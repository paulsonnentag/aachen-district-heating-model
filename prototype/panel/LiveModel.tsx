import { createEffect, createResource, createSignal, For, Show } from 'solid-js';
import { Dynamic } from 'solid-js/web';
import { DetailPanel, type Compute } from '../../app/components/DetailPanel';
import { GraphView, type Selection } from '../../app/graph/GraphView';
import { groupOfDataset, groupOfNode, groupsOf } from '../../app/graph/groups';
import type { FocusTarget } from '../../app/story/elements';
import { modelViews } from '../../app/views';
import type { PipelineEntry } from '../../lib/runtime/load';
import type { RunResult } from '../../lib/runtime/run';
import { BASELINE } from '../../lib/runtime/runs';
import { runOf } from '../model';

/** The pipeline on main, drawn by the workbench's own graph and detail views. */
export function LiveModel(props: { entry: PipelineEntry; target?: FocusTarget }) {
  const [scenario, setScenario] = createSignal(BASELINE);
  const [selection, setSelection] = createSignal<Selection>();
  const [reveal, setReveal] = createSignal<Selection | undefined>(undefined, { equals: false });
  const [open, setOpen] = createSignal<string>();
  const [expanded, setExpanded] = createSignal<string[]>([]);
  const [runs, { refetch }] = createResource(
    () => ({ entry: props.entry, scenario: scenario() }),
    ({ entry, scenario }) => runScenario(entry, scenario),
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
  const openable = (nodeId: string) => {
    const node = runs.latest?.result.pipeline.nodes.find((n) => n.id === nodeId);
    return node !== undefined && node.semantics in modelViews;
  };
  createEffect(() => {
    const target = props.target;
    if (!target) return;
    const selected: Selection | undefined = target.dataset
      ? { kind: 'dataset', id: target.dataset }
      : target.node
        ? { kind: 'node', id: target.node }
        : undefined;
    setScenario(target.scenario);
    setSelection(selected);
    setOpen(target.open && target.node ? target.node : undefined);
    setReveal(selected);
  });

  return (
    <div class="pt-live">
      <nav class="scenarios pt-scenarios">
        <span class="muted">Scenario</span>
        <button classList={{ active: scenario() === BASELINE }} onClick={() => setScenario(BASELINE)}>
          Baseline
        </button>
        <For each={props.entry.scenarios}>
          {(s) => (
            <button classList={{ active: scenario() === s.name }} onClick={() => setScenario(s.name)} title={s.scenario.expectation}>
              {s.scenario.label}
            </button>
          )}
        </For>
        <Show when={runs.loading}>
          <span class="muted pt-running">Running…</span>
        </Show>
      </nav>
      <Show when={runs.error}>
        <p class="error banner">{String(runs.error)}</p>
      </Show>
      <Show when={runs.latest}>
        {(r) => (
          <div class="workbench">
            <Show
              when={r().result.nodes.get(open() ?? '')}
              fallback={
                <>
                  <div class="canvas">
                    <GraphView
                      result={r().result}
                      baseline={r().baseline}
                      selected={selection()}
                      reveal={reveal()}
                      expanded={expanded()}
                      onSelect={setSelection}
                      onOpen={(id) => openable(id) && setOpen(id)}
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
                        onOpen={(id) => openable(id) && setOpen(id)}
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
    </div>
  );
}

async function runScenario(entry: PipelineEntry, scenario: string): Promise<{ result: RunResult; baseline?: RunResult }> {
  const baseline = await runOf(entry, BASELINE);
  if (scenario === BASELINE) return { result: baseline };
  return { result: await runOf(entry, scenario), baseline };
}
