import * as P from '@observablehq/plot';
import { createMemo, createSignal, For, Match, onCleanup, Show, Switch } from 'solid-js';
import { Portal } from 'solid-js/web';
import type { DatasetResult } from '../../lib/runtime/run';
import { tableFromTensor, type Table } from '../../lib/runtime/table';
import { coordsOf, reduction, type Tensor } from '../../lib/runtime/tensor';
import { collapsedLabel, domainOf, facetRowsOf, formatBytes, formatValue, rowsOf, shapeOf, type Shape } from '../values';
import { CellMap, cellMapPreview, gridOf, type MapSize } from './CellMap';
import { Plot } from './Plot';
import { spatialColumn, TableMap } from './TableMap';
import { formatCell, TableView } from './TableView';
import { ValuePreview } from './ValuePreview';

export type ViewName = 'chart' | 'map' | 'table' | 'rows' | 'file';
export type ViewOption = { name: ViewName; label: string };

export const PREVIEW_WIDTH = 196;
const MAP_PREVIEW_HEIGHT = 150;
const TABLE_PREVIEW_ROWS = 4;
const TABLE_PREVIEW_COLUMNS = 3;
const CHART_LABELS: Record<Shape['kind'], string> = { scalar: 'number', series: 'line chart', bars: 'bar chart', grid: 'heat map' };

/** A dataset drawn in the chosen view: small inside a box, or `large` at the given width. */
export function ValueView(props: {
  dataset: DatasetResult;
  baseline?: DatasetResult;
  view?: ViewName;
  large?: boolean;
  width?: number;
  maxHeight?: number;
}) {
  const width = () => props.width ?? PREVIEW_WIDTH;
  const mapSize = (): MapSize => (props.large ? { width: width(), maxHeight: props.maxHeight ?? 640 } : { width: width(), height: MAP_PREVIEW_HEIGHT, legend: false });
  return (
    <Switch fallback={<div class="preview-empty">not computed</div>}>
      <Match when={props.dataset.error}>
        <div class="preview-error">{props.dataset.error}</div>
      </Match>
      <Match when={props.view === 'chart' && props.dataset.tensor}>
        {(tensor) => (
          <Show when={props.large} fallback={<ValuePreview tensor={tensor()} baseline={props.baseline?.tensor} />}>
            <Show when={collapsedLabel(tensor())}>{(label) => <p class="muted view-note">chart shows {label()}</p>}</Show>
            <Plot class="detail-chart" render={() => detailChart(tensor(), props.baseline?.tensor, width())} />
          </Show>
        )}
      </Match>
      <Match when={props.view === 'map' && props.dataset.tensor}>
        {(tensor) => (
          <Show when={props.large} fallback={<Plot class="map" render={() => cellMapPreview(tensor(), mapSize())} />}>
            <CellMap tensor={tensor()} baseline={props.baseline?.tensor} size={mapSize()} />
          </Show>
        )}
      </Match>
      <Match when={props.view === 'map' && props.dataset.table}>
        {(table) => <TableMap table={table()} size={mapSize()} compact={!props.large} />}
      </Match>
      <Match when={props.view === 'table' && props.dataset.tensor}>
        {(tensor) => <TensorTable tensor={tensor()} large={props.large} />}
      </Match>
      <Match when={props.view === 'table' && props.dataset.table}>
        {(table) => <TableOrPreview table={table()} large={props.large} />}
      </Match>
      <Match when={props.view === 'rows' && props.dataset.source}>
        {(source) => <TableOrPreview table={source()} large={props.large} />}
      </Match>
      <Match when={props.view === 'file' && props.dataset.file}>
        {(file) => (
          <div class="dataset-file">
            <span class="muted">{new URL(file().url).host}</span>
            <span class="muted">{'catalog' in props.dataset.producer && 'decode' in props.dataset.producer.catalog ? 'decoded on demand' : 'read by the steps that use it'}</span>
          </div>
        )}
      </Match>
    </Switch>
  );
}

/** The ways a dataset can be shown, given what it holds: a tensor's shape, a table's columns, or a raw file. */
export function viewsOf(dataset: DatasetResult): ViewOption[] {
  const value = dataset.tensor ?? dataset.table ?? dataset.file;
  if (!value) return [];
  const known = OPTIONS.get(value);
  if (known && known.source === dataset.source) return known.options;
  const options = computeViews(dataset);
  OPTIONS.set(value, { source: dataset.source, options });
  return options;
}

