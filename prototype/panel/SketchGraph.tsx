import { createMemo, createSignal, For, onCleanup, onMount, Show } from 'solid-js';
import { layoutGraph, type Box, type LayoutEdge, type LayoutItem } from '../../app/graph/layout';
import type { Sketch, Task } from '../data/types';

const DATASET_SIZE = { width: 200, height: 46 };
const NODE_SIZE = { width: 190, height: 56 };
const MIN_SCALE = 0.7;

/**
 * A pipeline that may not run yet: nodes without semantics are drawn as sketches and
 * datasets without data as missing. Hovering a task highlights what it points at.
 */
export function SketchGraph(props: { sketch: Sketch; maxScale?: number }) {
  const graph = createMemo(() => buildGraph(props.sketch));
  const layout = createMemo(() => layoutGraph(graph().items, graph().edges));
  const [hovered, setHovered] = createSignal<Task>();
  const [width, setWidth] = createSignal(0);
  const scale = () => Math.max(MIN_SCALE, Math.min(props.maxScale ?? 1, width() > 0 ? (width() - 2) / layout().width : 1));
  const highlighted = (id: string) => {
    const task = hovered();
    if (!task) return false;
    const [kind, name] = id.split(':') as [string, string];
    return kind === 'node' ? (task.nodes ?? []).includes(name) : (task.datasets ?? []).includes(name);
  };
  let frame!: HTMLDivElement;
  onMount(() => {
    const observer = new ResizeObserver(() => setWidth(frame.clientWidth));
    observer.observe(frame);
    onCleanup(() => observer.disconnect());
  });

  return (
    <div class="pt-sketch">
      <div ref={frame} class="pt-sketch-frame">
        <div style={{ width: `${layout().width * scale()}px`, height: `${layout().height * scale()}px` }}>
          <div
            class="graph"
            style={{ width: `${layout().width}px`, height: `${layout().height}px`, transform: `scale(${scale()})` }}
          >
            <svg class="edges" width={layout().width} height={layout().height}>
              <For each={graph().edges}>
                {(edge) => (
                  <path
                    d={edgePath(layout().boxes.get(edge.from)!, layout().boxes.get(edge.to)!)}
                    classList={{ edge: true, linked: highlighted(edge.from) || highlighted(edge.to) }}
                  />
                )}
              </For>
            </svg>
            <For each={Object.entries(props.sketch.nodes)}>
              {([id, node]) => (
                <div
                  class="box model pt-node"
                  classList={{ 'pt-sketched': !node.semantics, selected: highlighted(`node:${id}`) }}
                  style={position(layout().boxes.get(`node:${id}`)!)}
                >
                  <div class="model-label">{node.label}</div>
                  <div class="model-meta">
                    <Show when={node.semantics} fallback={<span class="pt-sketch-tag">sketch · no semantics</span>}>
                      <span class="semantics">{node.semantics}</span>
                    </Show>
                  </div>
                </div>
              )}
            </For>
            <For each={Object.entries(props.sketch.datasets)}>
              {([name, dataset]) => (
                <div
                  class="box dataset pt-dataset"
                  classList={{ 'pt-missing': kindOf(props.sketch, name) === 'missing', selected: highlighted(`dataset:${name}`) }}
                  style={position(layout().boxes.get(`dataset:${name}`)!)}
                >
                  <div class="dataset-head">
                    <span class="dataset-name">{name}</span>
                    <span class={`badge ${kindOf(props.sketch, name)}`}>{kindOf(props.sketch, name)}</span>
                  </div>
                  <div class="dataset-unit">
                    {dataset.unit}
                    <Show when={dataset.dims.length > 0}>
                      <span class="dims"> [{dataset.dims.join(' × ')}]</span>
                    </Show>
                  </div>
                </div>
              )}
            </For>
          </div>
        </div>
      </div>
      <Show when={Object.keys(props.sketch.tasks).length > 0}>
        <h3 class="pt-h3">Tasks ({Object.keys(props.sketch.tasks).length})</h3>
        <ul class="pt-task-list">
          <For each={Object.values(props.sketch.tasks)}>
            {(task) => (
              <li onMouseEnter={() => setHovered(task)} onMouseLeave={() => setHovered(undefined)}>
                <TaskLine task={task} />
              </li>
            )}
          </For>
        </ul>
      </Show>
    </div>
  );
}

/** Instructions plus chips for the nodes and datasets the task points at. */
export function TaskLine(props: { task: Task; onTarget?: (target: { node?: string; dataset?: string }) => void }) {
  return (
    <div class="pt-task">
      <span>{props.task.instructions}</span>
      <span class="pt-chips">
        <For each={props.task.nodes ?? []}>
          {(node) => (
            <button class="pt-chip pt-chip-node" disabled={!props.onTarget} onClick={() => props.onTarget?.({ node })}>
              {node}
            </button>
          )}
        </For>
        <For each={props.task.datasets ?? []}>
          {(dataset) => (
            <button class="pt-chip pt-chip-dataset" disabled={!props.onTarget} onClick={() => props.onTarget?.({ dataset })}>
              {dataset}
            </button>
          )}
        </For>
      </span>
    </div>
  );
}

function buildGraph(sketch: Sketch): { items: LayoutItem[]; edges: LayoutEdge[] } {
  const items: LayoutItem[] = [];
  const edges: LayoutEdge[] = [];
  const seen = new Set<string>();
  const addDataset = (name: string) => {
    const id = `dataset:${name}`;
    if (!seen.has(id)) {
      seen.add(id);
      items.push({ id, ...DATASET_SIZE });
    }
    return id;
  };
  for (const [id, node] of Object.entries(sketch.nodes)) {
    const nodeId = `node:${id}`;
    for (const name of Object.values(node.inputs)) edges.push({ from: addDataset(name), to: nodeId });
    items.push({ id: nodeId, ...NODE_SIZE });
    for (const name of Object.values(node.outputs)) edges.push({ from: nodeId, to: addDataset(name) });
  }
  for (const name of Object.keys(sketch.datasets)) addDataset(name);
  return { items, edges };
}

function kindOf(sketch: Sketch, name: string): 'sourced' | 'assumption' | 'derived' | 'computed' | 'missing' {
  const produced = Object.values(sketch.nodes).some((node) => Object.values(node.outputs).includes(name));
  if (produced) return 'computed';
  return sketch.datasets[name]?.data ?? 'missing';
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
