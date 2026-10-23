import { isRemoteFile, type Dataset, type Decode, type Issue, type Pipeline, type PipelineNode } from './pipeline';
import { loadDataset, type FetchFile, type ReadText, type RemoteFile } from './datasets';
import { decodedTable, decodeFile } from './decode';
import { hashJson } from './hash';
import type { Table } from './table';
import type { Tensor } from './tensor';
import { validateGraph } from './validate';
import type { CacheInfo, ModelDescription, NodeInputs, NodeOutput, PreparedNode, RunContext, Semantics, VariableTrace } from '../semantics/types';

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
  table?: Table;
  file?: RemoteFile;
  /** For a CSV catalog dataset: the file's rows, before they became the tensor. */
  source?: Table;
  /** Identifies the value by its lineage, so kept results downstream can be checked without computing it. */
  key?: string;
  error?: string;
  /** Computes the value if it is not there yet: runs its node, or downloads and decodes its file. */
  compute?: (onLog: (line: string) => void) => Promise<void>;
};

export type NodeResult = {
  node: PipelineNode;
  /** `idle`: not computed, because nothing in this run needed its outputs. */
  status: 'ok' | 'error' | 'idle' | 'skipped' | 'invalid';
  error?: string;
  warnings: string[];
  description?: ModelDescription;
  trace?: Record<string, VariableTrace>;
  log?: string[];
  cache?: CacheInfo;
  key?: string;
  /** Computes the node, and first whatever it needs that is not computed yet; updates this run's results in place. */
  compute?: (onLog: (line: string) => void) => Promise<void>;
  /** Runs the node again from scratch, bypassing caches; the pipeline's results stay as they are. */
  recompute?: (onLog: (line: string) => void) => Promise<NodeOutput>;
};

/** `fetchFile` lets the run decode downloads itself; without it, only nodes read them. */
export async function runPipeline(
  pipeline: Pipeline,
  semantics: Record<string, Semantics>,
  readText: ReadText,
  fetchFile?: FetchFile,
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

  await evaluate(order, prepared as Map<string, PreparedNode>, datasets, nodes, fetchFile);
  return { pipeline, issues, datasets, nodes };
}

/**
 * Nodes that can look up a kept result use it without their inputs; the rest run in order.
 * A node with a lookup but no kept result runs only if something downstream has to run, and
 * a download that decodes into a table is only fetched when a node that has to run reads it.
 */
async function evaluate(
  order: string[],
  prepared: Map<string, PreparedNode>,
  datasets: Map<string, DatasetResult>,
  nodes: Map<string, NodeResult>,
  fetchFile: FetchFile | undefined,
): Promise<void> {
  const producerOf = new Map<string, string>();
  const consumersOf = new Map<string, string[]>();
  for (const { node } of nodes.values()) {
    for (const name of Object.values(node.outputs)) producerOf.set(name, node.id);
    for (const name of Object.values(node.inputs)) consumersOf.set(name, [...(consumersOf.get(name) ?? []), node.id]);
  }

  for (const id of order) await assignKey(nodes.get(id)!, prepared.get(id)!, datasets);
  const kept = new Map(
    await Promise.all(
      order.map(async (id) => {
        const { key } = nodes.get(id)!;
        const lookup = prepared.get(id)!.lookup;
        return [id, key && lookup ? await lookup(key).catch(() => undefined) : undefined] as const;
      }),
    ),
  );
  const mustRun = new Set<string>();
  for (const id of [...order].reverse()) {
    if (kept.get(id)) continue;
    const consumers = Object.values(nodes.get(id)!.node.outputs).flatMap((name) => consumersOf.get(name) ?? []);
    if (!prepared.get(id)!.lookup || consumers.length === 0 || consumers.some((c) => mustRun.has(c))) mustRun.add(id);
  }

  const execute = (id: string, context: Omit<RunContext, 'key'>) => executeNode(nodes.get(id)!, prepared.get(id)!, datasets, context);
  const decode = async (name: string, onLog: (line: string) => void) => {
    const dataset = datasets.get(name)!;
    const spec = decodeOf(dataset);
    if (!spec || dataset.table) return;
    try {
      if (!fetchFile) throw new Error('This run cannot download files');
      dataset.table = await decodeFile(dataset.file!, spec, dataset.key!, fetchFile, onLog);
      dataset.error = undefined;
    } catch (error) {
      dataset.error = error instanceof Error ? error.message : String(error);
      throw error;
    }
  };
  const ensureInputs = async (id: string, onLog: (line: string) => void) => {
    for (const name of Object.values(nodes.get(id)!.node.inputs)) {
      const producer = producerOf.get(name);
      if (producer) await ensure(producer, onLog);
      else await decode(name, onLog);
    }
  };
  const ensure = async (id: string, onLog: (line: string) => void): Promise<void> => {
    const result = nodes.get(id)!;
    if (result.status === 'ok') return;
    await ensureInputs(id, onLog);
    onLog(`▸ ${result.node.label}`);
    await execute(id, { fresh: false, onLog });
    if (nodes.get(id)!.status !== 'ok') throw new Error(`${result.node.label}: ${result.error ?? 'an input is missing'}`);
  };

  for (const id of order) {
    const result = nodes.get(id)!;
    result.compute = (onLog) => ensure(id, onLog);
    result.recompute = async (onLog) => {
      await ensureInputs(id, onLog);
      const inputs = gatherInputs(result.node, datasets);
      if (!inputs) throw new Error('An input is missing');
      return prepared.get(id)!.execute(inputs, { key: result.key ?? '', fresh: true, onLog });
    };
    const output = kept.get(id);
    if (output) applyOutput(result, output, datasets);
    else if (mustRun.has(id)) {
      for (const name of Object.values(result.node.inputs)) if (!producerOf.has(name)) await decode(name, () => {}).catch(() => undefined);
      await execute(id, { fresh: false, onLog: () => {} });
    } else result.status = 'idle';
  }
  for (const [name, dataset] of datasets) {
    const producer = producerOf.get(name);
    if (producer) dataset.compute = (onLog) => ensure(producer, onLog);
    else if (decodeOf(dataset)) dataset.compute = (onLog) => decode(name, onLog);
  }
}

