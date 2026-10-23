/**
 * `slot` items are shown on demand: they are placed beside the items they link without changing where
 * the others go, preferably beside those in `near` (the items they are shown for). `port` items are
 * where edges from outside enter (in the first column) or leave (in the last).
 */
export type LayoutItem = { id: string; width: number; height: number; slot?: boolean; near?: string[]; port?: 'in' | 'out' };
export type LayoutEdge = { from: string; to: string };
export type Box = { x: number; y: number; width: number; height: number };
/**
 * `routes` maps an edge (`from>to`) that skips columns to the waypoint boxes it passes through, one
 * per skipped column; waypoints are in `boxes`, under ids starting with `via:`.
 */
export type Layout = { boxes: Map<string, Box>; routes: Map<string, string[]>; width: number; height: number };

const COLUMN_GAP = 64;
const ROW_GAP = 18;
const VIA_HEIGHT = 2;
const VIA_GAP = 8;
const PADDING = 24;
const ORDER_SWEEPS = 8;
const RELAX_ITERATIONS = 12;

/**
 * Left-to-right layered layout for a DAG. Items keep their input order as a tie-breaker. Columns and
 * their order come from the items that are not slots, with each slot bridged by edges from its
 * predecessors to its successors, so showing or hiding slots never reorders anything. Slots go in
 * gutter columns: after the column of what makes them, or before the column of what reads them.
 */
export function layoutGraph(items: LayoutItem[], edges: LayoutEdge[]): Layout {
  const slots = new Set(items.filter((i) => i.slot).map((i) => i.id));
  if (slots.size === items.length) slots.clear();
  const fixed = items.filter((i) => !slots.has(i.id));
  const bridged = bridge(edges, slots);
  const preds = neighbours(fixed.map((i) => i.id), bridged, 'to', 'from');
  const succs = neighbours(fixed.map((i) => i.id), bridged, 'from', 'to');
  const layerOf = withPorts(fixed, bridged);
  const layers = orderLayers(fixed, layerOf, preds, succs);
  const columns = withGutters(layers, items.filter((i) => slots.has(i.id)), edges, layerOf);
  const { boxes, routes } = placeBoxes(columns, items, edges);
  return measure(boxes, routes);
}

/** The edges between non-slot items, with a path through a slot replaced by a direct edge. */
function bridge(edges: LayoutEdge[], slots: Set<string>): LayoutEdge[] {
  const into = new Map<string, string[]>();
  const out = new Map<string, string[]>();
  for (const { from, to } of edges) {
    if (slots.has(to)) into.set(to, [...(into.get(to) ?? []), from]);
    if (slots.has(from)) out.set(from, [...(out.get(from) ?? []), to]);
  }
  const direct = edges.filter((e) => !slots.has(e.from) && !slots.has(e.to));
  const through = [...slots].flatMap((slot) => (into.get(slot) ?? []).flatMap((from) => (out.get(slot) ?? []).map((to) => ({ from, to }))));
  return [...direct, ...through.filter((e) => !slots.has(e.from) && !slots.has(e.to) && e.from !== e.to)];
}

/** Puts a gutter before, between and after the layers and fills the gutters with the slots; empty ones are dropped. */
function withGutters(layers: string[][], slots: LayoutItem[], edges: LayoutEdge[], layerOf: Map<string, number>): string[][] {
  const index = new Map(layers.flatMap((layer) => layer.map((id, i) => [id, i] as const)));
  const columns: string[][] = Array.from({ length: layers.length * 2 + 1 }, (_, c) => (c % 2 === 1 ? layers[(c - 1) / 2]! : []));
  const placed = slots.map((slot, order) => {
    const isNear = (id: string) => slot.near?.includes(id) ?? false;
    const from = edges.filter((e) => e.to === slot.id && layerOf.has(e.from)).map((e) => e.from);
    const to = edges.filter((e) => e.from === slot.id && layerOf.has(e.to)).map((e) => e.to);
    // Beside what makes it, unless it is shown only for what reads it; then before its first reader, so no edge runs backwards.
    const afterMaker = from.length > 0 && (from.some(isNear) || !to.some(isNear));
    const anchors = afterMaker ? from : to;
    const layer = (pick: (...values: number[]) => number) => pick(...anchors.map((id) => layerOf.get(id)!));
    const column = anchors.length === 0 ? 0 : afterMaker ? 2 * layer(Math.max) + 2 : 2 * layer(Math.min);
    const ranked = anchors.some(isNear) ? anchors.filter(isNear) : anchors;
    const rank = ranked.length > 0 ? ranked.reduce((sum, id) => sum + index.get(id)!, 0) / ranked.length : Infinity;
    return { id: slot.id, column, rank, order };
  });
  placed.sort((a, b) => a.rank - b.rank || a.order - b.order);
  for (const slot of placed) columns[slot.column]!.push(slot.id);
  return columns.filter((column) => column.length > 0);
}

