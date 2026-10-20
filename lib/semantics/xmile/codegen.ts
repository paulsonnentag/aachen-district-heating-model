import type { Table } from './document';
import type { Expr, Subscript } from './expression';

/** Evaluates one variable into its buffer at time `t`; `initial` is true during the initial pass. */
export type Kernel = (t: number, initial: boolean) => void;

export type CodegenContext = {
  /** Resolved elements of every dimension. */
  dims: Map<string, string[]>;
  /** Index of each canonical element name, by dimension. */
  elementIndex: Map<string, Map<string, number>>;
  variable(ident: string): { dims: string[]; buffer: Float64Array } | undefined;
  time: { start: number; stop: number; dt: number };
};

export const FUNCTIONS: Record<string, string> = {
  min: 'Math.min',
  max: 'Math.max',
  abs: 'Math.abs',
  exp: 'Math.exp',
  ln: 'Math.log',
  log10: 'Math.log10',
  sqrt: 'Math.sqrt',
  sin: 'Math.sin',
  cos: 'Math.cos',
  tan: 'Math.tan',
  int: 'Math.floor',
};
export const REDUCERS = new Set(['sum', 'init']);
export const BUILTIN_NAMES = new Set(['time', 'dt', 'starttime', 'stoptime']);

/** Compiles an apply-to-all equation into one loop over the variable's elements. */
export function compileEquation(ctx: CodegenContext, dims: string[], out: Float64Array, expr: Expr, table?: Table): Kernel {
  const gen = generator(ctx);
  const value = gen.expression(expr, axesOf(ctx, dims), 'i', new Map(), new Map());
  const body = table ? `lookup(${gen.bind(table)}, ${value})` : value;
  return gen.finish(`for (let i = 0; i < ${out.length}; i++) out[i] = ${body};`, out);
}

/** Compiles per-element equations; dimension names inside them refer to the element being defined. */
export function compileElements(
  ctx: CodegenContext,
  dims: string[],
  out: Float64Array,
  elements: { at: number; position: number[]; expr: Expr; table?: Table }[],
): Kernel {
  if (elements.every((e) => e.expr.kind === 'num' && !e.table)) {
    for (const e of elements) out[e.at] = (e.expr as { value: number }).value;
    return () => {};
  }
  const gen = generator(ctx);
  const lines = elements.map((e) => {
    const context = new Map(dims.map((d, k) => [d, e.position[k]!]));
    const value = gen.expression(e.expr, [], 'i', new Map(), context);
    return `out[${e.at}] = ${e.table ? `lookup(${gen.bind(e.table)}, ${value})` : value};`;
  });
  return gen.finish(`const i = 0;\n${lines.join('\n')}`, out);
}

export function lookup(table: Table, x: number): number {
  const { xs, ys } = table;
  if (x <= xs[0]!) return ys[0]!;
  const last = xs.length - 1;
  if (x >= xs[last]!) return ys[last]!;
  let k = 1;
  while (xs[k]! < x) k++;
  const x0 = xs[k - 1]!;
  const y0 = ys[k - 1]!;
  return y0 + ((x - x0) / (xs[k]! - x0)) * (ys[k]! - y0);
}

type Axis = { dim: string; size: number };

/** Where each axis of a referenced variable comes from: an axis of the loop frame, or a fixed element. */
type AxisSource = { axis: number } | { fixed: number };

