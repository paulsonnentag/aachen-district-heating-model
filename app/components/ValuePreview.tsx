import * as P from '@observablehq/plot';
import { Match, Show, Switch } from 'solid-js';
import type { Tensor } from '../../lib/runtime/tensor';
import { collapsedLabel, domainOf, formatCompact, formatValue, lastValue, rowsOf, shapeOf } from '../values';
import { Plot } from './Plot';

const WIDTH = 196;
/** Wider grids are drawn as colour only; their numbers would overlap. */
const MAX_LABELLED_COLUMNS = 6;

/** Small, dimension-driven picture of a value; draws the baseline dashed when comparing. */
export function ValuePreview(props: { tensor?: Tensor; baseline?: Tensor; error?: string }) {
  return (
    <Switch fallback={<div class="preview-empty">not computed</div>}>
      <Match when={props.error}>
        <div class="preview-error">{props.error}</div>
      </Match>
      <Match when={props.tensor}>
        {(tensor) => <Preview tensor={tensor()} baseline={props.baseline} />}
      </Match>
    </Switch>
  );
}

function Preview(props: { tensor: Tensor; baseline?: Tensor }) {
  const shape = () => shapeOf(props.tensor);
  const scalar = (t: Tensor) => rowsOf(t, shapeOf(t))[0]!.value;
  return (
    <>
      <Switch>
        <Match when={shape().kind === 'scalar'}>
          <div class="preview-scalar">
            <span class="number">{formatValue(scalar(props.tensor))}</span>
            <Show when={props.baseline && scalar(props.baseline) !== scalar(props.tensor)}>
              <span class="was">was {formatValue(scalar(props.baseline!))}</span>
            </Show>
          </div>
        </Match>
        <Match when={shape().kind === 'series'}>
          <div class="preview-series">
            <Plot render={() => sparkline(props.tensor, props.baseline)} />
            <Show when={lastValue(props.tensor)}>
              {(last) => <span class="last">{last().year}: {formatValue(last().value)}</span>}
            </Show>
          </div>
        </Match>
        <Match when={shape().kind === 'bars'}>
          <Plot render={() => bars(props.tensor, props.baseline)} />
        </Match>
        <Match when={shape().kind === 'grid'}>
          <Plot render={() => grid(props.tensor)} />
        </Match>
      </Switch>
      <Show when={collapsedLabel(props.tensor)}>{(label) => <div class="preview-collapsed">{label()}</div>}</Show>
    </>
  );
}

function sparkline(tensor: Tensor, baseline?: Tensor): Element {
  const shape = shapeOf(tensor);
  const rows = rowsOf(tensor, shape);
  const base = baseline ? rowsOf(baseline, shapeOf(baseline)) : [];
  return P.plot({
    width: WIDTH,
    height: 48,
    margin: 3,
    x: { axis: null },
    y: { axis: null },
    color: { type: 'categorical' },
    marks: [
      P.lineY(base, { x: 'year', y: 'value', stroke: 'key', strokeDasharray: '3,2', strokeOpacity: 0.5 }),
      P.lineY(rows, { x: 'year', y: 'value', stroke: 'key', strokeWidth: 1.6, tip: true }),
    ],
  });
}

function bars(tensor: Tensor, baseline?: Tensor): Element {
  const shape = shapeOf(tensor);
  const rows = rowsOf(tensor, shape);
  const base = baseline ? rowsOf(baseline, shapeOf(baseline)) : [];
  return P.plot({
    width: WIDTH,
    height: 14 * rows.length + 6,
    marginLeft: 52,
    marginRight: 40,
    marginTop: 3,
    marginBottom: 3,
    x: { axis: null },
    y: { label: null, tickSize: 0, domain: rows.map((r) => r.key) },
    style: { fontSize: '10px' },
    marks: [
      P.barX(rows, { x: 'value', y: 'key', fill: 'var(--accent)', fillOpacity: 0.75 }),
      P.tickX(base, { x: 'value', y: 'key', stroke: 'currentColor', strokeDasharray: '2,2' }),
      P.text(rows, { x: 'value', y: 'key', text: (r: { value: number }) => formatValue(r.value), textAnchor: 'start', dx: 3, fontSize: 9 }),
    ],
  });
}

function grid(tensor: Tensor): Element {
  const shape = shapeOf(tensor);
  if (shape.kind !== 'grid') throw new Error('grid needs two dimensions');
  const rows = rowsOf(tensor, shape);
  const cols = domainOf(tensor, shape.cols);
  const labelled = cols.length <= MAX_LABELLED_COLUMNS;
  return P.plot({
    width: WIDTH,
    height: 14 * new Set(rows.map((r) => r.row)).size + 20,
    marginLeft: 52,
    marginTop: 16,
    marginBottom: 3,
    x: { axis: 'top', label: null, tickSize: 0, domain: cols, ...(labelled ? {} : { ticks: [cols[0], cols.at(-1)] }) },
    y: { label: null, tickSize: 0, domain: domainOf(tensor, shape.rows) },
    color: { scheme: 'blues' },
    style: { fontSize: '10px' },
    marks: [
      P.cell(rows, { x: 'col', y: 'row', fill: 'value', inset: 0.5 }),
      ...(labelled ? [P.text(rows, { x: 'col', y: 'row', text: (r: { value: number }) => formatCompact(r.value), fontSize: 8, fill: 'black' })] : []),
    ],
  });
}
