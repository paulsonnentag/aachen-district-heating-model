import { python } from '@codemirror/lang-python';
import { defaultHighlightStyle, syntaxHighlighting } from '@codemirror/language';
import { EditorState, RangeSetBuilder } from '@codemirror/state';
import { Decoration, EditorView, lineNumbers } from '@codemirror/view';
import { createSignal, For, onCleanup, onMount, Show } from 'solid-js';
import type { DatasetResult } from '../../lib/runtime/run';
import { tableData, type Table } from '../../lib/runtime/table';
import type { Tensor } from '../../lib/runtime/tensor';
import type { NodeOutput } from '../../lib/semantics/types';
import { CacheNote } from '../components/Details';
import type { ModelViewProps } from '../stockflow/StockFlowView';
import { formatBytes, formatValue } from '../values';

type Comparison = { port: string; dataset: string; difference: string | undefined };

/** A Python node's function in its script, with a button that runs it again in this browser and checks the result against the pipeline's. */
export function PythonView(props: ModelViewProps) {
  const code = () => props.node.description?.code;
  const [log, setLog] = createSignal<string[]>([]);
  const [running, setRunning] = createSignal(false);
  const [elapsed, setElapsed] = createSignal(0);
  const [fresh, setFresh] = createSignal<NodeOutput>();
  const [error, setError] = createSignal<string>();
  let logBox: HTMLPreElement | undefined;

  const run = async () => {
    setRunning(true);
    setLog([]);
    setFresh(undefined);
    setError(undefined);
    const started = performance.now();
    const timer = setInterval(() => setElapsed(Math.round((performance.now() - started) / 1000)), 500);
    try {
      setFresh(await props.node.recompute!((line) => {
        setLog((lines) => [...lines, line]);
        logBox?.scrollTo({ top: logBox.scrollHeight });
      }));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      clearInterval(timer);
      setRunning(false);
    }
  };
  const comparisons = (): Comparison[] =>
    Object.entries(props.node.node.outputs).map(([port, dataset]) => ({
      port,
      dataset,
      difference: describeDifference(fresh()!, port, props.result?.datasets.get(dataset)),
    }));
  const inputs = () =>
    Object.entries(props.node.node.inputs).map(([port, dataset]) => ({ port, dataset, result: props.result?.datasets.get(dataset) }));
  const downloadSize = () => inputs().reduce((total, input) => total + (input.result?.file?.size ?? 0), 0);

  return (
    <div class="py-view">
      <Show when={code()}>{(c) => <CodeView text={c().text} entry={c().entry} />}</Show>
      <aside class="py-side">
        <h3>Inputs</h3>
        <ul class="py-ports">
          <For each={inputs()}>
            {(input) => (
              <li>
                <code>{input.port}</code> ← <code>{input.dataset}</code>
                <Show when={input.result?.file}>{(file) => <span class="muted"> · {file().format}, {formatBytes(file().size)}</span>}</Show>
                <Show when={input.result?.table}>{(table) => <span class="muted"> · table, {table().rows.toLocaleString('en')} rows</span>}</Show>
              </li>
            )}
          </For>
        </ul>
        <h3>Result</h3>
        <Show when={props.node.cache}>{(cache) => <CacheNote cache={cache()} />}</Show>
        <Show when={props.node.status === 'idle'}>
          <p class="muted">Not computed: the results downstream were reused, so nothing in this run needed it.</p>
        </Show>
        <Show when={props.node.error}>
          <p class="error">{props.node.error}</p>
        </Show>
        <Show when={props.node.recompute}>
          <button class="open-model py-run" disabled={running()} onClick={run}>
            {running() ? `Running… ${elapsed()} s` : 'Run in browser'}
          </button>
          <p class="muted">
            Runs this step with Pyodide in a background worker, the same way it ran for the snapshot, after computing the steps
            it reads from if they are not computed yet
            <Show when={downloadSize() > 0}> (downloads {formatBytes(downloadSize())})</Show>. The pipeline keeps its current
            results; this checks that the script reproduces them.
          </p>
        </Show>
        <Show when={running() || log().length > 0}>
          <pre ref={logBox} class="node-log live">{log().join('\n')}</pre>
        </Show>
        <Show when={error()}>
          <pre class="error py-error">{error()}</pre>
        </Show>
        <Show when={fresh()}>
          {(output) => (
            <>
              <p>
                <strong>
                  {comparisons().every((c) => c.difference === undefined)
                    ? `Reproduced every output in ${output().cache?.seconds} s.`
                    : `Finished in ${output().cache?.seconds} s, but some outputs differ.`}
                </strong>
              </p>
              <table class="variables">
                <tbody>
                  <For each={comparisons()}>
                    {(c) => (
                      <tr>
                        <td class="var-name">{c.dataset}</td>
                        <td classList={{ warning: c.difference !== undefined }}>{c.difference ?? 'identical'}</td>
                      </tr>
                    )}
                  </For>
                </tbody>
              </table>
            </>
          )}
        </Show>
        <Show when={!running() && log().length === 0 && props.node.log?.length}>
          <h3>Log of the run that made this result</h3>
          <pre class="node-log">{props.node.log!.join('\n')}</pre>
        </Show>
      </aside>
    </div>
  );
}

