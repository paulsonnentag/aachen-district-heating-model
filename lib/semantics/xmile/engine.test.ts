import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { get, type Tensor } from '../../runtime/tensor';
import { parseXmile } from './document';
import { checkModel, simulate } from './engine';

const fixtures = join(import.meta.dirname, 'fixtures');

describe('agreement with Simlin', () => {
  // Reference series produced by the Simlin CLI (github.com/bpowers/simlin, commit 3f87e90).
  it.each(['builtins', 'heat-bench'])('%s matches every Simlin series', (name) => {
    const model = parseXmile(readFileSync(join(fixtures, `${name}.xmile`), 'utf8'));
    const results = simulate(model, {}, model.variables.map((v) => v.name)).outputs;
    const reference = readTsv(join(fixtures, `${name}.simlin.tsv`));
    let compared = 0;
    for (const [column, values] of reference.columns) {
      const match = /^([a-z0-9_]+)(?:\[(.*)\])?$/.exec(column);
      const tensor = match && results[match[1]!];
      if (!tensor) continue;
      const at = Object.fromEntries((match[2]?.split(',') ?? []).map((element, k) => [tensor.dims[k + 1]!, element]));
      values.forEach((expected, step) => {
        const actual = get(tensor, { ...at, year: String(reference.time[step]) });
        expect(Math.abs(actual - expected), `${column} at ${reference.time[step]}`).toBeLessThanOrEqual(1e-9 * Math.max(1, Math.abs(expected)));
        compared++;
      });
    }
    expect(compared).toBeGreaterThan(100);
  });
});

describe('input binding', () => {
  const model = parseXmile(`<xmile xmlns="http://docs.oasis-open.org/xmile/ns/XMILE/v1.0">
    <sim_specs method="Euler"><start>2020</start><stop>2024</stop><dt>1</dt></sim_specs>
    <dimensions><dim name="cell"/></dimensions>
    <model><variables>
      <aux name="demand" access="input"><dimensions><dim name="cell"/></dimensions><eqn>0</eqn><units>MWh</units></aux>
      <aux name="price" access="input"><eqn>0</eqn><units>EUR/MWh</units></aux>
      <aux name="bill" access="output"><dimensions><dim name="cell"/></dimensions><eqn>demand * price</eqn><units>EUR</units></aux>
    </variables></model>
  </xmile>`);
  const demand: Tensor = { dims: ['cell'], coords: [['a', 'b', 'c']], values: Float64Array.of(1, 2, 3), unit: 'MWh' };
  const price: Tensor = { dims: ['year'], coords: [['2020', '2022']], values: Float64Array.of(10, 30), unit: 'EUR/MWh' };

  it('takes the elements of an undeclared dimension from the input data', () => {
    const { bill } = simulate(model, { demand, price }).outputs;
    expect(bill!.coords[1]).toEqual(['a', 'b', 'c']);
    expect(get(bill!, { year: '2020', cell: 'c' })).toBe(30);
  });

  it('interpolates input time series between years and holds them outside', () => {
    const { bill } = simulate(model, { demand, price }).outputs;
    expect(get(bill!, { year: '2021', cell: 'a' })).toBe(20);
    expect(get(bill!, { year: '2024', cell: 'a' })).toBe(30);
  });

  it('rejects a dataset with the wrong unit or dimensions', () => {
    expect(() => simulate(model, { demand, price: { ...price, unit: 'EUR' } })).toThrow(/unit "EUR" does not match/);
    expect(() => simulate(model, { demand: { ...demand, dims: ['street'] }, price })).toThrow(/dims \[street\] do not match/);
  });
});

describe('structural checks', () => {
  it('reports unknown names, unsupported functions and syntax errors before running', () => {
    const model = parseXmile(`<xmile xmlns="http://docs.oasis-open.org/xmile/ns/XMILE/v1.0">
      <sim_specs method="RK4"><start>0</start><stop>1</stop><dt>1</dt></sim_specs>
      <model><variables>
        <aux name="a"><eqn>missing + 1</eqn></aux>
        <aux name="b"><eqn>SMTH1(a, 1)</eqn></aux>
        <aux name="c"><eqn>a +</eqn></aux>
      </variables></model>
    </xmile>`);
    expect(checkModel(model).map((i) => i.message)).toEqual([
      'Integration method rk4 is not supported; use Euler',
      'Unknown variable missing',
      'Unsupported function SMTH1',
      'unexpected end of equation in "a +"',
    ]);
  });

  it('rejects circular equations that do not pass through a stock', () => {
    const model = parseXmile(`<xmile xmlns="http://docs.oasis-open.org/xmile/ns/XMILE/v1.0">
      <sim_specs><start>0</start><stop>1</stop><dt>1</dt></sim_specs>
      <model><variables><aux name="a"><eqn>b</eqn></aux><aux name="b"><eqn>a</eqn></aux></variables></model>
    </xmile>`);
    expect(() => simulate(model, {}, ['a'])).toThrow(/Circular equations without a stock: a → b → a/);
  });
});

function readTsv(path: string): { time: number[]; columns: Map<string, number[]> } {
  const [header, ...rows] = readFileSync(path, 'utf8').trim().split('\n').map((line) => line.split('\t'));
  const columns = new Map(header!.map((name, c) => [name, rows.map((row) => Number(row[c]))]));
  return { time: columns.get('time')!, columns };
}
