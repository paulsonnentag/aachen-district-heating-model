import * as P from '@observablehq/plot';
import { createMemo, createSignal, For } from 'solid-js';
import type { Column, Geometry, Table } from '../../lib/runtime/table';
import { colourDomain, parseCellId, renderMap } from './CellMap';
import { Plot } from './Plot';
import { formatCell } from './TableView';

const WIDTH = 400;
/** Above this many features the map is drawn on a canvas, without tooltips. */
const MAX_SVG = 5000;
const TITLE_COLUMNS = 8;
/** Picker value for a map without colour. */
const NONE = '';

type Spatial = { name: string; kind: 'geometry' | 'cells' };
type Feature = { type: 'Feature'; geometry: Geometry; properties: { row: number } };
type Position = [number, number];

/** The column that places a table's rows on a map: a geometry column, or grid cell ids like 100mN30733E40528. */
export function spatialColumn(table: Table): Spatial | undefined {
  const columns = Object.entries(table.columns);
  const geometry = columns.find(([, c]) => c.type === 'geometry');
  if (geometry) return { name: geometry[0], kind: 'geometry' };
  const cells = columns.find(([, c]) => c.type === 'string' && table.rows > 0 && c.values.every((v) => v !== null && parseCellId(v) !== undefined));
  return cells && { name: cells[0], kind: 'cells' };
}

/** The table's rows on a map, coloured by one of its number columns. */
export function TableMap(props: { table: Table }) {
  const spatial = createMemo(() => spatialColumn(props.table)!);
  const numbers = () => Object.entries(props.table.columns).flatMap(([name, c]) => (c.type === 'number' ? [name] : []));
  const [chosen, setChosen] = createSignal<string>();
  const colourBy = () => {
    const c = chosen();
    if (c === NONE || (c !== undefined && numbers().includes(c))) return c;
    return numbers().find((n) => !/(^|_)id$/.test(n)) ?? NONE;
  };
  const colour = createMemo(() => {
    const column = props.table.columns[colourBy()];
    if (column?.type !== 'number') return undefined;
    return { values: column.values, domain: colourDomain(column.values, false), label: column.unit ? `${colourBy()} (${column.unit})` : colourBy() };
  });
  return (
    <div class="table-map">
      <div class="map-controls">
        <label>
          colour by
          <select value={colourBy()} onChange={(e) => setChosen(e.currentTarget.value)}>
            <option value={NONE}>nothing</option>
            <For each={numbers()}>{(name) => <option value={name}>{name}</option>}</For>
          </select>
        </label>
      </div>
      <Plot class="map" render={() => renderTable(props.table, spatial(), colour())} />
    </div>
  );
}

type Colour = { values: Float64Array; domain: [number, number]; label: string };

function renderTable(table: Table, spatial: Spatial, colour: Colour | undefined): Element {
  const column = table.columns[spatial.name]!;
  if (column.type === 'string') {
    const cells = column.values.map((id) => parseCellId(id!)!);
    return renderMap(cells, colour?.values ?? new Float64Array(cells.length).fill(1), colour?.domain ?? [0, 1], false, colour?.label ?? '');
  }
  if (column.type !== 'geometry') throw new Error(`${spatial.name} is not a geometry column`);
  const features: Feature[] = column.values.flatMap((geometry, row) => (geometry ? [{ type: 'Feature' as const, geometry, properties: { row } }] : []));
  const project = projection(column.crs, features);
  const height = heightOf(features, project);
  if (features.length > MAX_SVG) return canvasMap(features, project, height, colour);
  const lines = features.every((f) => f.geometry.type.endsWith('LineString'));
  const fill = colour ? (f: Feature) => colour.values[f.properties.row] : 'var(--accent)';
  const collection = { type: 'FeatureCollection', features };
  return P.plot({
    width: WIDTH,
    height,
    margin: 2,
    projection: column.crs === 'EPSG:4326' ? { type: 'mercator', domain: collection } : { type: 'reflect-y', domain: collection },
    color: { type: 'linear', scheme: 'ylgnbu', domain: colour?.domain, clamp: true, legend: Boolean(colour), label: colour?.label },
    marks: [
      P.geo(features, {
        ...(lines ? { stroke: fill, strokeWidth: 1.5 } : { fill, stroke: 'white', strokeWidth: 0.3, r: 2 }),
        title: (f: Feature) => rowTitle(table, f.properties.row),
      }),
    ],
  });
}

