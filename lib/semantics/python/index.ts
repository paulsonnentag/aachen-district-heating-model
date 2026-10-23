import { z } from 'zod';
import { tensorFromRows, type ReadText } from '../../runtime/datasets';
import type { Issue, PipelineNode } from '../../runtime/pipeline';
import { tableData, tableFromColumns, type Table } from '../../runtime/table';
import type { Tensor } from '../../runtime/tensor';
import type { CacheInfo, ModelDescription, NodeInputs, NodeOutput, Semantics } from '../types';
import { parseResult, type PythonResult, type ResultStore, type TensorData } from './cache';
import type { PythonJob, PythonRun } from './pyodide';

const ColumnSpecSchema = z.object({
  unit: z.string().optional(),
  crs: z.string().optional(),
  description: z.string().optional(),
});

const OutputSchema = z.union([
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

const PythonModelSchema = z.object({
  script: z.string(),
  /** The function to call: it gets one keyword argument per input and returns a dict with one entry per output. */
  entry: z.string().default('run'),
  /** A committed result of an earlier run, reused while its key matches the current script and inputs. */
  snapshot: z.string().optional(),
  outputs: z.record(z.string(), OutputSchema),
});

type PythonModel = z.infer<typeof PythonModelSchema>;

/** What the semantics needs from its environment: a Python to run in, which also fetches the downloads. */
export type PythonHost = {
  runtime: string;
  run: (job: PythonJob, onLog: (line: string) => void) => Promise<PythonRun>;
  store?: ResultStore;
};

type Found = { result: PythonResult; origin: CacheInfo['origin']; warnings: string[] };

/**
 * Data preparation written in Python. The node names a function of the script: raw downloads arrive
 * as file paths, tensors and tables as dicts, and it returns rows for each tensor output (coordinates,
 * then the value) and a dict of columns for each table output. Results are reused from memory, the
 * committed snapshot or the host's store, in that order.
 */
export function createPythonSemantics(host: PythonHost): Semantics {
  const results = new Map<string, Promise<Found>>();
  return {
    id: 'python',
    async prepare(node, readText) {
      const model = PythonModelSchema.parse(node.model);
      const script = await readText(model.script);
      return {
        ports: { inputs: null, outputs: Object.keys(model.outputs) },
        issues: checkEntry(model, script),
        description: describe(node, model, script),
        fingerprint: JSON.stringify({ runtime: host.runtime, script, entry: model.entry }),
        lookup: async (key) => {
          const found = await find(key, model, readText);
          return found && toOutput(model, found);
        },
        execute: async (inputs, { key, fresh, onLog }) => {
          const found = fresh ? undefined : await find(key, model, readText);
          return toOutput(model, found ?? (await compute(key, model, script, readText, inputs, onLog)));
        },
      };
    },
  };

  async function find(key: string, model: PythonModel, readText: ReadText): Promise<Found | undefined> {
    const known = results.get(key);
    if (known) return known;
    const snapshot = model.snapshot ? await readSnapshot(readText, model.snapshot) : undefined;
    if (snapshot?.key === key) return remember(key, { result: snapshot, origin: 'snapshot', warnings: [] });
    const stored = await host.store?.get(key);
    if (stored) return remember(key, { result: stored, origin: 'stored', warnings: [] });
    return undefined;
  }

  async function remember(key: string, found: Found): Promise<Found> {
    results.set(key, Promise.resolve(found));
    return found;
  }

  function compute(key: string, model: PythonModel, script: string, readText: ReadText, inputs: NodeInputs, onLog: (line: string) => void): Promise<Found> {
    const running = (async (): Promise<Found> => {
      const warnings = await staleSnapshot(model, readText);
      return { result: await run(key, model, script, inputs, onLog), origin: 'computed', warnings };
    })();
    results.set(key, running);
    running.catch(() => results.get(key) === running && results.delete(key));
    return running;
  }

  async function run(key: string, model: PythonModel, script: string, inputs: NodeInputs, onLog: (line: string) => void): Promise<PythonResult> {
    const started = performance.now();
    const values: Record<string, TensorData | Record<string, unknown[]>> = {};
    for (const [port, tensor] of Object.entries(inputs.tensors)) values[port] = tensorData(tensor);
    for (const [port, table] of Object.entries(inputs.tables)) values[port] = tableData(table);
    onLog(`Running ${model.entry}() from ${model.script} in ${host.runtime}`);
    const job: PythonJob = { script, path: model.script, entry: model.entry, files: inputs.files, values: JSON.stringify(values) };
    const { outputs, log } = await host.run(job, onLog);
    const result: PythonResult = {
      key,
      runtime: host.runtime,
      createdAt: new Date().toISOString(),
      seconds: Math.round((performance.now() - started) / 100) / 10,
      log,
      outputs,
    };
    await host.store?.put(result);
    return result;
  }
}

async function staleSnapshot(model: PythonModel, readText: ReadText): Promise<string[]> {
  if (!model.snapshot) return [];
  const snapshot = await readSnapshot(readText, model.snapshot);
  return [
    snapshot
      ? `Snapshot ${model.snapshot} is out of date: the script, runtime or inputs changed since it was made`
      : `Snapshot ${model.snapshot} could not be read`,
  ];
}

/** Converting a large table takes a moment, so each result keeps its converted outputs. */
const converted = new WeakMap<PythonResult, { spec: string; output: NodeOutput }>();

function toOutput(model: PythonModel, { result, origin, warnings }: Found): NodeOutput {
  const spec = JSON.stringify(model.outputs);
  const known = converted.get(result);
  const { key, runtime, createdAt, seconds } = result;
  const cache: CacheInfo = { origin, key, runtime, createdAt, seconds };
  if (known?.spec === spec) return { ...known.output, warnings, cache };
  const outputs: Record<string, Tensor> = {};
  const tables: Record<string, Table> = {};
  for (const [port, out] of Object.entries(model.outputs)) {
    const value = result.outputs[port];
    if (value === undefined) throw new Error(`${model.entry}() returned no "${port}"`);
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

function toRow(row: unknown): { at: string[]; value: number } {
  if (!Array.isArray(row)) throw new Error(`Row ${JSON.stringify(row)} is not a list`);
  const value = row[row.length - 1];
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error(`Row ${JSON.stringify(row)} does not end in a number`);
  return { at: row.slice(0, -1).map(String), value };
}

async function readSnapshot(readText: ReadText, path: string): Promise<PythonResult | undefined> {
  try {
    return parseResult(await readText(path));
  } catch {
    return undefined;
  }
}

function checkEntry(model: PythonModel, script: string): Issue[] {
  const defined = new RegExp(`^def ${model.entry.replace(/\W/g, '')}\\s*\\(`, 'm').test(script);
  return defined ? [] : [{ severity: 'error', where: model.script, message: `No function ${model.entry}() in the script` }];
}

function describe(node: PipelineNode, model: PythonModel, script: string): ModelDescription {
  return {
    code: { path: model.script, language: 'python', text: script, entry: model.entry },
    variables: [
      ...Object.keys(node.inputs).map((name) => ({ name, kind: 'aux' as const, role: 'input' as const, dims: [], equation: '' })),
      ...Object.entries(model.outputs).map(([name, out]) => ({
        name,
        kind: 'aux' as const,
        role: 'output' as const,
        dims: out.kind === 'table' ? [] : out.dims,
        equation: '',
        description: out.description,
        units: out.kind === 'table' ? 'table' : out.unit,
      })),
    ],
  };
}

function tensorData(tensor: Tensor): TensorData {
  return { dims: tensor.dims, coords: tensor.coords, values: Array.from(tensor.values), unit: tensor.unit };
}
