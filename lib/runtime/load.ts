import { IndexSchema, PipelineSchema, ScenarioSchema, type Pipeline, type PipelineIndex, type Scenario } from './pipeline';
import type { ReadText } from './datasets';

export type PipelineEntry = {
  path: string;
  dir: string;
  raw: unknown;
  title: string;
  scenarios: ScenarioEntry[];
};

export type ScenarioEntry = { path: string; scenario: Scenario };

export async function loadIndex(readText: ReadText): Promise<PipelineEntry[]> {
  const index: PipelineIndex = IndexSchema.parse(JSON.parse(await readText('index.json')));
  return Promise.all(
    index.pipelines.map(async ({ path, scenarios }) => {
      const raw: unknown = JSON.parse(await readText(path));
      return {
        path,
        dir: dirname(path),
        raw,
        title: titleOf(raw, path),
        scenarios: await Promise.all(
          scenarios.map(async (p) => ({ path: p, scenario: ScenarioSchema.parse(JSON.parse(await readText(p))) })),
        ),
      };
    }),
  );
}

/** Applies an optional scenario (RFC 7386 merge patch) and validates the result. */
export function resolvePipeline(entry: PipelineEntry, scenario?: Scenario): Pipeline {
  const raw = scenario ? mergePatch(entry.raw, scenario.patch) : entry.raw;
  return PipelineSchema.parse(raw);
}

export function scopedReader(readText: ReadText, dir: string): ReadText {
  return (path) => readText(dir ? `${dir}/${path}` : path);
}

export function mergePatch(target: unknown, patch: unknown): unknown {
  if (!isObject(patch)) return patch;
  const result: Record<string, unknown> = isObject(target) ? { ...target } : {};
  for (const [key, value] of Object.entries(patch)) {
    if (value === null) delete result[key];
    else result[key] = mergePatch(result[key], value);
  }
  return result;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function dirname(path: string): string {
  const i = path.lastIndexOf('/');
  return i < 0 ? '' : path.slice(0, i);
}

function titleOf(raw: unknown, fallback: string): string {
  return isObject(raw) && typeof raw.title === 'string' ? raw.title : fallback;
}
