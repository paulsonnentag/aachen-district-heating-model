import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadIndex, resolvePipeline, scopedReader, type PipelineEntry } from '../runtime/load';
import { runPipeline, type RunResult } from '../runtime/run';
import { createSemantics } from '.';
import { formatResult, type KeptResult } from './kept';
import { cachedDownload, nodePythonHost } from './python/node';

const root = join(import.meta.dirname, '../../pipelines');
const readText = (path: string) => readFile(join(root, path), 'utf8');
const entries = await loadIndex(readText);
const update = process.env.UPDATE_SNAPSHOTS === '1';

const snapshotted = entries.flatMap((entry) =>
  resolvePipeline(entry)
    .nodes.filter((node) => typeof node.model === 'object' && 'snapshot' in node.model)
    .map((node) => [`${entry.dir}/${node.id}`, entry, node.id, `${entry.dir}/${(node.model as { snapshot: string }).snapshot}`] as const),
);

const runs = new Map<string, Promise<{ result: RunResult; written: KeptResult[] }>>();

/** Snapshots spare readers a minute of downloads and Python; run with UPDATE_SNAPSHOTS=1 to recompute them. */
describe.each(snapshotted)('node %s', (_, entry, nodeId, snapshotPath) => {
  it(update ? 'recomputes its snapshot' : 'has a snapshot made from the current code and inputs', async () => {
    const { result, written } = await runOnce(entry);
    const node = result.nodes.get(nodeId)!;
    if (update) {
      expect({ status: node.status, error: node.error }).toEqual({ status: 'ok', error: undefined });
      if (node.cache?.origin === 'snapshot') return;
      const fresh = written.find((r) => r.key === node.key)!;
      await mkdir(dirname(join(root, snapshotPath)), { recursive: true });
      await writeFile(join(root, snapshotPath), formatResult(fresh));
      return;
    }
    expect({ status: node.status, error: node.error, origin: node.cache?.origin }).toEqual({ status: 'ok', error: undefined, origin: 'snapshot' });
  }, 900_000);
});

function runOnce(entry: PipelineEntry): Promise<{ result: RunResult; written: KeptResult[] }> {
  let run = runs.get(entry.path);
  if (!run) {
    run = (async () => {
      const written: KeptResult[] = [];
      const host = nodePythonHost();
      const stale = () => Promise.reject(new Error('Snapshot is stale: run UPDATE_SNAPSHOTS=1 npx vitest run lib/semantics/snapshot.test.ts'));
      const semantics = createSemantics({
        ...host,
        run: update ? host.run : stale,
        store: { get: async () => undefined, put: async (result) => void written.push(result) },
      });
      const result = await runPipeline(resolvePipeline(entry), semantics, scopedReader(readText, entry.dir), update ? cachedDownload : stale);
      if (update) for (const node of result.nodes.values()) if (node.status === 'idle') await node.compute?.(() => {});
      return { result, written };
    })();
    runs.set(entry.path, run);
  }
  return run;
}
