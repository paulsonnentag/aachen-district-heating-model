import { createMemo, createSignal, For, Show } from 'solid-js';
import type { NodeResult, RunResult } from '../../lib/runtime/run';
import type { Tensor } from '../../lib/runtime/tensor';
import type { VariableDescription, VariableTrace } from '../../lib/semantics/types';
import { detailChart } from '../components/DetailPanel';
import { Plot } from '../components/Plot';
import { formatValue } from '../values';
import {
  AUX_RADIUS,
  isVertical,
  layoutStockFlow,
  LINE_HEIGHT,
  readable,
  STOCK,
  VALVE_RADIUS,
  wrap,
  type Connector,
  type FlowShape,
  type Point,
  type Rect,
  type StockFlowLayout,
} from './layout';

export type ModelViewProps = { node: NodeResult; baseline?: NodeResult; result?: RunResult };

/** Stock-and-flow diagram of an XMILE node, with each variable's values from the run. */
export function StockFlowView(props: ModelViewProps) {
  const variables = () => props.node.description?.variables ?? [];
  const byName = createMemo(() => new Map(variables().map((v) => [v.name, v])));

  const years = () => Object.values(props.node.trace ?? {})[0]?.years ?? [];
  const [yearIndex, setYearIndex] = createSignal<number>();
  const year = () => Math.min(yearIndex() ?? years().length - 1, years().length - 1);
  const [zoom, setZoom] = createSignal(1);
  const [hovered, setHovered] = createSignal<string>();
  const [selected, setSelected] = createSignal<string>();
  const focus = () => hovered() ?? selected();
  const linked = (c: Connector) => focus() !== undefined && (c.from === focus() || c.to === focus());
  const values = (name: string): Values => ({
    trace: props.node.trace?.[name],
    baseline: props.baseline?.trace?.[name],
    year: year(),
  });
  const wiring = (name: string) => {
    if (props.node.node.inputs[name]) return `← ${props.node.node.inputs[name]}`;
    if (props.node.node.outputs[name]) return `→ ${props.node.node.outputs[name]}`;
    return undefined;
  };
  const layout = createMemo(() => layoutStockFlow(variables(), wiring));
  let frame!: HTMLDivElement;
  const fit = () => setZoom(Math.min(1.5, (frame.clientWidth - 24) / layout().width, (frame.clientHeight - 24) / layout().height));

  return (
    <div class="sf">
      <div class="sf-main">
        <div class="sf-toolbar">
          <div class="zoom">
            <button onClick={() => setZoom((z) => Math.max(0.2, z / 1.25))}>−</button>
            <span>{Math.round(zoom() * 100)}%</span>
            <button onClick={() => setZoom((z) => Math.min(3, z * 1.25))}>+</button>
            <button onClick={fit}>Fit</button>
          </div>
          <Show when={years().length > 1}>
            <label class="sf-year">
              <input type="range" min={0} max={years().length - 1} value={year()} onInput={(e) => setYearIndex(Number(e.currentTarget.value))} />
              <span>{years()[year()]}</span>
            </label>
          </Show>
          <span class="muted sf-legend">Σ total and avg mean over the elements of arrayed variables</span>
        </div>
        <div class="sf-frame" ref={frame} onClick={() => setSelected(undefined)}>
          <svg
            width={layout().width * zoom()}
            height={layout().height * zoom()}
            viewBox={`0 0 ${layout().width} ${layout().height}`}
            class="sf-diagram"
          >
            <defs>
              <marker id="sf-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
                <path d="M 0 1 L 10 5 L 0 9 z" class="sf-arrowhead" />
              </marker>
              <marker id="sf-arrow-linked" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
                <path d="M 0 1 L 10 5 L 0 9 z" class="sf-arrowhead linked" />
              </marker>
            </defs>
            <For each={[...layout().flows.values()]}>{(shape) => <Pipe shape={shape} />}</For>
            <For each={layout().connectors}>
              {(c) => (
                <path
                  d={connectorPath(layout(), c)}
                  class="sf-connector"
                  classList={{ initial: c.initial, linked: linked(c), dimmed: focus() !== undefined && !linked(c) }}
                  marker-end={linked(c) ? 'url(#sf-arrow-linked)' : 'url(#sf-arrow)'}
                />
              )}
            </For>
            <For each={[...layout().stocks]}>
              {([name, rect]) => (
                <Interactive name={name} onHover={setHovered} onSelect={setSelected} selected={selected() === name}>
                  <StockShape rect={rect} variable={byName().get(name)!} values={values(name)} wiring={wiring(name)} />
                </Interactive>
              )}
            </For>
            <For each={[...layout().flows]}>
              {([name, shape]) => (
                <Interactive name={name} onHover={setHovered} onSelect={setSelected} selected={selected() === name}>
                  <Valve shape={shape} variable={byName().get(name)!} values={values(name)} wiring={wiring(name)} />
                </Interactive>
              )}
            </For>
            <For each={[...layout().auxes]}>
              {([name, at]) => (
                <Interactive name={name} onHover={setHovered} onSelect={setSelected} selected={selected() === name}>
                  <AuxShape at={at} variable={byName().get(name)!} values={values(name)} wiring={wiring(name)} />
                </Interactive>
              )}
            </For>
          </svg>
        </div>
      </div>
      <Show when={byName().get(selected() ?? '')}>
        {(v) => <VariablePanel variable={v()} values={values(v().name)} wiring={wiring(v().name)} onClose={() => setSelected(undefined)} />}
      </Show>
    </div>
  );
}

