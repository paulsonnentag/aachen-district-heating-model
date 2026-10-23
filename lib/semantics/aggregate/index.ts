import { z } from 'zod';
import { cartesian } from '../../runtime/datasets';
import type { Issue, PipelineNode } from '../../runtime/pipeline';
import type { Column, Table } from '../../runtime/table';
import type { Tensor } from '../../runtime/tensor';
import { createKeeper, toOutput, type OutputSpec, type ResultStore } from '../kept';
import type { ModelDescription, NodeInputs, Semantics } from '../types';
import { numericLiterals } from '../xmile/document';
import { namesIn, parseExpression, type Expr } from './expression';

const RUNTIME = 'workbench aggregate 1';

const AggregateOutputSchema = z.object({
  /** Evaluated once per group, e.g. `sum(spf_air * demand_kwh) / sum(demand_kwh)`; `{dim}` is replaced per coordinate of `for`. */
  value: z.string(),
  unit: z.string(),
  /** Further dimensions: each coordinate with the text that replaces `{dim}` in the formula (the coordinate itself for a list). */
  for: z.record(z.string(), z.union([z.array(z.string()), z.record(z.string(), z.string())])).default({}),
  description: z.string().optional(),
});

const AggregateModelSchema = z.object({
  /** The input whose rows are aggregated. */
  rows: z.string(),
  /** Keeps only the rows for which this is true, e.g. `residential and demand_kwh > 0`. */
  where: z.string().optional(),
  /** The column that groups the rows; it becomes the first dimension of every output. */
  by: z.string().optional(),
  /** `input.column` listing every coordinate of `by` in order; rows of other groups are dropped. */
  over: z.string().optional(),
  outputs: z.record(z.string(), AggregateOutputSchema),
  /** A committed result of an earlier run, reused while its key matches the formulas and inputs. */
  snapshot: z.string().optional(),
});

type AggregateModel = z.infer<typeof AggregateModelSchema>;
type AggregateOutput = z.infer<typeof AggregateOutputSchema>;
type Value = number | string | boolean | null;
type RowFn = (row: number) => Value;
type GroupFn = (rows: number[]) => Value;

/** Reductions over a group's rows; outside them a formula may only read scalar inputs. */
const AGGREGATES: Record<string, (values: number[]) => number> = {
  sum: (values) => values.reduce((a, b) => a + b, 0),
  mean: (values) => values.reduce((a, b) => a + b, 0) / values.length,
  min: (values) => Math.min(...values),
  max: (values) => Math.max(...values),
  count: (values) => values.length,
};

/**
 * Simple formulas over a table: filter its rows, group them by a column and reduce each group with
 * `sum`, `mean`, `min`, `max` or `count`. Missing values are skipped by the reductions; `total(a, b)`
 * adds values counting missing ones as zero, `coalesce(a, b)` takes the first that is present.
 */
export function createAggregateSemantics(store?: ResultStore): Semantics {
  const keeper = createKeeper(RUNTIME, store);
  return {
    id: 'aggregate',
    async prepare(node, readText) {
      const model = AggregateModelSchema.parse(node.model);
      const specs = outputSpecs(model);
      return {
        ports: { inputs: null, outputs: Object.keys(model.outputs) },
        issues: check(node, model),
        description: describe(node, model),
        fingerprint: JSON.stringify({ runtime: RUNTIME, model: { ...model, snapshot: undefined } }),
        lookup: async (key) => {
          const found = await keeper.find(key, model.snapshot, readText);
          return found && toOutput(specs, found);
        },
        execute: async (inputs, { key, fresh, onLog }) => {
          const found = fresh ? undefined : await keeper.find(key, model.snapshot, readText);
          if (found) return toOutput(specs, found);
          return toOutput(specs, await keeper.compute(key, model.snapshot, readText, async () => ({ outputs: aggregate(model, inputs, onLog), log: [] })));
        },
      };
    },
  };
}

