import * as P from '@observablehq/plot';
import { createMemo, createSignal, For, Show } from 'solid-js';
import { coordsOf, reduceExcept, reduction, select, type Tensor } from '../../lib/runtime/tensor';
import { formatValue } from '../values';
import { Plot } from './Plot';

/** Cell of the European statistical grid, positioned by its south-west corner in EPSG:3035 metres. */
export type Cell = { id: string; x: number; y: number; size: number };

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

/** How big to draw a map: a fixed height, or the shape of the area up to `maxHeight`. */
export type MapSize = { width: number; height?: number; maxHeight?: number; legend?: boolean };

const DEFAULT_SIZE: MapSize = { width: 400 };

/** Map of a tensor over grid cells at one year, with the other dimensions picked or combined. */
export function CellMap(props: { tensor: Tensor; baseline?: Tensor; size?: MapSize }) {
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
      <Plot class="map" render={() => renderMap(grid().cells, values(), domain(), showDifference(), props.tensor.unit, props.size)} />
    </div>
  );
}

/** The map without controls: the last year, every other dimension combined. */
export function cellMapPreview(tensor: Tensor, size: MapSize): Element {
  const grid = gridOf(tensor)!;
  const frames = cellFrames(tensor, grid.dim, {});
  const last = coordsOf(frames, 'year')?.at(-1);
  const frame = last === undefined ? frames : select(frames, { year: last });
  return renderMap(grid.cells, alignTo(grid.cells, frame), colourDomain(frames.values, false), false, tensor.unit, size);
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
export function colourDomain(values: Float64Array, diverging: boolean): [number, number] {
  const sorted = Float64Array.from(values.filter(Number.isFinite)).sort();
  if (sorted.length === 0) return [0, 1];
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

export function renderMap(
  cells: Cell[],
  values: Float64Array,
  domain: [number, number],
  diverging: boolean,
  unit: string,
  size: MapSize = DEFAULT_SIZE,
): Element {
  const data = cells.map((cell, i) => ({ ...cell, value: values[i]! }));
  const label = diverging ? `Δ ${unit}` : unit;
  const [x0, y0, x1, y1] = cellBounds(cells);
  const height = size.height ?? Math.round(Math.min(size.maxHeight ?? Infinity, size.width * aspectOf(x1 - x0, y1 - y0)));
  const fitted = fitDomain([x0, x1], [y0, y1], size.width - 4, height - 6);
  const legend = size.legend ?? true;
  return P.plot({
    width: size.width,
    height,
    margin: 2,
    marginTop: 4,
    x: { axis: null, domain: fitted.x },
    y: { axis: null, domain: fitted.y },
    color: diverging
      ? { type: 'linear', scheme: 'rdbu', domain, clamp: true, legend, label }
      : { type: 'linear', scheme: 'ylgnbu', domain, clamp: true, legend, label },
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

/** Height over width of an area, kept between a wide strip and a tall page. */
export function aspectOf(width: number, height: number): number {
  return Math.min(1.5, Math.max(0.4, width > 0 ? height / width : 1));
}

function cellBounds(cells: Cell[]): [number, number, number, number] {
  let [x0, y0, x1, y1] = [Infinity, Infinity, -Infinity, -Infinity];
  for (const c of cells) {
    x0 = Math.min(x0, c.x);
    y0 = Math.min(y0, c.y);
    x1 = Math.max(x1, c.x + c.size);
    y1 = Math.max(y1, c.y + c.size);
  }
  return [x0, y0, x1, y1];
}

/** Widens the shorter extent so one metre is as long across as up within a frame of the given size. */
function fitDomain(x: [number, number], y: [number, number], width: number, height: number): { x: [number, number]; y: [number, number] } {
  const k = Math.min(width / (x[1] - x[0] || 1), height / (y[1] - y[0] || 1));
  const around = ([a, b]: [number, number], extent: number): [number, number] => [(a + b) / 2 - extent / 2, (a + b) / 2 + extent / 2];
  return { x: around(x, width / k), y: around(y, height / k) };
}

export function parseCellId(id: string): Cell | undefined {
  const match = /^(\d+)(m|km)N(\d+)E(\d+)$/.exec(id);
  if (!match) return undefined;
  const size = Number(match[1]) * (match[2] === 'km' ? 1000 : 1);
  return { id, x: Number(match[4]) * size, y: Number(match[3]) * size, size };
}
