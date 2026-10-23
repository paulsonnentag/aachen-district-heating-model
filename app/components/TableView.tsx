import { createMemo, createSignal, For, Match, Show, Switch } from 'solid-js';
import type { Column, Geometry, Table } from '../../lib/runtime/table';

const PAGE = 50;
const BINS = 24;

type Sort = { column: string; descending: boolean };

/** Every row of a table, a page at a time and sortable by any column; each header summarises its column. */
export function TableView(props: { table: Table }) {
  const names = () => Object.keys(props.table.columns);
  const [sort, setSort] = createSignal<Sort>();
  const [page, setPage] = createSignal(0);
  const order = createMemo(() => sortedRows(props.table, sort()));
  const pages = () => Math.max(1, Math.ceil(props.table.rows / PAGE));
  const current = () => Math.min(page(), pages() - 1);
  const visible = () => order().slice(current() * PAGE, (current() + 1) * PAGE);
  const toggle = (column: string) => {
    const s = sort();
    setSort(s?.column !== column ? { column, descending: false } : s.descending ? undefined : { column, descending: true });
    setPage(0);
  };

  return (
    <div class="table-view">
      <div class="table-scroll">
        <table class="data-table">
          <thead>
            <tr>
              <For each={names()}>
                {(name) => {
                  const column = () => props.table.columns[name]!;
                  return (
                    <th onClick={() => toggle(name)} title={column().description}>
                      <span class="col-name">
                        {name}
                        <Show when={sort()?.column === name}>{sort()!.descending ? ' ↓' : ' ↑'}</Show>
                      </span>
                      <span class="col-type">{typeLabel(column())}</span>
                      <ColumnSummary column={column()} />
                    </th>
                  );
                }}
              </For>
            </tr>
          </thead>
          <tbody>
            <For each={visible()}>
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
      </div>
      <div class="table-pager">
        <button disabled={current() === 0} onClick={() => setPage(current() - 1)}>‹</button>
        <span>
          {props.table.rows === 0 ? 'no rows' : `${current() * PAGE + 1}–${Math.min(props.table.rows, (current() + 1) * PAGE)} of ${props.table.rows.toLocaleString('en')}`}
        </span>
        <button disabled={current() >= pages() - 1} onClick={() => setPage(current() + 1)}>›</button>
      </div>
    </div>
  );
}

function ColumnSummary(props: { column: Column }) {
  const summary = createMemo(() => summarise(props.column));
  return (
    <span class="col-summary">
      <Switch>
        <Match when={summary().histogram}>
          {(bins) => (
            <svg class="col-histogram" width={BINS * 3} height={14}>
              <For each={bins()}>{(share, i) => <rect x={i() * 3} y={14 - Math.max(share * 14, share > 0 ? 1 : 0)} width={2.4} height={Math.max(share * 14, share > 0 ? 1 : 0)} />}</For>
            </svg>
          )}
        </Match>
      </Switch>
      <span>{summary().text}</span>
      <Show when={summary().missing > 0}>
        <span class="col-missing">{summary().missing.toLocaleString('en')} missing</span>
      </Show>
    </span>
  );
}

type Summary = { text: string; missing: number; histogram?: number[] };

function summarise(column: Column): Summary {
  switch (column.type) {
    case 'number': {
      const finite = Array.from(column.values).filter(Number.isFinite);
      const missing = column.values.length - finite.length;
      if (finite.length === 0) return { text: '', missing };
      let min = Infinity;
      let max = -Infinity;
      for (const v of finite) {
        if (v < min) min = v;
        if (v > max) max = v;
      }
      const counts = new Array<number>(BINS).fill(0);
      for (const v of finite) counts[max > min ? Math.min(BINS - 1, Math.floor(((v - min) / (max - min)) * BINS)) : 0]!++;
      const top = Math.max(...counts);
      return { text: `${formatNumber(min)} – ${formatNumber(max)}`, missing, histogram: counts.map((c) => c / top) };
    }
    case 'string': {
      const present = column.values.filter((v) => v !== null);
      return { text: `${new Set(present).size.toLocaleString('en')} distinct`, missing: column.values.length - present.length };
    }
    case 'boolean': {
      const yes = column.values.filter((v) => v === true).length;
      const no = column.values.filter((v) => v === false).length;
      return { text: `${yes.toLocaleString('en')} yes, ${no.toLocaleString('en')} no`, missing: column.values.length - yes - no };
    }
    case 'geometry': {
      const types = new Map<string, number>();
      for (const g of column.values) if (g) types.set(g.type, (types.get(g.type) ?? 0) + 1);
      const missing = column.values.length - [...types.values()].reduce((a, b) => a + b, 0);
      return { text: [...types].map(([type, n]) => `${n.toLocaleString('en')} ${type}`).join(', '), missing };
    }
  }
}

function sortedRows(table: Table, sort: Sort | undefined): number[] {
  const rows = Array.from({ length: table.rows }, (_, i) => i);
  const column = sort && table.columns[sort.column];
  if (!sort || !column) return rows;
  const key = sortKey(column);
  const direction = sort.descending ? -1 : 1;
  return rows.sort((a, b) => {
    const ka = key(a);
    const kb = key(b);
    if (ka === null || kb === null) return ka === kb ? 0 : ka === null ? 1 : -1;
    return (ka < kb ? -1 : ka > kb ? 1 : 0) * direction;
  });
}

function sortKey(column: Column): (row: number) => number | string | null {
  switch (column.type) {
    case 'number':
      return (row) => (Number.isFinite(column.values[row]) ? column.values[row]! : null);
    case 'string':
      return (row) => column.values[row] ?? null;
    case 'boolean':
      return (row) => (column.values[row] === null ? null : Number(column.values[row]));
    case 'geometry':
      return (row) => column.values[row]?.type ?? null;
  }
}

function typeLabel(column: Column): string {
  switch (column.type) {
    case 'number':
      return column.unit ?? 'number';
    case 'string':
      return 'text';
    case 'boolean':
      return 'yes / no';
    case 'geometry':
      return column.crs;
  }
}

export function formatCell(column: Column, row: number): string {
  switch (column.type) {
    case 'number': {
      const v = column.values[row]!;
      return Number.isFinite(v) ? formatNumber(v) : '';
    }
    case 'string':
      return column.values[row] ?? '';
    case 'boolean':
      return column.values[row] === null ? '' : column.values[row] ? 'yes' : 'no';
    case 'geometry':
      return describeGeometry(column.values[row] ?? null);
  }
}

/** Integers as they are, so ids and counts read exactly; other numbers to six significant digits. */
function formatNumber(value: number): string {
  return Number.isInteger(value) ? String(value) : String(Number(value.toPrecision(6)));
}

function describeGeometry(geometry: Geometry | null): string {
  if (!geometry) return '';
  if (geometry.type === 'Point') return (geometry.coordinates as number[]).map(formatNumber).join(', ');
  return `${geometry.type} · ${countPositions(geometry.coordinates).toLocaleString('en')} points`;
}

function countPositions(coordinates: unknown): number {
  if (!Array.isArray(coordinates)) return 0;
  if (typeof coordinates[0] === 'number') return 1;
  return coordinates.reduce((n: number, c) => n + countPositions(c), 0);
}
