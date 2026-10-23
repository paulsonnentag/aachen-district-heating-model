import { loadIndex, type PipelineEntry } from '../lib/runtime/load';
import { createRunCache } from '../lib/runtime/runs';
import { createSemantics } from '../lib/semantics';
import { browserPythonHost } from '../app/python/host';

/** The pipelines are served from the root, exactly as for the workbench app. */
export const readText = async (path: string): Promise<string> => {
  const response = await fetch(`${import.meta.env.BASE_URL}${path}`);
  if (!response.ok) throw new Error(`Could not load ${path} (${response.status})`);
  return response.text();
};

export const runOf = createRunCache(readText, createSemantics(browserPythonHost()));

let index: Promise<PipelineEntry[]> | undefined;

export function findEntry(dir: string): Promise<PipelineEntry> {
  index ??= loadIndex(readText);
  return index.then((entries) => {
    const entry = entries.find((e) => e.dir === dir);
    if (!entry) throw new Error(`No pipeline in ${dir}`);
    return entry;
  });
}
