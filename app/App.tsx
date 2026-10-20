import { createEffect, createMemo, createResource, createSignal, For, Show } from 'solid-js';
import { Dynamic } from 'solid-js/web';
import { loadIndex, resolvePipeline, scopedReader, type PipelineEntry } from '../lib/runtime/load';
import { runPipeline, type RunResult } from '../lib/runtime/run';
import { semantics } from '../lib/semantics';
import { DetailPanel } from './components/DetailPanel';
import { GraphView, type Selection } from './graph/GraphView';
import { modelViews } from './views';

const readText = async (path: string): Promise<string> => {
  const response = await fetch(`${import.meta.env.BASE_URL}${path}`);
  if (!response.ok) throw new Error(`Could not load ${path} (${response.status})`);
  return response.text();
};

export function App() {
  const [entries] = createResource(() => loadIndex(readText));
  const [pipelineIndex, setPipelineIndex] = createSignal(0);
  const [scenarioIndex, setScenarioIndex] = createSignal(-1);
  const [selection, setSelection] = createSignal<Selection>();
  const [open, setOpen] = createSignal<string>();
  const entry = createMemo(() => entries()?.[pipelineIndex()]);
  syncWithUrl({ entries, pipelineIndex, setPipelineIndex, scenarioIndex, setScenarioIndex, selection, setSelection, open, setOpen });
  const [runs] = createResource(
    () => entry() && { entry: entry()!, scenario: scenarioIndex() },
    ({ entry, scenario }) => runEntry(entry, scenario),
  );

  const choosePipeline = (index: number) => {
    setPipelineIndex(index);
    setScenarioIndex(-1);
    setSelection(undefined);
    setOpen(undefined);
  };
  const openable = (nodeId: string) => {
    const node = runs.latest?.result.pipeline.nodes.find((n) => n.id === nodeId);
    return node !== undefined && node.semantics in modelViews;
  };
  const openNode = (nodeId: string) => {
    if (openable(nodeId)) setOpen(nodeId);
  };

  return (
    <div class="app">
      <header>
        <h1>Model workbench</h1>
        <Show when={entries()}>
          <nav class="pipelines">
            <For each={entries()}>
              {(e, i) => (
                <button classList={{ active: i() === pipelineIndex() }} onClick={() => choosePipeline(i())}>
                  {e.title}
                </button>
              )}
            </For>
          </nav>
        </Show>
        <Show when={entry()}>
          <nav class="scenarios">
            <span class="muted">Scenario</span>
            <button classList={{ active: scenarioIndex() === -1 }} onClick={() => setScenarioIndex(-1)}>Baseline</button>
            <For each={entry()!.scenarios}>
              {(s, i) => (
                <button classList={{ active: i() === scenarioIndex() }} onClick={() => setScenarioIndex(i())} title={s.scenario.expectation}>
                  {s.scenario.label}
                </button>
              )}
            </For>
          </nav>
        </Show>
      </header>
      <Show when={entries.error}>
        <p class="error banner">{String(entries.error)}</p>
      </Show>
      <Show when={runs.error}>
        <p class="error banner">{String(runs.error)}</p>
      </Show>
      <Show when={runs.loading}>
        <div class="loading">Running…</div>
      </Show>
      <Show when={runs.latest}>
        {(r) => (
          <main>
            <Show
              when={r().result.nodes.get(open() ?? '')}
              fallback={
                <>
                  <div class="canvas">
                    <Summary runs={r()} expectation={entry()?.scenarios[scenarioIndex()]?.scenario.expectation} />
                    <GraphView result={r().result} baseline={r().baseline} selected={selection()} onSelect={setSelection} onOpen={openNode} />
                  </div>
                  <Show when={selection()}>
                    {(s) => (
                      <DetailPanel
                        selection={s()}
                        result={r().result}
                        baseline={r().baseline}
                        canOpen={openable}
                        onOpen={openNode}
                        onClose={() => setSelection(undefined)}
                      />
                    )}
                  </Show>
                </>
              }
            >
              {(node) => (
                <div class="model-view">
                  <div class="breadcrumb">
                    <button onClick={() => setOpen(undefined)}>← Pipeline</button>
                    <strong>{node().node.label}</strong>
                    <span class="semantics">{node().node.semantics}</span>
                    <Show when={typeof node().node.model === 'string'}>
                      <code class="muted">{node().node.model as string}</code>
                    </Show>
                  </div>
                  <Dynamic component={modelViews[node().node.semantics]} node={node()} baseline={r().baseline?.nodes.get(node().node.id)} />
                </div>
              )}
            </Show>
          </main>
        )}
      </Show>
    </div>
  );
}

function Summary(props: { runs: Runs; expectation?: string }) {
  const issues = () => props.runs.result.issues;
  return (
    <div class="summary">
      <Show when={props.runs.result.pipeline.description}>
        <p class="muted">{props.runs.result.pipeline.description}</p>
      </Show>
      <Show when={props.expectation}>
        <p class="expectation"><strong>Expected:</strong> {props.expectation} <span class="muted">(baseline dashed)</span></p>
      </Show>
      <For each={issues()}>
        {(issue) => <p class={issue.severity}>{issue.where}: {issue.message}</p>}
      </For>
    </div>
  );
}

type Runs = { result: RunResult; baseline?: RunResult };

/** Mirrors the view in `?pipeline=housing&scenario=no-quota&select=dataset:quota&open=housing_market` so views can be linked. */
function syncWithUrl(state: {
  entries: () => PipelineEntry[] | undefined;
  pipelineIndex: () => number;
  setPipelineIndex: (i: number) => void;
  scenarioIndex: () => number;
  setScenarioIndex: (i: number) => void;
  selection: () => Selection | undefined;
  setSelection: (s: Selection | undefined) => void;
  open: () => string | undefined;
  setOpen: (nodeId: string | undefined) => void;
}) {
  let restored = false;
  createEffect(() => {
    const entries = state.entries();
    if (!entries || restored) return;
    restored = true;
    const params = new URLSearchParams(location.search);
    const pipeline = Math.max(0, entries.findIndex((e) => e.dir === params.get('pipeline')));
    state.setPipelineIndex(pipeline);
    state.setScenarioIndex(entries[pipeline]!.scenarios.findIndex((s) => scenarioName(s.path) === params.get('scenario')));
    const [kind, id] = (params.get('select') ?? '').split(':');
    if ((kind === 'dataset' || kind === 'node') && id) state.setSelection({ kind, id });
    state.setOpen(params.get('open') ?? undefined);
  });
  createEffect(() => {
    const entry = state.entries()?.[state.pipelineIndex()];
    if (!entry || !restored) return;
    const params = new URLSearchParams({ pipeline: entry.dir });
    const scenario = entry.scenarios[state.scenarioIndex()];
    if (scenario) params.set('scenario', scenarioName(scenario.path));
    const selection = state.selection();
    if (selection) params.set('select', `${selection.kind}:${selection.id}`);
    const open = state.open();
    if (open) params.set('open', open);
    history.replaceState(null, '', `?${params}`);
  });
}

function scenarioName(path: string): string {
  return path.slice(path.lastIndexOf('/') + 1).replace(/\.json$/, '');
}

async function runEntry(entry: PipelineEntry, scenarioIndex: number): Promise<Runs> {
  const reader = scopedReader(readText, entry.dir);
  const baseline = await runPipeline(resolvePipeline(entry), semantics, reader);
  const scenario = entry.scenarios[scenarioIndex]?.scenario;
  if (!scenario) return { result: baseline };
  return { result: await runPipeline(resolvePipeline(entry, scenario), semantics, reader), baseline };
}
