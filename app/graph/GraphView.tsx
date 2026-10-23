import { createEffect, createMemo, createSignal, For, Show } from 'solid-js';
import { provenanceKind } from '../../lib/runtime/pipeline';
import type { DatasetResult, NodeResult, RunResult } from '../../lib/runtime/run';
import { CACHE_LABELS, ComputeButton, computeGroup, DatasetInfo, NodeDetail, STATUS_LABELS } from '../components/Details';
import { currentView, previewHeight, ValueView, valueSummary, viewsOf, ViewPicker, type ViewOption } from '../components/ValueView';
import { keyOf, type Actions, type Selection } from '../workbench';
import { consumersOf, groupsOf, groupStatus, type GroupInfo } from './groups';
import { layoutGraph, type Box, type Layout, type LayoutEdge, type LayoutItem } from './layout';

const DATASET_WIDTH = 220;
const DATASET_HEADER = 44;
const PICKER_HEIGHT = 18;
const NODE_SIZE = { width: 230, height: 100 };
const GROUP_SIZE = { width: 250, height: 112 };
const FRAME_HEADER = 32;
/** Expanded boxes have a fixed size, so the layout does not depend on what they draw; their content scrolls. */
const EXPANDED_DATASET = { width: 480, height: 500 };
const EXPANDED_NODE = { width: 420, height: 400 };
const EXPANDED_VIEW_WIDTH = 440;

