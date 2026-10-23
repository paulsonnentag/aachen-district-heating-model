import { python } from '@codemirror/lang-python';
import { defaultHighlightStyle, syntaxHighlighting } from '@codemirror/language';
import { EditorState } from '@codemirror/state';
import { EditorView, lineNumbers } from '@codemirror/view';
import { onCleanup, onMount } from 'solid-js';

/** Read-only code with line numbers; `wrap` wraps long lines, for narrow spaces. */
export function CodeView(props: { text: string; language?: string; wrap?: boolean; class?: string }) {
  let host!: HTMLDivElement;
  onMount(() => {
    const view = new EditorView({
      parent: host,
      state: EditorState.create({
        doc: props.text,
        extensions: [
          EditorState.readOnly.of(true),
          lineNumbers(),
          ...(props.language === 'python' ? [python(), syntaxHighlighting(defaultHighlightStyle)] : []),
          ...(props.wrap ? [EditorView.lineWrapping] : []),
        ],
      }),
    });
    onCleanup(() => view.destroy());
  });
  return <div ref={host} class={`code-view ${props.class ?? ''}`} />;
}
