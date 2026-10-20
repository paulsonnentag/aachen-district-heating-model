import * as P from '@observablehq/plot';
import { createMemo, createSignal, For, Show } from 'solid-js';
import { coordsOf, reduceExcept, select, type Tensor } from '../../lib/runtime/tensor';
import { formatValue, reduction } from '../values';
import { Plot } from './Plot';

/** Cell of the European statistical grid, positioned by its south-west corner in EPSG:3035 metres. */
type Cell = { id: string; x: number; y: number; size: number };

type Grid = { dim: string; cells: Cell[] };

/** Picker value meaning "combine all coordinates of this dimension". */
const ALL = '';

/**
 * The dimension whose coordinates are all INSPIRE grid cell ids such as 100mN30733E40528
 * (cell size, then northing and easting in units of that size), if there is one.
 */
export function gridOf(tensor: Tensor): Grid | undefined {
  for (const [i, dim] of tensor.dims.entries()) {
    const cells = tensor.coords[i]!.map(parseCellId);
    if (cells.length > 0 && cells.every((c) => c !== undefined)) return { dim, cells: cells as Cell[] };
  }
  return undefined;
}

/** Map of a tensor over grid cells at one year, with the other dimensions picked or combined. */
export function CellMap(props: { tensor: Tensor; baseline?: Tensor }) {
  const grid = createMemo(() => gridOf(props.tensor)!);
  const years = () => coordsOf(props.tensor, 'year');
  const others = () => props.tensor.dims.filter((d) => d !== 'year' && d !== grid().dim);
  const [chosenYear, setYear] = createSignal<string>();
  const [picks, setPicks] = createSignal<Record<string, string>>({});
  const [difference, setDifference] = createSignal(false);

  const year = () => {
    const all = years();
    const chosen = chosenYear();
    return all && (chosen && all.includes(chosen) ? chosen : all.at(-1));
  };
  const pick = (dim: string) => {
    const coords = coordsOf(props.tensor, dim)!;
    const chosen = picks()[dim];
    return chosen === ALL || (chosen !== undefined && coords.includes(chosen)) ? chosen : coords[0]!;
  };
  const fixed = () => Object.fromEntries(others().flatMap((d) => (pick(d) === ALL ? [] : [[d, pick(d)]])));
  const comparable = () => props.baseline !== undefined && props.baseline.dims.join() === props.tensor.dims.join();
  const showDifference = () => difference() && comparable();

  const frames = createMemo(() => {
    const current = cellFrames(props.tensor, grid().dim, fixed());
    if (!showDifference()) return current;
    const base = cellFrames(props.baseline!, grid().dim, fixed());
    return subtract(current, base, grid().dim);
  });
  const domain = createMemo(() => colourDomain(frames().values, showDifference()));
  const values = () => {
    const y = year();
    const frame = y === undefined ? frames() : select(frames(), { year: y });
    return alignTo(grid().cells, frame);
  };

  return (
    <div class="cell-map">
      <div class="map-controls">
        <Show when={years()}>
          {(all) => (
            <label>
              year
              <input
                type="range"
                min={0}
                max={all().length - 1}
                value={all().indexOf(year()!)}
                onInput={(e) => setYear(all()[Number(e.currentTarget.value)])}
              />
              <span class="map-year">{year()}</span>
            </label>
          )}
        </Show>
        <For each={others()}>
          {(dim) => (
            <label>
              {dim}
              <select value={pick(dim)} onChange={(e) => setPicks({ ...picks(), [dim]: e.currentTarget.value })}>
                <option value={ALL}>{reduction(props.tensor) === 'sum' ? 'Σ all' : 'mean of all'}</option>
                <For each={coordsOf(props.tensor, dim)}>{(c) => <option value={c}>{c}</option>}</For>
              </select>
            </label>
          )}
        </For>
        <Show when={comparable()}>
          <label>
            <input type="checkbox" checked={difference()} onChange={(e) => setDifference(e.currentTarget.checked)} />
            difference from baseline
          </label>
        </Show>
      </div>
      <Plot class="map" render={() => renderMap(grid().cells, values(), domain(), showDifference(), props.tensor.unit)} />
    </div>
  );
}

/** The tensor reduced to the grid dimension (and year, if any), with the picked coordinates fixed. */
function cellFrames(tensor: Tensor, gridDim: string, fixed: Record<string, string>): Tensor {
  const keep = [gridDim, 'year', ...Object.keys(fixed)];
  return select(reduceExcept(tensor, keep, reduction(tensor)), fixed);
}

function subtract(current: Tensor, base: Tensor, gridDim: string): Tensor {
  const sameCells = coordsOf(current, gridDim)!.join() === coordsOf(base, gridDim)!.join();
  const sameYears = (coordsOf(current, 'year') ?? []).join() === (coordsOf(base, 'year') ?? []).join();
  if (!sameCells || !sameYears) throw new Error('Baseline covers different cells or years');
  return { ...current, values: current.values.map((v, i) => v - base.values[i]!) };
}

/** Fixed across years so the slider shows change; the top and bottom 2% are clamped. */
function colourDomain(values: Float64Array, diverging: boolean): [number, number] {
  const sorted = Float64Array.from(values).sort();
  const at = (q: number) => sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))]!;
  if (diverging) {
    const extent = Math.max(Math.abs(at(0.02)), Math.abs(at(0.98))) || 1;
    return [-extent, extent];
  }
  const low = at(0.02);
  const high = at(0.98);
  return [low, high > low ? high : low + 1];
}

function alignTo(cells: Cell[], frame: Tensor): Float64Array {
  const ids = frame.coords[0]!;
  if (ids.length === cells.length && cells.every((c, i) => c.id === ids[i])) return frame.values;
  const position = new Map(ids.map((id, i) => [id, i]));
  return Float64Array.from(cells, (c) => frame.values[position.get(c.id) ?? -1] ?? NaN);
}

function renderMap(cells: Cell[], values: Float64Array, domain: [number, number], diverging: boolean, unit: string): Element {
  const data = cells.map((cell, i) => ({ ...cell, value: values[i]! }));
  const label = diverging ? `Δ ${unit}` : unit;
  return P.plot({
    width: 400,
    aspectRatio: 1,
    margin: 2,
    marginTop: 4,
    x: { axis: null },
    y: { axis: null },
    color: diverging
      ? { type: 'linear', scheme: 'rdbu', domain, clamp: true, legend: true, label }
      : { type: 'linear', scheme: 'ylgnbu', domain, clamp: true, legend: true, label },
    marks: [
      P.rect(data, {
        x1: 'x',
        x2: (d: Cell) => d.x + d.size,
        y1: 'y',
        y2: (d: Cell) => d.y + d.size,
        fill: 'value',
        title: (d: Cell & { value: number }) => `${d.id}\n${formatValue(d.value)} ${label}`,
        tip: true,
      }),
    ],
  });
}

function parseCellId(id: string): Cell | undefined {
  const match = /^(\d+)(m|km)N(\d+)E(\d+)$/.exec(id);
  if (!match) return undefined;
  const size = Number(match[1]) * (match[2] === 'km' ? 1000 : 1);
  return { id, x: Number(match[4]) * size, y: Number(match[3]) * size, size };
}
