export type LayoutItem = { id: string; width: number; height: number };
export type LayoutEdge = { from: string; to: string };
export type Box = { x: number; y: number; width: number; height: number };
export type Layout = { boxes: Map<string, Box>; width: number; height: number };

const COLUMN_GAP = 64;
const ROW_GAP = 18;
const PADDING = 24;
const ORDER_SWEEPS = 8;
const RELAX_ITERATIONS = 12;

/** Left-to-right layered layout for a DAG. Items keep their input order as a tie-breaker. */
export function layoutGraph(items: LayoutItem[], edges: LayoutEdge[]): Layout {
  const preds = neighbours(items, edges, 'to', 'from');
  const succs = neighbours(items, edges, 'from', 'to');
  const layerOf = assignLayers(items, preds, succs);
  const layers = orderLayers(items, layerOf, preds, succs);
  const boxes = placeBoxes(layers, items, preds, succs);
  return measure(boxes);
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
