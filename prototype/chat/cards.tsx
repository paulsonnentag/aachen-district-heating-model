import { For, Match, Show, Switch, type JSX } from 'solid-js';
import type { Artifact, Backlog, Draft, EvidenceMap, Plan, Run, SourceList, TaskList } from '../data/types';
import type { Workspace } from '../workspace';

/** An artifact embedded in the chat; clicking it opens it in the panel. */
export function ArtifactCard(props: { artifact: Artifact; ws: Workspace }) {
  const a = () => props.artifact;
  return (
    <div
      class={`pt-card ${a().kind}`}
      classList={{ active: props.ws.selected() === a().id, 'not-pursued': a().kind === 'plan' && (a() as Plan).outcome === 'not-pursued' }}
      onClick={(e) => {
        if (!(e.target as Element).closest('model-story, button, a')) props.ws.select(a().id);
      }}
    >
      <div class="pt-card-head">
        <span class="pt-kind">{KIND_LABEL[a().kind]}</span>
        <strong>{a().title}</strong>
        <ArtifactBadges artifact={a()} />
      </div>
      <Switch>
        <Match when={a().kind === 'evidence'}>
          <EvidenceBody artifact={a() as EvidenceMap} />
        </Match>
        <Match when={a().kind === 'plan'}>
          <PlanSummary plan={a() as Plan} ws={props.ws} />
        </Match>
        <Match when={a().kind === 'draft'}>
          <DraftSummary draft={a() as Draft} />
        </Match>
        <Match when={a().kind === 'tasks'}>
          <TasksBody artifact={a() as TaskList} limit={4} />
        </Match>
        <Match when={a().kind === 'sources'}>
          <SourcesBody artifact={a() as SourceList} />
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

export const KIND_LABEL: Record<Artifact['kind'], string> = {
  evidence: 'Evidence',
  plan: 'Plan',
  draft: 'Draft',
  tasks: 'Tasks',
  sources: 'Sources',
  run: 'Run',
  backlog: 'Backlog',
};

export function ArtifactBadges(props: { artifact: Artifact }) {
  return (
    <span class="pt-badges">
      <Switch>
        <Match when={props.artifact.kind === 'plan' && (props.artifact as Plan)}>
          {(plan) => (
            <>
              <Show when={plan().recommended}>
                <span class="pt-pill recommended">recommended</span>
              </Show>
              <span class={`pt-pill ${plan().outcome}`}>{plan().outcome === 'chosen' ? 'chosen' : 'not pursued'}</span>
            </>
          )}
        </Match>
        <Match when={props.artifact.kind === 'draft' && (props.artifact as Draft)}>
          {(draft) => <span class={`pt-pill ${draft().state}`}>{draft().state === 'merged' ? 'merged into main' : 'open'}</span>}
        </Match>
        <Match when={props.artifact.kind === 'run' && (props.artifact as Run)}>
          {(run) => {
            const failed = () => run().checks.filter((c) => !c.holds).length;
            return (
              <span class={`pt-pill ${failed() ? 'fails' : 'holds'}`}>
                {failed() ? `${failed()} of ${run().checks.length} checks fail` : `${run().checks.length} checks hold`}
              </span>
            );
          }}
        </Match>
      </Switch>
    </span>
  );
}

function PlanSummary(props: { plan: Plan; ws: Workspace }) {
  const taskCount = () => Object.keys(props.plan.sketch?.tasks ?? {}).length;
  const nodeCount = () => Object.keys(props.plan.sketch?.nodes ?? {}).length;
  return (
    <>
      <p class="pt-idea">{props.plan.idea}</p>
      <DataChips data={props.plan.data} />
      <div class="pt-card-foot">
        <Show when={props.plan.sketch}>
          <span class="muted">
            Sketch: {nodeCount()} nodes, {taskCount()} tasks
          </span>
        </Show>
        <Show when={props.plan.outcome === 'not-pursued'}>
          <span class="pt-reason">{props.plan.reason}</span>
          <CreateDraftButton title={props.plan.title} ws={props.ws} />
        </Show>
      </div>
    </>
  );
}

export function DataChips(props: { data: Plan['data'] }) {
  return (
    <ul class="pt-data">
      <For each={props.data}>
        {(d) => (
          <li class={d.status} title={d.status}>
            {d.label}
          </li>
        )}
      </For>
    </ul>
  );
}

function DraftSummary(props: { draft: Draft }) {
  const shown = () => props.draft.changes.slice(0, 3);
  const more = () => props.draft.changes.length - shown().length;
  return (
    <>
      <ChangeList changes={shown()} />
      <Show when={more() > 0}>
        <p class="muted pt-more">and {more()} more</p>
      </Show>
    </>
  );
}

export function ChangeList(props: { changes: Draft['changes'] }) {
  return (
    <ul class="pt-changes">
      <For each={props.changes}>
        {(change) => (
          <li class={change.op}>
            <span class="pt-op">{OP_SIGN[change.op]}</span>
            {change.text}
          </li>
        )}
      </For>
    </ul>
  );
}

const OP_SIGN = { add: '+', change: '~', remove: '−' } as const;

export function EvidenceBody(props: { artifact: EvidenceMap; full?: boolean }) {
  return (
    <table class="pt-evidence">
      <tbody>
        <For each={props.artifact.layers}>
          {(layer) => (
            <tr>
              <td>
                <strong>{layer.name}</strong>
                <div class="muted">{layer.question}</div>
              </td>
              <td>
                <span class={`pt-pill ${layer.evidence}`}>{layer.evidence}</span>
              </td>
              <Show when={props.full}>
                <td class="pt-note">{layer.note}</td>
              </Show>
            </tr>
          )}
        </For>
      </tbody>
    </table>
  );
}

export function TasksBody(props: { artifact: TaskList; limit?: number; renderTask?: (task: TaskList['tasks'][number]) => JSX.Element }) {
  const shown = () => (props.limit ? props.artifact.tasks.slice(0, props.limit) : props.artifact.tasks);
  const done = () => props.artifact.tasks.filter((t) => t.doneIn).length;
  return (
    <>
      <p class="muted">
        {done()} done, {props.artifact.tasks.length - done()} open
      </p>
      <ul class="pt-tasks">
        <For each={shown()}>
          {(task) => (
            <li classList={{ done: !!task.doneIn }}>
              <span class="pt-check">{task.doneIn ? '✓' : '○'}</span>
              <span>
                {props.renderTask ? props.renderTask(task) : task.instructions}
                <Show when={task.doneIn}>
                  <span class="muted"> · done in draft “{task.doneIn}”</span>
                </Show>
              </span>
            </li>
          )}
        </For>
      </ul>
      <Show when={shown().length < props.artifact.tasks.length}>
        <p class="muted pt-more">and {props.artifact.tasks.length - shown().length} more</p>
      </Show>
    </>
  );
}

export function SourcesBody(props: { artifact: SourceList; full?: boolean }) {
  return (
    <ul class="pt-sources">
      <For each={props.artifact.sources}>
        {(source) => (
          <li>
            <span class={`verification ${source.verification}`}>{VERIFICATION[source.verification]}</span>
            <span>
              <Show when={props.full} fallback={source.title}>
                <a href={source.url} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()}>
                  {source.title}
                </a>
              </Show>
              <span class="muted"> · {source.publisher}</span>
              <Show when={props.full && source.note}>
                <div class="muted">{source.note}</div>
              </Show>
            </span>
          </li>
        )}
      </For>
    </ul>
  );
}

const VERIFICATION = { primaryRead: 'read in full', snippetOnly: 'snippet only', unverified: 'not read' } as const;

export function RunBody(props: { artifact: Run; ws: Workspace }) {
  return (
    <>
      <ul class="pt-checks">
        <For each={props.artifact.checks}>
          {(check) => (
            <li classList={{ holds: check.holds, fails: !check.holds }}>
              <span class="pt-check">{check.holds ? '✓' : '✗'}</span>
              {check.label}
            </li>
          )}
        </For>
        <For each={props.artifact.warnings ?? []}>
          {(warning) => (
            <li class="warning">
              <span class="pt-check">!</span>
              {warning}
            </li>
          )}
        </For>
      </ul>
      <Show when={props.artifact.live}>
        {(live) => <div class="pt-live-snippet story">{props.ws.html(live())}</div>}
      </Show>
    </>
  );
}

export function BacklogBody(props: { artifact: Backlog; ws: Workspace }) {
  return (
    <ul class="pt-backlog">
      <For each={props.artifact.items}>
        {(item) => (
          <li>
            <span>
              <strong>{item.title}</strong>
              <span class="muted"> · {item.reason}</span>
            </span>
            <CreateDraftButton title={item.title} ws={props.ws} />
          </li>
        )}
      </For>
    </ul>
  );
}

export function CreateDraftButton(props: { title: string; ws: Workspace }) {
  return (
    <Show when={!props.ws.drafted(props.title)} fallback={<span class="pt-pill open">draft created</span>}>
      <button
        class="pt-button"
        onClick={(e) => {
          e.stopPropagation();
          props.ws.createDraft(props.title);
        }}
      >
        Create draft
      </button>
    </Show>
  );
}
