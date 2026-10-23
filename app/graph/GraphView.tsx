import { createEffect, createMemo, createSignal, For, Show } from 'solid-js';
import { provenanceKind } from '../../lib/runtime/pipeline';
import type { DatasetResult, NodeResult, RunResult } from '../../lib/runtime/run';
import { coordsOf, type Tensor } from '../../lib/runtime/tensor';
import { ValuePreview } from '../components/ValuePreview';
import { collapsedLabel, formatBytes, shapeOf } from '../values';
import { groupsOf, groupStatus, type GroupInfo } from './groups';
import { layoutGraph, type Box, type Layout, type LayoutEdge, type LayoutItem } from './layout';

export type Selection = { kind: 'dataset' | 'node' | 'group'; id: string };

const DATASET_WIDTH = 220;
const DATASET_HEADER = 44;
const NODE_SIZE = { width: 200, height: 64 };
const GROUP_SIZE = { width: 220, height: 76 };
const FRAME_HEADER = 32;

export function GraphView(props: {
  result: RunResult;
  baseline?: RunResult;
  selected?: Selection;
  /** Scrolls this box to the centre each time it is set. */
  reveal?: Selection;
  expanded: string[];
  onSelect: (selection: Selection | undefined) => void;
  onOpen?: (nodeId: string) => void;
  onToggleGroup: (groupId: string) => void;
}) {
  const groups = createMemo(() => groupsOf(props.result));
  const graph = createMemo(() => buildGraph(props.result, groups(), new Set(props.expanded)));
  const layout = () => graph().layout;
  const [hovered, setHovered] = createSignal<string>();
  const [zoom, setZoom] = createSignal(1);
  const focus = () => hovered() ?? (props.selected ? key(props.selected) : undefined);
  const isLinked = (edge: LayoutEdge) => focus() !== undefined && (edge.from === focus() || edge.to === focus());
  let frame!: HTMLDivElement;
  const fit = () => {
    const canvas = frame.closest('.canvas') as HTMLElement;
    setZoom(Math.min(1, (canvas.clientWidth - 16) / layout().width, (canvas.clientHeight - frame.offsetTop - 16) / layout().height));
  };
  const centre = (target: Selection) => {
    const box = layout().boxes.get(key(target));
    const canvas = frame.closest('.canvas') as HTMLElement | null;
    if (!box || !canvas) return;
    canvas.scrollTo({
      left: frame.offsetLeft + (box.x + box.width / 2) * zoom() - canvas.clientWidth / 2,
      top: frame.offsetTop + (box.y + box.height / 2) * zoom() - canvas.clientHeight / 2,
      behavior: 'smooth',
    });
  };
  createEffect(() => {
    const target = props.reveal;
    if (target) requestAnimationFrame(() => centre(target));
  });
  const isSelected = (kind: Selection['kind'], id: string) => props.selected?.kind === kind && props.selected.id === id;

  return (
    <>
      <div class="zoom">
        <button onClick={() => setZoom((z) => Math.max(0.2, z / 1.25))}>−</button>
        <span>{Math.round(zoom() * 100)}%</span>
        <button onClick={() => setZoom((z) => Math.min(2, z * 1.25))}>+</button>
        <button onClick={fit}>Fit</button>
      </div>
      <div ref={frame} style={{ width: `${layout().width * zoom()}px`, height: `${layout().height * zoom()}px` }}>
        <div
          class="graph"
          style={{ width: `${layout().width}px`, height: `${layout().height}px`, transform: `scale(${zoom()})` }}
          onClick={() => props.onSelect(undefined)}
        >
          <For each={graph().expanded}>
            {(id) => (
              <GroupFrame
                box={layout().boxes.get(frameKey(id))!}
                info={groups().get(id)!}
                selected={isSelected('group', id)}
                onSelect={() => props.onSelect({ kind: 'group', id })}
                onCollapse={() => props.onToggleGroup(id)}
              />
            )}
          </For>
          <svg class="edges" width={layout().width} height={layout().height}>
            <For each={graph().edges}>
              {(edge) => (
                <path
                  d={edgePath(layout().boxes.get(edge.from)!, layout().boxes.get(edge.to)!)}
                  classList={{ edge: true, linked: isLinked(edge), dimmed: focus() !== undefined && !isLinked(edge) }}
                />
              )}
            </For>
          </svg>
          <For each={graph().collapsed}>
            {(id) => {
              const itemId = key({ kind: 'group', id });
              return (
                <GroupBox
                  box={layout().boxes.get(itemId)!}
                  info={groups().get(id)!}
                  selected={isSelected('group', id)}
                  onHover={(on) => setHovered(on ? itemId : undefined)}
                  onSelect={() => props.onSelect({ kind: 'group', id })}
                  onExpand={() => props.onToggleGroup(id)}
                />
              );
            }}
          </For>
          <For each={props.result.pipeline.nodes}>
            {(node) => {
              const id = key({ kind: 'node', id: node.id });
              return (
                <Show when={layout().boxes.get(id)}>
                  {(box) => (
                    <ModelBox
                      box={box()}
                      result={props.result.nodes.get(node.id)!}
                      selected={isSelected('node', node.id)}
                      onHover={(on) => setHovered(on ? id : undefined)}
                      onSelect={() => props.onSelect({ kind: 'node', id: node.id })}
                      onOpen={() => props.onOpen?.(node.id)}
                    />
                  )}
                </Show>
              );
            }}
          </For>
          <For each={[...props.result.datasets.values()]}>
            {(dataset) => {
              const id = key({ kind: 'dataset', id: dataset.name });
              return (
                <Show when={layout().boxes.get(id)}>
                  {(box) => (
                    <DatasetBox
                      box={box()}
                      dataset={dataset}
                      baseline={props.baseline?.datasets.get(dataset.name)}
                      selected={isSelected('dataset', dataset.name)}
                      onHover={(on) => setHovered(on ? id : undefined)}
                      onSelect={() => props.onSelect({ kind: 'dataset', id: dataset.name })}
                    />
                  )}
                </Show>
              );
            }}
          </For>
        </div>
      </div>
    </>
  );
}