function decodeOf(dataset: DatasetResult): Decode | undefined {
  return 'catalog' in dataset.producer && isRemoteFile(dataset.producer.catalog) ? dataset.producer.catalog.decode : undefined;
}

/** A node's key hashes its fingerprint with its inputs' keys; its outputs are keyed by the node's key and port. */
async function assignKey(result: NodeResult, prepared: PreparedNode, datasets: Map<string, DatasetResult>): Promise<void> {
  const inputs = Object.entries(result.node.inputs)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([port, name]) => [port, datasets.get(name)?.key] as const);
  if (inputs.some(([, key]) => key === undefined)) return;
  result.key = await hashJson({ fingerprint: prepared.fingerprint, inputs });
  for (const [port, name] of Object.entries(result.node.outputs)) datasets.get(name)!.key = `${result.key}/${port}`;
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
    if (isRemoteFile(dataset)) {
      const { url, sha256, size, format, decode } = dataset;
      result.file = { url, sha256, size, format };
      result.key = decode ? await hashJson({ sha256, decode }) : `sha256:${sha256}`;
      if (decode) result.table = decodedTable(result.key);
      datasets.set(name, result);
      continue;
    }
    try {
      Object.assign(result, await loadDataset(dataset, readText));
      const { dims, coords, values, unit } = result.tensor!;
      result.key = await hashJson({ dims, coords, values: Array.from(values), unit });
    } catch (error) {
      result.error = error instanceof Error ? error.message : String(error);
    }
    datasets.set(name, result);
  }
  return datasets;
}

async function executeNode(
  result: NodeResult,
  prepared: PreparedNode,
  datasets: Map<string, DatasetResult>,
  context: Omit<RunContext, 'key'>,
): Promise<void> {
  const inputs = gatherInputs(result.node, datasets);
  if (!inputs) {
    result.status = 'skipped';
    return;
  }
  try {
    applyOutput(result, await prepared.execute(inputs, { ...context, key: result.key ?? '' }), datasets);
    result.error = undefined;
  } catch (error) {
    result.status = 'error';
    result.error = error instanceof Error ? error.message : String(error);
  }
}

function gatherInputs(node: PipelineNode, datasets: Map<string, DatasetResult>): NodeInputs | undefined {
  const inputs: NodeInputs = { tensors: {}, tables: {}, files: {} };
  for (const [port, name] of Object.entries(node.inputs)) {
    const dataset = datasets.get(name);
    if (dataset?.tensor) inputs.tensors[port] = dataset.tensor;
    else if (dataset?.table) inputs.tables[port] = dataset.table;
    else if (dataset?.file && !decodeOf(dataset)) inputs.files[port] = dataset.file;
    else return undefined;
  }
  return inputs;
}

function applyOutput(result: NodeResult, output: NodeOutput, datasets: Map<string, DatasetResult>): void {
  const { warnings, trace, log, cache } = output;
  Object.assign(result, { warnings, trace, log, cache, status: 'ok' });
  for (const [port, name] of Object.entries(result.node.outputs)) {
    const dataset = datasets.get(name)!;
    dataset.tensor = output.outputs[port];
    dataset.table = output.tables?.[port];
  }
}
