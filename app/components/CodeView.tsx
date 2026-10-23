import { python } from '@codemirror/lang-python';
import { defaultHighlightStyle, syntaxHighlighting } from '@codemirror/language';
import { EditorState, RangeSetBuilder } from '@codemirror/state';
import { Decoration, EditorView, lineNumbers } from '@codemirror/view';
import { onCleanup, onMount } from 'solid-js';

export type LineRange = { from: number; to: number };

/**
 * Read-only code with line numbers, counted from `firstLine` for an excerpt; `highlight` marks lines
 * (1-based) and scrolls to them; `wrap` wraps long lines, for narrow spaces.
 */
export function CodeView(props: { text: string; language?: string; highlight?: LineRange; firstLine?: number; wrap?: boolean; class?: string }) {
  let host!: HTMLDivElement;
  onMount(() => {
    const range = props.highlight;
    const view = new EditorView({
      parent: host,
      state: EditorState.create({
        doc: props.text,
        extensions: [
          EditorState.readOnly.of(true),
          lineNumbers({ formatNumber: (n) => String(n + (props.firstLine ?? 1) - 1) }),
          ...(props.language === 'python' ? [python(), syntaxHighlighting(defaultHighlightStyle)] : []),
          ...(range ? [highlightLines(range)] : []),
          ...(props.wrap ? [EditorView.lineWrapping] : []),
        ],
      }),
    });
    if (range) {
      requestAnimationFrame(() =>
        view.dispatch({ effects: EditorView.scrollIntoView(view.state.doc.line(range.from).from, { y: 'start', yMargin: 24 }) }),
      );
    }
    onCleanup(() => view.destroy());
  });
  return <div ref={host} class={`code-view ${props.class ?? ''}`} />;
}

/** First and last line (1-based) of a top-level Python function. */
export function functionLines(text: string, name: string): LineRange | undefined {
  const lines = text.split('\n');
  const start = lines.findIndex((line) => line.startsWith(`def ${name}(`));
  if (start < 0) return undefined;
  let end = start + 1;
  while (end < lines.length && (lines[end]!.trim() === '' || /^\s/.test(lines[end]!))) end++;
  while (end > start + 1 && lines[end - 1]!.trim() === '') end--;
  return { from: start + 1, to: end };
}

function highlightLines(range: LineRange) {
  const line = Decoration.line({ class: 'code-highlight' });
  return EditorView.decorations.compute([], (state) => {
    const builder = new RangeSetBuilder<Decoration>();
    for (let n = range.from; n <= Math.min(range.to, state.doc.lines); n++) builder.add(state.doc.line(n).from, state.doc.line(n).from, line);
    return builder.finish();
  });
}
