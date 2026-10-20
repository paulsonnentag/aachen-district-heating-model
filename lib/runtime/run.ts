import type { Dataset, Issue, Pipeline, PipelineNode } from './pipeline';
import { loadDataset, type ReadText } from './datasets';
import type { Tensor } from './tensor';
import { validateGraph } from './validate';
import type { ModelDescription, PreparedNode, Semantics, VariableTrace } from '../semantics/types';

export type RunResult = {
  pipeline: Pipeline;
  issues: Issue[];
  datasets: Map<string, DatasetResult>;
  nodes: Map<string, NodeResult>;
};

export type DatasetResult = {
  name: string;
  producer: { node: string } | { catalog: Dataset };
  tensor?: Tensor;
  error?: string;
};

export type NodeResult = {
  node: PipelineNode;
  status: 'ok' | 'error' | 'skipped' | 'invalid';
  error?: string;
  warnings: string[];
  description?: ModelDescription;
  trace?: Record<string, VariableTrace>;
};

export async function runPipeline(
  pipeline: Pipeline,
  semantics: Record<string, Semantics>,
  readText: ReadText,
): Promise<RunResult> {
  const prepared = await prepareNodes(pipeline, semantics, readText);
  const { issues, order } = validateGraph(pipeline, prepared);
  const datasets = await loadCatalog(pipeline, readText);
  const nodes = new Map<string, NodeResult>();

  for (const node of pipeline.nodes) {
    const prep = prepared.get(node.id);
    const description = prep instanceof Error ? undefined : prep?.description;
    nodes.set(node.id, { node, status: 'skipped', warnings: [], description });
    for (const name of Object.values(node.outputs)) datasets.set(name, { name, producer: { node: node.id } });
  }

  const blocked = issues.some((i) => i.severity === 'error');
  if (blocked) {
    for (const result of nodes.values()) result.status = 'invalid';
    return { pipeline, issues, datasets, nodes };
  }

  for (const nodeId of order) {
    await executeNode(nodes.get(nodeId)!, prepared.get(nodeId) as PreparedNode, datasets);
  }
  return { pipeline, issues, datasets, nodes };
}

async function prepareNodes(
  pipeline: Pipeline,
  semantics: Record<string, Semantics>,
  readText: ReadText,
): Promise<Map<string, PreparedNode | Error>> {
  const prepared = new Map<string, PreparedNode | Error>();
  for (const node of pipeline.nodes) {
    const kind = semantics[node.semantics];
    if (!kind) {
      prepared.set(node.id, new Error(`Unknown semantics "${node.semantics}"`));
      continue;
    }
    try {
      prepared.set(node.id, await kind.prepare(node, readText));
    } catch (error) {
      prepared.set(node.id, error instanceof Error ? error : new Error(String(error)));
    }
  }
  return prepared;
}

async function loadCatalog(pipeline: Pipeline, readText: ReadText): Promise<Map<string, DatasetResult>> {
  const datasets = new Map<string, DatasetResult>();
  for (const [name, dataset] of Object.entries(pipeline.datasets)) {
    const result: DatasetResult = { name, producer: { catalog: dataset } };
    try {
      result.tensor = await loadDataset(dataset, readText);
    } catch (error) {
      result.error = error instanceof Error ? error.message : String(error);
    }
    datasets.set(name, result);
  }
  return datasets;
}

async function executeNode(result: NodeResult, prepared: PreparedNode, datasets: Map<string, DatasetResult>): Promise<void> {
  const inputs: Record<string, Tensor> = {};
  for (const [port, name] of Object.entries(result.node.inputs)) {
    const tensor = datasets.get(name)?.tensor;
    if (!tensor) return;
    inputs[port] = tensor;
  }
  try {
    const { outputs, warnings, trace } = await prepared.execute(inputs);
    result.warnings = warnings;
    result.trace = trace;
    for (const [port, name] of Object.entries(result.node.outputs)) {
      datasets.get(name)!.tensor = outputs[port];
    }
    result.status = 'ok';
  } catch (error) {
    result.status = 'error';
    result.error = error instanceof Error ? error.message : String(error);
  }
}