type Values = { trace?: VariableTrace; baseline?: VariableTrace; year: number };

function Interactive(props: { name: string; selected: boolean; onHover: (name?: string) => void; onSelect: (name: string) => void; children: unknown }) {
  return (
    <g
      class="sf-node"
      classList={{ selected: props.selected }}
      onMouseEnter={() => props.onHover(props.name)}
      onMouseLeave={() => props.onHover(undefined)}
      onClick={(e) => {
        e.stopPropagation();
        props.onSelect(props.name);
      }}
    >
      {props.children as Element}
    </g>
  );
}

function StockShape(props: { rect: Rect; variable: VariableDescription; values: Values; wiring?: string }) {
  const left = () => props.rect.x - props.rect.width / 2;
  const top = () => props.rect.y - props.rect.height / 2;
  const spark = { width: STOCK.width - 16, height: 22 };
  return (
    <>
      <Show when={props.variable.dims.length > 0}>
        <rect x={left() + 8} y={top() - 8} width={props.rect.width} height={props.rect.height} class="sf-stock stacked" />
        <rect x={left() + 4} y={top() - 4} width={props.rect.width} height={props.rect.height} class="sf-stock stacked" />
      </Show>
      <rect x={left()} y={top()} width={props.rect.width} height={props.rect.height} class="sf-stock" />
      <text x={props.rect.x} y={top() + 15} class="sf-name" text-anchor="middle">{readable(props.variable.name)}</text>
      <Sparkline values={props.values} x={left() + 8} y={top() + 21} width={spark.width} height={spark.height} />
      <text x={props.rect.x} y={top() + props.rect.height - 7} class="sf-value" text-anchor="middle">{valueLabel(props.values)}</text>
      <Show when={props.wiring}>
        <text x={props.rect.x} y={top() + props.rect.height + 26} class="sf-wiring" text-anchor="middle">{props.wiring}</text>
      </Show>
      <Show when={props.variable.dims.length > 0}>
        <text x={props.rect.x} y={top() + props.rect.height + 13} class="sf-dims" text-anchor="middle">[{props.variable.dims.join(', ')}]</text>
      </Show>
    </>
  );
}

function Pipe(props: { shape: FlowShape }) {
  const path = () => pipePath(props.shape.points);
  const head = () => arrowHead(props.shape.points);
  return (
    <g class="sf-pipe">
      <path d={path()} class="sf-pipe-outer" />
      <path d={path()} class="sf-pipe-inner" />
      <path d={head()} class="sf-pipe-head" />
      <Show when={props.shape.sourceCloud}>{(c) => <Cloud at={c()} />}</Show>
      <Show when={props.shape.sinkCloud}>{(c) => <Cloud at={c()} />}</Show>
    </g>
  );
}

function Valve(props: { shape: FlowShape; variable: VariableDescription; values: Values; wiring?: string }) {
  const at = () => props.shape.valve;
  const vertical = () => isVertical(props.shape);
  const labelAt = (): Point => (vertical() ? { x: at().x + 16, y: at().y - 4 } : { x: at().x, y: at().y + 24 });
  return (
    <>
      <circle cx={at().x} cy={at().y} r={VALVE_RADIUS} class="sf-valve" />
      <path d={vertical() ? `M ${at().x - 9} ${at().y} L ${at().x + 9} ${at().y}` : `M ${at().x} ${at().y - 9} L ${at().x} ${at().y + 9}`} class="sf-valve-stem" />
      <Label at={labelAt()} anchor={vertical() ? 'start' : 'middle'} variable={props.variable} values={props.values} wiring={props.wiring} />
    </>
  );
}

