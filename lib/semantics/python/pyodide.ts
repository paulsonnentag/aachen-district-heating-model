import type { PyodideAPI } from 'pyodide';
import type { FetchFile, RemoteFile } from '../../runtime/datasets';

export const PYODIDE_VERSION = '314.0.7';
export const PYODIDE_CDN = `https://cdn.jsdelivr.net/pyodide/v${PYODIDE_VERSION}/full/`;

/** A script and its inputs, each under the name of its dataset. */
export type PythonJob = {
  script: string;
  /** Shown in tracebacks. */
  path: string;
  files: Record<string, RemoteFile>;
  /** JSON of the table inputs, each a dict of columns. */
  tables: string;
  /** JSON of the tensor inputs, each `{ dims, coords, values }` with one value per combination of coordinates. */
  tensors: string;
  /** The variables to read once the script has run. */
  outputs: string[];
};

export type PythonRun = { outputs: Record<string, unknown> };

/**
 * The script runs as a module of its own, with its inputs already defined: files as paths, tables as
 * DataFrames, tensors as Series indexed by their dims. Afterwards a DataFrame output becomes a dict of
 * columns and a Series output becomes rows of coordinates, then the value.
 */
export const RUNNER = `
import json
import pandas as pd

def series(tensor):
    if not tensor["dims"]:
        return tensor["values"][0]
    index = pd.MultiIndex.from_product(tensor["coords"], names=tensor["dims"])
    if len(tensor["dims"]) == 1:
        index = index.get_level_values(0)
    return pd.Series(tensor["values"], index=index)

def plain(value):
    if isinstance(value, pd.DataFrame):
        return {name: [None if blank(v) else v for v in value[name].tolist()] for name in value.columns}
    if isinstance(value, pd.Series):
        return [[*(at if isinstance(at, tuple) else (at,)), v] for at, v in value.items()]
    if isinstance(value, (int, float)):
        return [[value]]
    return value

def blank(value):
    return value is pd.NA or (isinstance(value, float) and value != value)

def scalar(value):
    if hasattr(value, "item"):
        return value.item()
    raise TypeError(f"{type(value).__name__} is not JSON serializable")

def run():
    namespace = {"__name__": "workbench_node", "__file__": path}
    namespace.update(json.loads(paths))
    namespace.update({name: pd.DataFrame(columns) for name, columns in json.loads(tables).items()})
    namespace.update({name: series(tensor) for name, tensor in json.loads(tensors).items()})
    try:
        exec(compile(source, path, "exec"), namespace)
    except Exception as error:
        return {"error": script_traceback(error)}
    missing = [name for name in outputs if name not in namespace]
    if missing:
        return {"error": f"{path} does not define {', '.join(missing)}"}
    return {"outputs": {name: plain(namespace[name]) for name in outputs}}

def script_traceback(error):
    import linecache, traceback
    linecache.cache[path] = (len(source), None, source.splitlines(True), path)
    shown = traceback.TracebackException.from_exception(error)
    shown.stack = traceback.StackSummary.from_list([frame for frame in shown.stack if frame.filename == path])
    return "".join(shown.format(chain=False)).strip()

json.dumps(run(), default=scalar)
`;

/** Downloads stay in Pyodide's file system under their hash, so nodes reading the same file share one copy. */
const FILES = '/files';

let queue: Promise<unknown> = Promise.resolve();

/** Runs jobs one at a time, since they share the interpreter; `onLog` only hears about downloads. */
export function runInPyodide(pyodide: PyodideAPI, job: PythonJob, onLog: (line: string) => void, fetchFile: FetchFile): Promise<PythonRun> {
  const run = queue.then(() => runNow(pyodide, job, onLog, fetchFile));
  queue = run.catch(() => undefined);
  return run;
}

async function runNow(pyodide: PyodideAPI, job: PythonJob, onLog: (line: string) => void, fetchFile: FetchFile): Promise<PythonRun> {
  const ignore = () => {};
  pyodide.setStdout({ batched: ignore });
  pyodide.setStderr({ batched: ignore });
  await pyodide.loadPackage('pandas', { messageCallback: ignore });
  await pyodide.loadPackagesFromImports(job.script, { messageCallback: ignore });

  const paths: Record<string, string> = {};
  for (const [name, file] of Object.entries(job.files)) paths[name] = await resident(pyodide, file, onLog, fetchFile);
  const globals = pyodide.toPy({
    source: job.script,
    path: job.path,
    paths: JSON.stringify(paths),
    tables: job.tables,
    tensors: job.tensors,
    outputs: job.outputs,
  });
  try {
    const ran = JSON.parse(pyodide.runPython(RUNNER, { globals }) as string) as { outputs: Record<string, unknown> } | { error: string };
    if ('error' in ran) throw new Error(ran.error);
    return { outputs: ran.outputs };
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