const OPTIONS = new WeakMap<object, { source?: Table; options: ViewOption[] }>();

function computeViews({ tensor, table, source, file }: DatasetResult): ViewOption[] {
  const options: ViewOption[] = [];
  if (tensor) {
    options.push({ name: 'chart', label: chartLabel(tensor) });
    if (gridOf(tensor)) options.push({ name: 'map', label: 'map' });
    options.push({ name: 'table', label: 'table' });
    if (source) options.push({ name: 'rows', label: 'file rows' });
  } else if (table) {
    options.push({ name: 'table', label: 'table' });
    if (spatialColumn(table)) options.push({ name: 'map', label: 'map' });
  } else if (file) options.push({ name: 'file', label: 'file' });
  return options;
}

function chartLabel(tensor: Tensor): string {
  const kind = shapeOf(tensor).kind;
  if (kind === 'scalar' && collapsedLabel(tensor)) return reduction(tensor) === 'sum' ? 'total' : 'mean';
  return CHART_LABELS[kind];
}

/** The picked view if the dataset has it, else the pipeline's suggestion, else the first. */
export function currentView(options: ViewOption[], picked?: string, suggested?: string): ViewOption | undefined {
  return options.find((o) => o.name === picked) ?? options.find((o) => o.name === suggested) ?? options[0];
}

/** Height of the small view inside a dataset box, for the layout. */
export function previewHeight(dataset: DatasetResult | undefined, view: ViewName | undefined): number {
  if (!dataset || dataset.error || !view) return 28;
  switch (view) {
    case 'chart':
      return chartPreviewHeight(dataset.tensor!) + (collapsedLabel(dataset.tensor!) ? 12 : 0);
    case 'map':
      return MAP_PREVIEW_HEIGHT;
    case 'table':
    case 'rows':
      return 18 + 15 * TABLE_PREVIEW_ROWS + 4;
    case 'file':
      return 30;
  }
}

function chartPreviewHeight(tensor: Tensor): number {
  const shape = shapeOf(tensor);
  switch (shape.kind) {
    case 'scalar':
      return 30;
    case 'series':
      return 54;
    case 'bars':
      return 14 * coordsOf(tensor, shape.by)!.length + 10;
    case 'grid':
      return 14 * coordsOf(tensor, shape.rows)!.length + 26;
  }
}

/** The current view's name, underlined; clicking it lists the other views to switch to. */
export function ViewPicker(props: { options: ViewOption[]; current?: ViewOption; onChange: (view: ViewName) => void }) {
  const [menu, setMenu] = createSignal<{ left: number; top: number }>();
  let button: HTMLButtonElement | undefined;
  let list: HTMLUListElement | undefined;
  const others = () => props.options.filter((o) => o.name !== props.current?.name);
  const close = (event: Event) => {
    const target = event.target as Node;
    if (list?.contains(target) || button?.contains(target)) return;
    stopListening();
    setMenu(undefined);
  };
  const place = () => {
    const rect = button!.getBoundingClientRect();
    setMenu({ left: rect.left, top: rect.bottom + 2 });
  };
  const toggle = () => {
    if (menu()) {
      stopListening();
      return setMenu(undefined);
    }
    place();
    document.addEventListener('pointerdown', close, true);
    document.addEventListener('scroll', follow, true);
  };
  const follow = () => {
    if (menu()) place();
  };
  const stopListening = () => {
    document.removeEventListener('pointerdown', close, true);
    document.removeEventListener('scroll', follow, true);
  };
  onCleanup(stopListening);
  return (
    <div class="view-picker" onClick={(e) => e.stopPropagation()} onDblClick={(e) => e.stopPropagation()}>
      <Show when={props.current}>
        {(current) => (
          <Show when={others().length > 0} fallback={<span class="view-name">{current().label}</span>}>
            <button ref={button} class="view-name choosable" title="Show it another way" onClick={toggle}>
              {current().label} ▾
            </button>
          </Show>
        )}
      </Show>
      <Show when={menu()} keyed>
        {(at) => (
          <Portal>
            <ul ref={list} class="view-menu" style={{ left: `${at.left}px`, top: `${at.top}px` }} onClick={(e) => e.stopPropagation()}>
              <For each={others()}>
                {(option) => (
                  <li>
                    <button
                      onClick={() => {
                        stopListening();
                        setMenu(undefined);
                        props.onChange(option.name);
                      }}
                    >
                      {option.label}
                    </button>
                  </li>
                )}
              </For>
            </ul>
          </Portal>
        )}
      </Show>
    </div>
  );
}

