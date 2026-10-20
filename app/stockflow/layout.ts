import type { VariableDescription } from '../../lib/semantics/types';

export type Point = { x: number; y: number };
export type Rect = Point & { width: number; height: number };

export type FlowShape = {
  /** Pipe from source (stock edge or cloud) to destination; the last point is the arrow tip. */
  points: Point[];
  valve: Point;
  sourceCloud?: Point;
  sinkCloud?: Point;
};

export type Connector = { from: string; to: string; initial: boolean };

export type StockFlowLayout = {
  width: number;
  height: number;
  stocks: Map<string, Rect>;
  flows: Map<string, FlowShape>;
  auxes: Map<string, Point>;
  connectors: Connector[];
};

export const STOCK = { width: 128, height: 66 };
export const AUX_RADIUS = 13;
export const VALVE_RADIUS = 9;
const STOCK_SPACING = 330;
const ROW_SPACING = 470;
const CLOUD_DISTANCE = 130;
const SIDE_FLOW_SPACING = 40;
const MARGIN = 90;

/**
 * Places a stock-and-flow diagram: chains of stocks linked by flows form fixed rows,
 * then auxiliaries settle around them under springs (one per connector) and repulsion.
 */
export function layoutStockFlow(variables: VariableDescription[], wiring: Wiring = () => undefined): StockFlowLayout {
  const stocks = new Map<string, Rect>();
  const flows = new Map<string, FlowShape>();
  placeSkeleton(variables, stocks, flows);
  const connectors = connectorsOf(variables);
  const auxVars = variables.filter((v) => v.kind === 'aux');
  const auxes = placeAuxiliaries(auxVars, connectors, stocks, flows, obstaclesOf(variables, stocks, flows, wiring), wiring);
  return normalize(stocks, flows, auxes, connectors);
}

/** Dataset line shown under a variable's label, if it is wired to one. */
export type Wiring = (name: string) => string | undefined;

export const LINE_HEIGHT = 13;
const CHAR_WIDTH = 6.2;

/** Label text of a variable: its name wrapped, then its value, then its dataset if wired. */
function labelLines(variable: VariableDescription, wiring: Wiring): number {
  return wrap(readable(variable.name), 16).length + 1 + (wiring(variable.name) ? 1 : 0);
}

export function readable(name: string): string {
  return name.replace(/_/g, ' ');
}

export function wrap(text: string, width: number): string[] {
  const lines: string[] = [];
  for (const word of text.split(' ')) {
    const last = lines.at(-1);
    if (last !== undefined && last.length + word.length + 1 <= width) lines[lines.length - 1] = `${last} ${word}`;
    else lines.push(word);
  }
  return lines;
}

/** Space a variable's shape and label take, relative to its centre. */
type Footprint = { left: number; top: number; width: number; height: number };

function labelWidth(variable: VariableDescription, wiring: Wiring): number {
  const longest = Math.max(...wrap(readable(variable.name), 16).map((l) => l.length), wiring(variable.name)?.length ?? 0);
  return Math.max(40, longest * CHAR_WIDTH + 10);
}

function auxFootprint(variable: VariableDescription, wiring: Wiring): Footprint {
  const width = labelWidth(variable, wiring);
  return { left: -width / 2, top: -AUX_RADIUS - 6, width, height: AUX_RADIUS * 2 + 14 + labelLines(variable, wiring) * LINE_HEIGHT };
}

type Box = { x: number; y: number; width: number; height: number };

function obstaclesOf(variables: VariableDescription[], stocks: Map<string, Rect>, flows: Map<string, FlowShape>, wiring: Wiring): Box[] {
  const byName = new Map(variables.map((v) => [v.name, v]));
  const boxes: Box[] = [];
  const rows = new Map<number, Rect[]>();
  for (const s of stocks.values()) rows.set(s.y, [...(rows.get(s.y) ?? []), s]);
  for (const [y, row] of rows) {
    const left = Math.min(...row.map((s) => s.x - s.width / 2));
    const right = Math.max(...row.map((s) => s.x + s.width / 2));
    boxes.push({ x: left, y: y - STOCK.height / 2 - 14, width: right - left, height: STOCK.height + 28 });
  }
  for (const [name, s] of stocks) {
    const text = wiring(name);
    const width = Math.max(s.width, (text?.length ?? 0) * CHAR_WIDTH);
    boxes.push({ x: s.x - width / 2 - 10, y: s.y - s.height / 2 - 14, width: width + 20, height: s.height + 14 + (text ? 32 : 18) });
  }
  for (const [name, f] of flows) {
    for (const [a, b] of f.points.slice(1).map((p, k) => [f.points[k]!, p] as const)) {
      boxes.push({ x: Math.min(a.x, b.x) - 10, y: Math.min(a.y, b.y) - 10, width: Math.abs(a.x - b.x) + 20, height: Math.abs(a.y - b.y) + 20 });
    }
    for (const c of [f.sourceCloud, f.sinkCloud]) if (c) boxes.push({ x: c.x - 20, y: c.y - 14, width: 40, height: 28 });
    const v = byName.get(name);
    if (!v) continue;
    const width = labelWidth(v, wiring);
    const lines = labelLines(v, wiring) * LINE_HEIGHT;
    boxes.push(isVertical(f) ? { x: f.valve.x - 12, y: f.valve.y - 20, width: width + 30, height: lines + 14 } : { x: f.valve.x - width / 2, y: f.valve.y - 12, width, height: lines + 26 });
  }
  return boxes;
}

