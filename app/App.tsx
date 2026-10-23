import { createEffect, createMemo, createResource, createSignal, For, Show } from 'solid-js';
import { Dynamic } from 'solid-js/web';
import { loadIndex, type PipelineEntry } from '../lib/runtime/load';
import type { RunResult } from '../lib/runtime/run';
import { BASELINE, createRunCache } from '../lib/runtime/runs';
import { createSemantics } from '../lib/semantics';
import { DetailPanel, type Compute } from './components/DetailPanel';
import { GraphView, type Selection } from './graph/GraphView';
import { groupOfDataset, groupOfNode, groupsOf } from './graph/groups';
import type { FocusTarget, StoryContext } from './story/elements';
import { browserPythonHost } from './python/host';
import { StoryPane } from './story/StoryPane';
import { modelViews } from './views';

const readText = async (path: string): Promise<string> => {
  const response = await fetch(`${import.meta.env.BASE_URL}${path}`);
  if (!response.ok) throw new Error(`Could not load ${path} (${response.status})`);
  return response.text();
};

const runOf = createRunCache(readText, createSemantics(browserPythonHost()));

/** Which panes are visible: the story alone, story and model side by side, or the model alone. */
type View = 'story' | 'split' | 'model';

export function App() {
  const [entries] = createResource(() => loadIndex(readText));
  const [pipelineIndex, setPipelineIndex] = createSignal(0);
  const [scenarioIndex, setScenarioIndex] = createSignal(-1);
  const [selection, setSelection] = createSignal<Selection>();
  const [open, setOpen] = createSignal<string>();
  const [view, setView] = createSignal<View>('model');
  const [expanded, setExpanded] = createSignal<string[]>([]);
  const [reveal, setReveal] = createSignal<Selection | undefined>(undefined, { equals: false });
  const entry = createMemo(() => entries()?.[pipelineIndex()]);
  syncWithUrl({
    entries,
    pipelineIndex,
    setPipelineIndex,
    scenarioIndex,
    setScenarioIndex,
    selection,
    setSelection,
    open,
    setOpen,
    view,
    setView,
    expanded,
    setExpanded,
  });
  const [runs, { refetch }] = createResource(
    () => entry() && { entry: entry()!, scenario: scenarioIndex() },
    ({ entry, scenario }) => runEntry(entry, scenario),
  );
  const toggleGroup = (id: string) => setExpanded((ids) => (ids.includes(id) ? ids.filter((g) => g !== id) : [...ids, id]));
  createEffect(() => {
    const s = selection();
    const result = runs.latest?.result;
    if (!s || !result) return;
    const group = s.kind === 'node' ? groupOfNode(result, s.id) : s.kind === 'dataset' ? groupOfDataset(groupsOf(result), s.id) : undefined;
    if (group && !expanded().includes(group)) setExpanded((ids) => [...ids, group]);
  });
  const compute: Compute = async (nodeIds, onLog) => {
    const result = runs.latest?.result;
    if (!result) return;
    for (const id of nodeIds) await result.nodes.get(id)?.compute?.(onLog);
    runOf.clear();
    await refetch();
  };
  const [storyText] = createResource(() => entry()?.story, readText);
  const storyShown = () => view() !== 'model';
  const modelShown = () => view() !== 'story';

  const choosePipeline = (index: number) => {
    setPipelineIndex(index);
    setScenarioIndex(-1);
    setSelection(undefined);
    setOpen(undefined);
    setExpanded([]);
    setView(defaultView(entries()?.[index]));
  };
  const togglePane = (pane: 'story' | 'model') => {
    const shown = pane === 'story' ? storyShown() : modelShown();
    if (!shown) setView('split');
    else if (view() === 'split') setView(pane === 'story' ? 'model' : 'story');
  };
  const openable = (nodeId: string) => {
    const node = runs.latest?.result.pipeline.nodes.find((n) => n.id === nodeId);
    return node !== undefined && node.semantics in modelViews;
  };
  const openNode = (nodeId: string) => {
    if (openable(nodeId)) setOpen(nodeId);
  };
  const focus = (target: FocusTarget) => {
    const scenarios = entry()?.scenarios ?? [];
    const selected: Selection | undefined = target.dataset
      ? { kind: 'dataset', id: target.dataset }
      : target.node
        ? { kind: 'node', id: target.node }
        : undefined;
    setScenarioIndex(scenarios.findIndex((s) => s.name === target.scenario));
    setSelection(selected);
    setOpen(target.open && target.node && openable(target.node) ? target.node : undefined);
    setView('split');
    setReveal(selected);
  };
  const storyContext = createMemo((): StoryContext | undefined => {
    const current = entry();
    if (!current) return undefined;
    return {
      runs: (scenario) => runOf(current, scenario),
      focus,
      focused: () => {
        if (!modelShown()) return undefined;
        const s = selection();
        return { scenario: current.scenarios[scenarioIndex()]?.name ?? BASELINE, dataset: s?.kind === 'dataset' ? s.id : undefined };
      },
      scenarioLabel: (name) => current.scenarios.find((s) => s.name === name)?.scenario.label ?? name,
    };
  });

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
        <Show when={entry()?.story}>
          <nav class="panes">
            <button classList={{ active: storyShown() }} onClick={() => togglePane('story')}>Story</button>
            <button classList={{ active: modelShown() }} onClick={() => togglePane('model')}>Model</button>
          </nav>
        </Show>
        <Show when={entry() && modelShown()}>
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
      <Show when={storyText.error}>
        <p class="error banner">{String(storyText.error)}</p>
      </Show>
      <Show when={runs.loading && modelShown()}>
        <div class="loading">Running…</div>
      </Show>
      <main>
        <Show when={storyText.latest !== undefined && storyContext()}>
          {(context) => <StoryPane text={storyText.latest!} context={context()} split={view() === 'split'} hidden={!storyShown()} />}
        </Show>
        <Show when={modelShown() && runs.latest}>
          {(r) => (
            <div class="workbench">
              <Show
                when={r().result.nodes.get(open() ?? '')}
                fallback={
                  <>
                    <div class="canvas">
                      <Summary runs={r()} expectation={entry()?.scenarios[scenarioIndex()]?.scenario.expectation} />
                      <GraphView
                        result={r().result}
                        baseline={r().baseline}
                        selected={selection()}
                        reveal={reveal()}
                        expanded={expanded()}
                        onSelect={setSelection}
                        onOpen={openNode}
                        onToggleGroup={toggleGroup}
                      />
                    </div>
                    <Show when={selection()}>
                      {(s) => (
                        <DetailPanel
                          selection={s()}
                          result={r().result}
                          baseline={r().baseline}
                          expanded={expanded()}
                          canOpen={openable}
                          onOpen={openNode}
                          onSelect={setSelection}
                          onToggleGroup={toggleGroup}
                          onCompute={compute}
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
                      <Show when={typeof node().node.model === 'string' ? (node().node.model as string) : node().description?.code?.path}>
                        {(path) => <code class="muted">{path()}</code>}
                      </Show>
                    </div>
                    <Dynamic
                      component={modelViews[node().node.semantics]}
                      node={node()}
                      baseline={r().baseline?.nodes.get(node().node.id)}
                      result={r().result}
                    />
                  </div>
                )}
              </Show>
            </div>
          )}
        </Show>
      </main>
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

/** Mirrors the view in `?pipeline=housing&scenario=no-quota&select=dataset:quota&open=housing_market&expand=prepare&view=split` so views can be linked. */
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
  view: () => View;
  setView: (view: View) => void;
  expanded: () => string[];
  setExpanded: (ids: string[]) => void;
}) {
  let restored = false;
  createEffect(() => {
    const entries = state.entries();
    if (!entries || restored) return;
    restored = true;
    const params = new URLSearchParams(location.search);
    const pipeline = Math.max(0, entries.findIndex((e) => e.dir === params.get('pipeline')));
    state.setPipelineIndex(pipeline);
    state.setScenarioIndex(entries[pipeline]!.scenarios.findIndex((s) => s.name === params.get('scenario')));
    const [kind, id] = (params.get('select') ?? '').split(':');
    if ((kind === 'dataset' || kind === 'node' || kind === 'group') && id) state.setSelection({ kind, id });
    state.setOpen(params.get('open') ?? undefined);
    state.setExpanded((params.get('expand') ?? '').split(',').filter(Boolean));
    const view = params.get('view');
    const hasStory = entries[pipeline]!.story !== undefined;
    state.setView(hasStory && (view === 'story' || view === 'split' || view === 'model') ? view : defaultView(entries[pipeline]));
  });
  createEffect(() => {
    const entry = state.entries()?.[state.pipelineIndex()];
    if (!entry || !restored) return;
    const params = new URLSearchParams({ pipeline: entry.dir });
    const scenario = entry.scenarios[state.scenarioIndex()];
    if (scenario) params.set('scenario', scenario.name);
    const selection = state.selection();
    if (selection) params.set('select', `${selection.kind}:${selection.id}`);
    const open = state.open();
    if (open) params.set('open', open);
    if (state.expanded().length > 0) params.set('expand', state.expanded().join(','));
    if (entry.story) params.set('view', state.view());
    history.replaceState(null, '', `?${params}`);
  });
}

function defaultView(entry: PipelineEntry | undefined): View {
  return entry?.story ? 'story' : 'model';
}

async function runEntry(entry: PipelineEntry, scenarioIndex: number): Promise<Runs> {
  const baseline = await runOf(entry, BASELINE);
  const scenario = entry.scenarios[scenarioIndex];
  if (!scenario) return { result: baseline };
  return { result: await runOf(entry, scenario.name), baseline };
}
