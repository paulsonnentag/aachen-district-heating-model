import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { PyodideAPI } from 'pyodide';
import type { RemoteFile } from '../../runtime/datasets';
import { sha256Hex } from '../../runtime/hash';
import type { PythonHost } from './index';
import { PYODIDE_VERSION, runInPyodide } from './pyodide';

const DOWNLOADS = join(import.meta.dirname, '../../../.cache/downloads');

/** Runs Python nodes in-process with the Pyodide npm package, the same runtime the browser uses. */
export function nodePythonHost(downloads = DOWNLOADS): PythonHost {
  let pyodide: Promise<PyodideAPI> | undefined;
  return {
    runtime: `Pyodide ${PYODIDE_VERSION}`,
    async run(job, onLog) {
      pyodide ??= import('pyodide').then(({ loadPyodide }) => loadPyodide());
      return runInPyodide(await pyodide, job, onLog, (file, log) => cachedDownload(file, downloads, log));
    },
  };
}

/** Downloads are kept by content hash, so a changed file upstream is noticed rather than silently used. */
async function cachedDownload(file: RemoteFile, downloads: string, onLog: (line: string) => void): Promise<Uint8Array> {
  const path = join(downloads, file.sha256);
  const cached = await readFile(path).catch(() => undefined);
  if (cached) return new Uint8Array(cached.buffer, cached.byteOffset, cached.byteLength);
  onLog(`Downloading ${file.url}`);
  const response = await fetch(file.url);
  if (!response.ok) throw new Error(`Download failed (${response.status}): ${file.url}`);
  const bytes = new Uint8Array(await response.arrayBuffer());
  const hash = await sha256Hex(bytes);
  if (hash !== file.sha256) throw new Error(`${file.url} changed upstream: expected sha256 ${file.sha256}, got ${hash}`);
  await mkdir(downloads, { recursive: true });
  await writeFile(`${path}.part`, bytes);
  await rename(`${path}.part`, path);
  return bytes;
}