function AuxShape(props: { at: Point; variable: VariableDescription; values: Values; wiring?: string }) {
  const role = () => props.variable.role;
  return (
    <>
      <Show when={props.variable.dims.length > 0}>
        <circle cx={props.at.x + 5} cy={props.at.y - 5} r={AUX_RADIUS} class={`sf-aux stacked ${role()}`} />
      </Show>
      <circle cx={props.at.x} cy={props.at.y} r={AUX_RADIUS} class={`sf-aux ${role()}`} />
      <Label at={{ x: props.at.x, y: props.at.y + AUX_RADIUS + 13 }} anchor="middle" variable={props.variable} values={props.values} wiring={props.wiring} />
    </>
  );
}

function Label(props: { at: Point; anchor: 'start' | 'middle'; variable: VariableDescription; values: Values; wiring?: string }) {
  const lines = () => wrap(readable(props.variable.name), 16);
  return (
    <text x={props.at.x} y={props.at.y} class="sf-label" text-anchor={props.anchor}>
      <For each={lines()}>{(line, i) => <tspan x={props.at.x} dy={i() === 0 ? 0 : LINE_HEIGHT}>{line}</tspan>}</For>
      <Show when={props.values.trace}>
        <tspan x={props.at.x} dy={LINE_HEIGHT} class="sf-value">{valueLabel(props.values)}</tspan>
      </Show>
      <Show when={props.wiring}>
        <tspan x={props.at.x} dy={LINE_HEIGHT} class="sf-wiring">{props.wiring}</tspan>
      </Show>
    </text>
  );
}

function Sparkline(props: { values: Values; x: number; y: number; width: number; height: number }) {
  const scale = createMemo(() => {
    const series = [props.values.trace?.summary, props.values.baseline?.summary].filter((s): s is Float64Array => !!s);
    const all = series.flatMap((s) => [...s]);
    const min = Math.min(...all);
    const max = Math.max(...all);
    const n = props.values.trace?.summary.length ?? 1;
    return {
      x: (i: number) => props.x + (n > 1 ? (i / (n - 1)) * props.width : props.width / 2),
      y: (v: number) => props.y + props.height - (max > min ? ((v - min) / (max - min)) * props.height : props.height / 2),
    };
  });
  const path = (values?: Float64Array) =>
    values ? [...values].map((v, i) => `${i === 0 ? 'M' : 'L'} ${scale().x(i).toFixed(1)} ${scale().y(v).toFixed(1)}`).join(' ') : '';
  return (
    <Show when={props.values.trace && props.values.trace.summary.length > 1}>
      <path d={path(props.values.baseline?.summary)} class="sf-spark baseline" />
      <path d={path(props.values.trace!.summary)} class="sf-spark" />
      <line x1={scale().x(props.values.year)} x2={scale().x(props.values.year)} y1={props.y} y2={props.y + props.height} class="sf-cursor" />
    </Show>
  );
}

function Cloud(props: { at: Point }) {
  const { x, y } = props.at;
  return (
    <path
      class="sf-cloud"
      d={`M ${x - 12} ${y + 6} a 6 6 0 0 1 2 -11 a 7 7 0 0 1 12 -3 a 6 6 0 0 1 10 5 a 5 5 0 0 1 -2 9 z`}
    />
  );
}

