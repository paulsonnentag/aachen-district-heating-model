import { z } from 'zod';
import { tensorFromRows, type ReadText } from '../runtime/datasets';
import { ColumnSpecSchema } from '../runtime/pipeline';
import { tableFromColumns, type Table } from '../runtime/table';
import type { Tensor } from '../runtime/tensor';
import type { CacheInfo, NodeOutput } from './types';

/** A node's result in plain JSON, with what is needed to tell whether it is still current. */
export type KeptResult = {
  key: string;
  runtime: string;
  createdAt: string;
  seconds: number;
  log: string[];
  /** Per output: a list of rows for a tensor (coordinates, then the value), or a dict of columns for a table. */
  outputs: Record<string, unknown>;
};

/** Persists results across sessions, e.g. in IndexedDB. */
export type ResultStore = {
  get: (key: string) => Promise<KeptResult | undefined>;
  put: (result: KeptResult) => Promise<void>;
};

export const OutputSchema = z.union([
  z.object({
    kind: z.literal('table'),
    description: z.string().optional(),
    columns: z.record(z.string(), ColumnSpecSchema).default({}),
  }),
  z.object({
    kind: z.literal('tensor').optional(),
    dims: z.array(z.string()).default([]),
    unit: z.string(),
    description: z.string().optional(),
  }),
]);

export type OutputSpec = z.infer<typeof OutputSchema>;

export type Found = { result: KeptResult; origin: CacheInfo['origin']; warnings: string[] };

/** Where a node's result comes from when it is not computed: memory, the committed snapshot, then the store. */
export type Keeper = {
  find: (key: string, snapshot: string | undefined, readText: ReadText) => Promise<Found | undefined>;
  compute: (
    key: string,
    snapshot: string | undefined,
    readText: ReadText,
    run: () => Promise<{ outputs: Record<string, unknown>; log: string[] }>,
  ) => Promise<Found>;
};

export function createKeeper(runtime: string, store?: ResultStore): Keeper {
  const results = new Map<string, Promise<Found>>();
  const remember = (key: string, found: Found) => {
    results.set(key, Promise.resolve(found));
    return found;
  };
  return {
    async find(key, snapshot, readText) {
      const known = results.get(key);
      if (known) return known;
      const committed = snapshot ? await readSnapshot(readText, snapshot) : undefined;
      if (committed?.key === key) return remember(key, { result: committed, origin: 'snapshot', warnings: [] });
      const stored = await store?.get(key);
      if (stored) return remember(key, { result: stored, origin: 'stored', warnings: [] });
      return undefined;
    },
    compute(key, snapshot, readText, run) {
      const running = (async (): Promise<Found> => {
        const warnings = await staleSnapshot(snapshot, readText);
        const started = performance.now();
        const { outputs, log } = await run();
        const result: KeptResult = {
          key,
          runtime,
          createdAt: new Date().toISOString(),
          seconds: Math.round((performance.now() - started) / 100) / 10,
          log,
          outputs,
        };
        await store?.put(result);
        return { result, origin: 'computed', warnings };
      })();
      results.set(key, running);
      running.catch(() => results.get(key) === running && results.delete(key));
      return running;
    },
  };
}

/** Converting a large table takes a moment, so each result keeps its converted outputs. */
const converted = new WeakMap<KeptResult, { spec: string; output: NodeOutput }>();

export function toOutput(specs: Record<string, OutputSpec>, { result, origin, warnings }: Found): NodeOutput {
  const spec = JSON.stringify(specs);
  const known = converted.get(result);
  const { key, runtime, createdAt, seconds } = result;
  const cache: CacheInfo = { origin, key, runtime, createdAt, seconds };
  if (known?.spec === spec) return { ...known.output, warnings, cache };
  const outputs: Record<string, Tensor> = {};
  const tables: Record<string, Table> = {};
  for (const [port, out] of Object.entries(specs)) {
    const value = result.outputs[port];
    if (value === undefined) throw new Error(`The result has no "${port}"`);
    try {
      if (out.kind === 'table') {
        if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error('expected a dict of columns');
        tables[port] = tableFromColumns(value as Record<string, unknown[]>, out.columns);
      } else {
        if (!Array.isArray(value)) throw new Error('expected a list of rows');
        outputs[port] = tensorFromRows(value.map(toRow), out.dims, out.unit);
      }
    } catch (error) {
      throw new Error(`Output ${port}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  const output: NodeOutput = { outputs, tables, warnings, log: result.log, cache };
  converted.set(result, { spec, output });
  return output;
}

/** JSON with one row (or column) per line, so a recomputed snapshot diffs line by line. */
export function formatResult(result: KeptResult): string {
  const { outputs, ...meta } = result;
  const header = JSON.stringify(meta, null, 2).slice(0, -2);
  const body = Object.entries(outputs)
    .map(([name, value]) => `    ${JSON.stringify(name)}: ${formatOutput(value)}`)
    .join(',\n');
  return `${header},\n  "outputs": {\n${body}\n  }\n}\n`;
}

export function parseResult(text: string): KeptResult {
  const result = JSON.parse(text) as KeptResult;
  if (typeof result.key !== 'string' || typeof result.outputs !== 'object') throw new Error('Not a node result');
  return result;
}

async function staleSnapshot(snapshot: string | undefined, readText: ReadText): Promise<string[]> {
  if (!snapshot) return [];
  const committed = await readSnapshot(readText, snapshot);
  return [
    committed
      ? `Snapshot ${snapshot} is out of date: the code, runtime or inputs changed since it was made`
      : `Snapshot ${snapshot} could not be read`,
  ];
}

async function readSnapshot(readText: ReadText, path: string): Promise<KeptResult | undefined> {
  try {
    return parseResult(await readText(path));
  } catch {
    return undefined;
  }
}

function toRow(row: unknown): { at: string[]; value: number } {
  if (!Array.isArray(row)) throw new Error(`Row ${JSON.stringify(row)} is not a list`);
  const value = row[row.length - 1];
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error(`Row ${JSON.stringify(row)} does not end in a number`);
  return { at: row.slice(0, -1).map(String), value };
}

function formatOutput(value: unknown): string {
  const lines = Array.isArray(value)
    ? value.map((row) => JSON.stringify(row))
    : Object.entries(value as Record<string, unknown>).map(([column, values]) => `${JSON.stringify(column)}: ${JSON.stringify(values)}`);
  const [open, close] = Array.isArray(value) ? ['[', ']'] : ['{', '}'];
  return `${open}\n${lines.map((line) => `      ${line}`).join(',\n')}\n    ${close}`;
}
