import type { Issue } from '../../runtime/pipeline';
import type { Tensor } from '../../runtime/tensor';
import { BUILTIN_NAMES, compileElements, compileEquation, FUNCTIONS, lookup, REDUCERS, stridesOf, type CodegenContext, type Kernel } from './codegen';
import type { Table, XmileModel, XmileVariable } from './document';
import type { VariableTrace } from '../types';
import { canonicalName, parseEquation, references, type Expr } from './expression';

type Program = {
  model: XmileModel;
  dims: Map<string, string[]>;
  variables: Map<string, Variable>;
  steps: number;
};

type Variable = {
  source: XmileVariable;
  dims: string[];
  buffer: Float64Array;
  definition: Definition;
};

type Definition =
  | { kind: 'equation'; expr: Expr; table?: Table }
  | { kind: 'elements'; elements: { at: number; position: number[]; expr: Expr; table?: Table }[] }
  | { kind: 'data' }
  | { kind: 'series'; times: number[]; values: Float64Array };

/** Variables up to this many elements keep their full values in the trace. */
const TRACE_FULL_LIMIT = 2000;

/**
 * Runs a stock-and-flow model with its input variables bound to tensors (Euler integration)
 * and returns the requested variables as tensors over [year, ...dims], plus a trace of every variable.
 */
export function simulate(
  model: XmileModel,
  inputs: Record<string, Tensor>,
  save = outputNames(model),
): { outputs: Record<string, Tensor>; trace: Record<string, VariableTrace> } {
  const program = buildProgram(model, inputs);
  const small = [...program.variables.values()].filter((v) => v.buffer.length <= TRACE_FULL_LIMIT).map((v) => v.source.ident);
  const { series, summaries } = run(program, [...new Set([...save.map(canonicalName), ...small])]);
  const tensorOf = (v: Variable) => toTensor(program, v, series);
  const outputs = Object.fromEntries(save.map((name) => [name, tensorOf(program.variables.get(canonicalName(name))!)]));
  const years = Array.from({ length: program.steps }, (_, i) => String(model.time.start + i * model.time.dt));
  const trace = Object.fromEntries(
    [...program.variables.values()].map((v) => [
      v.source.name,
      {
        years,
        summary: summaries.get(v.source.ident)!,
        aggregate: v.dims.length === 0 ? 'value' : v.source.kind === 'aux' ? 'mean' : 'total',
        tensor: series.has(v.source.ident) ? tensorOf(v) : undefined,
      } satisfies VariableTrace,
    ]),
  );
  return { outputs, trace };
}

/** Structural problems found without running: unsupported features, bad equations, unknown names. */
export function checkModel(model: XmileModel): Issue[] {
  const issues: Issue[] = [];
  const error = (where: string, message: string) => issues.push({ severity: 'error', where, message });
  if (model.time.method !== 'euler') error('sim_specs', `Integration method ${model.time.method} is not supported; use Euler`);
  const idents = new Set(model.variables.map((v) => v.ident));
  for (const v of model.variables) {
    for (const tag of v.unsupported) error(v.name, `<${tag}> is not supported`);
    for (const dim of v.dims) if (!model.dims.has(dim)) error(v.name, `Undeclared dimension ${dim}`);
    for (const flow of [...v.inflows, ...v.outflows]) if (!idents.has(flow)) error(v.name, `Unknown flow ${flow}`);
    if (v.access === 'input') continue;
    for (const equation of [v.equation, ...v.elementEquations.map((e) => e.equation)]) {
      try {
        for (const problem of unknownNames(parseEquation(equation), idents)) error(v.name, problem);
      } catch (e) {
        error(v.name, (e as Error).message);
      }
    }
  }
  return issues;
}

function outputNames(model: XmileModel): string[] {
  return model.variables.filter((v) => v.access === 'output').map((v) => v.name);
}

// ---------------------------------------------------------------------------
// Building the program: dimensions, buffers, and each variable's definition
// ---------------------------------------------------------------------------

function buildProgram(model: XmileModel, inputs: Record<string, Tensor>): Program {
  const dims = resolveDimensions(model, inputs);
  const variables = new Map<string, Variable>();
  for (const source of model.variables) {
    const size = source.dims.reduce((n, d) => n * dims.get(d)!.length, 1);
    const buffer = new Float64Array(size);
    const definition = source.access === 'input'
      ? bindInput(source, inputs[source.name], dims, buffer)
      : defineVariable(source, dims);
    variables.set(source.ident, { source, dims: source.dims, buffer, definition });
  }
  for (const v of variables.values()) checkFlows(v, variables);
  const steps = Math.round((model.time.stop - model.time.start) / model.time.dt) + 1;
  return { model, dims, variables, steps };
}

