import type { Issue, PipelineNode } from '../runtime/pipeline';
import type { ReadText } from '../runtime/datasets';
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
  execute: (inputs: Record<string, Tensor>) => Promise<NodeOutput>;
};

export type NodeOutput = {
  outputs: Record<string, Tensor>;
  warnings: string[];
  /** Values of internal variables, for views that show inside the model. */
  trace?: Record<string, VariableTrace>;
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
};

export type VariableDescription = {
  name: string;
  kind: 'stock' | 'flow' | 'aux';
  role: 'input' | 'output' | 'internal';
  dims: string[];
  equation: string;
  units?: string;
  inflows?: string[];
  outflows?: string[];
  /** Variables the equation reads (for a stock: its initial value). */
  dependsOn?: string[];
};
