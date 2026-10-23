import { createEffect, For, Match, on, onCleanup, onMount, Show, Switch } from 'solid-js';
import type { Artifact, Block, Message } from '../data/types';
import type { Workspace } from '../workspace';
import { ArtifactCard } from './cards';

/** The chat, either whole or revealed one message at a time (`step` messages shown). */
export function Chat(props: { ws: Workspace; step?: number; onStep: (step: number | undefined) => void }) {
  const chat = () => props.ws.experiment.chat;
  const visible = () => (props.step === undefined ? chat() : chat().slice(0, props.step));
  let thread!: HTMLDivElement;
  createEffect(
    on(
      () => props.step,
      (step) => {
        if (step === undefined) return;
        requestAnimationFrame(() => thread.lastElementChild?.scrollIntoView({ block: 'start', behavior: 'smooth' }));
      },
    ),
  );
  onMount(() => {
    const onKey = (e: KeyboardEvent) => {
      if (props.step === undefined || (e.target instanceof Element && e.target.closest('input, textarea'))) return;
      if (e.key === 'ArrowRight' || e.key === 'ArrowDown') props.onStep(Math.min(chat().length, props.step + 1));
      else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') props.onStep(Math.max(1, props.step - 1));
      else return;
      e.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    onCleanup(() => window.removeEventListener('keydown', onKey));
  });

  return (
    <section class="pt-chat">
      <div class="pt-stepper">
        <Show
          when={props.step}
          fallback={
            <button class="pt-button" onClick={() => props.onStep(1)}>
              Step through
            </button>
          }
        >
          {(step) => (
            <>
              <button class="pt-button" disabled={step() <= 1} onClick={() => props.onStep(step() - 1)}>
                ← Back
              </button>
              <span class="pt-step-count">
                {step()} / {chat().length}
              </span>
              <button class="pt-button primary" disabled={step() >= chat().length} onClick={() => props.onStep(step() + 1)}>
                Next →
              </button>
              <span class="muted pt-step-hint">or use the arrow keys</span>
              <button class="pt-button" onClick={() => props.onStep(undefined)}>
                Show all
              </button>
            </>
          )}
        </Show>
      </div>
      <div ref={thread} class="pt-thread" classList={{ stepping: props.step !== undefined }}>
        <For each={visible()}>{(message) => <MessageView message={message} ws={props.ws} />}</For>
      </div>
      <form class="pt-composer" onSubmit={(e) => e.preventDefault()}>
        <textarea rows={2} placeholder="Ask a question or give the agent a task…" disabled />
        <button type="submit" disabled>
          Send
        </button>
        <span class="muted">Click dummy: the agent isn’t connected.</span>
      </form>
    </section>
  );
}

function MessageView(props: { message: Message; ws: Workspace }) {
  const isAgent = () => props.message.author === 'agent';
  return (
    <article class="pt-message" classList={{ agent: isAgent() }}>
      <div class="pt-avatar">{isAgent() ? 'A' : 'P'}</div>
      <div class="pt-message-body">
        <div class="pt-message-head">
          <strong>{isAgent() ? 'Agent' : 'Paul'}</strong>
          <span class="muted">{props.message.time}</span>
        </div>
        <For each={props.message.blocks}>{(block) => <BlockView block={block} ws={props.ws} />}</For>
      </div>
    </article>
  );
}

function BlockView(props: { block: Block; ws: Workspace }) {
  return (
    <Switch fallback={<ArtifactCard artifact={props.block as Artifact} ws={props.ws} />}>
      <Match when={props.block.kind === 'text' && props.block}>
        {(block) => <div class="pt-text">{props.ws.markdown(block().text)}</div>}
      </Match>
      <Match when={props.block.kind === 'tools' && props.block}>
        {(block) => (
          <details class="pt-tools">
            <summary>
              {block().calls.length} tool call{block().calls.length === 1 ? '' : 's'}
              <span class="muted"> · {block().calls[0]}</span>
            </summary>
            <ul>
              <For each={block().calls}>{(call) => <li>{call}</li>}</For>
            </ul>
          </details>
        )}
      </Match>
    </Switch>
  );
}