function ModelBox(props: {
  box: Box;
  result: NodeResult;
  selected: boolean;
  onHover: (on: boolean) => void;
  onSelect: () => void;
  onOpen: () => void;
}) {
  return (
    <div
      class={`box model status-${props.result.status}`}
      classList={{ selected: props.selected }}
      style={position(props.box)}
      onMouseEnter={() => props.onHover(true)}
      onMouseLeave={() => props.onHover(false)}
      onClick={(e) => {
        e.stopPropagation();
        props.onSelect();
      }}
      onDblClick={(e) => {
        e.stopPropagation();
        props.onOpen();
      }}
    >
      <div class="model-label">{props.result.node.label}</div>
      <div class="model-meta">
        <span class="semantics">{props.result.node.semantics}</span>
        <Show when={props.result.status !== 'ok'}>
          <span class="status">{STATUS_LABELS[props.result.status]}</span>
        </Show>
        <Show when={props.result.warnings.length > 0}>
          <span class="status warn">{props.result.warnings.length} warning{props.result.warnings.length > 1 ? 's' : ''}</span>
        </Show>
        <Show when={props.result.cache}>{(cache) => <span class="cache-origin">{CACHE_LABELS[cache().origin]}</span>}</Show>
      </div>
    </div>
  );
}

export const CACHE_LABELS = { snapshot: 'from snapshot', stored: 'from browser cache', computed: 'computed' } as const;
export const STATUS_LABELS: Record<NodeResult['status'], string> = {
  ok: 'ok',
  error: 'error',
  idle: 'not computed',
  skipped: 'skipped',
  invalid: 'invalid',
};

function GroupBox(props: {
  box: Box;
  info: GroupInfo;
  selected: boolean;
  onHover: (on: boolean) => void;
  onSelect: () => void;
  onExpand: () => void;
}) {
  const status = () => groupStatus(props.info);
  return (
    <div
      class={`box model group status-${status().status}`}
      classList={{ selected: props.selected }}
      style={position(props.box)}
      onMouseEnter={() => props.onHover(true)}
      onMouseLeave={() => props.onHover(false)}
      onClick={(e) => {
        e.stopPropagation();
        props.onSelect();
      }}
      onDblClick={(e) => {
        e.stopPropagation();
        props.onExpand();
      }}
    >
      <button
        class="group-toggle"
        title="Show the steps"
        onClick={(e) => {
          e.stopPropagation();
          props.onExpand();
        }}
      >
        ▸
      </button>
      <div class="model-label">{props.info.group.label}</div>
      <div class="model-meta">
        <span class="semantics">{props.info.nodes.length} steps</span>
        <GroupStatusNote info={props.info} />
      </div>
    </div>
  );
}