export function isVertical(shape: FlowShape): boolean {
  const [a, b] = shape.points;
  return Math.abs(a!.x - b!.x) < Math.abs(a!.y - b!.y);
}

// ---------------------------------------------------------------------------
// Skeleton: stocks and their flows
// ---------------------------------------------------------------------------

function placeSkeleton(variables: VariableDescription[], stocks: Map<string, Rect>, flows: Map<string, FlowShape>): void {
  const stockVars = variables.filter((v) => v.kind === 'stock');
  const ends = flowEnds(variables);
  const rows = chains(stockVars, ends);
  rows.forEach((row, r) => {
    row.forEach((name, i) => stocks.set(name, { x: i * STOCK_SPACING, y: r * ROW_SPACING, width: STOCK.width, height: STOCK.height }));
  });
  const order = new Map(rows.flatMap((row) => row.map((name, i) => [name, i] as const)));
  const horizontalIn = new Set<string>();
  const horizontalOut = new Set<string>();
  const sides = new Map<string, { top: string[]; bottom: string[] }>();
  const side = (stock: string) => sides.get(stock) ?? (sides.set(stock, { top: [], bottom: [] }), sides.get(stock)!);

  // flows between neighbouring stocks run straight between them
  for (const [flow, { from, to }] of ends) {
    if (from && to && rowOf(rows, from) === rowOf(rows, to) && order.get(to)! === order.get(from)! + 1) {
      const a = stocks.get(from)!;
      const b = stocks.get(to)!;
      flows.set(flow, straight({ x: a.x + a.width / 2, y: a.y }, { x: b.x - b.width / 2, y: b.y }));
      horizontalOut.add(from);
      horizontalIn.add(to);
    }
  }
  // the first inflow from a cloud enters from the left, the last outflow to a cloud leaves to the right
  for (const [flow, { from, to }] of ends) {
    if (flows.has(flow)) continue;
    if (!from && to && !horizontalIn.has(to)) {
      const s = stocks.get(to)!;
      const end = { x: s.x - s.width / 2, y: s.y };
      flows.set(flow, { ...straight({ x: end.x - CLOUD_DISTANCE, y: s.y }, end), sourceCloud: { x: end.x - CLOUD_DISTANCE - 14, y: s.y } });
      horizontalIn.add(to);
    } else if (from && !to && !horizontalOut.has(from) && isLast(rows, from)) {
      const s = stocks.get(from)!;
      const start = { x: s.x + s.width / 2, y: s.y };
      flows.set(flow, { ...straight(start, { x: start.x + CLOUD_DISTANCE, y: s.y }), sinkCloud: { x: start.x + CLOUD_DISTANCE + 14, y: s.y } });
      horizontalOut.add(from);
    } else if (!from && to) side(to).top.push(flow);
    else if (from && !to) side(from).bottom.push(flow);
    else if (from && to) side(from).bottom.push(flow);
  }
  // the rest enter from above or leave below; flows between distant stocks loop underneath
  for (const [stock, { top, bottom }] of sides) {
    const s = stocks.get(stock)!;
    top.forEach((flow, k) => {
      const x = s.x + (k - (top.length - 1) / 2) * SIDE_FLOW_SPACING;
      const end = { x, y: s.y - s.height / 2 };
      flows.set(flow, { ...straight({ x, y: end.y - CLOUD_DISTANCE }, end), sourceCloud: { x, y: end.y - CLOUD_DISTANCE - 12 } });
    });
    bottom.forEach((flow, k) => {
      const x = s.x + (k - (bottom.length - 1) / 2) * SIDE_FLOW_SPACING;
      const start = { x, y: s.y + s.height / 2 };
      const to = ends.get(flow)!.to;
      if (!to) {
        flows.set(flow, { ...straight(start, { x, y: start.y + CLOUD_DISTANCE }), sinkCloud: { x, y: start.y + CLOUD_DISTANCE + 12 } });
        return;
      }
      const t = stocks.get(to)!;
      const depth = Math.max(start.y, t.y + t.height / 2) + 70 + 26 * k;
      const points = [start, { x, y: depth }, { x: t.x, y: depth }, { x: t.x, y: t.y + t.height / 2 }];
      flows.set(flow, { points, valve: { x: (x + t.x) / 2, y: depth } });
    });
  }
  // flows attached to no stock float on their own
  let loose = 0;
  for (const v of variables.filter((v) => v.kind === 'flow' && !flows.has(v.name))) {
    const y = (rows.length + 0.5) * ROW_SPACING;
    const x = loose++ * STOCK_SPACING;
    flows.set(v.name, { ...straight({ x: x - 70, y }, { x: x + 70, y }), sourceCloud: { x: x - 84, y }, sinkCloud: { x: x + 84, y } });
  }
}

