import type { ReadText } from './datasets';
import { resolvePipeline, scopedReader, type PipelineEntry } from './load';
import { runPipeline, type RunResult } from './run';
import type { Semantics } from '../semantics/types';

export const BASELINE = 'baseline';

export type RunOf = (entry: PipelineEntry, scenario: string) => Promise<RunResult>;

/** Runs each pipeline once per scenario name (or `BASELINE`) and hands out the same result afterwards. */
export function createRunCache(readText: ReadText, semantics: Record<string, Semantics>): RunOf {
  const cache = new Map<string, Promise<RunResult>>();
  return (entry, scenario) => {
    const key = `${entry.path}#${scenario}`;
    let run = cache.get(key);
    if (!run) {
      run = start(entry, scenario);
      cache.set(key, run);
    }
    return run;
  };

  async function start(entry: PipelineEntry, scenario: string): Promise<RunResult> {
    const patch = scenario === BASELINE ? undefined : entry.scenarios.find((s) => s.name === scenario)?.scenario;
    if (scenario !== BASELINE && !patch) {
      const known = [BASELINE, ...entry.scenarios.map((s) => s.name)].join(', ');
      throw new Error(`Unknown scenario "${scenario}" (known: ${known})`);
    }
    return runPipeline(resolvePipeline(entry, patch), semantics, scopedReader(readText, entry.dir));
  }
}