function GroupFrame(props: { box: Box; info: GroupInfo; selected: boolean; onSelect: () => void; onCollapse: () => void }) {
  return (
    <div class="group-frame" classList={{ selected: props.selected }} style={position(props.box)}>
      <div
        class="group-head"
        onClick={(e) => {
          e.stopPropagation();
          props.onSelect();
        }}
        onDblClick={(e) => {
          e.stopPropagation();
          props.onCollapse();
        }}
      >
        <button
          class="group-toggle"
          title="Collapse into one box"
          onClick={(e) => {
            e.stopPropagation();
            props.onCollapse();
          }}
        >
          ▾
        </button>
        <span class="group-label">{props.info.group.label}</span>
        <span class="muted">{props.info.nodes.length} steps</span>
        <GroupStatusNote info={props.info} />
      </div>
    </div>
  );
}

function GroupStatusNote(props: { info: GroupInfo }) {
  const status = () => groupStatus(props.info);
  return (
    <>
      <Show when={status().status !== 'ok'}>
        <span class="status">{STATUS_LABELS[status().status]}</span>
      </Show>
      <Show when={status().idle.length > 0}>
        <span class="cache-origin">
          {status().computed} of {props.info.nodes.length} computed
        </span>
      </Show>
    </>
  );
}

function DatasetBox(props: {
  box: Box;
  dataset: DatasetResult;
  baseline?: DatasetResult;
  selected: boolean;
  onHover: (on: boolean) => void;
  onSelect: () => void;
}) {
  const badge = () => {
    const producer = props.dataset.producer;
    if ('node' in producer) {
      const empty = !props.dataset.tensor && !props.dataset.table && !props.dataset.error;
      return empty ? { text: 'on demand', class: 'on-demand' } : { text: 'computed', class: 'computed' };
    }
    const kind = provenanceKind(producer.catalog.source);
    return { text: kind, class: kind };
  };
  return (
    <div
      class="box dataset"
      classList={{ selected: props.selected }}
      style={position(props.box)}
      onMouseEnter={() => props.onHover(true)}
      onMouseLeave={() => props.onHover(false)}
      onClick={(e) => {
        e.stopPropagation();
        props.onSelect();
      }}
    >
      <div class="dataset-head">
        <span class="dataset-name">{props.dataset.name}</span>
        <span class={`badge ${badge().class}`}>{badge().text}</span>
      </div>
      <Show
        when={props.dataset.file}
        fallback={
          <Show
            when={props.dataset.table}
            fallback={
              <>
                <div class="dataset-unit">
                  {props.dataset.tensor?.unit ?? ''}
                  <Show when={props.dataset.tensor && props.dataset.tensor.dims.length > 0}>
                    <span class="dims"> [{props.dataset.tensor!.dims.join(' × ')}]</span>
                  </Show>
                </div>
                <ValuePreview tensor={props.dataset.tensor} baseline={props.baseline?.tensor} error={props.dataset.error} />
              </>
            }
          >
            {(table) => (
              <div class="dataset-file">
                <span>table · {table().rows.toLocaleString('en')} rows × {Object.keys(table().columns).length} columns</span>
                <span class="muted">{Object.keys(table().columns).join(', ')}</span>
              </div>
            )}
          </Show>
        }
      >
        {(file) => (
          <div class="dataset-file">
            <span>{file().format} · {formatBytes(file().size)}</span>
            <span class="muted">{new URL(file().url).host}</span>
          </div>
        )}
      </Show>
    </div>
  );
}

type Graph = {
  layout: Layout;
  /** Edges between the boxes actually drawn. */
  edges: LayoutEdge[];
  expanded: string[];
  collapsed: string[];
};

/**
 * A collapsed group is one box and hides the datasets only its steps use. An expanded group is laid
 * out on its own and placed in the pipeline's layout as one framed item, so its steps stay together.
 */
