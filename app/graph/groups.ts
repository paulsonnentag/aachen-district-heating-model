import type { PipelineGroup } from '../../lib/runtime/pipeline';
import type { NodeResult, RunResult } from '../../lib/runtime/run';

export type GroupInfo = {
  group: PipelineGroup;
  nodes: NodeResult[];
  /** Datasets the group reads from outside. */
  inputs: string[];
  /** Datasets the group makes that something outside reads, or nothing reads at all. */
  outputs: string[];
  /** Datasets made and read only inside the group: hidden while it is collapsed. */
  internal: string[];
};

export function groupsOf(result: RunResult): Map<string, GroupInfo> {
  const consumers = new Map<string, string[]>();
  for (const node of result.pipeline.nodes) {
    for (const name of Object.values(node.inputs)) consumers.set(name, [...(consumers.get(name) ?? []), node.id]);
  }
  const groups = new Map<string, GroupInfo>();
  for (const group of result.pipeline.groups) {
    const members = new Set(group.nodes);
    const nodes = group.nodes.flatMap((id) => result.nodes.get(id) ?? []);
    const produced = new Set(nodes.flatMap((n) => Object.values(n.node.outputs)));
    const read = new Set(nodes.flatMap((n) => Object.values(n.node.inputs)));
    const isInternal = (name: string) => (consumers.get(name)?.length ?? 0) > 0 && consumers.get(name)!.every((c) => members.has(c));
    groups.set(group.id, {
      group,
      nodes,
      inputs: [...read].filter((name) => !produced.has(name)),
      outputs: [...produced].filter((name) => !isInternal(name)),
      internal: [...produced].filter(isInternal),
    });
  }
  return groups;
}

export function groupOfNode(result: RunResult, nodeId: string): string | undefined {
  return result.pipeline.groups.find((g) => g.nodes.includes(nodeId))?.id;
}

/** The group a dataset lives in, if it is internal to one. */
export function groupOfDataset(groups: Map<string, GroupInfo>, name: string): string | undefined {
  for (const [id, info] of groups) if (info.internal.includes(name)) return id;
  return undefined;
}

/** The worst status among the group's nodes, and how many of them are computed. */
export function groupStatus(info: GroupInfo): { status: NodeResult['status']; computed: number; idle: string[] } {
  const statuses = info.nodes.map((n) => n.status);
  const worst = (['invalid', 'error', 'skipped'] as const).find((s) => statuses.includes(s));
  const idle = info.nodes.filter((n) => n.status === 'idle').map((n) => n.node.id);
  return { status: worst ?? 'ok', computed: statuses.filter((s) => s === 'ok').length, idle };
}