function TensorTable(props: { tensor: Tensor; large?: boolean }) {
  const table = createMemo(() => tableFromTensor(props.tensor));
  return <TableOrPreview table={table()} large={props.large} />;
}

function TableOrPreview(props: { table: Table; large?: boolean }) {
  return (
    <Show when={props.large} fallback={<TablePreview table={props.table} />}>
      <TableView table={props.table} />
    </Show>
  );
}

/** The first rows and columns, enough to see what a table holds. */
function TablePreview(props: { table: Table }) {
  const names = () => Object.keys(props.table.columns).slice(0, TABLE_PREVIEW_COLUMNS);
  const rows = () => Array.from({ length: Math.min(TABLE_PREVIEW_ROWS, props.table.rows) }, (_, i) => i);
  return (
    <table class="table-preview">
      <thead>
        <tr>
          <For each={names()}>{(name) => <th>{name}</th>}</For>
        </tr>
      </thead>
      <tbody>
        <For each={rows()}>
          {(row) => (
            <tr>
              <For each={names()}>
                {(name) => {
                  const column = props.table.columns[name]!;
                  return <td class={`cell-${column.type}`}>{formatCell(column, row)}</td>;
                }}
              </For>
            </tr>
          )}
        </For>
      </tbody>
    </table>
  );
}

/** One line that says how big a value is: unit and dimensions, rows and columns, or format and size. */
export function valueSummary(dataset: DatasetResult): string {
  const { tensor, table, file } = dataset;
  if (tensor) return `${tensor.unit}${tensor.dims.length > 0 ? ` [${tensor.dims.join(' × ')}]` : ''}`;
  if (table) return `${table.rows.toLocaleString('en')} rows × ${Object.keys(table.columns).length} columns`;
  if (file) return `${file.format} · ${formatBytes(file.size)}`;
  return '';
}

export function detailChart(tensor: Tensor, baseline?: Tensor, width = 380): Element {
  const shape = shapeOf(tensor);
  if (shape.kind === 'series') {
    const { facet, rows } = facetRowsOf(tensor);
    const base = baseline ? facetRowsOf(baseline).rows : [];
    const fy = facet ? 'facet' : undefined;
    return P.plot({
      width,
      height: facet ? 120 * new Set(rows.map((r) => r.facet)).size : 220,
      marginLeft: 56,
      marginRight: facet ? 56 : 20,
      y: { grid: true, label: tensor.unit },
      x: { label: null, tickFormat: 'd' },
      fy: facet ? { label: null } : undefined,
      color: { legend: Boolean(shape.by), type: 'categorical' },
      marks: [
        P.lineY(base, { x: 'year', y: 'value', stroke: 'key', fy, strokeDasharray: '3,2', strokeOpacity: 0.5 }),
        P.lineY(rows, { x: 'year', y: 'value', stroke: 'key', fy, strokeWidth: 1.8, tip: true }),
      ],
    });
  }
  const rows = rowsOf(tensor, shape);
  if (shape.kind === 'scalar') {
    const p = document.createElement('p');
    p.className = 'detail-scalar';
    p.textContent = `${formatValue(rows[0]!.value)} ${tensor.unit}`;
    return p;
  }
  if (shape.kind === 'bars') {
    return P.plot({
      width,
      height: 26 * rows.length + 40,
      marginLeft: 80,
      x: { grid: true, label: tensor.unit },
      y: { label: null, domain: rows.map((r) => r.key) },
      marks: [P.barX(rows, { x: 'value', y: 'key', fill: 'var(--accent)', tip: true })],
    });
  }
  return P.plot({
    width,
    height: 28 * new Set(rows.map((r) => r.row)).size + 50,
    marginLeft: 80,
    x: { axis: 'top', label: null, domain: domainOf(tensor, shape.cols) },
    y: { label: null, domain: domainOf(tensor, shape.rows) },
    color: { scheme: 'blues', legend: true, label: tensor.unit },
    marks: [
      P.cell(rows, { x: 'col', y: 'row', fill: 'value', inset: 1, tip: true }),
      P.text(rows, { x: 'col', y: 'row', text: (r: { value: number }) => formatValue(r.value), fill: 'black' }),
    ],
  });
}