function flowEnds(variables: VariableDescription[]): Map<string, { from?: string; to?: string }> {
  const ends = new Map<string, { from?: string; to?: string }>();
  for (const v of variables.filter((v) => v.kind === 'stock')) {
    for (const f of v.inflows ?? []) ends.set(f, { ...ends.get(f), to: v.name });
    for (const f of v.outflows ?? []) ends.set(f, { ...ends.get(f), from: v.name });
  }
  return ends;
}

/** Groups stocks connected by flows into rows, ordered along the direction of flow. */
function chains(stocks: VariableDescription[], ends: Map<string, { from?: string; to?: string }>): string[][] {
  const next = new Map<string, string[]>();
  const linked = new Map<string, Set<string>>(stocks.map((s) => [s.name, new Set<string>()]));
  for (const { from, to } of ends.values()) {
    if (!from || !to) continue;
    next.set(from, [...(next.get(from) ?? []), to]);
    linked.get(from)!.add(to);
    linked.get(to)!.add(from);
  }
  const seen = new Set<string>();
  const rows: string[][] = [];
  for (const s of stocks) {
    if (seen.has(s.name)) continue;
    const component: string[] = [];
    const stack = [s.name];
    while (stack.length) {
      const name = stack.pop()!;
      if (seen.has(name)) continue;
      seen.add(name);
      component.push(name);
      stack.push(...linked.get(name)!);
    }
    rows.push(flowOrder(component, next, stocks.map((v) => v.name)));
  }
  return rows.sort((a, b) => b.length - a.length);
}

function flowOrder(component: string[], next: Map<string, string[]>, declared: string[]): string[] {
  const inComponent = new Set(component);
  const indegree = new Map(component.map((c) => [c, 0]));
  for (const c of component) for (const n of next.get(c) ?? []) if (inComponent.has(n)) indegree.set(n, indegree.get(n)! + 1);
  const byDeclaration = (a: string, b: string) => declared.indexOf(a) - declared.indexOf(b);
  const ready = component.filter((c) => indegree.get(c) === 0).sort(byDeclaration);
  const order: string[] = [];
  while (order.length < component.length) {
    const name = ready.shift() ?? component.filter((c) => !order.includes(c)).sort(byDeclaration)[0]!;
    if (order.includes(name)) continue;
    order.push(name);
    for (const n of next.get(name) ?? []) {
      if (!inComponent.has(n)) continue;
      indegree.set(n, indegree.get(n)! - 1);
      if (indegree.get(n) === 0) ready.push(n);
    }
  }
  return order;
}

function rowOf(rows: string[][], stock: string): number {
  return rows.findIndex((row) => row.includes(stock));
}

function isLast(rows: string[][], stock: string): boolean {
  return rows[rowOf(rows, stock)]!.at(-1) === stock;
}

function straight(from: Point, to: Point): FlowShape {
  return { points: [from, to], valve: { x: (from.x + to.x) / 2, y: (from.y + to.y) / 2 } };
}

// ---------------------------------------------------------------------------
// Auxiliaries: start next to what they connect to, then relax
// ---------------------------------------------------------------------------

function connectorsOf(variables: VariableDescription[]): Connector[] {
  const names = new Set(variables.map((v) => v.name));
  return variables.flatMap((v) =>
    (v.dependsOn ?? []).filter((d) => names.has(d)).map((d) => ({ from: d, to: v.name, initial: v.kind === 'stock' })),
  );
}

