import { marked } from 'marked';
import { createEffect, createResource, createSignal, on, Show } from 'solid-js';
import { render } from 'solid-js/web';
import '../app/styles.css';
import { createStory, type FocusTarget, type StoryContext } from '../app/story/elements';
import { Chat } from './chat/Chat';
import { findExperiment } from './data/experiments';
import type { Artifact, Message } from './data/types';
import { findEntry, runOf } from './model';
import { Panel, type View } from './panel/Panel';
import './prototype.css';
import type { Workspace } from './workspace';

render(() => <Workbench />, document.getElementById('root')!);

/** Chat on the left; the panel on the right only shows what was selected in the chat. */
function Workbench() {
  const params = new URLSearchParams(location.search);
  const experiment = findExperiment(params.get('experiment'));
  const [entry] = createResource(() => findEntry(experiment.pipeline));
  const [view, setView] = createSignal<View>();
  const [created, setCreated] = createSignal<string[]>([]);
  const [step, setStep] = createSignal(stepOf(params.get('step'), experiment.chat.length));
  document.title = `${experiment.title} · Model workbench`;

  const selected = () => {
    const current = view();
    return current?.kind === 'artifact' ? current.id : undefined;
  };
  const focus = (target: FocusTarget) => {
    const current = view();
    const from = current?.kind === 'artifact' ? current.id : current?.from;
    setView({ kind: 'model', target: { ...target }, from });
  };
  const context: StoryContext = {
    runs: async (scenario) => runOf(await findEntry(experiment.pipeline), scenario),
    focus,
    focused: () => {
      const current = view();
      return current?.kind === 'model' ? current.target : undefined;
    },
    scenarioLabel: (name) => entry()?.scenarios.find((s) => s.name === name)?.scenario.label ?? name,
  };
  const ws: Workspace = {
    experiment,
    selected,
    select: (id) => setView({ kind: 'artifact', id }),
    focus,
    markdown: (text) => createStory(marked.parse(text, { async: false }), context),
    html: (html) => createStory(html, context),
    drafted: (title) => created().includes(title),
    createDraft: (title) => setCreated((list) => [title, ...list]),
  };

  createEffect(
    on(step, (current) => {
      const next = new URLSearchParams({ experiment: experiment.id });
      if (current !== undefined) next.set('step', String(current));
      history.replaceState(null, '', `?${next}`);
      if (current === undefined) return;
      const artifact = latestArtifact(experiment.chat.slice(0, current));
      setView(artifact ? { kind: 'artifact', id: artifact.id } : undefined);
    }),
  );

  return (
    <div class="pt-wb">
      <header class="pt-header">
        <a class="pt-back" href="index.html">
          ← Experiments
        </a>
        <h1>{experiment.title}</h1>
        <span class={`pt-pill ${experiment.status}`}>{experiment.status}</span>
        <span class="muted pt-question">{experiment.question}</span>
      </header>
      <div class="pt-body">
        <Chat ws={ws} step={step()} onStep={setStep} />
        <Show when={entry()} fallback={<p class="muted pt-pad">{entry.error ? String(entry.error) : 'Loading pipeline…'}</p>}>
          {(e) => <Panel ws={ws} entry={e()} view={view()} />}
        </Show>
      </div>
    </div>
  );
}

function stepOf(param: string | null, messages: number): number | undefined {
  if (param === null) return undefined;
  const step = Number(param);
  return Number.isInteger(step) ? Math.min(Math.max(step, 1), messages) : 1;
}

/** The artifact the panel shows at a step: the lead artifact of the latest message that has any. */
function latestArtifact(messages: Message[]): Artifact | undefined {
  for (const message of [...messages].reverse()) {
    const artifact = leadArtifact(message);
    if (artifact) return artifact;
  }
  return undefined;
}

/** What a message produced, rather than its context: drafts before runs before plans. */
function leadArtifact(message: Message): Artifact | undefined {
  const order: Artifact['kind'][] = ['draft', 'run', 'plan', 'tasks', 'backlog', 'sources', 'evidence'];
  const artifacts = message.blocks.filter((block): block is Artifact => 'id' in block);
  return order.flatMap((kind) => artifacts.filter((a) => a.kind === kind))[0];
}