/** Many features at once: a canvas with the same colours and legend, but no tooltips. */
function canvasMap(features: Feature[], project: (p: Position) => Position, height: number, colour: Colour | undefined): Element {
  const wrapper = document.createElement('div');
  if (colour) wrapper.append(P.legend({ color: { type: 'linear', scheme: 'ylgnbu', domain: colour.domain, label: colour.label } }));
  const canvas = document.createElement('canvas');
  const ratio = window.devicePixelRatio || 1;
  canvas.width = WIDTH * ratio;
  canvas.height = height * ratio;
  canvas.style.width = `${WIDTH}px`;
  canvas.style.height = `${height}px`;
  const context = canvas.getContext('2d')!;
  context.scale(ratio, ratio);
  const toCanvas = fit(features, project, height);
  const scale = colour && P.scale({ color: { type: 'linear', scheme: 'ylgnbu', domain: colour.domain, clamp: true } });
  const accent = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() || '#3b6fd8';
  for (const feature of features) {
    const value = colour?.values[feature.properties.row];
    const style = !scale ? accent : value !== undefined && Number.isFinite(value) ? String(scale.apply(value)) : '#c8c8c4';
    context.fillStyle = style;
    context.strokeStyle = style;
    draw(context, feature.geometry, toCanvas);
  }
  wrapper.append(canvas);
  return wrapper;
}

function draw(context: CanvasRenderingContext2D, geometry: Geometry, at: (p: Position) => Position): void {
  const coordinates = geometry.coordinates as never;
  const path = (line: Position[]) => line.forEach((p, i) => (i === 0 ? context.moveTo(...at(p)) : context.lineTo(...at(p))));
  switch (geometry.type) {
    case 'Point': {
      const [x, y] = at(coordinates);
      context.fillRect(x - 1, y - 1, 2, 2);
      return;
    }
    case 'MultiPoint':
      return (coordinates as Position[]).forEach((p) => draw(context, { type: 'Point', coordinates: p }, at));
    case 'LineString':
    case 'MultiLineString':
      context.beginPath();
      (geometry.type === 'LineString' ? [coordinates as Position[]] : (coordinates as Position[][])).forEach(path);
      context.lineWidth = 1;
      context.stroke();
      return;
    case 'Polygon':
    case 'MultiPolygon':
      context.beginPath();
      (geometry.type === 'Polygon' ? [coordinates as Position[][]] : (coordinates as Position[][][])).forEach((rings) => rings.forEach(path));
      context.fill('evenodd');
      return;
    case 'GeometryCollection':
      return geometry.geometries?.forEach((g) => draw(context, g, at));
  }
}

/** Planar coordinates as they are; longitude and latitude squeezed by the cosine of the mean latitude. */
function projection(crs: string, features: Feature[]): (p: Position) => Position {
  if (crs !== 'EPSG:4326') return (p) => p;
  const latitudes = features.flatMap((f) => positions(f.geometry.coordinates).map((p) => p[1]));
  const squeeze = Math.cos(((latitudes.reduce((a, b) => a + b, 0) / Math.max(1, latitudes.length)) * Math.PI) / 180);
  return ([lon, lat]) => [lon * squeeze, lat];
}

function heightOf(features: Feature[], project: (p: Position) => Position): number {
  const [x0, y0, x1, y1] = bounds(features, project);
  return Math.round(Math.min(560, Math.max(160, x1 > x0 ? (WIDTH * (y1 - y0)) / (x1 - x0) : WIDTH)));
}

function fit(features: Feature[], project: (p: Position) => Position, height: number): (p: Position) => Position {
  const [x0, y0, x1, y1] = bounds(features, project);
  const margin = 4;
  const k = Math.min((WIDTH - 2 * margin) / (x1 - x0 || 1), (height - 2 * margin) / (y1 - y0 || 1));
  const dx = (WIDTH - k * (x1 - x0)) / 2;
  const dy = (height - k * (y1 - y0)) / 2;
  return (p) => {
    const [x, y] = project(p);
    return [dx + k * (x - x0), height - dy - k * (y - y0)];
  };
}

function bounds(features: Feature[], project: (p: Position) => Position): [number, number, number, number] {
  let [x0, y0, x1, y1] = [Infinity, Infinity, -Infinity, -Infinity];
  for (const feature of features) {
    for (const p of positions(feature.geometry.coordinates)) {
      const [x, y] = project(p);
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
    }
  }
  return [x0, y0, x1, y1];
}

function positions(coordinates: unknown): Position[] {
  if (!Array.isArray(coordinates)) return [];
  if (typeof coordinates[0] === 'number') return [coordinates as Position];
  return coordinates.flatMap(positions);
}

function rowTitle(table: Table, row: number): string {
  return Object.entries(table.columns)
    .filter(([, c]: [string, Column]) => c.type !== 'geometry')
    .slice(0, TITLE_COLUMNS)
    .map(([name, column]) => `${name}: ${formatCell(column, row)}`)
    .join('\n');
}
