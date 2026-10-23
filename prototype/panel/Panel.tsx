import { Match, Show, Switch } from 'solid-js';
import type { FocusTarget } from '../../app/story/elements';
import type { PipelineEntry } from '../../lib/runtime/load';
import { BASELINE } from '../../lib/runtime/runs';
import { artifactsOf } from '../data/experiments';
import type { Workspace } from '../workspace';
import { ArtifactDetail } from './ArtifactDetail';
import { LiveModel } from './LiveModel';

/** What the chat selected last: an artifact, or the live model focused on a value, claim or task. */
export type View = { kind: 'artifact'; id: string } | { kind: 'model'; target: FocusTarget; from?: string };

export function Panel(props: { ws: Workspace; entry: PipelineEntry; view?: View }) {
  const artifactOf = (id: string | undefined) => artifactsOf(props.ws.experiment).find((a) => a.id === id);

  return (
    <section class="pt-panel">
      <Switch fallback={<EmptyPanel />}>
        <Match when={props.view?.kind === 'artifact' && artifactOf(props.view.id)}>
          {(artifact) => (
            <div class="pt-panel-body">
              <ArtifactDetail artifact={artifact()} ws={props.ws} onShowModel={() => props.ws.focus({ scenario: BASELINE })} />
            </div>
          )}
        </Match>
        <Match when={props.view?.kind === 'model' && props.view}>
          {(view) => (
            <>
              <div class="pt-panel-bar">
                <Show when={artifactOf(view().from)}>
                  {(from) => (
                    <button class="pt-button" onClick={() => props.ws.select(from().id)}>
                      ← {from().title}
                    </button>
                  )}
                </Show>
                <strong>Model</strong>
                <span class="muted">{describe(view().target)}</span>
              </div>
              <div class="pt-panel-body">
                <LiveModel entry={props.entry} target={view().target} />
              </div>
            </>
          )}
        </Match>
      </Switch>
    </section>
  );
}

function EmptyPanel() {
  return (
    <div class="pt-empty">
      <p>Click a plan, draft, run or source in the chat to open it here.</p>
      <p class="muted">Numbers, claims and task chips open the model at the part they come from.</p>
    </div>
  );
}

function describe(target: FocusTarget): string {
  const focus = target.dataset ?? target.node;
  return focus ? `showing ${focus}` : 'the pipeline on main';
}
