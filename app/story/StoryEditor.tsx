import { defaultKeymap, history, historyKeymap } from '@codemirror/commands';
import { markdown } from '@codemirror/lang-markdown';
import { EditorState } from '@codemirror/state';
import { EditorView, keymap } from '@codemirror/view';
import { onCleanup, onMount } from 'solid-js';
import type { StoryContext } from './elements';
import { livePreview } from './livePreview';

/** Markdown source of the story with live rendering; `text` is only read when the editor mounts. */
export function StoryEditor(props: { text: string; context: StoryContext; onChange: (text: string) => void }) {
  let host!: HTMLDivElement;
  onMount(() => {
    const view = new EditorView({
      parent: host,
      state: EditorState.create({
        doc: props.text,
        selection: { anchor: props.text.length },
        extensions: [
          history(),
          keymap.of([...defaultKeymap, ...historyKeymap]),
          markdown(),
          EditorView.lineWrapping,
          livePreview(props.context),
          EditorView.updateListener.of((update) => {
            if (update.docChanged) props.onChange(update.state.doc.toString());
          }),
        ],
      }),
    });
    onCleanup(() => view.destroy());
  });
  return <div ref={host} class="story-editor" />;
}
