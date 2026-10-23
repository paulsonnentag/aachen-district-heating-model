import { describe, expect, it } from 'vitest';
import type { PipelineNode } from '../../runtime/pipeline';
import { tableFromColumns } from '../../runtime/table';
import { get, scalar } from '../../runtime/tensor';
import type { NodeInputs } from '../types';
import { createAggregateSemantics } from '.';

const buildings = tableFromColumns({
  cell: ['a', 'a', 'b', 'c', 'b'],
  residential: [true, true, true, false, false],
  demand: [10, 30, 20, 50, NaN],
  gas_2030: [1, 2, 3, 4, 5],
  gas_2045: [0, 1, null, 2, 3],
});
const cells = tableFromColumns({ cell: ['b', 'a', 'd'] });

describe('aggregate semantics', () => {
  it('filters, groups over a coordinate list and substitutes for dimensions', async () => {
    const { prepared, run } = await prepare({
      rows: 'buildings',
      where: 'residential and demand > 0',
      by: 'cell',
      over: 'cells.cell',
      outputs: {
        demand: { value: 'sum(demand) / per_unit', unit: 'MWh' },
        gas: { value: 'sum(total(gas_{year}))', unit: 'count', for: { year: { '2030': '2030', '2045': '2045' } } },
      },
    });
    expect(prepared.issues).toEqual([]);
    const result = await run({ tensors: { per_unit: scalar(10, '1') }, tables: { buildings, cells }, files: {} });
    const demand = result.outputs.demand!;
    expect(demand.dims).toEqual(['cell']);
    expect(get(demand, { cell: 'a' })).toBe(4);
    expect(get(demand, { cell: 'b' })).toBe(2);
    expect(get(demand, { cell: 'd' })).toBe(0);
    expect(get(result.outputs.gas!, { cell: 'b', year: '2045' })).toBe(0);
    expect(get(result.outputs.gas!, { cell: 'a', year: '2030' })).toBe(3);
  });

  it('fails on a group without a value instead of inventing one', async () => {
    const { run } = await prepare({ rows: 'buildings', by: 'cell', over: 'cells.cell', outputs: { mean: { value: 'mean(demand)', unit: 'kWh' } } });
    await expect(run({ tensors: {}, tables: { buildings, cells }, files: {} })).rejects.toThrow('no number for 1 of 3 values, e.g. d');
  });

  it('rejects literals and columns read outside a reduction', async () => {
    const { prepared, run } = await prepare({ rows: 'buildings', where: 'demand > 15', outputs: { x: { value: 'demand', unit: 'kWh' } } });
    expect(prepared.issues.map((i) => i.message)).toEqual(['Literal 15 in demand > 15: declare it as an input backed by a dataset']);
    await expect(run({ tensors: {}, tables: { buildings, cells }, files: {} })).rejects.toThrow('demand is read outside');
  });
});

async function prepare(model: Record<string, unknown>) {
  const node = { id: 'test', semantics: 'aggregate', model, inputs: { buildings: 'buildings', cells: 'cells', per_unit: 'per_unit' }, outputs: {} } as unknown as PipelineNode;
  const prepared = await createAggregateSemantics().prepare(node, async () => '');
  const run = (inputs: NodeInputs) => prepared.execute(inputs, { key: crypto.randomUUID(), fresh: true, onLog: () => {} });
  return { prepared, run };
}
