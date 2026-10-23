import { sourceRefs, type Issue, type Pipeline } from './pipeline';
import type { PreparedNode } from '../semantics/types';

/** Checks everything that can be checked before running, and returns the execution order. */
export function validateGraph(
  pipeline: Pipeline,
  prepared: Map<string, PreparedNode | Error>,
): { issues: Issue[]; order: string[] } {
  const issues: Issue[] = [
    ...checkSources(pipeline),
    ...checkProducers(pipeline),
    ...checkNodes(pipeline, prepared),
    ...checkGroups(pipeline),
  ];
  const { order, cyclic } = topologicalOrder(pipeline);
  if (cyclic.length > 0) issues.push({ severity: 'error', where: 'pipeline', message: `Cycle between nodes: ${cyclic.join(', ')}` });
  return { issues, order };
}

function checkSources(pipeline: Pipeline): Issue[] {
  const issues: Issue[] = [];
  for (const [name, dataset] of Object.entries(pipeline.datasets)) {
    for (const ref of sourceRefs(dataset.source)) {
      if (!pipeline.sources[ref]) issues.push({ severity: 'error', where: `dataset ${name}`, message: `Unknown source "${ref}"` });
    }
  }
  return issues;
}

function checkProducers(pipeline: Pipeline): Issue[] {
  const issues: Issue[] = [];
  const producers = new Map<string, string>();
  for (const node of pipeline.nodes) {
    for (const name of Object.values(node.outputs)) {
      if (pipeline.datasets[name]) {
        issues.push({ severity: 'error', where: `node ${node.id}`, message: `Output "${name}" is also defined in datasets` });
      }
      const other = producers.get(name);
      if (other) issues.push({ severity: 'error', where: `node ${node.id}`, message: `Output "${name}" is also produced by ${other}` });
      producers.set(name, node.id);
    }
  }
  for (const node of pipeline.nodes) {
    for (const [port, name] of Object.entries(node.inputs)) {
      if (!pipeline.datasets[name] && !producers.has(name)) {
        issues.push({ severity: 'error', where: `node ${node.id}`, message: `Input ${port} reads "${name}", which no dataset or node provides` });
      }
    }
  }
  return issues;
}

function checkNodes(pipeline: Pipeline, prepared: Map<string, PreparedNode | Error>): Issue[] {
  const issues: Issue[] = [];
  for (const node of pipeline.nodes) {
    const prep = prepared.get(node.id);
    const where = `node ${node.id}`;
    if (!prep || prep instanceof Error) {
      issues.push({ severity: 'error', where, message: prep?.message ?? 'Not prepared' });
      continue;
    }
    issues.push(...prep.issues.map((i) => ({ ...i, where: `${where}: ${i.where}` })));
    const { inputs, outputs } = prep.ports;
    if (inputs) {
      for (const port of inputs) if (!(port in node.inputs)) issues.push({ severity: 'error', where, message: `Model input "${port}" is not wired` });
      for (const port of Object.keys(node.inputs)) if (!inputs.includes(port)) issues.push({ severity: 'error', where, message: `"${port}" is not an input of the model` });
    }
    for (const port of Object.keys(node.outputs)) if (!outputs.includes(port)) issues.push({ severity: 'error', where, message: `"${port}" is not an output of the model` });
  }
  return issues;
}

function checkGroups(pipeline: Pipeline): Issue[] {
  const issues: Issue[] = [];
  const nodeIds = new Set(pipeline.nodes.map((n) => n.id));
  const groupOf = new Map<string, string>();
  for (const group of pipeline.groups) {
    const where = `group ${group.id}`;
    if (nodeIds.has(group.id)) issues.push({ severity: 'error', where, message: 'A node has the same id' });
    for (const id of group.nodes) {
      if (!nodeIds.has(id)) issues.push({ severity: 'error', where, message: `Unknown node "${id}"` });
      const other = groupOf.get(id);
      if (other) issues.push({ severity: 'error', where, message: `Node "${id}" is also in group ${other}` });
      groupOf.set(id, group.id);
    }
  }
  return issues;
}

function topologicalOrder(pipeline: Pipeline): { order: string[]; cyclic: string[] } {
  const producerOf = new Map<string, string>();
  for (const node of pipeline.nodes) for (const name of Object.values(node.outputs)) producerOf.set(name, node.id);
  const dependsOn = new Map(
    pipeline.nodes.map((node) => [
      node.id,
      new Set(Object.values(node.inputs).flatMap((name) => producerOf.get(name) ?? [])),
    ]),
  );
  const order: string[] = [];
  const done = new Set<string>();
  while (order.length < pipeline.nodes.length) {
    const ready = pipeline.nodes.filter((n) => !done.has(n.id) && [...dependsOn.get(n.id)!].every((d) => done.has(d)));
    if (ready.length === 0) return { order, cyclic: pipeline.nodes.filter((n) => !done.has(n.id)).map((n) => n.id) };
    for (const node of ready) {
      order.push(node.id);
      done.add(node.id);
    }
  }
  return { order, cyclic: [] };
}
