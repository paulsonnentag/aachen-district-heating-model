import type { PipelineGroup } from '../../lib/runtime/pipeline';
import type { NodeResult, RunResult } from '../../lib/runtime/run';

export type GroupInfo = {
  group: PipelineGroup;
  nodes: NodeResult[];
  /** Datasets the group reads from outside. */
  inputs: string[];
  /** Datasets the group makes that something outside reads, or nothing reads at all. */
  outputs: string[];
  /** Datasets only the group's steps read, whether they make them or they are sources: hidden while it is collapsed. */
  internal: string[];
};

export function groupsOf(result: RunResult): Map<string, GroupInfo> {
  const consumers = consumersOf(result);
  const groups = new Map<string, GroupInfo>();
  for (const group of result.pipeline.groups) {
    const members = new Set(group.nodes);
    const nodes = group.nodes.flatMap((id) => result.nodes.get(id) ?? []);
    const produced = new Set(nodes.flatMap((n) => Object.values(n.node.outputs)));
    const read = new Set(nodes.flatMap((n) => Object.values(n.node.inputs)));
    const isInternal = (name: string) => (consumers.get(name)?.length ?? 0) > 0 && consumers.get(name)!.every((c) => members.has(c));
    const sources = [...read].filter((name) => !produced.has(name) && !('node' in (result.datasets.get(name)?.producer ?? {})));
    groups.set(group.id, {
      group,
      nodes,
      inputs: [...read].filter((name) => !produced.has(name) && !(sources.includes(name) && isInternal(name))),
      outputs: [...produced].filter((name) => !isInternal(name)),
      internal: [...produced, ...sources].filter(isInternal),
    });
  }
  return groups;
}

/** The nodes that read each dataset. */
export function consumersOf(result: RunResult): Map<string, string[]> {
  const consumers = new Map<string, string[]>();
  for (const node of result.pipeline.nodes) {
    for (const name of Object.values(node.inputs)) consumers.set(name, [...(consumers.get(name) ?? []), node.id]);
  }
  return consumers;
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
