/**
 * `slot` items are shown on demand: they are placed beside the items they link without changing where
 * the others go, preferably beside those in `near` (the items they are shown for).
 */
export type LayoutItem = { id: string; width: number; height: number; slot?: boolean; near?: string[] };
export type LayoutEdge = { from: string; to: string };
export type Box = { x: number; y: number; width: number; height: number };
export type Layout = { boxes: Map<string, Box>; width: number; height: number };

const COLUMN_GAP = 64;
const ROW_GAP = 18;
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
  const preds = neighbours(fixed, bridged, 'to', 'from');
  const succs = neighbours(fixed, bridged, 'from', 'to');
  const layerOf = assignLayers(fixed, preds, succs);
  const layers = orderLayers(fixed, layerOf, preds, succs);
  const columns = withGutters(layers, items.filter((i) => slots.has(i.id)), edges, layerOf);
  const boxes = placeBoxes(columns, items, neighbours(items, edges, 'to', 'from'), neighbours(items, edges, 'from', 'to'));
  return measure(boxes);
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
    const readers = edges.filter((e) => e.from === slot.id && layerOf.has(e.to)).map((e) => e.to);
    const to = readers.some(isNear) ? readers.filter(isNear) : readers;
    // Beside what makes it, unless it is shown only for what reads it.
    const afterMaker = from.length > 0 && (from.some(isNear) || !readers.some(isNear));
    const anchors = afterMaker ? from : to;
    const layer = (pick: (...values: number[]) => number) => pick(...anchors.map((id) => layerOf.get(id)!));
    const column = anchors.length === 0 ? 0 : afterMaker ? 2 * layer(Math.max) + 2 : 2 * layer(Math.min);
    const rank = anchors.length > 0 ? anchors.reduce((sum, id) => sum + index.get(id)!, 0) / anchors.length : Infinity;
    return { id: slot.id, column, rank, order };
  });
  placed.sort((a, b) => a.rank - b.rank || a.order - b.order);
  for (const slot of placed) columns[slot.column]!.push(slot.id);
  return columns.filter((column) => column.length > 0);
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

function placeBoxes(
  layers: string[][],
  items: LayoutItem[],
  preds: Map<string, string[]>,
  succs: Map<string, string[]>,
): Map<string, Box> {
  const size = new Map(items.map((i) => [i.id, i]));
  const boxes = new Map<string, Box>();
  let x = PADDING;
  for (const layer of layers) {
    const width = Math.max(...layer.map((id) => size.get(id)!.width));
    let y = PADDING;
    for (const id of layer) {
      const item = size.get(id)!;
      boxes.set(id, { x, y, width: item.width, height: item.height });
      y += item.height + ROW_GAP;
    }
    x += width + COLUMN_GAP;
  }
  for (let iteration = 0; iteration < RELAX_ITERATIONS; iteration++) {
    for (const layer of layers) {
      const column = layer.map((id) => boxes.get(id)!);
      const desired = layer.map((id, i) => {
        const linked = [...preds.get(id)!, ...succs.get(id)!].map((n) => centreY(boxes.get(n)!));
        const target = linked.length > 0 ? linked.reduce((a, b) => a + b, 0) / linked.length : centreY(column[i]!);
        return target - column[i]!.height / 2;
      });
      const placed = closestNonOverlapping(desired, column.map((b) => b.height));
      column.forEach((box, i) => (box.y = placed[i]!));
    }
  }
  const top = Math.min(...[...boxes.values()].map((b) => b.y));
  for (const box of boxes.values()) box.y += PADDING - top;
  return boxes;
}

/**
 * Positions boxes in order as close as possible (least squares) to their desired tops without overlapping.
 * Shifting each box by the heights above it turns this into isotonic regression, solved by pooling adjacent violators.
 */
function closestNonOverlapping(desired: number[], heights: number[]): number[] {
  const offsets: number[] = [];
  let offset = 0;
  for (const height of heights) {
    offsets.push(offset);
    offset += height + ROW_GAP;
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

function measure(boxes: Map<string, Box>): Layout {
  const all = [...boxes.values()];
  return {
    boxes,
    width: Math.max(...all.map((b) => b.x + b.width)) + PADDING,
    height: Math.max(...all.map((b) => b.y + b.height)) + PADDING,
  };
}

function neighbours(items: LayoutItem[], edges: LayoutEdge[], key: 'from' | 'to', other: 'from' | 'to'): Map<string, string[]> {
  const map = new Map(items.map((i) => [i.id, [] as string[]]));
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
