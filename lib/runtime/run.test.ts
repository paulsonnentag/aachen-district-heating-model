import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { loadIndex, mergePatch, resolvePipeline, scopedReader, type PipelineEntry } from './load';
import { runPipeline, type RunResult } from './run';
import { coordsOf, get, sumExcept, type Tensor } from './tensor';
import { semantics } from '../semantics';

const root = join(import.meta.dirname, '../../pipelines');
const readText = (path: string) => readFile(join(root, path), 'utf8');

describe('housing pipeline', () => {
  it('runs without issues and keeps every node ok', async () => {
    const result = await runEntry(await entry('housing/pipeline.json'));
    expectClean(result);
  });

  it('conserves dwellings: total stock = free + social', async () => {
    const result = await runEntry(await entry('housing/pipeline.json'));
    const free = tensor(result, 'stock_free');
    const social = tensor(result, 'stock_social');
    const total = tensor(result, 'total_stock');
    for (const year of ['2022', '2030', '2040']) {
      expect(get(total, { year })).toBeCloseTo(get(free, { year }) + get(social, { year }), 6);
    }
    expect(get(total, { year: '2022' })).toBe(140000);
  });

  it('degenerate case: quota 0 sends every completion to the free segment', async () => {
    const housing = await entry('housing/pipeline.json');
    const noQuota = housing.scenarios.find((s) => s.path.endsWith('no-quota.json'))!.scenario;
    const result = await runEntry(housing, noQuota);
    expectClean(result);
    const social = tensor(result, 'stock_social');
    const free = tensor(result, 'stock_free');
    const completions = tensor(result, 'completions');
    // Social only changes by funded additions, expiry and demolition, never by completions.
    const s0 = get(social, { year: '2022' });
    expect(get(social, { year: '2023' })).toBeCloseTo(s0 + 318 - 1000 - 0.002 * s0, 6);
    const f0 = get(free, { year: '2022' });
    expect(get(free, { year: '2023' })).toBeCloseTo(f0 + get(completions, { year: '2022' }) + 1000 - 0.002 * f0, 6);
  });

  it('rejects a dataset whose unit does not match the model', async () => {
    const housing = await entry('housing/pipeline.json');
    const result = await runEntry(housing, { label: 'bad unit', patch: { datasets: { cap_rate: { unit: 'dmnl' } } } });
    const node = result.nodes.get('housing_market')!;
    expect(node.status).toBe('error');
    expect(node.error).toMatch(/unit "dmnl" does not match model unit "1\/year"/);
  });
});

describe('heat transition pipeline', () => {
  let baseline: RunResult;
  beforeAll(async () => {
    baseline = await runEntry(await entry('heat-transition/pipeline.json'));
  });

  it('runs without issues and keeps every node ok', () => {
    expectClean(baseline);
  });

  it('starts at the demand-weighted district heating share of the census cells', () => {
    const stock = tensor(baseline, 'heating_stock_2022');
    const demand = tensor(baseline, 'heat_demand');
    const buildings = sumExcept(stock, ['cell']);
    let connected = 0;
    let covered = 0;
    for (const cell of coordsOf(stock, 'cell')!) {
      const total = get(buildings, { cell });
      if (total === 0) continue;
      const d = get(demand, { cell, year: '2022' });
      connected += (d * get(stock, { cell, tech: 'dh' })) / total;
      covered += d;
    }
    expect(get(tensor(baseline, 'dh_heat_share'), { year: '2022' })).toBeCloseTo(connected / covered, 9);
  });

  it('conserves buildings per cell: installs replace exactly what was replaced', () => {
    const perCell = sumExcept(tensor(baseline, 'heating_stock'), ['year', 'cell']);
    const initial = sumExcept(tensor(baseline, 'heating_stock_2022'), ['cell']);
    for (const cell of coordsOf(perCell, 'cell')!) {
      expect(get(perCell, { year: '2045', cell })).toBeCloseTo(get(initial, { cell }), 6);
    }
  });

  it('gives every technology an initial age distribution that sums to one', () => {
    const perTech = sumExcept(tensor(baseline, 'initial_age_share'), ['tech']);
    for (const tech of coordsOf(perTech, 'tech')!) expect(get(perTech, { tech })).toBeCloseTo(1, 9);
  });

  it('keeps gas in the choice set under the Bio-Treppe but not under the 2024 rule', async () => {
    const heat = await entry('heat-transition/pipeline.json');
    const rule = heat.scenarios.find((s) => s.path.endsWith('geg-2024-rule.json'))!.scenario;
    const counterfactual = await runEntry(heat, rule);
    expectClean(counterfactual);
    const fossilInstalls = (result: RunResult, year: string) => {
      const byTech = sumExcept(tensor(result, 'installs'), ['year', 'tech']);
      return get(byTech, { year, tech: 'gas' }) + get(byTech, { year, tech: 'oil' });
    };
    expect(fossilInstalls(baseline, '2030')).toBeGreaterThan(0);
    expect(fossilInstalls(counterfactual, '2026')).toBeGreaterThan(0);
    expect(fossilInstalls(counterfactual, '2027')).toBe(0);
  });

  it('runs every scenario', async () => {
    const heat = await entry('heat-transition/pipeline.json');
    for (const { scenario } of heat.scenarios) expectClean(await runEntry(heat, scenario));
  });
});

describe('provenance rule', () => {
  it('rejects literal numbers inside model equations', async () => {
    const housing = await entry('housing/pipeline.json');
    const result = await runEntry(housing, {
      label: 'literal',
      patch: {
        nodes: [
          {
            id: 'calc',
            label: 'calc',
            semantics: 'equation',
            model: { variables: { y: { equation: 'total_stock * 1.05', units: 'dwellings' } } },
            inputs: { total_stock: 'total_stock' },
            outputs: { y: 'y' },
          },
        ],
      },
    });
    expect(result.issues.map((i) => i.message)).toContain('Literal 1.05 in equation: declare it as an input backed by a dataset');
  });
});

describe('mergePatch', () => {
  it('merges objects, replaces arrays and deletes nulls', () => {
    expect(mergePatch({ a: { b: 1, c: 2 }, d: [1] }, { a: { b: 3, c: null }, d: [2] })).toEqual({ a: { b: 3 }, d: [2] });
  });
});

async function entry(path: string): Promise<PipelineEntry> {
  const entries = await loadIndex(readText);
  return entries.find((e) => e.path === path)!;
}

async function runEntry(entry: PipelineEntry, scenario?: Parameters<typeof resolvePipeline>[1]): Promise<RunResult> {
  return runPipeline(resolvePipeline(entry, scenario), semantics, scopedReader(readText, entry.dir));
}

function expectClean(result: RunResult): void {
  expect(result.issues.filter((i) => i.severity === 'error')).toEqual([]);
  for (const [, node] of result.nodes) expect({ id: node.node.id, status: node.status, error: node.error }).toEqual({ id: node.node.id, status: 'ok', error: undefined });
  for (const [name, dataset] of result.datasets) expect({ name, error: dataset.error }).toEqual({ name, error: undefined });
}

function tensor(result: RunResult, name: string): Tensor {
  const t = result.datasets.get(name)?.tensor;
  if (!t) throw new Error(`No tensor for ${name}`);
  return t;
}
