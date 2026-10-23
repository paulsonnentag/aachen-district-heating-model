import { parseResult, type KeptResult, type ResultStore } from '../../lib/semantics/kept';
import type { PythonHost } from '../../lib/semantics/python';
import { PYODIDE_VERSION, type PythonJob, type PythonRun } from '../../lib/semantics/python/pyodide';
import type { WorkerReply } from './worker';

/** Python nodes in the browser: Pyodide in a worker that also downloads the files, results kept in IndexedDB. */
export function browserPythonHost(): PythonHost {
  return {
    runtime: `Pyodide ${PYODIDE_VERSION}`,
    run: runInWorker(),
    store: indexedDbStore(),
  };
}

function runInWorker(): (job: PythonJob, onLog: (line: string) => void) => Promise<PythonRun> {
  let worker: Worker | undefined;
  let nextId = 0;
  const pending = new Map<number, { resolve: (run: PythonRun) => void; reject: (error: Error) => void; onLog: (line: string) => void }>();
  return (job, onLog) => {
    worker ??= startWorker();
    const id = nextId++;
    return new Promise((resolve, reject) => {
      pending.set(id, { resolve, reject, onLog });
      worker!.postMessage({ id, job });
    });
  };

  function startWorker(): Worker {
    const started = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
    started.onmessage = (event: MessageEvent<WorkerReply>) => {
      const reply = event.data;
      const call = pending.get(reply.id);
      if (!call) return;
      if (reply.kind === 'log') return call.onLog(reply.line);
      pending.delete(reply.id);
      if (reply.kind === 'done') call.resolve({ outputs: reply.outputs, log: reply.log });
      else call.reject(new Error(reply.message));
    };
    return started;
  }
}

function indexedDbStore(): ResultStore {
  const STORE = 'python-results';
  const db = new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open('model-workbench', 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  const call = <T>(mode: IDBTransactionMode, action: (store: IDBObjectStore) => IDBRequest<T>) =>
    db.then(
      (d) =>
        new Promise<T>((resolve, reject) => {
          const request = action(d.transaction(STORE, mode).objectStore(STORE));
          request.onsuccess = () => resolve(request.result);
          request.onerror = () => reject(request.error);
        }),
    );
  return {
    get: (key) =>
      call<string | undefined>('readonly', (s) => s.get(key))
        .then((text) => (text ? parseResult(text) : undefined))
        .catch(() => undefined),
    put: (result: KeptResult) =>
      call('readwrite', (s) => s.put(JSON.stringify(result), result.key))
        .then(() => undefined)
        .catch((error) => console.warn('Could not keep the result in IndexedDB', error)),
  };
}