function aggregate(model: AggregateModel, inputs: NodeInputs, onLog: (line: string) => void): Record<string, unknown> {
  const table = inputs.tables[model.rows];
  if (!table) throw new Error(`Input ${model.rows} is not a table`);
  const scalars = scalarInputs(inputs.tensors);
  const keep = model.where ? compileRow(parseExpression(model.where), table, scalars) : () => true;
  const { coords, groups } = groupRows(model, table, inputs, (row) => truthy(keep(row)));
  onLog(`${groups.reduce((n, g) => n + g.length, 0).toLocaleString('en')} of ${table.rows.toLocaleString('en')} rows in ${coords.length.toLocaleString('en')} groups`);
  const outputs: Record<string, unknown> = {};
  for (const [port, output] of Object.entries(model.outputs)) {
    const rows: (string | number)[][] = [];
    const failed: string[] = [];
    const combos = [...cartesian(Object.values(output.for).map(coordinatesOf))];
    const formulas = combos.map((combo) => compileGroup(parseExpression(substitute(output, combo)), table, scalars));
    groups.forEach((group, g) => {
      combos.forEach((combo, c) => {
        const value = formulas[c]!(group);
        if (typeof value !== 'number' || !Number.isFinite(value)) failed.push([coords[g], ...combo].filter((x) => x !== undefined).join(' '));
        else rows.push([...(model.by ? [coords[g]!] : []), ...combo, value]);
      });
    });
    if (failed.length > 0) throw new Error(`${port}: no number for ${failed.length} of ${groups.length * combos.length} values, e.g. ${failed.slice(0, 3).join(', ')}`);
    outputs[port] = rows;
  }
  return outputs;
}

function groupRows(model: AggregateModel, table: Table, inputs: NodeInputs, keep: (row: number) => boolean): { coords: string[]; groups: number[][] } {
  if (!model.by) {
    const rows = Array.from({ length: table.rows }, (_, i) => i).filter(keep);
    return { coords: [], groups: [rows] };
  }
  const by = readColumn(table, model.by);
  const coords = model.over ? overCoordinates(model.over, inputs) : undefined;
  const index = new Map((coords ?? []).map((c, i) => [c, i]));
  const groups: number[][] = (coords ?? []).map(() => []);
  const found: string[] = [];
  for (let row = 0; row < table.rows; row++) {
    if (!keep(row)) continue;
    const key = by(row);
    if (key === null) continue;
    let g = index.get(String(key));
    if (g === undefined) {
      if (coords) continue;
      g = groups.length;
      index.set(String(key), g);
      found.push(String(key));
      groups.push([]);
    }
    groups[g]!.push(row);
  }
  return { coords: coords ?? found, groups };
}

function overCoordinates(over: string, inputs: NodeInputs): string[] {
  const [port, column] = over.split('.');
  const table = inputs.tables[port!];
  if (!table) throw new Error(`over: input ${port} is not a table`);
  const read = readColumn(table, column!);
  return Array.from({ length: table.rows }, (_, row) => String(read(row)));
}

function compileRow(expr: Expr, table: Table, scalars: Map<string, number>): RowFn {
  switch (expr.kind) {
    case 'number':
      return () => expr.value;
    case 'name': {
      if (expr.name in table.columns) return readColumn(table, expr.name);
      const scalar = scalars.get(expr.name);
      if (scalar === undefined) throw new Error(`No column or scalar input named ${expr.name}`);
      return () => scalar;
    }
    case 'call': {
      if (expr.name in AGGREGATES) throw new Error(`${expr.name}() cannot be nested in a row formula`);
      const args = expr.args.map((a) => compileRow(a, table, scalars));
      if (expr.name === 'total') return (row) => args.reduce((sum: number, arg) => sum + numberOr(arg(row), 0), 0);
      if (expr.name === 'coalesce') return (row) => args.map((arg) => arg(row)).find((v) => v !== null) ?? null;
      throw new Error(`Unknown function ${expr.name}()`);
    }
    case 'unary': {
      const arg = compileRow(expr.arg, table, scalars);
      return expr.op === 'not' ? (row) => !truthy(arg(row)) : (row) => negate(arg(row));
    }
    case 'binary': {
      const left = compileRow(expr.left, table, scalars);
      const right = compileRow(expr.right, table, scalars);
      return (row) => binary(expr.op, left(row), right(row));
    }
  }
}

