import { marked } from 'marked';
import { createEffect, createMemo, createSignal, on, Show, untrack } from 'solid-js';
import { createStory, type StoryContext } from './elements';
import { StoryEditor } from './StoryEditor';

/**
 * The narrative document, readable or editable. Raw HTML passes through Markdown, so `model-*`
 * elements become live. Edits only live in memory: a reload brings back the file.
 */
export function StoryPane(props: { text: string; context: StoryContext; split: boolean; hidden: boolean }) {
  const [draft, setDraft] = createSignal(props.text);
  const [editing, setEditing] = createSignal(false);
  const [revision, setRevision] = createSignal(0);
  createEffect(on(() => props.text, (text) => revert(text), { defer: true }));

  const story = createMemo(() => (editing() ? undefined : createStory(marked.parse(draft(), { async: false }), props.context)));
  /** A fresh editor per session: entering edit mode, or reverting while editing. */
  const session = createMemo(() => (editing() ? { revision: revision(), text: untrack(draft) } : undefined));
  const edited = () => draft() !== props.text;

  function revert(text: string) {
    setDraft(text);
    setRevision((r) => r + 1);
  }

  return (
    <article class="story" classList={{ split: props.split }} hidden={props.hidden}>
      <div class="story-toolbar">
        <div class="segmented">
          <button classList={{ active: !editing() }} onClick={() => setEditing(false)}>Read</button>
          <button classList={{ active: editing() }} onClick={() => setEditing(true)}>Edit</button>
        </div>
        <Show when={edited()}>
          <span class="story-edited">Edited · not saved</span>
          <button class="story-revert" onClick={() => revert(props.text)}>Revert</button>
        </Show>
      </div>
      <Show when={session()} keyed fallback={<div class="story-body">{story()}</div>}>
        {(current) => (
          <div class="story-body editing">
            <StoryEditor text={current.text} context={props.context} onChange={setDraft} />
          </div>
        )}
      </Show>
    </article>
  );
}