function placeAuxiliaries(
  variables: VariableDescription[],
  connectors: Connector[],
  stocks: Map<string, Rect>,
  flows: Map<string, FlowShape>,
  obstacles: Box[],
  wiring: Wiring,
): Map<string, Point> {
  const names = variables.map((v) => v.name);
  const fixed = new Map<string, Point>([...stocks, ...[...flows].map(([n, f]) => [n, f.valve] as const)]);
  const neighbours = new Map<string, string[]>();
  for (const { from, to } of connectors) {
    neighbours.set(from, [...(neighbours.get(from) ?? []), to]);
    neighbours.set(to, [...(neighbours.get(to) ?? []), from]);
  }
  const positions = initialPositions(names, neighbours, fixed);
  relax(names, connectors, positions, fixed, stocks, flows);
  separate(variables, positions, obstacles, wiring);
  return new Map(names.map((n) => [n, positions.get(n)!]));
}

function initialPositions(names: string[], neighbours: Map<string, string[]>, fixed: Map<string, Point>): Map<string, Point> {
  const positions = new Map(fixed);
  const pending = new Set(names);
  let wave = 0;
  while (pending.size > 0) {
    const placed = [...pending].filter((n) => (neighbours.get(n) ?? []).some((m) => positions.has(m)));
    if (placed.length === 0) {
      [...pending].forEach((n, i) => positions.set(n, { x: i * 140, y: -ROW_SPACING / 2 - 120 * wave }));
      break;
    }
    for (const [i, name] of placed.entries()) {
      const known = neighbours.get(name)!.filter((m) => positions.has(m)).map((m) => positions.get(m)!);
      const centre = { x: mean(known.map((p) => p.x)), y: mean(known.map((p) => p.y)) };
      const angle = -Math.PI / 2 + (i + wave) * 2.39996;
      positions.set(name, { x: centre.x + Math.cos(angle) * 110, y: centre.y + Math.sin(angle) * 110 - 40 });
      pending.delete(name);
    }
    wave++;
  }
  return positions;
}

function relax(
  names: string[],
  connectors: Connector[],
  positions: Map<string, Point>,
  fixed: Map<string, Point>,
  stocks: Map<string, Rect>,
  flows: Map<string, FlowShape>,
): void {
  const free = new Set(names);
  const segments = [...flows.values()].flatMap((f) => f.points.slice(1).map((p, k) => [f.points[k]!, p] as const));
  const points = [...fixed.values(), ...[...flows.values()].flatMap((f) => [f.sourceCloud, f.sinkCloud].filter((p): p is Point => !!p))];
  const iterations = 300;
  for (let it = 0; it < iterations; it++) {
    const step = 30 * (1 - it / iterations) + 1;
    const force = new Map(names.map((n) => [n, { x: 0, y: 0 }]));
    const push = (name: string, dx: number, dy: number) => {
      const f = force.get(name);
      if (f) {
        f.x += dx;
        f.y += dy;
      }
    };
    for (const { from, to } of connectors) {
      const a = positions.get(from)!;
      const b = positions.get(to)!;
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const d = Math.hypot(dx, dy) || 1;
      const pull = ((d - 150) / d) * 0.06;
      if (free.has(from)) push(from, dx * pull, dy * pull);
      if (free.has(to)) push(to, -dx * pull, -dy * pull);
    }
    for (const [i, a] of names.entries()) {
      const pa = positions.get(a)!;
      for (const b of names.slice(i + 1)) {
        const pb = positions.get(b)!;
        const [dx, dy, d] = away(pa, pb);
        if (d > 240) continue;
        const r = 2600 / (d * d);
        push(a, (dx / d) * r, (dy / d) * r);
        push(b, (-dx / d) * r, (-dy / d) * r);
      }
      for (const p of points) {
        const [dx, dy, d] = away(pa, p);
        if (d < 120) push(a, (dx / d) * (3000 / (d * d)), (dy / d) * (3000 / (d * d)));
      }
      for (const s of stocks.values()) {
        const nearest = { x: clamp(pa.x, s.x - s.width / 2, s.x + s.width / 2), y: clamp(pa.y, s.y - s.height / 2, s.y + s.height / 2) };
        const [dx, dy, d] = away(pa, nearest);
        if (d < 110) push(a, (dx / d) * (5000 / (d * d)), (dy / d) * (5000 / (d * d)));
      }
      for (const [p, q] of segments) {
        const nearest = closestOnSegment(pa, p, q);
        const [dx, dy, d] = away(pa, nearest);
        if (d < 60) push(a, (dx / d) * (1500 / (d * d)), (dy / d) * (1500 / (d * d)));
      }
    }
    for (const name of names) {
      const f = force.get(name)!;
      const length = Math.hypot(f.x, f.y);
      const scale = length > step ? step / length : 1;
      const p = positions.get(name)!;
      positions.set(name, { x: p.x + f.x * scale, y: p.y + f.y * scale });
    }
  }
}

