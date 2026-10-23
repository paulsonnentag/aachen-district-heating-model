import { For, Match, Show, Switch } from 'solid-js';
import { marked } from 'marked';
import { BASELINE } from '../../lib/runtime/runs';
import {
  ArtifactBadges,
  BacklogBody,
  ChangeList,
  CreateDraftButton,
  DataChips,
  EvidenceBody,
  KIND_LABEL,
  RunBody,
  SourcesBody,
  TasksBody,
} from '../chat/cards';
import type { Artifact, Backlog, Draft, EvidenceMap, Plan, Run, SourceList, TaskList } from '../data/types';
import type { Workspace } from '../workspace';
import { SketchGraph, TaskLine } from './SketchGraph';

export function ArtifactDetail(props: { artifact: Artifact; ws: Workspace; onShowModel: () => void }) {
  const a = () => props.artifact;
  return (
    <div class="pt-detail">
      <header class="pt-detail-head">
        <span class="pt-kind">{KIND_LABEL[a().kind]}</span>
        <h2>{a().title}</h2>
        <ArtifactBadges artifact={a()} />
      </header>
      <Switch>
        <Match when={a().kind === 'plan'}>
          <PlanDetail plan={a() as Plan} ws={props.ws} />
        </Match>
        <Match when={a().kind === 'draft'}>
          <DraftDetail draft={a() as Draft} ws={props.ws} onShowModel={props.onShowModel} />
        </Match>
        <Match when={a().kind === 'evidence'}>
          <EvidenceBody artifact={a() as EvidenceMap} full />
        </Match>
        <Match when={a().kind === 'tasks'}>
          <TasksBody
            artifact={a() as TaskList}
            renderTask={(task) => <TaskLine task={task} onTarget={(t) => props.ws.focus({ scenario: BASELINE, ...t })} />}
          />
        </Match>
        <Match when={a().kind === 'sources'}>
          <SourcesBody artifact={a() as SourceList} full />
        </Match>
        <Match when={a().kind === 'run'}>
          <RunBody artifact={a() as Run} ws={props.ws} />
        </Match>
        <Match when={a().kind === 'backlog'}>
          <BacklogBody artifact={a() as Backlog} ws={props.ws} />
        </Match>
      </Switch>
    </div>
  );
}

function PlanDetail(props: { plan: Plan; ws: Workspace }) {
  const draft = () => props.ws.experiment.chat.flatMap((m) => m.blocks).find((b) => 'id' in b && b.id === props.plan.draft);
  return (
    <>
      <p>{props.plan.idea}</p>
      <Show when={props.plan.reason}>
        <p class="pt-reason">
          <strong>{props.plan.outcome === 'chosen' ? 'Why: ' : 'Not pursued: '}</strong>
          {props.plan.reason}
        </p>
      </Show>
      <div class="pt-columns">
        <div>
          <h3 class="pt-h3">Data</h3>
          <DataChips data={props.plan.data} />
        </div>
        <div>
          <h3 class="pt-h3">Can answer</h3>
          <ul class="pt-plain">
            <For each={props.plan.answers}>{(answer) => <li>{answer}</li>}</For>
          </ul>
          <h3 class="pt-h3">Can’t answer</h3>
          <ul class="pt-plain muted">
            <For each={props.plan.limits}>{(limit) => <li>{limit}</li>}</For>
          </ul>
        </div>
      </div>
      <div class="pt-actions">
        <Show
          when={props.plan.outcome === 'chosen' && draft()}
          fallback={<CreateDraftButton title={props.plan.title} ws={props.ws} />}
        >
          {(d) => (
            <button class="pt-button" onClick={() => props.ws.select((d() as Draft).id)}>
              Open draft “{(d() as Draft).title}”
            </button>
          )}
        </Show>
      </div>
      <Show when={props.plan.sketch}>
        {(sketch) => (
          <>
            <h3 class="pt-h3">Proposed pipeline</h3>
            <SketchGraph sketch={sketch()} />
          </>
        )}
      </Show>
    </>
  );
}

function DraftDetail(props: { draft: Draft; ws: Workspace; onShowModel: () => void }) {
  return (
    <>
      <h3 class="pt-h3">Changes</h3>
      <ChangeList changes={props.draft.changes} />
      <Show when={props.draft.live}>
        <div class="pt-actions">
          <span class="muted">This draft’s result is on main.</span>
          <button class="pt-button" onClick={props.onShowModel}>
            Show the model
          </button>
        </div>
      </Show>
      <Show when={props.draft.story}>
        {(story) => (
          <>
            <h3 class="pt-h3">Story skeleton</h3>
            <div class="story pt-skeleton" innerHTML={marked.parse(story(), { async: false })} />
          </>
        )}
      </Show>
      <Show when={props.draft.sketch}>
        {(sketch) => (
          <>
            <h3 class="pt-h3">Pipeline in this draft</h3>
            <SketchGraph sketch={sketch()} />
          </>
        )}
      </Show>
    </>
  );
}
