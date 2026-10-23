import type { PyodideAPI } from 'pyodide';
import { PYODIDE_CDN, runInPyodide, type PythonJob } from '../../lib/semantics/python/pyodide';
import { download } from './download';

export type WorkerRequest = { id: number; job: PythonJob };
export type WorkerReply =
  | { id: number; kind: 'log'; line: string }
  | { id: number; kind: 'done'; outputs: Record<string, unknown>; log: string[] }
  | { id: number; kind: 'error'; message: string };

let pyodide: Promise<PyodideAPI> | undefined;

self.onmessage = async (event: MessageEvent<WorkerRequest>) => {
  const { id, job } = event.data;
  const reply = (message: WorkerReply) => self.postMessage(message);
  try {
    pyodide ??= loadFromCdn();
    const run = await runInPyodide(await pyodide, job, (line) => reply({ id, kind: 'log', line }), download);
    reply({ id, kind: 'done', ...run });
  } catch (error) {
    reply({ id, kind: 'error', message: error instanceof Error ? error.message : String(error) });
  }
};

async function loadFromCdn(): Promise<PyodideAPI> {
  const { loadPyodide } = (await import(/* @vite-ignore */ `${PYODIDE_CDN}pyodide.mjs`)) as typeof import('pyodide');
  return loadPyodide({ indexURL: PYODIDE_CDN });
}
