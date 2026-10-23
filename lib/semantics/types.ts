import type { Issue, PipelineNode } from '../runtime/pipeline';
import type { ReadText, RemoteFile } from '../runtime/datasets';
import type { Table } from '../runtime/table';
import type { Tensor } from '../runtime/tensor';

/** A formalism: knows how to load, check, run and describe models of one kind. */
export type Semantics = {
  id: string;
  prepare: (node: PipelineNode, readText: ReadText) => Promise<PreparedNode>;
};

export type PreparedNode = {
  /** `inputs: null` means the semantics accepts whatever inputs the node wires up. */
  ports: { inputs: string[] | null; outputs: string[] };
  issues: Issue[];
  description: ModelDescription;
  /** Everything the node's result depends on apart from its inputs: code, model, runtime. */
  fingerprint: string;
  /**
   * For nodes too slow to run on every load: a result kept from an earlier run with this key, if any.
   * Nodes that have one are only run when something needs their outputs.
   */
  lookup?: (key: string) => Promise<NodeOutput | undefined>;
  execute: (inputs: NodeInputs, context: RunContext) => Promise<NodeOutput>;
};

export type NodeInputs = {
  tensors: Record<string, Tensor>;
  tables: Record<string, Table>;
  /** Inputs wired to raw downloads. */
  files: Record<string, RemoteFile>;
};

export type RunContext = {
  /** Identifies this node's code together with the lineage of its inputs. */
  key: string;
  /** Bypass every kept result and compute from scratch. */
  fresh: boolean;
  onLog: (line: string) => void;
};

export type NodeOutput = {
  outputs: Record<string, Tensor>;
  tables?: Record<string, Table>;
  warnings: string[];
  /** Values of internal variables, for views that show inside the model. */
  trace?: Record<string, VariableTrace>;
  /** What the model printed while it ran. */
  log?: string[];
  /** Set when the result was reused instead of computed in this run. */
  cache?: CacheInfo;
};

export type CacheInfo = {
  /** Where this run found the result: a file committed with the pipeline, this browser's storage, or a fresh computation. */
  origin: 'snapshot' | 'stored' | 'computed';
  /** Hash of everything the result depends on: code, runtime and the lineage of its inputs. */
  key: string;
  runtime: string;
  createdAt: string;
  seconds: number;
};

export type VariableTrace = {
  years: string[];
  /** One value per year: the value itself, or the total or mean over the elements of an arrayed variable. */
  summary: Float64Array;
  aggregate: 'value' | 'total' | 'mean';
  /** The full values, kept only when the variable is small. */
  tensor?: Tensor;
};

export type ModelDescription = {
  variables: VariableDescription[];
  /** The model's code: a program's source, or the definition written out for reading; `path` if it is a file. */
  code?: { path?: string; language: string; text: string };
};

export type VariableDescription = {
  name: string;
  kind: 'stock' | 'flow' | 'aux';
  role: 'input' | 'output' | 'internal';
  dims: string[];
  equation: string;
  description?: string;
  units?: string;
  inflows?: string[];
  outflows?: string[];
  /** Variables the equation reads (for a stock: its initial value). */
  dependsOn?: string[];
};