/** Layers of the items other than ports, with a layer of in-ports before them and of out-ports after. */
function withPorts(items: LayoutItem[], edges: LayoutEdge[]): Map<string, number> {
  const core = items.filter((i) => !i.port);
  const ids = new Set(core.map((i) => i.id));
  const inner = edges.filter((e) => ids.has(e.from) && ids.has(e.to));
  const layerOf = assignLayers(core, neighbours([...ids], inner, 'to', 'from'), neighbours([...ids], inner, 'from', 'to'));
  const shift = items.some((i) => i.port === 'in') ? 1 : 0;
  for (const [id, value] of layerOf) layerOf.set(id, value + shift);
  const last = Math.max(shift - 1, ...layerOf.values());
  for (const item of items) if (item.port) layerOf.set(item.id, item.port === 'in' ? 0 : last + 1);
  return layerOf;
}

function assignLayers(items: LayoutItem[], preds: Map<string, string[]>, succs: Map<string, string[]>): Map<string, number> {
  const layer = new Map<string, number>();
  const visit = (id: string): number => {
    const known = layer.get(id);
    if (known !== undefined) return known;
    layer.set(id, 0);
    const value = Math.max(0, ...preds.get(id)!.map((p) => visit(p) + 1));
    layer.set(id, value);
    return value;
  };
  for (const item of items) visit(item.id);
  // Pull sources right, next to their first consumer, to avoid long edges.
  for (const item of items) {
    const next = succs.get(item.id)!;
    if (preds.get(item.id)!.length === 0 && next.length > 0) layer.set(item.id, Math.min(...next.map((s) => layer.get(s)!)) - 1);
  }
  const min = Math.min(...layer.values());
  for (const [id, value] of layer) layer.set(id, value - min);
  return layer;
}

function orderLayers(
  items: LayoutItem[],
  layerOf: Map<string, number>,
  preds: Map<string, string[]>,
  succs: Map<string, string[]>,
): string[][] {
  const count = Math.max(...layerOf.values()) + 1;
  const layers: string[][] = Array.from({ length: count }, () => []);
  for (const item of items) layers[layerOf.get(item.id)!]!.push(item.id);
  const index = new Map<string, number>();
  const reindex = () => layers.forEach((layer) => layer.forEach((id, i) => index.set(id, i)));
  reindex();
  for (let sweep = 0; sweep < ORDER_SWEEPS; sweep++) {
    const down = sweep % 2 === 0;
    const sequence = down ? layers : [...layers].reverse();
    for (const layer of sequence) {
      const centre = new Map(layer.map((id) => [id, barycentre(down ? preds.get(id)! : succs.get(id)!, index) ?? index.get(id)!]));
      layer.sort((a, b) => centre.get(a)! - centre.get(b)!);
      layer.forEach((id, i) => index.set(id, i));
    }
  }
  return layers;
}

/**
 * Stacks the columns, lines boxes up with what they link, then gives every edge that skips columns a
 * waypoint in each column it crosses, slotted between the boxes there, so it passes through a gap
 * instead of over a box; the waypoints are lined up the same way, pushing the boxes apart.
 */
function placeBoxes(columns: string[][], items: LayoutItem[], edges: LayoutEdge[]): { boxes: Map<string, Box>; routes: Map<string, string[]> } {
  const size = new Map(items.map((i) => [i.id, i]));
  const boxes = new Map<string, Box>();
  const lefts: number[] = [];
  const widths: number[] = [];
  let x = PADDING;
  for (const column of columns) {
    const width = Math.max(...column.map((id) => size.get(id)!.width));
    let y = PADDING;
    for (const id of column) {
      const item = size.get(id)!;
      boxes.set(id, { x, y, width: item.width, height: item.height });
      y += item.height + ROW_GAP;
    }
    lefts.push(x);
    widths.push(width);
    x += width + COLUMN_GAP;
  }
  relax(columns, boxes, edges);
  const { routes, chained } = routeLongEdges(columns, boxes, edges, lefts, widths);
  if (routes.size > 0) relax(columns, boxes, chained);
  const top = Math.min(...[...boxes.values()].map((b) => b.y));
  for (const box of boxes.values()) box.y += PADDING - top;
  return { boxes, routes };
}

/**
 * Waypoints are shared by the edges leaving one item, so they run together until they part. Each is
 * slotted into its column where a straight line between the edge's ends would cross it.
 */