function buildGraph(result: RunResult, groups: Map<string, GroupInfo>, expanded: Set<string>): Graph {
  const groupOfNode = new Map<string, string>();
  const groupOfDataset = new Map<string, string>();
  for (const [id, info] of groups) {
    for (const node of info.nodes) groupOfNode.set(node.node.id, id);
    for (const name of info.internal) groupOfDataset.set(name, id);
  }
  const containers = new Map<string, LayoutItem[]>([['', []]]);
  const containerOf = new Map<string, string>();
  const add = (container: string, item: LayoutItem) => {
    if (containerOf.has(item.id)) return item.id;
    if (container && !containers.has(container)) {
      containers.set(container, []);
      containers.get('')!.push({ id: frameKey(container), width: 0, height: 0 });
    }
    containers.get(container)!.push(item);
    containerOf.set(item.id, container);
    return item.id;
  };
  const datasetItem = (name: string): string | undefined => {
    const group = groupOfDataset.get(name);
    if (group && !expanded.has(group)) return undefined;
    return add(group ?? '', { id: key({ kind: 'dataset', id: name }), width: DATASET_WIDTH, height: datasetHeight(result.datasets.get(name)) });
  };
  const nodeItem = (nodeId: string): string => {
    const group = groupOfNode.get(nodeId);
    if (group && !expanded.has(group)) return add('', { id: key({ kind: 'group', id: group }), ...GROUP_SIZE });
    return add(group ?? '', { id: key({ kind: 'node', id: nodeId }), ...NODE_SIZE });
  };

  const drawn = new Map<string, LayoutEdge>();
  const connect = (from: string | undefined, to: string | undefined) => {
    if (from && to) drawn.set(`${from}>${to}`, { from, to });
  };
  for (const node of result.pipeline.nodes) {
    const inputs = Object.values(node.inputs).map(datasetItem);
    const id = nodeItem(node.id);
    for (const input of inputs) connect(input, id);
    for (const name of Object.values(node.outputs)) connect(id, datasetItem(name));
  }
  for (const name of result.datasets.keys()) datasetItem(name);

  const lift = (id: string) => (containerOf.get(id) ? frameKey(containerOf.get(id)!) : id);
  const edgesIn = new Map<string, Map<string, LayoutEdge>>([...containers.keys()].map((c) => [c, new Map()]));
  for (const edge of drawn.values()) {
    const from = containerOf.get(edge.from)!;
    const to = containerOf.get(edge.to)!;
    if (from === to) edgesIn.get(from)!.set(`${edge.from}>${edge.to}`, edge);
    else edgesIn.get('')!.set(`${lift(edge.from)}>${lift(edge.to)}`, { from: lift(edge.from), to: lift(edge.to) });
  }

  const inner = new Map<string, Layout>();
  for (const [container, items] of containers) {
    if (!container) continue;
    const sub = layoutGraph(items, [...edgesIn.get(container)!.values()]);
    inner.set(container, sub);
    Object.assign(containers.get('')!.find((i) => i.id === frameKey(container))!, { width: sub.width, height: sub.height + FRAME_HEADER });
  }
  const outer = layoutGraph(containers.get('')!, [...edgesIn.get('')!.values()]);
  const boxes = new Map(outer.boxes);
  for (const [container, sub] of inner) {
    const origin = outer.boxes.get(frameKey(container))!;
    for (const [id, box] of sub.boxes) boxes.set(id, { ...box, x: box.x + origin.x, y: box.y + origin.y + FRAME_HEADER });
  }
  return {
    layout: { boxes, width: outer.width, height: outer.height },
    edges: [...drawn.values()],
    expanded: [...inner.keys()],
    collapsed: [...groups.keys()].filter((id) => !expanded.has(id) && boxes.has(key({ kind: 'group', id }))),
  };
}

function datasetHeight(dataset: DatasetResult | undefined): number {
  if (dataset?.file) return DATASET_HEADER + 8;
  if (dataset?.table) return DATASET_HEADER + 12;
  const tensor = dataset?.tensor;
  if (!tensor) return DATASET_HEADER + 28;
  return previewHeight(tensor) + (collapsedLabel(tensor) ? 12 : 0);
}

function previewHeight(tensor: Tensor): number {
  const shape = shapeOf(tensor);
  switch (shape.kind) {
    case 'scalar':
      return DATASET_HEADER + 30;
    case 'series':
      return DATASET_HEADER + 54;
    case 'bars':
      return DATASET_HEADER + 14 * coordsOf(tensor, shape.by)!.length + 10;
    case 'grid':
      return DATASET_HEADER + 14 * coordsOf(tensor, shape.rows)!.length + 26;
  }
}

function edgePath(from: Box, to: Box): string {
  const x1 = from.x + from.width;
  const y1 = from.y + from.height / 2;
  const x2 = to.x;
  const y2 = to.y + to.height / 2;
  const bend = Math.max(32, (x2 - x1) / 2);
  return `M ${x1} ${y1} C ${x1 + bend} ${y1}, ${x2 - bend} ${y2}, ${x2} ${y2}`;
}

function position(box: Box) {
  return { left: `${box.x}px`, top: `${box.y}px`, width: `${box.width}px`, height: `${box.height}px` };
}

function key(selection: Selection): string {
  return `${selection.kind}:${selection.id}`;
}

function frameKey(groupId: string): string {
  return `frame:${groupId}`;
}
