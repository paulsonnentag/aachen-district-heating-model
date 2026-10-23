import { z } from 'zod';
import type { PipelineNode } from '../../runtime/pipeline';
import { tableData } from '../../runtime/table';
import type { Tensor } from '../../runtime/tensor';
import { createKeeper, OutputSchema, toOutput, type ResultStore } from '../kept';
import type { ModelDescription, Semantics } from '../types';
import { RUNNER, type PythonJob, type PythonRun } from './pyodide';

const PythonModelSchema = z.object({
  script: z.string(),
  /** A committed result of an earlier run, reused while its key matches the current script and inputs. */
  snapshot: z.string().optional(),
  /** The variables the script defines, each read back as one output. */
  outputs: z.record(z.string(), OutputSchema),
});

type PythonModel = z.infer<typeof PythonModelSchema>;

/** What the semantics needs from its environment: a Python to run in, which also fetches the downloads. */
export type PythonHost = {
  runtime: string;
  run: (job: PythonJob, onLog: (line: string) => void) => Promise<PythonRun>;
  store?: ResultStore;
};

/** Tensor inputs as the runner receives them: one value per combination of coordinates. */
type TensorData = { dims: string[]; coords: string[][]; values: number[] };

/**
 * Data preparation written as a plain Python script. Each input is a variable named after its dataset
 * (files as paths, tables as DataFrames, tensors as Series) and each output is a variable the script
 * defines. Results are reused from memory, the committed snapshot or the host's store, in that order.
 */
export function createPythonSemantics(host: PythonHost): Semantics {
  const keeper = createKeeper(host.runtime, host.store);
  return {
    id: 'python',
    async prepare(node, readText) {
      const model = PythonModelSchema.parse(node.model);
      const script = await readText(model.script);
      return {
        ports: { inputs: null, outputs: Object.keys(model.outputs) },
        issues: [],
        description: describe(node, model, script),
        fingerprint: JSON.stringify({ runtime: host.runtime, runner: RUNNER, script }),
        lookup: async (key) => {
          const found = await keeper.find(key, model.snapshot, readText);
          return found && toOutput(model.outputs, found);
        },
        execute: async (inputs, { key, fresh, onLog }) => {
          const found = fresh ? undefined : await keeper.find(key, model.snapshot, readText);
          if (found) return toOutput(model.outputs, found);
          return toOutput(
            model.outputs,
            await keeper.compute(key, model.snapshot, readText, async () => {
              const job: PythonJob = {
                script,
                path: model.script,
                files: inputs.files,
                tables: JSON.stringify(mapValues(inputs.tables, tableData)),
                tensors: JSON.stringify(mapValues(inputs.tensors, tensorData)),
                outputs: Object.keys(model.outputs),
              };
              const { outputs } = await host.run(job, onLog);
              return { outputs, log: [] };
            }),
          );
        },
      };
    },
  };
}

function describe(node: PipelineNode, model: PythonModel, script: string): ModelDescription {
  return {
    code: { path: model.script, language: 'python', text: script },
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

function mapValues<T, U>(record: Record<string, T>, map: (value: T) => U): Record<string, U> {
  return Object.fromEntries(Object.entries(record).map(([name, value]) => [name, map(value)]));
}

function tensorData(tensor: Tensor): TensorData {
  return { dims: tensor.dims, coords: tensor.coords, values: Array.from(tensor.values) };
}
