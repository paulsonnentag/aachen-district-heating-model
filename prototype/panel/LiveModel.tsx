import { createEffect, createResource, createSignal, For, Show } from 'solid-js';
import { Dynamic } from 'solid-js/web';
import { Fullscreen } from '../../app/components/Fullscreen';
import { GraphView } from '../../app/graph/GraphView';
import type { FocusTarget } from '../../app/story/elements';
import { modelViews } from '../../app/views';
import { createWorkbench, type Selection } from '../../app/workbench';
import type { PipelineEntry } from '../../lib/runtime/load';
import type { RunResult } from '../../lib/runtime/run';
import { BASELINE } from '../../lib/runtime/runs';
import { runOf } from '../model';

/** The pipeline on main, drawn by the workbench's own graph and detail views. */
export function LiveModel(props: { entry: PipelineEntry; target?: FocusTarget }) {
  const [scenario, setScenario] = createSignal(BASELINE);
  const [open, setOpen] = createSignal<string>();
  const [runs, { refetch }] = createResource(
    () => ({ entry: props.entry, scenario: scenario() }),
    ({ entry, scenario }) => runScenario(entry, scenario),
  );
  const openable = (nodeId: string) => {
    const node = runs.latest?.result.pipeline.nodes.find((n) => n.id === nodeId);
    return node !== undefined && node.semantics in modelViews;
  };
  const workbench = createWorkbench({
    result: () => runs.latest?.result,
    refresh: async () => {
      runOf.clear();
      await refetch();
    },
    canOpen: openable,
    open: (nodeId) => {
      if (!openable(nodeId)) return;
      workbench.setFull(undefined);
      setOpen(nodeId);
    },
  });
  createEffect(() => {
    const target = props.target;
    if (!target) return;
    const selected: Selection | undefined = target.dataset
      ? { kind: 'dataset', id: target.dataset }
      : target.node
        ? { kind: 'node', id: target.node }
        : undefined;
    setScenario(target.scenario);
    workbench.setFull(undefined);
    workbench.focus(selected);
    setOpen(target.open && target.node ? target.node : undefined);
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
                      selected={workbench.selection()}
                      reveal={workbench.reveal()}
                      expanded={workbench.expanded()}
                      actions={workbench.actions}
                    />
                  </div>
                  <Show when={workbench.full()}>
                    {(s) => <Fullscreen selection={s()} result={r().result} baseline={r().baseline} actions={workbench.actions} />}
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
