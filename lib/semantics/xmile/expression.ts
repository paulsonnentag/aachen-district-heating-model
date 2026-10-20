export type Expr =
  | { kind: 'num'; value: number }
  | { kind: 'ref'; name: string; subscripts: Subscript[] | null }
  | { kind: 'binary'; op: BinaryOp; left: Expr; right: Expr }
  | { kind: 'unary'; op: '-' | 'not'; operand: Expr }
  | { kind: 'if'; condition: Expr; then: Expr; else: Expr }
  | { kind: 'call'; fn: string; args: Expr[] };

export type Subscript = { kind: 'name'; name: string } | { kind: 'star' };

export type BinaryOp = '+' | '-' | '*' | '/' | '^' | '=' | '<>' | '<' | '>' | '<=' | '>=' | 'and' | 'or';

const TOKEN = /\s*(\d+\.?\d*(?:e[+-]?\d+)?|\.\d+(?:e[+-]?\d+)?|[A-Za-z_][A-Za-z0-9_]*|"[^"]*"|>=|<=|<>|[-+*/^()[\],<>=])/giy;
const KEYWORDS = new Set(['if', 'then', 'else', 'and', 'or', 'not']);
const COMPARISONS: BinaryOp[] = ['=', '<>', '<', '>', '<=', '>='];

/** Parses an XMILE equation. Names are canonicalized (lowercase, underscores). */
export function parseEquation(source: string): Expr {
  const tokens = tokenize(source);
  let pos = 0;
  const expr = parseIf();
  if (pos < tokens.length) fail(`unexpected "${tokens[pos]}"`);
  return expr;

  function parseIf(): Expr {
    if (peek() !== 'if') return parseOr();
    pos++;
    const condition = parseIf();
    expect('then');
    const then = parseIf();
    expect('else');
    return { kind: 'if', condition, then, else: parseIf() };
  }

  function parseOr(): Expr {
    return leftAssoc(['or'], parseAnd);
  }

  function parseAnd(): Expr {
    return leftAssoc(['and'], parseNot);
  }

  function parseNot(): Expr {
    if (peek() !== 'not') return parseComparison();
    pos++;
    return { kind: 'unary', op: 'not', operand: parseNot() };
  }

  function parseComparison(): Expr {
    return leftAssoc(COMPARISONS, parseAdditive);
  }

  function parseAdditive(): Expr {
    return leftAssoc(['+', '-'], parseMultiplicative);
  }

  function parseMultiplicative(): Expr {
    return leftAssoc(['*', '/'], parseUnary);
  }

  function parseUnary(): Expr {
    if (peek() === '-') {
      pos++;
      return { kind: 'unary', op: '-', operand: parseUnary() };
    }
    if (peek() === '+') pos++;
    return parsePower();
  }

  function parsePower(): Expr {
    const base = parseAtom();
    if (peek() !== '^') return base;
    pos++;
    return { kind: 'binary', op: '^', left: base, right: parseUnary() };
  }

  function parseAtom(): Expr {
    const token = tokens[pos++];
    if (token === undefined) return fail('unexpected end of equation');
    if (token === '(') {
      const inner = parseIf();
      expect(')');
      return inner;
    }
    if (/^[\d.]/.test(token)) return { kind: 'num', value: Number(token) };
    if (!/^[A-Za-z_"]/.test(token)) return fail(`unexpected "${token}"`);
    const name = canonicalName(token.replace(/"/g, ''));
    if (KEYWORDS.has(name)) return fail(`unexpected "${token}"`);
    if (peek() === '(') return { kind: 'call', fn: name, args: list('(', ')', parseIf) };
    if (peek() === '[') return { kind: 'ref', name, subscripts: list('[', ']', parseSubscript) };
    return { kind: 'ref', name, subscripts: null };
  }

  function parseSubscript(): Subscript {
    if (peek() === '*') {
      pos++;
      return { kind: 'star' };
    }
    const token = tokens[pos++];
    if (token === undefined || !/^[A-Za-z_\d"]/.test(token)) return fail('expected a subscript');
    return { kind: 'name', name: canonicalName(token.replace(/"/g, '')) };
  }

  function list<T>(open: string, close: string, item: () => T): T[] {
    expect(open);
    const items: T[] = [];
    while (peek() !== close) {
      items.push(item());
      if (peek() !== close) expect(',');
    }
    pos++;
    return items;
  }

  function leftAssoc(ops: string[], operand: () => Expr): Expr {
    let left = operand();
    while (ops.includes(peek() ?? '')) {
      const op = tokens[pos++]!.toLowerCase() as BinaryOp;
      left = { kind: 'binary', op, left, right: operand() };
    }
    return left;
  }

  function peek(): string | undefined {
    return tokens[pos]?.toLowerCase();
  }

  function expect(token: string): void {
    if (peek() !== token) fail(`expected "${token}"`);
    pos++;
  }

  function fail(message: string): never {
    throw new Error(`${message} in "${source.trim()}"`);
  }
}

/** The names an expression reads, and whether it reads TIME. Subscript labels are not references. */
export function references(expr: Expr, found = { names: new Set<string>(), usesTime: false }): { names: Set<string>; usesTime: boolean } {
  switch (expr.kind) {
    case 'ref':
      if (expr.name === 'time') found.usesTime = true;
      else found.names.add(expr.name);
      break;
    case 'binary':
      references(expr.left, found);
      references(expr.right, found);
      break;
    case 'unary':
      references(expr.operand, found);
      break;
    case 'if':
      for (const e of [expr.condition, expr.then, expr.else]) references(e, found);
      break;
    case 'call':
      for (const e of expr.args) references(e, found);
      break;
  }
  return found;
}

export function canonicalName(name: string): string {
  return name.trim().toLowerCase().replace(/[\s_]+/g, '_');
}

function tokenize(source: string): string[] {
  const tokens: string[] = [];
  let end = 0;
  TOKEN.lastIndex = 0;
  for (let match = TOKEN.exec(source); match; match = TOKEN.exec(source)) {
    tokens.push(match[1]!);
    end = TOKEN.lastIndex;
  }
  const rest = source.slice(end).trim();
  if (rest) throw new Error(`cannot read "${rest}" in "${source.trim()}"`);
  return tokens;
}