function routeLongEdges(columns: string[][], boxes: Map<string, Box>, edges: LayoutEdge[], lefts: number[], widths: number[]) {
  const columnOf = new Map(columns.flatMap((column, c) => column.map((id) => [id, c] as const)));
  const routes = new Map<string, string[]>();
  const chained = new Map<string, LayoutEdge>();
  const link = (from: string, to: string) => chained.set(`${from}>${to}`, { from, to });
  for (const edge of edges) {
    const start = columnOf.get(edge.from)!;
    const end = columnOf.get(edge.to)!;
    if (end <= start + 1) {
      link(edge.from, edge.to);
      continue;
    }
    const from = centreY(boxes.get(edge.from)!);
    const to = centreY(boxes.get(edge.to)!);
    const via: string[] = [];
    let previous = edge.from;
    for (let c = start + 1; c < end; c++) {
      const id = `via:${edge.from}:${c}`;
      if (!boxes.has(id)) {
        const y = from + ((to - from) * (c - start)) / (end - start);
        const column = columns[c]!;
        const at = column.findIndex((other) => centreY(boxes.get(other)!) > y);
        column.splice(at === -1 ? column.length : at, 0, id);
        boxes.set(id, { x: lefts[c]!, y: y - VIA_HEIGHT / 2, width: widths[c]!, height: VIA_HEIGHT });
      }
      link(previous, id);
      via.push(id);
      previous = id;
    }
    link(previous, edge.to);
    routes.set(`${edge.from}>${edge.to}`, via);
  }
  return { routes, chained: [...chained.values()] };
}

function relax(columns: string[][], boxes: Map<string, Box>, edges: LayoutEdge[]) {
  const all = [...boxes.keys()];
  const preds = neighbours(all, edges, 'to', 'from');
  const succs = neighbours(all, edges, 'from', 'to');
  for (let iteration = 0; iteration < RELAX_ITERATIONS; iteration++) {
    for (const ids of columns) {
      const column = ids.map((id) => boxes.get(id)!);
      const desired = ids.map((id, i) => {
        const linked = [...preds.get(id)!, ...succs.get(id)!].map((n) => centreY(boxes.get(n)!));
        const target = linked.length > 0 ? linked.reduce((a, b) => a + b, 0) / linked.length : centreY(column[i]!);
        return target - column[i]!.height / 2;
      });
      const gaps = ids.map((id, i) => (i > 0 && isVia(id) && isVia(ids[i - 1]!) ? VIA_GAP : ROW_GAP));
      const placed = closestNonOverlapping(desired, column.map((b) => b.height), gaps);
      column.forEach((box, i) => (box.y = placed[i]!));
    }
  }
}

function isVia(id: string): boolean {
  return id.startsWith('via:') || id.startsWith('port:');
}

/**
 * Positions boxes in order as close as possible (least squares) to their desired tops without
 * overlapping, keeping `gaps[i]` above box i. Shifting each box by the heights and gaps above it
 * turns this into isotonic regression, solved by pooling adjacent violators.
 */
function closestNonOverlapping(desired: number[], heights: number[], gaps: number[]): number[] {
  const offsets: number[] = [];
  let offset = 0;
  for (const [i, height] of heights.entries()) {
    if (i > 0) offset += gaps[i]!;
    offsets.push(offset);
    offset += height;
  }
  const blocks: { sum: number; count: number }[] = [];
  for (const [i, d] of desired.entries()) {
    blocks.push({ sum: d - offsets[i]!, count: 1 });
    while (blocks.length > 1 && mean(blocks.at(-2)!) > mean(blocks.at(-1)!)) {
      const last = blocks.pop()!;
      blocks.at(-1)!.sum += last.sum;
      blocks.at(-1)!.count += last.count;
    }
  }
  const shifted = blocks.flatMap((b) => Array<number>(b.count).fill(mean(b)));
  return shifted.map((z, i) => z + offsets[i]!);
}

function mean(block: { sum: number; count: number }): number {
  return block.sum / block.count;
}

function measure(boxes: Map<string, Box>, routes: Map<string, string[]>): Layout {
  const all = [...boxes.values()];
  return {
    boxes,
    routes,
    width: Math.max(...all.map((b) => b.x + b.width)) + PADDING,
    height: Math.max(...all.map((b) => b.y + b.height)) + PADDING,
  };
}

function neighbours(ids: string[], edges: LayoutEdge[], key: 'from' | 'to', other: 'from' | 'to'): Map<string, string[]> {
  const map = new Map(ids.map((id) => [id, [] as string[]]));
  for (const edge of edges) map.get(edge[key])?.push(edge[other]);
  return map;
}

function barycentre(ids: string[], index: Map<string, number>): number | undefined {
  if (ids.length === 0) return undefined;
  return ids.reduce((sum, id) => sum + index.get(id)!, 0) / ids.length;
}

function centreY(box: Box): number {
  return box.y + box.height / 2;
}
