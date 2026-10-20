import { provenanceKind, type Pipeline, type Source } from '../runtime/pipeline';
import type { RunResult } from '../runtime/run';
import { BASELINE } from '../runtime/runs';
import { coordsOf, reduceExcept, reduction, select, type Tensor } from '../runtime/tensor';
import { FORMATS, formatStoryValue, isFormat } from './format';

/**
 * A story embeds model results with custom HTML elements:
 *
 *   <model-value dataset="dh_heat_share" year="2045" format="percent">23%</model-value>
 *   <model-value dataset="dh_heat_share" year="2045" scenario="network-delay" minus="baseline" format="pp">…</model-value>
 *   <model-figure dataset="installs" scenario="geg-2024-rule">Caption</model-figure>
 *   <model-figure dataset="dh_network_cost" year="2030" view="map">Caption</model-figure>
 *   <model-claim dataset="dh_target_gap" year="2045" below="0" expect="fails">Hypothesis text</model-claim>
 *   <model-assumptions dataset="dh_heat_share"></model-assumptions>
 *   <model-link node="heat_turnover" open>Link text</model-link>
 *   <model-source ref="aachen_heat_plan">Link text</model-source>
 *
 * Every attribute that is not reserved fixes a coordinate (cell, tech, year, …). Dimensions left
 * free are summed for amounts and averaged for intensities, as in the graph previews.
 * A claim states a hypothesis; `expect` says which verdict the surrounding text relies on.
 */
export const STORY_TAGS = ['model-value', 'model-figure', 'model-claim', 'model-assumptions', 'model-link', 'model-source'] as const;

export type StoryTag = (typeof STORY_TAGS)[number];

export type StoryElement = { tag: string; attrs: Record<string, string> };

/** Runs of one pipeline by scenario name, `BASELINE` included. */
export type ScenarioRuns = (scenario: string) => Promise<RunResult>;

export type DataRef = { dataset: string; scenario: string; at: Record<string, string> };

export type StoryValue = { ref: DataRef; value: number; text: string; description: string };

export type StoryFigure = { ref: DataRef; view: 'chart' | 'map'; tensor: Tensor; baseline?: Tensor };

export type StoryClaim = {
  ref: DataRef;
  holds: boolean;
  expected: boolean;
  left: number;
  right: number;
  relation: 'below' | 'above';
  description: string;
};

export type StoryAssumptions = { ref: DataRef; inputs: UpstreamInput[] };

export type UpstreamInput = { dataset: string; kind: 'sourced' | 'derived' | 'assumption'; text: string };

export type StoryLink = { scenario: string; dataset?: string; node?: string; open: boolean };

export type StorySource = Source & { ref: string };

const RESERVED = new Set(['dataset', 'node', 'scenario', 'minus', 'format', 'below', 'above', 'expect', 'view', 'open']);

/** Resolves an element and throws if it refers to something missing or, for claims, if the verdict differs from `expect`. */
export async function checkElement(element: StoryElement, runs: ScenarioRuns): Promise<void> {
  switch (element.tag) {
    case 'model-value':
      await storyValue(element.attrs, runs);
      return;
    case 'model-figure':
      await storyFigure(element.attrs, runs);
      return;
    case 'model-claim': {
      const claim = await storyClaim(element.attrs, runs);
      if (claim.holds !== claim.expected) {
        throw new Error(`Claim ${claim.holds ? 'holds' : 'fails'} but the text expects it to ${claim.expected ? 'hold' : 'fail'}: ${claim.description}`);
      }
      return;
    }
    case 'model-assumptions':
      await storyAssumptions(element.attrs, runs);
      return;
    case 'model-link':
      await storyLink(element.attrs, runs);
      return;
    case 'model-source':
      await storySource(element.attrs, runs);
      return;
    default:
      throw new Error(`Unknown element <${element.tag}>`);
  }
}

export async function storyValue(attrs: Record<string, string>, runs: ScenarioRuns): Promise<StoryValue> {
  const ref = dataRefOf(attrs);
  const format = attrs.format ?? 'number';
  if (!isFormat(format)) throw new Error(`format="${format}" must be one of ${FORMATS.join(', ')}`);
  const own = scalarOf(await runs(ref.scenario), ref);
  if (attrs.minus === undefined) return { ref, ...own, text: formatStoryValue(own.value, format, false) };
  const other = scalarOf(await runs(attrs.minus), ref);
  const value = own.value - other.value;
  return { ref, value, text: formatStoryValue(value, format, true), description: `${own.description} minus ${attrs.minus}` };
}

export async function storyFigure(attrs: Record<string, string>, runs: ScenarioRuns): Promise<StoryFigure> {
  const ref = dataRefOf(attrs);
  const view = attrs.view ?? 'chart';
  if (view !== 'chart' && view !== 'map') throw new Error(`view="${view}" must be "chart" or "map"`);
  const tensor = selectAt(tensorOf(await runs(ref.scenario), ref.dataset), ref);
  if (view === 'map' && !tensor.dims.some((d) => d !== 'year')) throw new Error(`"${ref.dataset}" has no cell dimension left to map`);
  if (ref.scenario === BASELINE) return { ref, view, tensor };
  return { ref, view, tensor, baseline: selectAt(tensorOf(await runs(BASELINE), ref.dataset), ref) };
}