function compileGroup(expr: Expr, table: Table, scalars: Map<string, number>): GroupFn {
  switch (expr.kind) {
    case 'number':
      return () => expr.value;
    case 'name': {
      const scalar = scalars.get(expr.name);
      if (scalar !== undefined) return () => scalar;
      throw new Error(`${expr.name} is read outside ${Object.keys(AGGREGATES).join('(), ')}(); say how to combine its rows`);
    }
    case 'call': {
      const reduce = AGGREGATES[expr.name];
      if (!reduce) {
        const args = expr.args.map((a) => compileGroup(a, table, scalars));
        if (expr.name === 'total') return (rows) => args.reduce((sum: number, arg) => sum + numberOr(arg(rows), 0), 0);
        if (expr.name === 'coalesce') return (rows) => args.map((arg) => arg(rows)).find((v) => v !== null) ?? null;
        throw new Error(`Unknown function ${expr.name}()`);
      }
      if (expr.args.length > 1) throw new Error(`${expr.name}() takes one formula`);
      const arg = expr.args[0] ? compileRow(expr.args[0], table, scalars) : () => 1;
      return (rows) => {
        const values: number[] = [];
        for (const row of rows) {
          const v = arg(row);
          if (typeof v === 'number' && Number.isFinite(v)) values.push(v);
          else if (typeof v === 'boolean') values.push(Number(v));
        }
        return values.length === 0 && expr.name !== 'sum' && expr.name !== 'count' ? null : reduce(values);
      };
    }
    case 'unary': {
      const arg = compileGroup(expr.arg, table, scalars);
      return expr.op === 'not' ? (rows) => !truthy(arg(rows)) : (rows) => negate(arg(rows));
    }
    case 'binary': {
      const left = compileGroup(expr.left, table, scalars);
      const right = compileGroup(expr.right, table, scalars);
      return (rows) => binary(expr.op, left(rows), right(rows));
    }
  }
}

function readColumn(table: Table, name: string): RowFn {
  const column: Column | undefined = table.columns[name];
  if (!column) throw new Error(`The table has no column ${name}`);
  switch (column.type) {
    case 'number':
      return (row) => (Number.isFinite(column.values[row]) ? column.values[row]! : null);
    case 'string':
    case 'boolean':
      return (row) => column.values[row] ?? null;
    case 'geometry':
      throw new Error(`${name} is a geometry column`);
  }
}

function binary(op: string, a: Value, b: Value): Value {
  if (op === 'and') return truthy(a) && truthy(b);
  if (op === 'or') return truthy(a) || truthy(b);
  if (a === null || b === null) return op === '!=' ? a !== b : op === '==' ? a === b : null;
  switch (op) {
    case '==':
      return a === b;
    case '!=':
      return a !== b;
    case '<':
      return (a as number) < (b as number);
    case '<=':
      return (a as number) <= (b as number);
    case '>':
      return (a as number) > (b as number);
    case '>=':
      return (a as number) >= (b as number);
  }
  if (typeof a !== 'number' || typeof b !== 'number') throw new Error(`${op} needs numbers, got ${JSON.stringify(a)} and ${JSON.stringify(b)}`);
  switch (op) {
    case '+':
      return a + b;
    case '-':
      return a - b;
    case '*':
      return a * b;
    case '/':
      return a / b;
  }
  throw new Error(`Unknown operator ${op}`);
}

function negate(value: Value): Value {
  if (value === null) return null;
  if (typeof value !== 'number') throw new Error(`Cannot negate ${JSON.stringify(value)}`);
  return -value;
}

function truthy(value: Value): boolean {
  return value !== null && value !== false && value !== 0 && value !== '';
}

function numberOr(value: Value, fallback: number): number {
  return typeof value === 'number' ? value : fallback;
}

function scalarInputs(tensors: Record<string, Tensor>): Map<string, number> {
  const scalars = new Map<string, number>();
  for (const [port, tensor] of Object.entries(tensors)) {
    if (tensor.dims.length > 0) throw new Error(`Input ${port} has dimensions ${tensor.dims.join(', ')}; formulas read tables and scalars`);
    scalars.set(port, tensor.values[0]!);
  }
  return scalars;
}

