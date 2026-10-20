import { createMemo, createSignal, For, Show } from 'solid-js';
import { provenanceKind } from '../../lib/runtime/pipeline';
import type { DatasetResult, NodeResult, RunResult } from '../../lib/runtime/run';
import { coordsOf, type Tensor } from '../../lib/runtime/tensor';
import { ValuePreview } from '../components/ValuePreview';
import { collapsedLabel, shapeOf } from '../values';
import { layoutGraph, type Box, type LayoutEdge, type LayoutItem } from './layout';

export type Selection = { kind: 'dataset' | 'node'; id: string };

const DATASET_WIDTH = 220;
const DATASET_HEADER = 44;
const NODE_SIZE = { width: 200, height: 64 };

export function GraphView(props: {
  result: RunResult;
  baseline?: RunResult;
  selected?: Selection;
  onSelect: (selection: Selection | undefined) => void;
  onOpen?: (nodeId: string) => void;
}) {
  const graph = createMemo(() => buildGraph(props.result));
  const layout = createMemo(() => layoutGraph(graph().items, graph().edges));
  const [hovered, setHovered] = createSignal<string>();
  const [zoom, setZoom] = createSignal(1);
  const focus = () => hovered() ?? (props.selected ? key(props.selected) : undefined);
  const isLinked = (edge: LayoutEdge) => focus() !== undefined && (edge.from === focus() || edge.to === focus());
  let frame!: HTMLDivElement;
  const fit = () => {
    const canvas = frame.closest('.canvas') as HTMLElement;
    setZoom(Math.min(1, (canvas.clientWidth - 16) / layout().width, (canvas.clientHeight - frame.offsetTop - 16) / layout().height));
  };

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
          <For each={props.result.pipeline.nodes}>
            {(node) => {
              const id = key({ kind: 'node', id: node.id });
              return (
                <ModelBox
                  box={layout().boxes.get(id)!}
                  result={props.result.nodes.get(node.id)!}
                  selected={props.selected?.kind === 'node' && props.selected.id === node.id}
                  onHover={(on) => setHovered(on ? id : undefined)}
                  onSelect={() => props.onSelect({ kind: 'node', id: node.id })}
                  onOpen={() => props.onOpen?.(node.id)}
                />
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
                      selected={props.selected?.kind === 'dataset' && props.selected.id === dataset.name}
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
          <span class="status">{props.result.status}</span>
        </Show>
        <Show when={props.result.warnings.length > 0}>
          <span class="status warn">{props.result.warnings.length} warning{props.result.warnings.length > 1 ? 's' : ''}</span>
        </Show>
      </div>
    </div>
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
    if ('node' in producer) return { text: 'computed', class: 'computed' };
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
      <div class="dataset-unit">
        {props.dataset.tensor?.unit ?? ''}
        <Show when={props.dataset.tensor && props.dataset.tensor.dims.length > 0}>
          <span class="dims"> [{props.dataset.tensor!.dims.join(' × ')}]</span>
        </Show>
      </div>
      <ValuePreview tensor={props.dataset.tensor} baseline={props.baseline?.tensor} error={props.dataset.error} />
    </div>
  );
}

function buildGraph(result: RunResult): { items: LayoutItem[]; edges: LayoutEdge[] } {
  const items: LayoutItem[] = [];
  const edges: LayoutEdge[] = [];
  const seen = new Set<string>();
  const addDataset = (name: string) => {
    const id = key({ kind: 'dataset', id: name });
    if (seen.has(id)) return id;
    seen.add(id);
    items.push({ id, width: DATASET_WIDTH, height: datasetHeight(result.datasets.get(name)?.tensor) });
    return id;
  };
  for (const node of result.pipeline.nodes) {
    const nodeId = key({ kind: 'node', id: node.id });
    for (const name of Object.values(node.inputs)) edges.push({ from: addDataset(name), to: nodeId });
    items.push({ id: nodeId, ...NODE_SIZE });
    for (const name of Object.values(node.outputs)) edges.push({ from: nodeId, to: addDataset(name) });
  }
  for (const name of result.datasets.keys()) addDataset(name);
  return { items, edges };
}

function datasetHeight(tensor: Tensor | undefined): number {
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
