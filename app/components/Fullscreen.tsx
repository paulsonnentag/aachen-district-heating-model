import { createSignal, Match, onCleanup, onMount, Show, Switch } from 'solid-js';
import type { RunResult } from '../../lib/runtime/run';
import { groupsOf } from '../graph/groups';
import type { Actions, Selection } from '../workbench';
import { DatasetInfo, GroupDetail, NodeDetail } from './Details';
import { currentView, ValueView, valueSummary, viewsOf, ViewPicker } from './ValueView';

const MAX_VIEW_WIDTH = 1100;
const KIND_LABELS: Record<Selection['kind'], string> = { dataset: 'dataset', node: 'step', group: 'group' };

/** One dataset, step or group over the whole model pane; Esc or × goes back to the graph. */
export function Fullscreen(props: { selection: Selection; result: RunResult; baseline?: RunResult; actions: Actions }) {
  const close = () => props.actions.fullscreen(undefined);
  onMount(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') close();
    };
    window.addEventListener('keydown', onKey);
    onCleanup(() => window.removeEventListener('keydown', onKey));
  });
  const title = () => {
    const s = props.selection;
    if (s.kind === 'node') return props.result.nodes.get(s.id)?.node.label ?? s.id;
    if (s.kind === 'group') return props.result.pipeline.groups.find((g) => g.id === s.id)?.label ?? s.id;
    return s.id;
  };
  return (
    <div class="fullscreen">
      <div class="fullscreen-head">
        <span class="muted">{KIND_LABELS[props.selection.kind]}</span>
        <strong classList={{ 'dataset-name': props.selection.kind === 'dataset' }}>{title()}</strong>
        <span class="spacer" />
        <span class="muted">Esc to close</span>
        <button class="close" title="Close" onClick={close}>
          ×
        </button>
      </div>
      <div class="fullscreen-body">
        <Switch fallback={<p class="muted">Nothing called {props.selection.id} in this pipeline.</p>}>
          <Match when={props.selection.kind === 'dataset' && props.result.datasets.get(props.selection.id)}>
            {(dataset) => {
              const options = () => viewsOf(dataset());
              const view = () => currentView(options(), props.actions.viewOf(dataset().name), props.result.pipeline.views[dataset().name]);
              const width = measureWidth();
              return (
                <div class="fullscreen-dataset">
                  <div class="fullscreen-view" ref={width.ref}>
                    <p class="muted">{valueSummary(dataset())}</p>
                    <Show when={width.value() > 0}>
                      <ValueView
                        dataset={dataset()}
                        baseline={props.baseline?.datasets.get(dataset().name)}
                        view={view()?.name}
                        large
                        width={Math.min(MAX_VIEW_WIDTH, width.value())}
                        maxHeight={Math.max(320, window.innerHeight - 260)}
                      />
                    </Show>
                    <ViewPicker options={options()} current={view()} onChange={(v) => props.actions.setView(dataset().name, v)} />
                  </div>
                  <aside class="fullscreen-info">
                    <DatasetInfo dataset={dataset()} result={props.result} actions={props.actions} />
                  </aside>
                </div>
              );
            }}
          </Match>
          <Match when={props.selection.kind === 'node' && props.result.nodes.get(props.selection.id)}>
            {(node) => (
              <div class="fullscreen-text">
                <NodeDetail node={node()} result={props.result} actions={props.actions} />
              </div>
            )}
          </Match>
          <Match when={props.selection.kind === 'group' && groupsOf(props.result).get(props.selection.id)}>
            {(info) => (
              <div class="fullscreen-text">
                <GroupDetail info={info()} result={props.result} actions={props.actions} />
              </div>
            )}
          </Match>
        </Switch>
      </div>
    </div>
  );
}

/** The content width of the element given to `ref`, kept up to date as the window resizes. */
function measureWidth() {
  const [value, setValue] = createSignal(0);
  const observer = new ResizeObserver(([entry]) => setValue(Math.floor(entry!.contentRect.width)));
  onCleanup(() => observer.disconnect());
  return { value, ref: (element: HTMLElement) => observer.observe(element) };
}