function generator(ctx: CodegenContext) {
  const env: unknown[] = [];
  let pre: string[] = [];
  let counter = 0;

  return { expression, bind, finish };

  function finish(loop: string, out: Float64Array): Kernel {
    const declarations = env.map((_, k) => `const e${k} = env[${k}];`).join('\n');
    const source = `${declarations}\n${pre.join('\n')}\n${loop}`;
    const fn = new Function('env', 'out', 't', 'initial', 'lookup', source) as (
      env: unknown[],
      out: Float64Array,
      t: number,
      initial: boolean,
      lookup: (table: Table, x: number) => number,
    ) => void;
    return (t, initial) => fn(env, out, t, initial, lookup);
  }

  function bind(value: unknown): string {
    env.push(value);
    return `e${env.length - 1}`;
  }

  function expression(expr: Expr, frame: Axis[], index: string, stars: Map<string, number>, context: Map<string, number>): string {
    const sub = (e: Expr) => expression(e, frame, index, stars, context);
    switch (expr.kind) {
      case 'num':
        return String(expr.value);
      case 'unary':
        return expr.op === '-' ? `(-${sub(expr.operand)})` : `((${sub(expr.operand)}) === 0 ? 1 : 0)`;
      case 'if':
        return `((${sub(expr.condition)}) !== 0 ? (${sub(expr.then)}) : (${sub(expr.else)}))`;
      case 'binary': {
        const l = sub(expr.left);
        const r = sub(expr.right);
        switch (expr.op) {
          case '^':
            return `Math.pow(${l}, ${r})`;
          case 'and':
            return `((${l}) !== 0 && (${r}) !== 0 ? 1 : 0)`;
          case 'or':
            return `((${l}) !== 0 || (${r}) !== 0 ? 1 : 0)`;
          case '=':
            return `(${l} === ${r} ? 1 : 0)`;
          case '<>':
            return `(${l} !== ${r} ? 1 : 0)`;
          case '<':
          case '>':
          case '<=':
          case '>=':
            return `(${l} ${expr.op} ${r} ? 1 : 0)`;
          default:
            return `(${l} ${expr.op} ${r})`;
        }
      }
      case 'call':
        if (expr.fn === 'sum') return sum(expr.args, frame, index, context);
        if (expr.fn === 'init') return init(expr.args, frame, index, stars, context);
        if (!(expr.fn in FUNCTIONS)) throw new Error(`Unsupported function ${expr.fn.toUpperCase()}`);
        return `${FUNCTIONS[expr.fn]}(${expr.args.map(sub).join(', ')})`;
      case 'ref':
        return reference(expr.name, expr.subscripts, frame, index, stars, context);
    }
  }

  /** SUM over the starred axes: a nested loop over the frame extended by those axes, hoisted before the main loop. */
  function sum(args: Expr[], frame: Axis[], index: string, context: Map<string, number>): string {
    const arg = single('SUM', args);
    const starDims = starredDims(arg);
    if (starDims.length === 0) throw new Error('SUM needs a * subscript to sum over');
    const inner = [...frame, ...axesOf(ctx, starDims)];
    const stars = new Map(starDims.map((d, k) => [d, frame.length + k]));
    const span = starDims.reduce((n, d) => n * ctx.dims.get(d)!.length, 1);
    const size = frameSize(frame);
    const id = counter++;
    const [body, nested] = hoisted(() => expression(arg, inner, `j${id}`, stars, context));
    const result = bind(new Float64Array(size));
    pre.push(
      ...nested,
      `for (let f${id} = 0; f${id} < ${size}; f${id}++) { let s = 0; for (let k${id} = 0; k${id} < ${span}; k${id}++) { const j${id} = f${id} * ${span} + k${id}; s += ${body}; } ${result}[f${id}] = s; }`,
    );
    return `${result}[${index}]`;
  }

  /** INIT: the argument evaluated once in the initial pass and held for the rest of the run. */
  function init(args: Expr[], frame: Axis[], index: string, stars: Map<string, number>, context: Map<string, number>): string {
    const arg = single('INIT', args);
    const size = frameSize(frame);
    const id = counter++;
    const [body, nested] = hoisted(() => expression(arg, frame, `g${id}`, stars, context));
    const held = bind(new Float64Array(size));
    pre.push(`if (initial) { ${nested.join('\n')} for (let g${id} = 0; g${id} < ${size}; g${id}++) ${held}[g${id}] = ${body}; }`);
    return `${held}[${index}]`;
  }

  function hoisted(build: () => string): [string, string[]] {
    const outer = pre;
    pre = [];
    const body = build();
    const nested = pre;
    pre = outer;
    return [body, nested];
  }

  function reference(
    name: string,
    subscripts: Subscript[] | null,
    frame: Axis[],
    index: string,
    stars: Map<string, number>,
    context: Map<string, number>,
  ): string {
    if (name === 'time') return 't';
    if (name === 'dt') return String(ctx.time.dt);
    if (name === 'starttime') return String(ctx.time.start);
    if (name === 'stoptime') return String(ctx.time.stop);
    const target = ctx.variable(name);
    if (!target) throw new Error(`Unknown variable ${name}`);
    if (subscripts && subscripts.length !== target.dims.length) {
      throw new Error(`${name} has ${target.dims.length} dimensions but is used with ${subscripts.length} subscripts`);
    }
    const buffer = bind(target.buffer);
    const sources = target.dims.map((dim, k) => axisSource(name, dim, subscripts?.[k], frame, stars, context));
    if (sources.every((s) => 'fixed' in s)) {
      const strides = stridesOf(target.dims.map((d) => ctx.dims.get(d)!.length));
      return `${buffer}[${sources.reduce((n, s, k) => n + (s as { fixed: number }).fixed * strides[k]!, 0)}]`;
    }
    if (sources.length === frame.length && sources.every((s, k) => 'axis' in s && s.axis === k)) return `${buffer}[${index}]`;
    return `${buffer}[${bind(gatherIndex(target.dims, sources, frame))}[${index}]]`;
  }

  function axisSource(
    name: string,
    dim: string,
    subscript: Subscript | undefined,
    frame: Axis[],
    stars: Map<string, number>,
    context: Map<string, number>,
  ): AxisSource {
    if (subscript?.kind === 'star') {
      const axis = stars.get(dim);
      if (axis === undefined) throw new Error(`${name}[*] can only appear inside SUM`);
      return { axis };
    }
    const label = subscript?.name ?? dim;
    if (ctx.dims.has(label)) {
      if (label !== dim) throw new Error(`${name}: subscript ${label} does not match its dimension ${dim}`);
      const axis = frame.findIndex((a) => a.dim === dim);
      if (axis >= 0) return { axis };
      const fixed = context.get(dim);
      if (fixed !== undefined) return { fixed };
      throw new Error(`${name} varies by ${dim}, which is not a dimension of the equation using it`);
    }
    const fixed = ctx.elementIndex.get(dim)?.get(label);
    if (fixed === undefined) throw new Error(`${name}: ${label} is not an element of ${dim}`);
    return { fixed };
  }

  function gatherIndex(dims: string[], sources: AxisSource[], frame: Axis[]): Int32Array {
    const size = frameSize(frame);
    const frameStrides = stridesOf(frame.map((a) => a.size));
    const sourceStrides = stridesOf(dims.map((d) => ctx.dims.get(d)!.length));
    const index = new Int32Array(size);
    for (let f = 0; f < size; f++) {
      let offset = 0;
      for (const [k, s] of sources.entries()) {
        const position = 'fixed' in s ? s.fixed : Math.floor(f / frameStrides[s.axis]!) % frame[s.axis]!.size;
        offset += position * sourceStrides[k]!;
      }
      index[f] = offset;
    }
    return index;
  }

  function starredDims(expr: Expr, found: string[] = []): string[] {
    switch (expr.kind) {
      case 'ref':
        for (const [k, s] of (expr.subscripts ?? []).entries()) {
          const dim = ctx.variable(expr.name)?.dims[k];
          if (s.kind === 'star' && dim && !found.includes(dim)) found.push(dim);
        }
        break;
      case 'binary':
        starredDims(expr.left, found);
        starredDims(expr.right, found);
        break;
      case 'unary':
        starredDims(expr.operand, found);
        break;
      case 'if':
        for (const e of [expr.condition, expr.then, expr.else]) starredDims(e, found);
        break;
      case 'call':
        if (expr.fn !== 'sum') for (const e of expr.args) starredDims(e, found);
        break;
    }
    return found;
  }
}

function single(fn: string, args: Expr[]): Expr {
  if (args.length !== 1) throw new Error(`${fn} takes one argument`);
  return args[0]!;
}

function axesOf(ctx: CodegenContext, dims: string[]): Axis[] {
  return dims.map((dim) => ({ dim, size: ctx.dims.get(dim)!.length }));
}

function frameSize(frame: Axis[]): number {
  return frame.reduce((n, a) => n * a.size, 1);
}

export function stridesOf(sizes: number[]): number[] {
  const strides = new Array<number>(sizes.length);
  let stride = 1;
  for (let k = sizes.length - 1; k >= 0; k--) {
    strides[k] = stride;
    stride *= sizes[k]!;
  }
  return strides;
}
