/** What a script returned, with what is needed to tell whether it is still current. */
export type PythonResult = {
  key: string;
  runtime: string;
  createdAt: string;
  seconds: number;
  log: string[];
  /** Per output: a list of rows for a tensor, or a dict of columns for a table. */
  outputs: Record<string, unknown>;
};

/** Tensor inputs as the script sees them: plain lists, one value per combination of coordinates. */
export type TensorData = { dims: string[]; coords: string[][]; values: number[]; unit: string };

/** Persists results across sessions, e.g. in IndexedDB. */
export type ResultStore = {
  get: (key: string) => Promise<PythonResult | undefined>;
  put: (result: PythonResult) => Promise<void>;
};

/** JSON with one row (or column) per line, so a recomputed snapshot diffs line by line. */
export function formatResult(result: PythonResult): string {
  const { outputs, ...meta } = result;
  const header = JSON.stringify(meta, null, 2).slice(0, -2);
  const body = Object.entries(outputs)
    .map(([name, value]) => `    ${JSON.stringify(name)}: ${formatOutput(value)}`)
    .join(',\n');
  return `${header},\n  "outputs": {\n${body}\n  }\n}\n`;
}

export function parseResult(text: string): PythonResult {
  const result = JSON.parse(text) as PythonResult;
  if (typeof result.key !== 'string' || typeof result.outputs !== 'object') throw new Error('Not a Python node result');
  return result;
}

function formatOutput(value: unknown): string {
  const lines = Array.isArray(value)
    ? value.map((row) => JSON.stringify(row))
    : Object.entries(value as Record<string, unknown>).map(([column, values]) => `${JSON.stringify(column)}: ${JSON.stringify(values)}`);
  const [open, close] = Array.isArray(value) ? ['[', ']'] : ['{', '}'];
  return `${open}\n${lines.map((line) => `      ${line}`).join(',\n')}\n    ${close}`;
}