export function GraphView(props: {
  result: RunResult;
  baseline?: RunResult;
  selected?: Selection;
  /** Scrolls this box to the centre each time it is set. */
  reveal?: Selection;
  /** Nodes and groups whose datasets are shown. */
  unfolded: string[];
  expanded: string[];
  actions: Actions;
}) {
  const groups = createMemo(() => groupsOf(props.result));
  const shown = createMemo(() => shownDatasets(props.result, groups(), props.unfolded, props.expanded, props.selected));
  const viewOf = (dataset: DatasetResult) =>
    currentView(viewsOf(dataset), props.actions.viewOf(dataset.name), props.result.pipeline.views[dataset.name]);
  const datasetHeight = (name: string) => {
    const dataset = props.result.datasets.get(name);
    const view = dataset && viewOf(dataset);
    return DATASET_HEADER + previewHeight(dataset, view?.name) + (view ? PICKER_HEIGHT : 0);
  };
  const graph = createMemo(() => buildGraph(props.result, groups(), new Set(props.expanded), shown(), datasetHeight));
  const layout = () => graph().layout;
  const [hovered, setHovered] = createSignal<string>();
  const [zoom, setZoom] = createSignal(1);
  const focus = () => hovered() ?? (props.selected ? keyOf(props.selected) : undefined);
  const isLinked = (edge: LayoutEdge) => focus() !== undefined && (edge.from === focus() || edge.to === focus());
  let frame!: HTMLDivElement;
  const fit = () => {
    const canvas = frame.closest('.canvas') as HTMLElement;
    setZoom(Math.min(1, (canvas.clientWidth - 16) / layout().width, (canvas.clientHeight - frame.offsetTop - 16) / layout().height));
  };
  const centre = (target: Selection) => {
    const box = layout().boxes.get(keyOf(target));
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
  /** Unfolding re-lays out the graph; the clicked box stays where it was on screen. */
  const unfold = (target: Selection) => {
    const before = layout().boxes.get(keyOf(target));
    props.actions.unfold(target);
    const after = layout().boxes.get(keyOf(target));
    const canvas = frame.closest('.canvas') as HTMLElement | null;
    if (before && after && canvas) canvas.scrollBy((after.x - before.x) * zoom(), (after.y - before.y) * zoom());
  };
  const isUnfolded = (kind: Selection['kind'], id: string) => props.unfolded.includes(keyOf({ kind, id }));
  const isSelected = (kind: Selection['kind'], id: string) => props.selected?.kind === kind && props.selected.id === id;
  const isExpanded = (kind: Selection['kind'], id: string) => props.expanded.includes(keyOf({ kind, id }));

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
          onClick={() => props.actions.select(undefined)}
        >
          <For each={graph().expanded}>
            {(id) => (
              <GroupFrame
                box={layout().boxes.get(frameKey(id))!}
                info={groups().get(id)!}
                result={props.result}
                selected={isSelected('group', id)}
                actions={props.actions}
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
              const itemId = keyOf({ kind: 'group', id });
              return (
                <GroupBox
                  box={layout().boxes.get(itemId)!}
                  info={groups().get(id)!}
                  selected={isSelected('group', id)}
                  unfolded={isUnfolded('group', id)}
                  onHover={(on) => setHovered(on ? itemId : undefined)}
                  onUnfold={unfold}
                  actions={props.actions}
                />
              );
            }}
          </For>
          <For each={props.result.pipeline.nodes}>
            {(node) => {
              const id = keyOf({ kind: 'node', id: node.id });
              return (
                <Show when={layout().boxes.get(id)}>
                  {(box) => (
                    <ModelBox
                      box={box()}
                      node={props.result.nodes.get(node.id)!}
                      result={props.result}
                      selected={isSelected('node', node.id)}
                      expanded={isExpanded('node', node.id)}
                      unfolded={isUnfolded('node', node.id)}
                      onHover={(on) => setHovered(on ? id : undefined)}
                      onUnfold={unfold}
                      actions={props.actions}
                    />
                  )}
                </Show>
              );
            }}
          </For>
          <For each={[...props.result.datasets.values()]}>
            {(dataset) => {
              const id = keyOf({ kind: 'dataset', id: dataset.name });
              return (
                <Show when={layout().boxes.get(id)}>
                  {(box) => (
                    <DatasetBox
                      box={box()}
                      dataset={dataset}
                      baseline={props.baseline?.datasets.get(dataset.name)}
                      result={props.result}
                      options={viewsOf(dataset)}
                      view={viewOf(dataset)}
                      selected={isSelected('dataset', dataset.name)}
                      expanded={isExpanded('dataset', dataset.name)}
                      onHover={(on) => setHovered(on ? id : undefined)}
                      actions={props.actions}
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

function DatasetBox(props: {
  box: Box;
  dataset: DatasetResult;
  baseline?: DatasetResult;
  result: RunResult;
  options: ViewOption[];
  view?: ViewOption;
  selected: boolean;
  expanded: boolean;
  onHover: (on: boolean) => void;
  actions: Actions;
}) {
  const target = (): Selection => ({ kind: 'dataset', id: props.dataset.name });
  const badge = () => {
    const producer = props.dataset.producer;
    if ('node' in producer) {
      const empty = !props.dataset.tensor && !props.dataset.table && !props.dataset.error;
      return empty ? { text: 'on demand', class: 'on-demand' } : { text: 'computed', class: 'computed' };
    }
    const kind = provenanceKind(producer.catalog.source);
    return { text: kind, class: kind };
  };
  const picker = () => (
    <ViewPicker options={props.options} current={props.view} onChange={(view) => props.actions.setView(props.dataset.name, view)} />
  );
  return (
    <div
      class="box dataset"
      classList={{ selected: props.selected, expanded: props.expanded }}
      style={position(props.box)}
      onMouseEnter={() => props.onHover(true)}
      onMouseLeave={() => props.onHover(false)}
      onClick={(e) => {
        e.stopPropagation();
        if (props.expanded) props.actions.select(target());
        else props.actions.toggle(target());
      }}
    >
      <div
        class="dataset-head"
        onClick={(e) => {
          if (!props.expanded) return;
          e.stopPropagation();
          props.actions.toggle(target());
        }}
      >
        <span class="dataset-name">{props.dataset.name}</span>
        <span class={`badge ${badge().class}`}>{badge().text}</span>
        <BoxButtons target={target()} expanded={props.expanded} actions={props.actions} />
      </div>
      <div class="dataset-unit">{valueSummary(props.dataset)}</div>
      <Show
        when={props.expanded}
        fallback={
          <>
            <div class="preview" style={{ height: `${previewHeight(props.dataset, props.view?.name)}px` }}>
              <ValueView dataset={props.dataset} baseline={props.baseline} view={props.view?.name} />
            </div>
            {picker()}
          </>
        }
      >
        <div class="box-body">
          <ValueView dataset={props.dataset} baseline={props.baseline} view={props.view?.name} large width={EXPANDED_VIEW_WIDTH} maxHeight={420} />
          {picker()}
          <DatasetInfo dataset={props.dataset} result={props.result} actions={props.actions} />
        </div>
      </Show>
    </div>
  );
}

function ModelBox(props: {
  box: Box;
  node: NodeResult;
  result: RunResult;
  selected: boolean;
  expanded: boolean;
  unfolded: boolean;
  onHover: (on: boolean) => void;
  onUnfold: (target: Selection) => void;
  actions: Actions;
}) {
  const target = (): Selection => ({ kind: 'node', id: props.node.node.id });
  return (
    <div
      class={`box model status-${props.node.status}`}
      classList={{ selected: props.selected, expanded: props.expanded, unfolded: props.unfolded }}
      style={position(props.box)}
      title={props.expanded ? undefined : props.node.node.description}
      onMouseEnter={() => props.onHover(true)}
      onMouseLeave={() => props.onHover(false)}
      onClick={(e) => {
        e.stopPropagation();
        if (props.expanded) props.actions.select(target());
        else props.onUnfold(target());
      }}
    >
      <div
        class="model-head"
        onClick={(e) => {
          if (!props.expanded) return;
          e.stopPropagation();
          props.actions.toggle(target());
        }}
      >
        <div class="model-title">
          <span class="model-label">{props.node.node.label}</span>
          <BoxButtons target={target()} expanded={props.expanded} details actions={props.actions} />
        </div>
        <Show when={!props.expanded && props.node.node.description}>
          <p class="model-description">{props.node.node.description}</p>
        </Show>
        <div class="model-meta">
          <span class="semantics">{props.node.node.semantics}</span>
          <Show when={props.node.status !== 'ok'}>
            <span class="status">{STATUS_LABELS[props.node.status]}</span>
          </Show>
          <Show when={props.node.warnings.length > 0}>
            <span class="status warn">{props.node.warnings.length} warning{props.node.warnings.length > 1 ? 's' : ''}</span>
          </Show>
          <Show when={props.node.cache}>{(cache) => <span class="cache-origin">{CACHE_LABELS[cache().origin]}</span>}</Show>
        </div>
      </div>
      <Show when={props.expanded}>
        <div class="box-body">
          <NodeDetail node={props.node} result={props.result} actions={props.actions} />
        </div>
      </Show>
    </div>
  );
}

/**
 * Details (for boxes whose click unfolds them instead), fullscreen and, once expanded, collapse;
 * they take the click so the box itself does not react.
 */
function BoxButtons(props: { target: Selection; expanded: boolean; details?: boolean; actions: Actions }) {
  return (
    <span class="box-buttons" classList={{ shown: props.expanded }}>
      <Show when={props.details && !props.expanded}>
        <button
          title="Details"
          onClick={(e) => {
            e.stopPropagation();
            props.actions.toggle(props.target);
          }}
        >
          <DetailsIcon />
        </button>
      </Show>
      <button
        title="Fullscreen"
        onClick={(e) => {
          e.stopPropagation();
          props.actions.fullscreen(props.target);
        }}
      >
        <FullscreenIcon />
      </button>
      <Show when={props.expanded}>
        <button
          title="Collapse"
          onClick={(e) => {
            e.stopPropagation();
            props.actions.toggle(props.target);
          }}
        >
          ×
        </button>
      </Show>
    </span>
  );
}

function DetailsIcon() {
  return (
    <svg class="icon" width="11" height="11" viewBox="0 0 12 12" aria-hidden="true">
      <path d="M1.5 2.5h9M1.5 6h9M1.5 9.5h6" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" />
    </svg>
  );
}

function FullscreenIcon() {
  return (
    <svg class="icon" width="11" height="11" viewBox="0 0 12 12" aria-hidden="true">
      <path d="M1 4.5V1h3.5M7.5 1H11v3.5M11 7.5V11H7.5M4.5 11H1V7.5" fill="none" stroke="currentColor" stroke-width="1.4" />
    </svg>
  );
}

function GroupBox(props: {
  box: Box;
  info: GroupInfo;
  selected: boolean;
  unfolded: boolean;
  onHover: (on: boolean) => void;
  onUnfold: (target: Selection) => void;
  actions: Actions;
}) {
  const target = (): Selection => ({ kind: 'group', id: props.info.group.id });
  return (
    <div
      class={`box model group status-${groupStatus(props.info).status}`}
      classList={{ selected: props.selected, unfolded: props.unfolded }}
      style={position(props.box)}
      title={props.info.group.description}
      onMouseEnter={() => props.onHover(true)}
      onMouseLeave={() => props.onHover(false)}
      onClick={(e) => {
        e.stopPropagation();
        props.onUnfold(target());
      }}
    >
      <button
        class="group-toggle"
        title="Show its steps"
        onClick={(e) => {
          e.stopPropagation();
          props.actions.toggle(target());
        }}
      >
        ▸
      </button>
      <div class="model-title">
        <span class="model-label">{props.info.group.label}</span>
        <BoxButtons target={target()} expanded={false} actions={props.actions} />
      </div>
      <Show when={props.info.group.description}>
        <p class="model-description">{props.info.group.description}</p>
      </Show>
      <div class="model-meta">
        <GroupStatusNote info={props.info} />
      </div>
    </div>
  );
}

function GroupFrame(props: { box: Box; info: GroupInfo; result: RunResult; selected: boolean; actions: Actions }) {
  const target = (): Selection => ({ kind: 'group', id: props.info.group.id });
  return (
    <div class="group-frame" classList={{ selected: props.selected }} style={position(props.box)}>
      <div
        class="group-head"
        title={props.info.group.description}
        onClick={(e) => {
          e.stopPropagation();
          props.actions.toggle(target());
        }}
      >
        <span class="group-toggle">▾</span>
        <span class="group-label">{props.info.group.label}</span>
        <span class="group-description">{props.info.group.description}</span>
        <GroupStatusNote info={props.info} />
        <Show when={groupStatus(props.info).idle.length > 0}>
          <ComputeButton label="Compute all steps" inline run={(onLog) => computeGroup(props.info, props.result, props.actions, onLog)} />
        </Show>
        <span class="box-buttons shown">
          <button
            title="Fullscreen"
            onClick={(e) => {
              e.stopPropagation();
              props.actions.fullscreen(target());
            }}
          >
            <FullscreenIcon />
          </button>
        </span>
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

type Graph = {
  layout: Layout;
  /** Edges between the boxes actually drawn. */
  edges: LayoutEdge[];
  expanded: string[];
  collapsed: string[];
};

/**
 * Only the `shown` datasets get a box; between two computations, a hidden dataset becomes an edge
 * from the one that makes it to the one that reads it. A collapsed group is one box and hides the
 * datasets only its steps use. An expanded group is laid out on its own and placed in the
 * pipeline's layout as one framed item, so its steps stay together.
 */
function buildGraph(
  result: RunResult,
  groups: Map<string, GroupInfo>,
  expanded: Set<string>,
  shown: Set<string>,
  datasetHeight: (name: string) => number,
): Graph {
  const isExpanded = (kind: Selection['kind'], id: string) => expanded.has(keyOf({ kind, id }));
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
    if (!shown.has(name)) return undefined;
    const group = groupOfDataset.get(name);
    if (group && !isExpanded('group', group)) return undefined;
    const size = isExpanded('dataset', name) ? EXPANDED_DATASET : { width: DATASET_WIDTH, height: datasetHeight(name) };
    return add(group ?? '', { id: keyOf({ kind: 'dataset', id: name }), ...size });
  };
  const nodeItem = (nodeId: string): string => {
    const group = groupOfNode.get(nodeId);
    if (group && !isExpanded('group', group)) return add('', { id: keyOf({ kind: 'group', id: group }), ...GROUP_SIZE });
    return add(group ?? '', { id: keyOf({ kind: 'node', id: nodeId }), ...(isExpanded('node', nodeId) ? EXPANDED_NODE : NODE_SIZE) });
  };

  const drawn = new Map<string, LayoutEdge>();
  const connect = (from: string | undefined, to: string | undefined) => {
    if (from && to && from !== to) drawn.set(`${from}>${to}`, { from, to });
  };
  const producerOf = new Map(result.pipeline.nodes.flatMap((node) => Object.values(node.outputs).map((name) => [name, node.id] as const)));
  for (const node of result.pipeline.nodes) {
    const inputs = Object.values(node.inputs).map((name) => {
      const producer = producerOf.get(name);
      return datasetItem(name) ?? (producer ? nodeItem(producer) : undefined);
    });
    const id = nodeItem(node.id);
    for (const input of inputs) connect(input, id);
    for (const name of Object.values(node.outputs)) connect(id, datasetItem(name));
  }
  for (const name of shown) datasetItem(name);

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
    collapsed: [...groups.keys()].filter((id) => !isExpanded('group', id) && boxes.has(keyOf({ kind: 'group', id }))),
  };
}

/** The model's results, what the unfolded nodes and groups read and make, and the datasets selected or expanded. */
function shownDatasets(
  result: RunResult,
  groups: Map<string, GroupInfo>,
  unfolded: string[],
  expanded: string[],
  selected: Selection | undefined,
): Set<string> {
  const consumers = consumersOf(result);
  const shown = new Set([...result.datasets.keys()].filter((name) => !consumers.has(name)));
  const datasetsOf = (key: string): string[] => {
    const node = result.nodes.get(key.slice('node:'.length))?.node;
    if (key.startsWith('node:') && node) return [...Object.values(node.inputs), ...Object.values(node.outputs)];
    const info = groups.get(key.slice('group:'.length));
    if (key.startsWith('group:') && info) return [...info.inputs, ...info.outputs];
    return [];
  };
  for (const key of unfolded) for (const name of datasetsOf(key)) shown.add(name);
  for (const key of [...expanded, ...(selected ? [keyOf(selected)] : [])]) {
    if (key.startsWith('dataset:')) shown.add(key.slice('dataset:'.length));
  }
  return new Set([...shown].filter((name) => result.datasets.has(name)));
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

function frameKey(groupId: string): string {
  return `frame:${groupId}`;
}
