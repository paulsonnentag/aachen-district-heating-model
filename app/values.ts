import { coordsOf, entries, reduceExcept, reduction, type Tensor } from '../lib/runtime/tensor';

export type Shape =
  | { kind: 'scalar' }
  | { kind: 'series'; by?: string }
  | { kind: 'bars'; by: string }
  | { kind: 'grid'; rows: string; cols: string };

export type Row = { year?: number; key: string; row?: string; col?: string; value: number };

/** Dimensions with more coordinates than this are collapsed instead of drawn one row each. */
const MAX_DRAWN = 24;

/** Picks a generic visual from the tensor's dimensions only; large dimensions are collapsed. */
export function shapeOf(tensor: Tensor): Shape {
  const others = drawnDims(tensor);
  if (tensor.dims.includes('year')) return { kind: 'series', by: others.at(-1) };
  if (others.length === 0) return { kind: 'scalar' };
  if (others.length === 1) return { kind: 'bars', by: others[0]! };
  return { kind: 'grid', rows: others[0]!, cols: others.at(-1)! };
}

/** How collapsed dimensions are combined, e.g. "Σ over 3660 cell", or undefined if none are. */
export function collapsedLabel(tensor: Tensor): string | undefined {
  const collapsed = tensor.dims.filter((d) => d !== 'year' && !drawnDims(tensor).includes(d));
  if (collapsed.length === 0) return undefined;
  const what = collapsed.map((d) => `${coordsOf(tensor, d)!.length} ${d}`).join(' × ');
  return reduction(tensor) === 'sum' ? `Σ over ${what}` : `mean of ${what}`;
}

export function rowsOf(tensor: Tensor, shape: Shape): Row[] {
  const reduce = (keep: string[]) => entries(reduceExcept(tensor, keep, reduction(tensor)));
  switch (shape.kind) {
    case 'scalar':
      return [...reduce([])].map(([, value]) => ({ key: '', value }));
    case 'series': {
      const keep = shape.by ? ['year', shape.by] : ['year'];
      return [...reduce(keep)].map(([at, value]) => ({
        year: Number(at.year),
        key: shape.by ? at[shape.by]! : '',
        value,
      }));
    }
    case 'bars':
      return [...reduce([shape.by])].map(([at, value]) => ({ key: at[shape.by]!, value }));
    case 'grid':
      return [...reduce([shape.rows, shape.cols])].map(([at, value]) => ({
        key: `${at[shape.rows]} ${at[shape.cols]}`,
        row: at[shape.rows]!,
        col: at[shape.cols]!,
        value,
      }));
  }
}

/** Rows for the detail view: one facet per value of the first category dimension. */
export function facetRowsOf(tensor: Tensor): { facet?: string; rows: (Row & { facet?: string })[] } {
  const others = drawnDims(tensor);
  if (!tensor.dims.includes('year') || others.length < 2) return { rows: rowsOf(tensor, shapeOf(tensor)) };
  const facet = others[0]!;
  const by = others.at(-1)!;
  const rows = [...entries(reduceExcept(tensor, ['year', facet, by], reduction(tensor)))].map(([at, value]) => ({
    year: Number(at.year),
    key: at[by]!,
    facet: at[facet]!,
    value,
  }));
  return { facet, rows };
}

const precise = new Intl.NumberFormat('en', { maximumSignificantDigits: 5, useGrouping: false });
const grouped = new Intl.NumberFormat('en', { maximumSignificantDigits: 4 });
const compact = new Intl.NumberFormat('en', { maximumSignificantDigits: 2, notation: 'compact' });

/** Years like 2026.5 stay ungrouped and unrounded; large magnitudes get separators. */
export function formatValue(value: number): string {
  if (Math.abs(value) >= 1e6) return `${grouped.format(value / 1e6)}M`;
  if (Math.abs(value) >= 1e4) return grouped.format(value);
  return precise.format(value);
}

export function formatBytes(bytes: number): string {
  return `${(bytes / 1e6).toFixed(bytes < 1e7 ? 1 : 0)} MB`;
}

export function formatCompact(value: number): string {
  return Math.abs(value) < 0.01 && value !== 0 ? value.toExponential(0) : compact.format(value);
}

export function domainOf(tensor: Tensor, dim: string): string[] {
  return tensor.coords[tensor.dims.indexOf(dim)] ?? [];
}

export function lastValue(tensor: Tensor): { year: string; value: number } | undefined {
  if (!tensor.dims.includes('year') || drawnDims(tensor).length > 0) return undefined;
  const series = reduceExcept(tensor, ['year'], reduction(tensor));
  const years = series.coords[0]!;
  return { year: years.at(-1)!, value: series.values[years.length - 1]! };
}

function drawnDims(tensor: Tensor): string[] {
  return tensor.dims.filter((d, i) => d !== 'year' && tensor.coords[i]!.length <= MAX_DRAWN);
}