function VariablePanel(props: { variable: VariableDescription; values: Values; wiring?: string; onClose: () => void }) {
  const tensor = (): Tensor | undefined => props.values.trace?.tensor ?? summaryTensor(props.values.trace, props.variable);
  const baseline = (): Tensor | undefined => props.values.baseline?.tensor ?? summaryTensor(props.values.baseline, props.variable);
  return (
    <aside class="detail">
      <button class="close" onClick={() => props.onClose()}>×</button>
      <h2>{props.variable.name}</h2>
      <p class="muted">
        {props.variable.kind} · {props.variable.role}
        <Show when={props.variable.dims.length > 0}> · [{props.variable.dims.join(', ')}]</Show>
        <Show when={props.variable.units}> · {props.variable.units}</Show>
      </p>
      <Show when={props.wiring}><p><code>{props.wiring}</code></p></Show>
      <Show when={props.variable.role !== 'input'}>
        <h3>{props.variable.kind === 'stock' ? 'Initial value' : 'Equation'}</h3>
        <code class="equation">{props.variable.equation}</code>
      </Show>
      <Show when={props.variable.inflows?.length || props.variable.outflows?.length}>
        <p class="flows">
          <Show when={props.variable.inflows?.length}>in: {props.variable.inflows!.join(', ')} </Show>
          <Show when={props.variable.outflows?.length}>out: {props.variable.outflows!.join(', ')}</Show>
        </p>
      </Show>
      <Show when={tensor()}>
        {(t) => (
          <>
            <h3>{props.values.trace?.tensor || props.variable.dims.length === 0 ? 'Values' : `${props.values.trace?.aggregate} over ${props.variable.dims.join(' × ')}`}</h3>
            <Plot class="detail-chart" render={() => detailChart(t(), baseline())} />
          </>
        )}
      </Show>
    </aside>
  );
}

function summaryTensor(trace: VariableTrace | undefined, variable: VariableDescription): Tensor | undefined {
  if (!trace) return undefined;
  return { dims: ['year'], coords: [trace.years], values: trace.summary, unit: variable.units ?? '' };
}

function valueLabel(values: Values): string {
  const trace = values.trace;
  if (!trace) return '';
  const prefix = trace.aggregate === 'total' ? 'Σ ' : trace.aggregate === 'mean' ? 'avg ' : '';
  return `${prefix}${formatValue(trace.summary[values.year] ?? Number.NaN)}`;
}

function connectorPath(layout: StockFlowLayout, c: Connector): string {
  const a = anchorOf(layout, c.from);
  const b = anchorOf(layout, c.to);
  if (!a || !b) return '';
  const mid = { x: (a.centre.x + b.centre.x) / 2, y: (a.centre.y + b.centre.y) / 2 };
  const dx = b.centre.x - a.centre.x;
  const dy = b.centre.y - a.centre.y;
  const control = { x: mid.x - dy * 0.18, y: mid.y + dx * 0.18 };
  const start = a.edge(control);
  const end = b.edge(control);
  return `M ${start.x} ${start.y} Q ${control.x} ${control.y} ${end.x} ${end.y}`;
}

type Anchor = { centre: Point; edge: (toward: Point) => Point };

function anchorOf(layout: StockFlowLayout, name: string): Anchor | undefined {
  const stock = layout.stocks.get(name);
  if (stock) return { centre: stock, edge: (p) => rectEdge(stock, p) };
  const flow = layout.flows.get(name);
  const point = flow?.valve ?? layout.auxes.get(name);
  if (!point) return undefined;
  const radius = (flow ? VALVE_RADIUS : AUX_RADIUS) + 2;
  return { centre: point, edge: (p) => circleEdge(point, radius, p) };
}

function rectEdge(rect: Rect, toward: Point): Point {
  const dx = toward.x - rect.x;
  const dy = toward.y - rect.y;
  const scale = Math.min((rect.width / 2 + 2) / Math.abs(dx || 1e-9), (rect.height / 2 + 2) / Math.abs(dy || 1e-9));
  return { x: rect.x + dx * scale, y: rect.y + dy * scale };
}

function circleEdge(centre: Point, radius: number, toward: Point): Point {
  const dx = toward.x - centre.x;
  const dy = toward.y - centre.y;
  const d = Math.hypot(dx, dy) || 1;
  return { x: centre.x + (dx / d) * radius, y: centre.y + (dy / d) * radius };
}

function pipePath(points: Point[]): string {
  const last = points.at(-1)!;
  const before = points.at(-2)!;
  const d = Math.hypot(last.x - before.x, last.y - before.y) || 1;
  const end = { x: last.x - ((last.x - before.x) / d) * 10, y: last.y - ((last.y - before.y) / d) * 10 };
  return [...points.slice(0, -1), end].map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`).join(' ');
}

function arrowHead(points: Point[]): string {
  const tip = points.at(-1)!;
  const before = points.at(-2)!;
  const d = Math.hypot(tip.x - before.x, tip.y - before.y) || 1;
  const ux = (tip.x - before.x) / d;
  const uy = (tip.y - before.y) / d;
  const base = { x: tip.x - ux * 13, y: tip.y - uy * 13 };
  return `M ${tip.x} ${tip.y} L ${base.x - uy * 8} ${base.y + ux * 8} L ${base.x + uy * 8} ${base.y - ux * 8} Z`;
}