/** The whole script, scrolled to the node's function, which is highlighted. */
function CodeView(props: { text: string; entry?: string }) {
  let host!: HTMLDivElement;
  onMount(() => {
    const range = props.entry ? functionLines(props.text, props.entry) : undefined;
    const view = new EditorView({
      parent: host,
      state: EditorState.create({
        doc: props.text,
        extensions: [
          EditorState.readOnly.of(true),
          lineNumbers(),
          python(),
          syntaxHighlighting(defaultHighlightStyle),
          ...(range ? [highlightLines(range)] : []),
        ],
      }),
    });
    if (range) {
      requestAnimationFrame(() =>
        view.dispatch({ effects: EditorView.scrollIntoView(view.state.doc.line(range.from).from, { y: 'start', yMargin: 24 }) }),
      );
    }
    onCleanup(() => view.destroy());
  });
  return <div ref={host} class="py-code" />;
}

/** First and last line (1-based) of a top-level function. */
function functionLines(text: string, name: string): { from: number; to: number } | undefined {
  const lines = text.split('\n');
  const start = lines.findIndex((line) => line.startsWith(`def ${name}(`));
  if (start < 0) return undefined;
  let end = start + 1;
  while (end < lines.length && (lines[end]!.trim() === '' || /^\s/.test(lines[end]!))) end++;
  while (end > start + 1 && lines[end - 1]!.trim() === '') end--;
  return { from: start + 1, to: end };
}

function highlightLines(range: { from: number; to: number }) {
  const line = Decoration.line({ class: 'py-entry-line' });
  return EditorView.decorations.compute([], (state) => {
    const builder = new RangeSetBuilder<Decoration>();
    for (let n = range.from; n <= Math.min(range.to, state.doc.lines); n++) builder.add(state.doc.line(n).from, state.doc.line(n).from, line);
    return builder.finish();
  });
}

function describeDifference(fresh: NodeOutput, port: string, current: DatasetResult | undefined): string | undefined {
  if (current?.table || fresh.tables?.[port]) return describeTableDifference(fresh.tables?.[port], current?.table);
  return describeTensorDifference(fresh.outputs[port], current?.tensor);
}

function describeTensorDifference(fresh: Tensor | undefined, current: Tensor | undefined): string | undefined {
  if (!fresh || !current) return 'missing';
  if (fresh.dims.join() !== current.dims.join()) return `dimensions ${fresh.dims.join(' × ')} instead of ${current.dims.join(' × ')}`;
  if (fresh.coords.some((c, i) => c.join() !== current.coords[i]!.join())) return 'different coordinates';
  let largest = 0;
  for (let i = 0; i < fresh.values.length; i++) largest = Math.max(largest, Math.abs(fresh.values[i]! - current.values[i]!));
  return largest === 0 ? undefined : `values differ by up to ${formatValue(largest)} ${current.unit}`;
}

function describeTableDifference(fresh: Table | undefined, current: Table | undefined): string | undefined {
  if (!fresh || !current) return current ? 'missing' : 'not computed before, so nothing to compare';
  if (fresh.rows !== current.rows) return `${fresh.rows} rows instead of ${current.rows}`;
  const names = Object.keys(fresh.columns);
  if (names.join() !== Object.keys(current.columns).join()) return 'different columns';
  const a = tableData(fresh);
  const b = tableData(current);
  const differing = names.filter((name) => JSON.stringify(a[name]) !== JSON.stringify(b[name]));
  return differing.length === 0 ? undefined : `columns ${differing.join(', ')} differ`;
}