/** Declared elements, or for dimensions declared without elements, the coordinates of the inputs that use them. */
function resolveDimensions(model: XmileModel, inputs: Record<string, Tensor>): Map<string, string[]> {
  const dims = new Map(model.dims);
  const fromData = new Map<string, string>();
  for (const v of model.variables.filter((v) => v.access === 'input')) {
    const tensor = inputs[v.name];
    if (!tensor) continue;
    checkInputDims(v, tensor);
    for (const [k, dim] of tensor.dims.entries()) {
      const ident = canonicalName(dim);
      if (dim === 'year' || !v.dims.includes(ident)) continue;
      const coords = tensor.coords[k]!;
      const declared = dims.get(ident);
      if (declared && declared.length === 0) {
        dims.set(ident, coords);
        fromData.set(ident, v.name);
      } else if (fromData.has(ident) && !sameElements(declared!, coords)) {
        throw new Error(`Input ${v.name}: elements of ${dim} differ from those of input ${fromData.get(ident)}`);
      }
    }
  }
  for (const [dim, elements] of dims) {
    if (elements.length === 0) throw new Error(`Dimension ${dim} has no elements: declare them or bind an input that varies by it`);
  }
  return dims;
}

/** Copies a dataset into the input's buffer; a dataset with several years becomes a time series. */
function bindInput(variable: XmileVariable, tensor: Tensor | undefined, dims: Map<string, string[]>, buffer: Float64Array): Definition {
  if (!tensor) throw new Error(`Missing input ${variable.name}`);
  checkUnits(variable, tensor);
  const tensorDims = tensor.dims.map(canonicalName);
  const yearAxis = tensor.dims.indexOf('year');
  const tensorStrides = stridesOf(tensor.coords.map((c) => c.length));
  const positions = variable.dims.map((dim) => {
    const axis = tensorDims.indexOf(dim);
    const index = new Map(tensor.coords[axis]!.map((c, i) => [canonicalName(c), i]));
    return dims.get(dim)!.map((element) => {
      const at = index.get(canonicalName(element));
      if (at === undefined) throw new Error(`Input ${variable.name}: dataset has no ${tensor.dims[axis]}=${element}`);
      return at * tensorStrides[axis]!;
    });
  });
  const offsets = flatOffsets(positions, buffer.length);
  const years = yearAxis >= 0 ? tensor.coords[yearAxis]! : ['0'];
  const yearStride = yearAxis >= 0 ? tensorStrides[yearAxis]! : 0;
  const values = new Float64Array(years.length * buffer.length);
  for (let y = 0; y < years.length; y++) {
    for (let b = 0; b < buffer.length; b++) {
      const value = tensor.values[y * yearStride + offsets[b]!]!;
      if (!Number.isFinite(value)) throw new Error(`Input ${variable.name}: non-finite value ${value}`);
      values[y * buffer.length + b] = value;
    }
  }
  if (years.length === 1) {
    buffer.set(values);
    return { kind: 'data' };
  }
  return { kind: 'series', times: years.map(Number), values };
}

function defineVariable(variable: XmileVariable, dims: Map<string, string[]>): Definition {
  if (variable.elementEquations.length === 0) {
    return { kind: 'equation', expr: parseEquation(variable.equation), table: variable.table };
  }
  const strides = stridesOf(variable.dims.map((d) => dims.get(d)!.length));
  const elements = variable.elementEquations.map((e) => {
    if (e.subscript.length !== variable.dims.length) throw new Error(`${variable.name}: element [${e.subscript}] has the wrong number of subscripts`);
    const position = e.subscript.map((s, k) => {
      const index = dims.get(variable.dims[k]!)!.findIndex((element) => canonicalName(element) === canonicalName(s));
      if (index < 0) throw new Error(`${variable.name}: ${s} is not an element of ${variable.dims[k]}`);
      return index;
    });
    const at = position.reduce((n, p, k) => n + p * strides[k]!, 0);
    return { at, position, expr: parseEquation(e.equation), table: e.table };
  });
  const size = variable.dims.reduce((n, d) => n * dims.get(d)!.length, 1);
  if (new Set(elements.map((e) => e.at)).size !== size) throw new Error(`${variable.name}: needs exactly one equation per element`);
  return { kind: 'elements', elements };
}

function checkFlows(stock: Variable, variables: Map<string, Variable>): void {
  for (const name of [...stock.source.inflows, ...stock.source.outflows]) {
    const flow = variables.get(name);
    if (!flow) throw new Error(`${stock.source.name}: unknown flow ${name}`);
    if (flow.dims.join() !== stock.dims.join()) throw new Error(`${stock.source.name}: flow ${name} must have the same dimensions as the stock`);
  }
}

