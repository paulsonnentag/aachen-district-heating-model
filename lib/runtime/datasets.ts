import Papa from 'papaparse';
import type { Dataset, NestedValue, RemoteFileDataset } from './pipeline';
import { tableFromColumns, type Table } from './table';
import type { Tensor } from './tensor';

export type ReadText = (path: string) => Promise<string>;

/** A raw download as nodes see it: fetched only when a node actually runs on it. */
export type RemoteFile = Pick<RemoteFileDataset, 'url' | 'sha256' | 'size' | 'format'>;

/** Gets a download's bytes, checked against its pinned hash. */
export type FetchFile = (file: RemoteFile, onLog: (line: string) => void) => Promise<Uint8Array>;

/** One coordinate per dimension, then the value. */
export type Row = { at: string[]; value: number };

/** A catalog dataset as a tensor and, for a CSV file, the rows it was read from. */
export async function loadDataset(dataset: Exclude<Dataset, RemoteFileDataset>, readText: ReadText): Promise<{ tensor: Tensor; source?: Table }> {
  if (!('file' in dataset)) return { tensor: fromNested(dataset.value, dataset.dims, dataset.unit) };
  const text = await readText(dataset.file);
  return { tensor: loadCsv(text, dataset.dims, dataset.column, dataset.unit), source: csvTable(text) };
}

function csvTable(text: string): Table {
  const parsed = Papa.parse<Record<string, unknown>>(text.trim(), { header: true, skipEmptyLines: true, dynamicTyping: true });
  const names = parsed.meta.fields ?? [];
  return tableFromColumns(Object.fromEntries(names.map((name) => [name, parsed.data.map((row) => row[name] ?? null)])));
}

/** Builds a dense tensor from rows that cover every combination of coordinates exactly once. */
export function tensorFromRows(rows: Row[], dims: string[], unit: string): Tensor {
  const coords = dims.map((d, i) => sortCoords(d, unique(rows.map((r) => r.at[i]!))));
  const positions = coords.map((c) => new Map(c.map((key, k) => [key, k])));
  const values = new Float64Array(coords.reduce((n, c) => n * c.length, 1)).fill(NaN);
  for (const row of rows) {
    if (row.at.length !== dims.length) throw new Error(`Row ${row.at.join(', ')} has ${row.at.length} coordinates for ${dims.length} dimensions`);
    const offset = row.at.reduce((o, key, i) => o * coords[i]!.length + positions[i]!.get(key)!, 0);
    if (!Number.isNaN(values[offset]!)) throw new Error(`Duplicate row for ${row.at.join(', ')}`);
    values[offset] = row.value;
  }
  if (values.some(Number.isNaN)) throw new Error('Missing or non-numeric values for some coordinates');
  return { dims, coords, values, unit };
}

function loadCsv(text: string, dimColumns: Record<string, string>, column: string, unit: string): Tensor {
  const parsed = Papa.parse<Record<string, string>>(text.trim(), { header: true, skipEmptyLines: true });
  if (parsed.errors.length > 0) throw new Error(`CSV: ${parsed.errors[0]!.message}`);
  const dims = Object.keys(dimColumns);
  const rows = parsed.data.map((row) => ({
    at: dims.map((d) => requireCell(row, dimColumns[d]!)),
    value: Number(requireCell(row, column)),
  }));
  try {
    return tensorFromRows(rows, dims, unit);
  } catch (error) {
    throw new Error(`CSV: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function fromNested(value: NestedValue, dims: string[], unit: string): Tensor {
  const coords = dims.map(() => [] as string[]);
  collectCoords(value, 0, coords);
  const sorted = coords.map((c, i) => sortCoords(dims[i]!, c));
  const values = new Float64Array(sorted.reduce((n, c) => n * c.length, 1));
  let offset = 0;
  for (const at of cartesian(sorted)) values[offset++] = lookupNested(value, at);
  return { dims, coords: sorted, values, unit };
}

function collectCoords(value: NestedValue, depth: number, coords: string[][]): void {
  if (depth === coords.length) {
    if (typeof value !== 'number') throw new Error('Inline value is nested deeper than its dims');
    return;
  }
  if (typeof value === 'number') throw new Error(`Inline value needs a level for dimension ${depth + 1}`);
  for (const [key, child] of Object.entries(value)) {
    if (!coords[depth]!.includes(key)) coords[depth]!.push(key);
    collectCoords(child, depth + 1, coords);
  }
}

function lookupNested(value: NestedValue, at: string[]): number {
  let current: NestedValue | undefined = value;
  for (const key of at) current = typeof current === 'object' ? current[key] : undefined;
  if (typeof current !== 'number') throw new Error(`Inline value missing at ${at.join(', ')}`);
  return current;
}

export function* cartesian(coords: string[][]): Generator<string[]> {
  if (coords.length === 0) {
    yield [];
    return;
  }
  const [first, ...rest] = coords;
  for (const head of first!) for (const tail of cartesian(rest)) yield [head, ...tail];
}

function sortCoords(dim: string, coords: string[]): string[] {
  return dim === 'year' ? [...coords].sort((a, b) => Number(a) - Number(b)) : coords;
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

function requireCell(row: Record<string, string>, column: string): string {
  const cell = row[column];
  if (cell === undefined || cell === '') throw new Error(`CSV: missing column ${column}`);
  return cell.trim();
}
