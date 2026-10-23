import { entries, type Tensor } from './tensor';

/** Records with named, typed columns: what a dataset looks like before it is reduced to a tensor. */
export type Table = { rows: number; columns: Record<string, Column> };

export type Column =
  | { type: 'number'; values: Float64Array; unit?: string; description?: string }
  | { type: 'string'; values: (string | null)[]; description?: string }
  | { type: 'boolean'; values: (boolean | null)[]; description?: string }
  | { type: 'geometry'; values: (Geometry | null)[]; crs: string; description?: string };

/** A GeoJSON geometry object. */
export type Geometry = { type: string; coordinates?: unknown; geometries?: Geometry[] };

/** What a producer can say about a column beyond its values. */
export type ColumnSpec = { unit?: string; crs?: string; description?: string };

/**
 * Builds a table from one list of values per column. Each column's type follows from its
 * values: numbers (missing values become NaN), booleans, GeoJSON geometries or strings.
 */
export function tableFromColumns(data: Record<string, unknown[]>, specs: Record<string, ColumnSpec> = {}): Table {
  const names = Object.keys(data);
  const rows = names.length > 0 ? data[names[0]!]!.length : 0;
  const columns: Record<string, Column> = {};
  for (const name of names) {
    const values = data[name]!;
    if (!Array.isArray(values)) throw new Error(`Column ${name} is not a list`);
    if (values.length !== rows) throw new Error(`Column ${name} has ${values.length} values, the table has ${rows} rows`);
    columns[name] = toColumn(name, values, specs[name] ?? {});
  }
  for (const name of Object.keys(specs)) if (!(name in data)) throw new Error(`The table has no column ${name}`);
  return { rows, columns };
}

/** Columns as plain lists, the way a Python script receives a table. */
export function tableData(table: Table): Record<string, unknown[]> {
  return Object.fromEntries(Object.entries(table.columns).map(([name, column]) => [name, Array.from(column.values as ArrayLike<unknown>)]));
}

/** One row per value of the tensor: its coordinates, then the value. */
export function tableFromTensor(tensor: Tensor): Table {
  const coords: string[][] = tensor.dims.map(() => []);
  const values: number[] = [];
  for (const [at, value] of entries(tensor)) {
    tensor.dims.forEach((dim, i) => coords[i]!.push(at[dim]!));
    values.push(value);
  }
  const columns: Record<string, Column> = {};
  tensor.dims.forEach((dim, i) => (columns[dim] = { type: 'string', values: coords[i]! }));
  columns.value = { type: 'number', values: Float64Array.from(values), unit: tensor.unit };
  return { rows: values.length, columns };
}

export function isTable(value: unknown): value is Table {
  return typeof value === 'object' && value !== null && 'columns' in value && 'rows' in value;
}

function toColumn(name: string, values: unknown[], spec: ColumnSpec): Column {
  const present = values.filter((v) => v !== null && v !== undefined);
  const { description } = spec;
  if (spec.crs || (present.length > 0 && present.every(isGeometry))) {
    if (!spec.crs) throw new Error(`Geometry column ${name} needs a crs`);
    if (!present.every(isGeometry)) throw new Error(`Column ${name} mixes geometries with other values`);
    return { type: 'geometry', values: values.map((v) => (v ?? null) as Geometry | null), crs: spec.crs, description };
  }
  if (present.every((v) => typeof v === 'number')) {
    return { type: 'number', values: Float64Array.from(values, (v) => (typeof v === 'number' ? v : NaN)), unit: spec.unit, description };
  }
  if (present.every((v) => typeof v === 'boolean')) {
    return { type: 'boolean', values: values.map((v) => (typeof v === 'boolean' ? v : null)), description };
  }
  return { type: 'string', values: values.map((v) => (v === null || v === undefined ? null : String(v))), description };
}

function isGeometry(value: unknown): value is Geometry {
  return typeof value === 'object' && value !== null && typeof (value as Geometry).type === 'string' && ('coordinates' in value || 'geometries' in value);
}
