import { describe, expect, it } from 'vitest';
import { reduceExcept, select, type Tensor } from './tensor';

const t: Tensor = {
  dims: ['year', 'cell', 'tech'],
  coords: [['2022', '2023'], ['a', 'b', 'c'], ['gas', 'hp']],
  values: Float64Array.from({ length: 12 }, (_, i) => i),
  unit: 'buildings',
};

describe('reduceExcept', () => {
  it('sums or averages over the dimensions not kept, keeping their order', () => {
    expect([...reduceExcept(t, ['tech', 'year'], 'sum').values]).toEqual([0 + 2 + 4, 1 + 3 + 5, 6 + 8 + 10, 7 + 9 + 11]);
    expect([...reduceExcept(t, ['cell'], 'mean').values]).toEqual([(0 + 1 + 6 + 7) / 4, (2 + 3 + 8 + 9) / 4, (4 + 5 + 10 + 11) / 4]);
    expect(reduceExcept(t, [], 'sum').values[0]).toBe(66);
  });
});

describe('select', () => {
  it('fixes dimensions and keeps the rest', () => {
    const slice = select(t, { year: '2023', tech: 'hp' });
    expect(slice.dims).toEqual(['cell']);
    expect([...slice.values]).toEqual([7, 9, 11]);
    expect([...select(t, { cell: 'b' }).values]).toEqual([2, 3, 8, 9]);
  });

  it('rejects unknown coordinates', () => {
    expect(() => select(t, { tech: 'oil' })).toThrow(/No coordinate tech=oil/);
  });
});
