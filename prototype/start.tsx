import { createResource, For, Show } from 'solid-js';
import { render } from 'solid-js/web';
import '../app/styles.css';
import { draftsOf, experiments } from './data/experiments';
import type { Experiment } from './data/types';
import { findEntry } from './model';
import './prototype.css';

render(() => <Start />, document.getElementById('root')!);

function Start() {
  return (
    <div class="pt-start">
      <header class="pt-start-head">
        <h1>Aachen modelling demo</h1>
        <p class="muted">Two research questions, each as a finished model and as the chat with the research agent that built it.</p>
      </header>
      <h2 class="pt-section">Text and model</h2>
      <p class="muted pt-section-note">The workbench as it is: the story with live numbers next to the pipeline that computes them.</p>
      <div class="pt-experiments">
        <For each={experiments}>{(experiment) => <ModelCard experiment={experiment} />}</For>
      </div>
      <h2 class="pt-section">Chats</h2>
      <p class="muted pt-section-note">
        How each model could have come about: plans, drafts, tasks and runs as artifacts in the chat. Step through with the arrow keys.
      </p>
      <div class="pt-experiments">
        <For each={experiments}>{(experiment) => <ChatCard experiment={experiment} />}</For>
      </div>
    </div>
  );
}

function ModelCard(props: { experiment: Experiment }) {
  const [entry] = createResource(() => findEntry(props.experiment.pipeline));
  const href = () => {
    const params = new URLSearchParams({ pipeline: props.experiment.pipeline });
    if (entry()?.story) params.set('view', 'split');
    return `app.html?${params}`;
  };
  const stats = () => {
    const e = entry();
    if (!e) return [];
    const pipeline = e.raw as { sources?: Record<string, unknown>; nodes?: unknown[]; datasets?: Record<string, unknown> };
    return [
      { label: 'sources', value: Object.keys(pipeline.sources ?? {}).length },
      { label: 'nodes', value: pipeline.nodes?.length ?? 0 },
      { label: 'datasets', value: Object.keys(pipeline.datasets ?? {}).length },
      { label: 'scenarios', value: e.scenarios.length },
    ];
  };

  return (
    <a class="pt-experiment" classList={{ parked: props.experiment.status === 'parked' }} href={href()}>
      <div class="pt-experiment-head">
        <span class={`pt-pill ${props.experiment.status}`}>{props.experiment.status}</span>
        <span class="muted">{entry()?.story ? 'Story + model' : 'Model only, no story yet'}</span>
      </div>
      <h2>{props.experiment.title}</h2>
      <p class="pt-question">{props.experiment.question}</p>
      <p class="muted">{props.experiment.summary}</p>
      <Show when={entry()} fallback={<p class="muted">{entry.error ? String(entry.error) : 'Loading pipeline…'}</p>}>
        <dl class="pt-stats four">
          <For each={stats()}>
            {(stat) => (
              <div>
                <dt>{stat.label}</dt>
                <dd>{stat.value}</dd>
              </div>
            )}
          </For>
        </dl>
      </Show>
    </a>
  );
}

function ChatCard(props: { experiment: Experiment }) {
  const href = `workbench.html?experiment=${props.experiment.id}`;
  const stats = () => [
    { label: 'messages', value: props.experiment.chat.length },
    { label: 'drafts', value: draftsOf(props.experiment).length },
    { label: 'open tasks', value: props.experiment.tasks.length },
  ];

  return (
    <div class="pt-experiment">
      <div class="pt-experiment-head">
        <span class={`pt-pill ${props.experiment.status}`}>{props.experiment.status}</span>
        <span class="muted">Updated {props.experiment.updated}</span>
      </div>
      <h2>{props.experiment.title}</h2>
      <p class="pt-question">{props.experiment.question}</p>
      <dl class="pt-stats">
        <For each={stats()}>
          {(stat) => (
            <div>
              <dt>{stat.label}</dt>
              <dd>{stat.value}</dd>
            </div>
          )}
        </For>
      </dl>
      <div class="pt-actions">
        <a class="pt-button primary" href={`${href}&step=1`}>
          Step through the chat
        </a>
        <a class="pt-button" href={href}>
          Show the whole chat
        </a>
      </div>
    </div>
  );
}