function checkInputDims(variable: XmileVariable, tensor: Tensor): void {
  const valueDims = tensor.dims.filter((d) => d !== 'year').map(canonicalName);
  if (!sameElements(valueDims, variable.dims)) {
    throw new Error(`Input ${variable.name}: dataset dims [${valueDims}] do not match model dims [${variable.dims}]`);
  }
}

function checkUnits(variable: XmileVariable, tensor: Tensor): void {
  if (!variable.units) return;
  const normalize = (u: string) => u.replace(/\s+/g, '').toLowerCase();
  if (normalize(variable.units) !== normalize(tensor.unit)) {
    throw new Error(`Input ${variable.name}: dataset unit "${tensor.unit}" does not match model unit "${variable.units}"`);
  }
}

// ---------------------------------------------------------------------------
// Running: an initial pass in dependency order, then integrate stocks and
// recompute everything that can change, step by step
// ---------------------------------------------------------------------------

function run(program: Program, save: string[]): { series: Map<string, Float64Array>; summaries: Map<string, Float64Array> } {
  const { start, dt } = program.model.time;
  const deps = dependencies(program);
  const constant = constantVariables(program, deps);
  const isStock = (name: string) => program.variables.get(name)!.source.kind === 'stock';
  const initialOrder = topologicalOrder(program, deps, () => true);
  const dynamicOrder = topologicalOrder(program, deps, (name) => !isStock(name)).filter((n) => !constant.has(n) && !isStock(n));
  const kernels = compileKernels(program);
  const stocks = [...program.variables.values()].filter((v) => v.source.kind === 'stock');

  const series = new Map(save.map((name) => {
    const v = program.variables.get(name);
    if (!v) throw new Error(`Unknown variable ${name}`);
    return [name, new Float64Array(program.steps * v.buffer.length)];
  }));
  const summaries = new Map([...program.variables.keys()].map((name) => [name, new Float64Array(program.steps)]));
  const record = (step: number) => {
    for (const [name, out] of series) {
      const buffer = program.variables.get(name)!.buffer;
      out.set(buffer, step * buffer.length);
    }
    for (const [name, out] of summaries) {
      const v = program.variables.get(name)!;
      let total = 0;
      for (let i = 0; i < v.buffer.length; i++) total += v.buffer[i]!;
      out[step] = v.source.kind === 'aux' ? total / v.buffer.length : total;
    }
  };

  for (const name of initialOrder) kernels.get(name)!(start, true);
  record(0);
  for (let step = 1; step < program.steps; step++) {
    for (const stock of stocks) integrate(stock, program.variables, dt);
    const t = start + step * dt;
    for (const name of dynamicOrder) kernels.get(name)!(t, false);
    record(step);
  }
  return { series, summaries };
}

function compileKernels(program: Program): Map<string, Kernel> {
  const ctx: CodegenContext = {
    dims: program.dims,
    elementIndex: new Map([...program.dims].map(([d, elements]) => [d, new Map(elements.map((e, i) => [canonicalName(e), i]))])),
    variable: (ident) => program.variables.get(ident),
    time: program.model.time,
  };
  const kernels = new Map<string, Kernel>();
  for (const [name, v] of program.variables) {
    try {
      kernels.set(name, compileKernel(ctx, v));
    } catch (e) {
      throw new Error(`${v.source.name}: ${(e as Error).message}`);
    }
  }
  return kernels;
}

function compileKernel(ctx: CodegenContext, v: Variable): Kernel {
  const d = v.definition;
  switch (d.kind) {
    case 'data':
      return () => {};
    case 'series':
      return (t) => interpolate(d.times, d.values, t, v.buffer);
    case 'equation':
      return compileEquation(ctx, v.dims, v.buffer, d.expr, d.table);
    case 'elements':
      return compileElements(ctx, v.dims, v.buffer, d.elements);
  }
}

function integrate(stock: Variable, variables: Map<string, Variable>, dt: number): void {
  const level = stock.buffer;
  const inflows = stock.source.inflows.map((n) => variables.get(n)!.buffer);
  const outflows = stock.source.outflows.map((n) => variables.get(n)!.buffer);
  for (let i = 0; i < level.length; i++) {
    let net = 0;
    for (const f of inflows) net += f[i]!;
    for (const f of outflows) net -= f[i]!;
    level[i] = level[i]! + dt * net;
  }
}

