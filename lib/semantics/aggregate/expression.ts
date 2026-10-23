/** Formulas over table rows: arithmetic, comparisons, `and`/`or`/`not` and function calls such as `sum(x * y)`. */
export type Expr =
  | { kind: 'number'; value: number }
  | { kind: 'name'; name: string }
  | { kind: 'call'; name: string; args: Expr[] }
  | { kind: 'unary'; op: '-' | 'not'; arg: Expr }
  | { kind: 'binary'; op: BinaryOp; left: Expr; right: Expr };

export type BinaryOp = '+' | '-' | '*' | '/' | '<' | '<=' | '>' | '>=' | '==' | '!=' | 'and' | 'or';

type Token = { kind: 'number' | 'name' | 'op'; text: string; at: number };

const TOKEN = /\s*(?:(\d+(?:\.\d*)?(?:e[+-]?\d+)?|\.\d+)|([A-Za-z_][A-Za-z0-9_]*)|(<=|>=|==|!=|[-+*/(),<>]))/y;
const KEYWORDS = new Set(['and', 'or', 'not']);
const COMPARISONS = new Set(['<', '<=', '>', '>=', '==', '!=']);

export function parseExpression(text: string): Expr {
  const tokens = tokenize(text);
  let position = 0;
  const peek = () => tokens[position];
  const fail = (message: string): never => {
    throw new Error(`${message} at "${text.slice(peek()?.at ?? text.length).trim() || 'the end'}" in ${text}`);
  };
  const take = (expected?: string) => {
    const token = tokens[position];
    if (!token || (expected !== undefined && token.text !== expected)) fail(expected ? `Expected "${expected}"` : 'Unexpected end');
    position++;
    return token!;
  };
  const isOp = (...ops: string[]) => {
    const token = peek();
    return token !== undefined && (token.kind === 'op' || KEYWORDS.has(token.text)) && ops.includes(token.text);
  };

  const binaryLevel = (ops: string[], next: () => Expr) => (): Expr => {
    let left = next();
    while (isOp(...ops)) {
      const op = take().text as BinaryOp;
      left = { kind: 'binary', op, left, right: next() };
    }
    return left;
  };
  const primary = (): Expr => {
    const token = take();
    if (token.kind === 'number') return { kind: 'number', value: Number(token.text) };
    if (token.text === '(') {
      const inner = or();
      take(')');
      return inner;
    }
    if (token.kind === 'name' && !KEYWORDS.has(token.text)) {
      if (!isOp('(')) return { kind: 'name', name: token.text };
      take('(');
      const args: Expr[] = [];
      while (!isOp(')')) {
        args.push(or());
        if (!isOp(')')) take(',');
      }
      take(')');
      return { kind: 'call', name: token.text, args };
    }
    position--;
    return fail('Expected a value');
  };
  const unary = (): Expr => {
    if (isOp('-')) {
      take();
      return { kind: 'unary', op: '-', arg: unary() };
    }
    return primary();
  };
  const product = binaryLevel(['*', '/'], unary);
  const sum = binaryLevel(['+', '-'], product);
  const comparison = (): Expr => {
    const left = sum();
    if (!isOp(...COMPARISONS)) return left;
    const op = take().text as BinaryOp;
    return { kind: 'binary', op, left, right: sum() };
  };
  const not = (): Expr => {
    if (isOp('not')) {
      take();
      return { kind: 'unary', op: 'not', arg: not() };
    }
    return comparison();
  };
  const and = binaryLevel(['and'], not);
  const or = binaryLevel(['or'], and);

  const expr = or();
  if (position < tokens.length) fail('Unexpected');
  return expr;
}

/** Names the formula reads, outside and inside function calls. */
export function namesIn(expr: Expr): string[] {
  switch (expr.kind) {
    case 'number':
      return [];
    case 'name':
      return [expr.name];
    case 'call':
      return expr.args.flatMap(namesIn);
    case 'unary':
      return namesIn(expr.arg);
    case 'binary':
      return [...namesIn(expr.left), ...namesIn(expr.right)];
  }
}

function tokenize(text: string): Token[] {
  const tokens: Token[] = [];
  TOKEN.lastIndex = 0;
  while (TOKEN.lastIndex < text.length) {
    if (/^\s*$/.test(text.slice(TOKEN.lastIndex))) break;
    const at = TOKEN.lastIndex;
    const match = TOKEN.exec(text);
    if (!match) throw new Error(`Cannot read "${text.slice(at).trim()}" in ${text}`);
    const [, number, name, op] = match;
    tokens.push(number !== undefined ? { kind: 'number', text: number, at } : name !== undefined ? { kind: 'name', text: name, at } : { kind: 'op', text: op!, at });
  }
  return tokens;
}