export async function storyClaim(attrs: Record<string, string>, runs: ScenarioRuns): Promise<StoryClaim> {
  const ref = dataRefOf(attrs);
  const relation = attrs.below !== undefined ? 'below' : 'above';
  const against = attrs[relation];
  if (against === undefined || (attrs.below !== undefined && attrs.above !== undefined)) {
    throw new Error('A claim needs exactly one of below="…" or above="…"');
  }
  const expect = attrs.expect ?? 'holds';
  if (expect !== 'holds' && expect !== 'fails') throw new Error(`expect="${expect}" must be "holds" or "fails"`);
  const left = scalarOf(await runs(ref.scenario), ref);
  const right = isNumber(against) ? Number(against) : scalarOf(await runs(against), ref).value;
  const holds = relation === 'below' ? left.value < right : left.value > right;
  const threshold = isNumber(against) ? against : `${against} (${right})`;
  return {
    ref,
    holds,
    expected: expect === 'holds',
    left: left.value,
    right,
    relation,
    description: `${left.description} = ${left.value}, ${relation} ${threshold}`,
  };
}

export async function storyAssumptions(attrs: Record<string, string>, runs: ScenarioRuns): Promise<StoryAssumptions> {
  const ref = dataRefOf(attrs);
  const run = await runs(ref.scenario);
  tensorOf(run, ref.dataset);
  const order = { assumption: 0, derived: 1, sourced: 2 };
  const inputs = upstreamInputs(run.pipeline, ref.dataset).sort((a, b) => order[a.kind] - order[b.kind] || a.dataset.localeCompare(b.dataset));
  return { ref, inputs };
}

export async function storyLink(attrs: Record<string, string>, runs: ScenarioRuns): Promise<StoryLink> {
  const scenario = attrs.scenario ?? BASELINE;
  const run = await runs(scenario);
  if (attrs.dataset !== undefined) tensorOf(run, attrs.dataset);
  if (attrs.node !== undefined && !run.nodes.has(attrs.node)) throw new Error(`Unknown node "${attrs.node}"`);
  if ((attrs.dataset === undefined) === (attrs.node === undefined)) throw new Error('A link needs exactly one of dataset="…" or node="…"');
  return { scenario, dataset: attrs.dataset, node: attrs.node, open: attrs.open !== undefined };
}

/** A source from the pipeline's catalog, so every URL lives in one place with its verification status. */
export async function storySource(attrs: Record<string, string>, runs: ScenarioRuns): Promise<StorySource> {
  if (!attrs.ref) throw new Error('Missing ref="…"');
  const source = (await runs(BASELINE)).pipeline.sources[attrs.ref];
  if (!source) throw new Error(`Unknown source "${attrs.ref}"`);
  return { ...source, ref: attrs.ref };
}

function dataRefOf(attrs: Record<string, string>): DataRef {
  if (!attrs.dataset) throw new Error('Missing dataset="…"');
  const at = Object.fromEntries(Object.entries(attrs).filter(([name]) => !RESERVED.has(name)));
  return { dataset: attrs.dataset, scenario: attrs.scenario ?? BASELINE, at };
}

function scalarOf(run: RunResult, ref: DataRef): { value: number; description: string } {
  const tensor = tensorOf(run, ref.dataset);
  const selected = selectAt(tensor, ref);
  if (selected.dims.includes('year')) throw new Error(`Fix year="…" to read a single value of "${ref.dataset}"`);
  const mode = reduction(tensor);
  const value = reduceExcept(selected, [], mode).values[0]!;
  const fixed = Object.entries(ref.at).map(([dim, coord]) => `${dim}=${coord}`);
  const combined = selected.dims.map((d) => `${coordsOf(selected, d)!.length} ${d}`);
  const parts = [ref.dataset, ...fixed, ...(combined.length ? [`${mode === 'sum' ? 'Σ over' : 'mean of'} ${combined.join(' × ')}`] : []), ref.scenario];
  return { value, description: parts.join(' · ') };
}

function tensorOf(run: RunResult, dataset: string): Tensor {
  const result = run.datasets.get(dataset);
  if (!result) throw new Error(`Unknown dataset "${dataset}"`);
  if (!result.tensor) throw new Error(`Dataset "${dataset}" was not computed${result.error ? `: ${result.error}` : ''}`);
  return result.tensor;
}

function selectAt(tensor: Tensor, ref: DataRef): Tensor {
  for (const dim of Object.keys(ref.at)) {
    if (!tensor.dims.includes(dim)) {
      throw new Error(`"${ref.dataset}" has no dimension "${dim}" (it has ${tensor.dims.join(', ') || 'none'})`);
    }
  }
  return select(tensor, ref.at);
}

/** Catalog datasets that feed `dataset`, directly or through nodes, with how each is backed. */
function upstreamInputs(pipeline: Pipeline, dataset: string): UpstreamInput[] {
  const producers = new Map(pipeline.nodes.flatMap((node) => Object.values(node.outputs).map((out) => [out, node] as const)));
  const seen = new Set<string>();
  const pending = [dataset];
  while (pending.length > 0) {
    const name = pending.pop()!;
    if (seen.has(name)) continue;
    seen.add(name);
    const node = producers.get(name);
    if (node) pending.push(...Object.values(node.inputs));
  }
  return [...seen].flatMap((name) => {
    const entry = pipeline.datasets[name];
    if (!entry) return [];
    const source = entry.source;
    const text = 'assumption' in source ? source.assumption : 'method' in source ? source.method : source.locator;
    return [{ dataset: name, kind: provenanceKind(source), text }];
  });
}

function isNumber(text: string): boolean {
  return text.trim() !== '' && Number.isFinite(Number(text));
}