/**
 * Moves each auxiliary to the free spot nearest its relaxed position, so no label overlaps
 * another label, a stock, a pipe or a flow label. Auxiliaries closest to the stocks and flows go first.
 */
function separate(variables: VariableDescription[], positions: Map<string, Point>, obstacles: Box[], wiring: Wiring): void {
  const taken = [...obstacles];
  const centre = { x: mean(obstacles.map((o) => o.x + o.width / 2)), y: mean(obstacles.map((o) => o.y + o.height / 2)) };
  const order = [...variables].sort((a, b) => distance(positions.get(a.name)!, centre) - distance(positions.get(b.name)!, centre));
  for (const variable of order) {
    const footprint = auxFootprint(variable, wiring);
    const spot = nearestFreeSpot(positions.get(variable.name)!, footprint, taken);
    positions.set(variable.name, spot);
    taken.push(boxAt(spot, footprint));
  }
}

function nearestFreeSpot(start: Point, footprint: Footprint, taken: Box[]): Point {
  const step = 12;
  for (let radius = 0; radius < 3000; radius += step) {
    const count = Math.max(1, Math.round((2 * Math.PI * radius) / step));
    for (let k = 0; k < count; k++) {
      const angle = -Math.PI / 2 + (2 * Math.PI * k) / count;
      const spot = { x: start.x + Math.cos(angle) * radius, y: start.y + Math.sin(angle) * radius };
      const box = boxAt(spot, footprint);
      if (!taken.some((t) => overlaps(box, t))) return spot;
    }
  }
  return start;
}

function boxAt(p: Point, f: Footprint): Box {
  return { x: p.x + f.left, y: p.y + f.top, width: f.width, height: f.height };
}

function overlaps(a: Box, b: Box): boolean {
  const gap = 8;
  return a.x < b.x + b.width + gap && b.x < a.x + a.width + gap && a.y < b.y + b.height + gap && b.y < a.y + a.height + gap;
}

function distance(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function normalize(
  stocks: Map<string, Rect>,
  flows: Map<string, FlowShape>,
  auxes: Map<string, Point>,
  connectors: Connector[],
): StockFlowLayout {
  const all = [
    ...[...stocks.values()].flatMap((s) => [{ x: s.x - s.width / 2, y: s.y - s.height / 2 }, { x: s.x + s.width / 2, y: s.y + s.height / 2 }]),
    ...[...flows.values()].flatMap((f) => [...f.points, f.valve, ...[f.sourceCloud, f.sinkCloud].filter((p): p is Point => !!p)]),
    ...auxes.values(),
  ];
  const minX = Math.min(...all.map((p) => p.x)) - MARGIN;
  const minY = Math.min(...all.map((p) => p.y)) - MARGIN;
  const shift = (p: Point): Point => ({ x: p.x - minX, y: p.y - minY });
  const shiftOptional = (p?: Point) => (p ? shift(p) : undefined);
  return {
    width: Math.max(...all.map((p) => p.x)) - minX + MARGIN,
    height: Math.max(...all.map((p) => p.y)) - minY + MARGIN,
    stocks: new Map([...stocks].map(([n, s]) => [n, { ...s, ...shift(s) }])),
    flows: new Map([...flows].map(([n, f]) => [n, { points: f.points.map(shift), valve: shift(f.valve), sourceCloud: shiftOptional(f.sourceCloud), sinkCloud: shiftOptional(f.sinkCloud) }])),
    auxes: new Map([...auxes].map(([n, p]) => [n, shift(p)])),
    connectors,
  };
}

function away(a: Point, b: Point): [number, number, number] {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  const d = Math.hypot(dx, dy);
  return d < 1 ? [1, 0, 1] : [dx, dy, d];
}

function closestOnSegment(p: Point, a: Point, b: Point): Point {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const t = clamp(((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy || 1), 0, 1);
  return { x: a.x + t * dx, y: a.y + t * dy };
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function mean(values: number[]): number {
  return values.reduce((a, b) => a + b, 0) / values.length;
}
