import type { PyodideAPI } from 'pyodide';
import type { RemoteFile } from '../../runtime/datasets';

export const PYODIDE_VERSION = '314.0.7';
export const PYODIDE_CDN = `https://cdn.jsdelivr.net/pyodide/v${PYODIDE_VERSION}/full/`;

export type PythonJob = {
  script: string;
  /** Shown in tracebacks. */
  path: string;
  /** The function to call, with one keyword argument per input. */
  entry: string;
  files: Record<string, RemoteFile>;
  /** JSON of the other inputs: tensors and tables. */
  values: string;
};

export type PythonRun = { outputs: Record<string, unknown>; log: string[] };

export type FetchFile = (file: RemoteFile, onLog: (line: string) => void) => Promise<Uint8Array>;

/** The script runs in a namespace of its own, so its `if __name__ == "__main__"` block stays inactive. */
const RUNNER = `
import json
namespace = {"__name__": "workbench_node", "__file__": path}
exec(compile(source, path, "exec"), namespace)
json.dumps(namespace[entry](**json.loads(paths), **json.loads(values)))
`;

/** Downloads stay in Pyodide's file system under their hash, so nodes reading the same file share one copy. */
const FILES = '/files';

let queue: Promise<unknown> = Promise.resolve();

/** Runs jobs one at a time, since they share the interpreter's stdout; scripts get the paths of their files. */
export function runInPyodide(pyodide: PyodideAPI, job: PythonJob, onLog: (line: string) => void, fetchFile: FetchFile): Promise<PythonRun> {
  const run = queue.then(() => runNow(pyodide, job, onLog, fetchFile));
  queue = run.catch(() => undefined);
  return run;
}

async function runNow(pyodide: PyodideAPI, job: PythonJob, onLog: (line: string) => void, fetchFile: FetchFile): Promise<PythonRun> {
  const log: string[] = [];
  const print = (line: string) => {
    log.push(line);
    onLog(line);
  };
  pyodide.setStdout({ batched: print });
  pyodide.setStderr({ batched: print });
  await pyodide.loadPackagesFromImports(job.script, { messageCallback: onLog, errorCallback: onLog });

  const paths: Record<string, string> = {};
  for (const [port, file] of Object.entries(job.files)) paths[port] = await resident(pyodide, file, onLog, fetchFile);
  const globals = pyodide.toPy({ source: job.script, path: job.path, entry: job.entry, paths: JSON.stringify(paths), values: job.values });
  try {
    const json = pyodide.runPython(RUNNER, { globals }) as string;
    return { outputs: JSON.parse(json) as Record<string, unknown>, log };
  } finally {
    globals.destroy();
  }
}

async function resident(pyodide: PyodideAPI, file: RemoteFile, onLog: (line: string) => void, fetchFile: FetchFile): Promise<string> {
  const path = `${FILES}/${file.sha256}`;
  if (!pyodide.FS.analyzePath(path).exists) {
    const bytes = await fetchFile(file, onLog);
    pyodide.FS.mkdirTree(FILES);
    pyodide.FS.writeFile(path, bytes);
  }
  return path;
}
