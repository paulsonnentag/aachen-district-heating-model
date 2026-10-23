import { z } from 'zod';
import type { Issue, PipelineNode } from '../../runtime/pipeline';
import { tableData } from '../../runtime/table';
import type { Tensor } from '../../runtime/tensor';
import { createKeeper, OutputSchema, toOutput, type ResultStore } from '../kept';
import type { ModelDescription, Semantics } from '../types';
import type { PythonJob, PythonRun } from './pyodide';

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

/** Tensor inputs as the script sees them: plain lists, one value per combination of coordinates. */
type TensorData = { dims: string[]; coords: string[][]; values: number[]; unit: string };

/**
 * Data preparation written in Python. The node names a function of the script: raw downloads arrive
 * as file paths, tensors and tables as dicts, and it returns rows for each tensor output (coordinates,
 * then the value) and a dict of columns for each table output. Results are reused from memory, the
 * committed snapshot or the host's store, in that order.
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
        issues: checkEntry(model, script),
        description: describe(node, model, script),
        fingerprint: JSON.stringify({ runtime: host.runtime, script, entry: model.entry }),
        lookup: async (key) => {
          const found = await keeper.find(key, model.snapshot, readText);
          return found && toOutput(model.outputs, found);
        },
        execute: async (inputs, { key, fresh, onLog }) => {
          const found = fresh ? undefined : await keeper.find(key, model.snapshot, readText);
          if (found) return toOutput(model.outputs, found);
          return toOutput(
            model.outputs,
            await keeper.compute(key, model.snapshot, readText, () => {
              const values: Record<string, TensorData | Record<string, unknown[]>> = {};
              for (const [port, tensor] of Object.entries(inputs.tensors)) values[port] = tensorData(tensor);
              for (const [port, table] of Object.entries(inputs.tables)) values[port] = tableData(table);
              onLog(`Running ${model.entry}() from ${model.script} in ${host.runtime}`);
              const job: PythonJob = { script, path: model.script, entry: model.entry, files: inputs.files, values: JSON.stringify(values) };
              return host.run(job, onLog);
            }),
          );
        },
      };
    },
  };
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