function coordinatesOf(values: string[] | Record<string, string>): string[] {
  return Array.isArray(values) ? values : Object.keys(values);
}

/** The formula with `{dim}` replaced for one combination of coordinates of the output's `for` dimensions. */
function substitute(output: AggregateOutput, combo: string[]): string {
  const dims = Object.entries(output.for);
  return output.value.replace(/\{(\w+)\}/g, (match, dim: string) => {
    const i = dims.findIndex(([name]) => name === dim);
    if (i < 0) throw new Error(`${match} is not a dimension of for`);
    const values = dims[i]![1];
    return Array.isArray(values) ? combo[i]! : values[combo[i]!]!;
  });
}

function outputSpecs(model: AggregateModel): Record<string, OutputSpec> {
  return Object.fromEntries(
    Object.entries(model.outputs).map(([port, output]) => [
      port,
      { dims: [...(model.by ? [model.by] : []), ...Object.keys(output.for)], unit: output.unit, description: output.description },
    ]),
  );
}

function check(node: PipelineNode, model: AggregateModel): Issue[] {
  const issues: Issue[] = [];
  const where = node.id;
  if (!(model.rows in node.inputs)) issues.push({ severity: 'error', where, message: `rows: no input named ${model.rows}` });
  const overPort = model.over?.split('.')[0];
  if (overPort && !(overPort in node.inputs)) issues.push({ severity: 'error', where, message: `over: no input named ${overPort}` });
  const formulas = [
    ...(model.where ? [model.where] : []),
    ...Object.values(model.outputs).flatMap((output) => [...cartesian(Object.values(output.for).map(coordinatesOf))].map((combo) => substitute(output, combo))),
  ];
  for (const formula of formulas) {
    try {
      parseExpression(formula);
    } catch (error) {
      issues.push({ severity: 'error', where, message: error instanceof Error ? error.message : String(error) });
    }
  }
  for (const formula of [model.where ?? '', ...Object.values(model.outputs).map((o) => o.value)]) {
    for (const literal of numericLiterals(formula)) {
      issues.push({ severity: 'error', where, message: `Literal ${literal} in ${formula}: declare it as an input backed by a dataset` });
    }
  }
  return issues;
}

function describe(node: PipelineNode, model: AggregateModel): ModelDescription {
  const rows = node.inputs[model.rows] ?? model.rows;
  const over = model.over && (node.inputs[model.over.split('.')[0]!] ?? model.over);
  const scope = [
    `Over the rows of ${rows}`,
    model.where ? ` where ${model.where}` : '',
    model.by ? `, per ${model.by}` : '',
    over ? ` in the order of ${over}` : '',
  ].join('');
  return {
    variables: [
      ...Object.keys(node.inputs).map((name) => ({ name, kind: 'aux' as const, role: 'input' as const, dims: [], equation: '' })),
      ...Object.entries(model.outputs).map(([name, output]) => ({
        name,
        kind: 'aux' as const,
        role: 'output' as const,
        dims: [...(model.by ? [model.by] : []), ...Object.keys(output.for)],
        equation: output.value,
        description: [output.description, scope, ...Object.entries(output.for).map(([dim, values]) => forText(dim, values))]
          .flatMap((text) => (text ? [text.replace(/\.$/, '')] : []))
          .join('. ')
          .concat('.'),
        units: output.unit,
        dependsOn: namesOf(output),
      })),
    ],
  };
}

function namesOf(output: AggregateOutput): string[] {
  try {
    const first = [...cartesian(Object.values(output.for).map(coordinatesOf))][0]!;
    return [...new Set(namesIn(parseExpression(substitute(output, first))))];
  } catch {
    return [];
  }
}

function forText(dim: string, values: string[] | Record<string, string>): string {
  if (Array.isArray(values)) return `For each ${dim}: ${values.join(', ')}`;
  return `For each ${dim}: ${Object.entries(values)
    .map(([coord, text]) => (coord === text ? coord : `${coord} = ${text}`))
    .join(', ')}`;
}