/** Linear interpolation between the dataset's years, held constant outside them. */
function interpolate(times: number[], values: Float64Array, t: number, out: Float64Array): void {
  const size = out.length;
  let k = times.findIndex((time) => time >= t);
  if (k === 0 || k === -1) {
    const row = k === 0 ? 0 : times.length - 1;
    out.set(values.subarray(row * size, (row + 1) * size));
    return;
  }
  const w = (t - times[k - 1]!) / (times[k]! - times[k - 1]!);
  for (let i = 0; i < size; i++) out[i] = values[(k - 1) * size + i]! * (1 - w) + values[k * size + i]! * w;
}

// ---------------------------------------------------------------------------
// Dependency analysis
// ---------------------------------------------------------------------------

type Dependencies = Map<string, { names: Set<string>; usesTime: boolean }>;

function dependencies(program: Program): Dependencies {
  const deps: Dependencies = new Map();
  for (const [name, v] of program.variables) {
    const found = { names: new Set<string>(), usesTime: v.definition.kind === 'series' };
    if (v.definition.kind === 'equation') references(v.definition.expr, found);
    if (v.definition.kind === 'elements') for (const e of v.definition.elements) references(e.expr, found);
    for (const n of found.names) if (!program.variables.has(n)) found.names.delete(n);
    deps.set(name, found);
  }
  return deps;
}

/** Variables that depend on neither time nor stocks: computed once in the initial pass. */
function constantVariables(program: Program, deps: Dependencies): Set<string> {
  const result = new Map<string, boolean>();
  const isConstant = (name: string): boolean => {
    const known = result.get(name);
    if (known !== undefined) return known;
    result.set(name, false);
    const v = program.variables.get(name)!;
    const d = deps.get(name)!;
    const value = v.source.kind !== 'stock' && !d.usesTime && [...d.names].every(isConstant);
    result.set(name, value);
    return value;
  };
  return new Set([...program.variables.keys()].filter(isConstant));
}

function topologicalOrder(program: Program, deps: Dependencies, follow: (name: string) => boolean): string[] {
  const order: string[] = [];
  const state = new Map<string, 'visiting' | 'done'>();
  const visit = (name: string, path: string[]) => {
    if (state.get(name) === 'done') return;
    if (state.get(name) === 'visiting') throw new Error(`Circular equations without a stock: ${[...path, name].join(' → ')}`);
    state.set(name, 'visiting');
    for (const d of deps.get(name)!.names) if (follow(d)) visit(d, [...path, name]);
    state.set(name, 'done');
    order.push(name);
  };
  for (const name of program.variables.keys()) visit(name, []);
  return order;
}

function unknownNames(expr: Expr, idents: Set<string>): string[] {
  switch (expr.kind) {
    case 'num':
      return [];
    case 'ref':
      return BUILTIN_NAMES.has(expr.name) || idents.has(expr.name) ? [] : [`Unknown variable ${expr.name}`];
    case 'binary':
      return [...unknownNames(expr.left, idents), ...unknownNames(expr.right, idents)];
    case 'unary':
      return unknownNames(expr.operand, idents);
    case 'if':
      return [expr.condition, expr.then, expr.else].flatMap((e) => unknownNames(e, idents));
    case 'call': {
      const known = expr.fn in FUNCTIONS || REDUCERS.has(expr.fn);
      return [...(known ? [] : [`Unsupported function ${expr.fn.toUpperCase()}`]), ...expr.args.flatMap((e) => unknownNames(e, idents))];
    }
  }
}

// ---------------------------------------------------------------------------
// Output
// ---------------------------------------------------------------------------

function toTensor(program: Program, v: Variable, series: Map<string, Float64Array>): Tensor {
  const { start, dt } = program.model.time;
  const years = Array.from({ length: program.steps }, (_, i) => String(start + i * dt));
  return {
    dims: ['year', ...v.dims],
    coords: [years, ...v.dims.map((d) => program.dims.get(d)!)],
    values: series.get(v.source.ident)!,
    unit: v.source.units ?? '',
  };
}

function flatOffsets(positions: number[][], size: number): Int32Array {
  const offsets = new Int32Array(size);
  const strides = stridesOf(positions.map((p) => p.length));
  for (let b = 0; b < size; b++) {
    let offset = 0;
    for (const [k, p] of positions.entries()) offset += p[Math.floor(b / strides[k]!) % p.length]!;
    offsets[b] = offset;
  }
  return offsets;
}

function sameElements(a: string[], b: string[]): boolean {
  const canon = (xs: string[]) => xs.map(canonicalName).sort().join('\u0000');
  return a.length === b.length && canon(a) === canon(b);
}
