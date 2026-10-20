import { syntaxTree } from '@codemirror/language';
import { StateField, type EditorState, type Extension, type Range } from '@codemirror/state';
import { Decoration, EditorView, WidgetType, type DecorationSet } from '@codemirror/view';
import type { SyntaxNodeRef } from '@lezer/common';
import { createStory, type StoryContext } from './elements';

/** Elements that render as their own block (figure, claim box, input list) rather than inline. */
const BLOCK_TAGS = new Set(['model-figure', 'model-claim', 'model-assumptions']);

const ELEMENT = /<(model-[a-z-]+)((?:\s+[a-z-]+(?:="[^"]*")?)*)\s*>([\s\S]*?)<\/\1>/g;

type ModelElement = { tag: string; from: number; to: number; source: string };

/**
 * Obsidian-style live preview: Markdown and `model-*` elements render in place, and the raw
 * syntax of a token reappears while the selection touches it.
 */
export function livePreview(context: StoryContext): Extension {
  return StateField.define<DecorationSet>({
    create: (state) => decorate(state, context),
    update: (decorations, tr) =>
      tr.docChanged || tr.selection || syntaxTree(tr.state) !== syntaxTree(tr.startState) ? decorate(tr.state, context) : decorations,
    provide: (field) => EditorView.decorations.from(field),
  });
}

function decorate(state: EditorState, context: StoryContext): DecorationSet {
  const decorations: Range<Decoration>[] = [];
  const rendered: ModelElement[] = [];
  for (const element of modelElements(state.doc.toString())) {
    const block = BLOCK_TAGS.has(element.tag) && onOwnLines(state, element);
    if (touches(state, element.from, element.to)) {
      decorations.push(SOURCE.range(element.from, element.to));
      decorations.push(Decoration.widget({ widget: new StoryWidget(element.source, context, block, true), side: 1, block }).range(element.to));
    } else {
      decorations.push(Decoration.replace({ widget: new StoryWidget(element.source, context, block, false), block }).range(element.from, element.to));
      rendered.push(element);
    }
  }
  syntaxTree(state).iterate({
    enter: (node) => {
      if (rendered.some((e) => node.from >= e.from && node.to <= e.to)) return false;
      decorations.push(...markdownDecorations(state, node));
      return undefined;
    },
  });
  return Decoration.set(decorations, true);
}

function modelElements(text: string): ModelElement[] {
  return [...text.matchAll(ELEMENT)].map((m) => ({ tag: m[1]!, from: m.index, to: m.index + m[0].length, source: m[0] }));
}

function markdownDecorations(state: EditorState, node: SyntaxNodeRef): Range<Decoration>[] {
  const heading = /^ATXHeading(\d)$/.exec(node.name);
  if (heading) return [Decoration.line({ class: `cm-md-h${heading[1]}` }).range(state.doc.lineAt(node.from).from)];
  switch (node.name) {
    case 'HeaderMark':
      return lineTouched(state, node.from) ? [MARKUP.range(node.from, node.to)] : [hide(state, node.from, node.to + 1)];
    case 'StrongEmphasis':
      return [STRONG.range(node.from, node.to)];
    case 'Emphasis':
      return [EMPHASIS.range(node.from, node.to)];
    case 'InlineCode':
      return [CODE.range(node.from, node.to)];
    case 'Link':
      return [LINK.range(node.from, node.to)];
    case 'EmphasisMark':
    case 'CodeMark':
    case 'LinkMark':
    case 'URL':
    case 'LinkTitle': {
      const parent = node.node.parent;
      const owner = parent ? [parent.from, parent.to] : [node.from, node.to];
      return touches(state, owner[0]!, owner[1]!) ? [MARKUP.range(node.from, node.to)] : [hide(state, node.from, node.to)];
    }
    case 'ListMark': {
      const bullet = node.node.parent?.parent?.name === 'BulletList';
      if (!bullet || lineTouched(state, node.from)) return [MARKUP.range(node.from, node.to)];
      return [Decoration.replace({ widget: BULLET }).range(node.from, node.to)];
    }
    default:
      return [];
  }
}

/** Renders one element through the same custom elements as the read view. */
class StoryWidget extends WidgetType {
  constructor(
    readonly source: string,
    readonly context: StoryContext,
    readonly block: boolean,
    readonly preview: boolean,
  ) {
    super();
  }

  eq(other: StoryWidget): boolean {
    return other.source === this.source && other.block === this.block && other.preview === this.preview;
  }

  toDOM(view: EditorView): HTMLElement {
    const wrapper = document.createElement(this.block ? 'div' : 'span');
    wrapper.className = `cm-story-widget ${this.block ? 'block' : 'inline'}${this.preview ? ' preview' : ''}`;
    wrapper.append(createStory(this.source, this.context));
    if (this.block && !this.preview) {
      const edit = document.createElement('button');
      edit.className = 'cm-story-edit';
      edit.textContent = 'edit';
      edit.title = 'Edit the source of this element';
      edit.addEventListener('mousedown', (event) => {
        event.preventDefault();
        view.dispatch({ selection: { anchor: view.posAtDOM(wrapper) } });
        view.focus();
      });
      wrapper.append(edit);
    }
    return wrapper;
  }

  /** Blocks keep their own clicks (map sliders, model focus); inline values let a click place the cursor. */
  ignoreEvent(): boolean {
    return this.block;
  }
}

class BulletWidget extends WidgetType {
  toDOM(): HTMLElement {
    const span = document.createElement('span');
    span.className = 'cm-md-bullet';
    span.textContent = '•';
    return span;
  }
}

const SOURCE = Decoration.mark({ class: 'cm-story-source' });
const MARKUP = Decoration.mark({ class: 'cm-md-markup' });
const STRONG = Decoration.mark({ class: 'cm-md-strong' });
const EMPHASIS = Decoration.mark({ class: 'cm-md-em' });
const CODE = Decoration.mark({ class: 'cm-md-code' });
const LINK = Decoration.mark({ class: 'cm-md-link' });
const BULLET = new BulletWidget();

function hide(state: EditorState, from: number, to: number): Range<Decoration> {
  return Decoration.replace({}).range(from, Math.min(to, state.doc.lineAt(from).to));
}

function touches(state: EditorState, from: number, to: number): boolean {
  return state.selection.ranges.some((r) => r.from <= to && r.to >= from);
}

function lineTouched(state: EditorState, pos: number): boolean {
  const line = state.doc.lineAt(pos);
  return touches(state, line.from, line.to);
}

/** Block widgets must cover whole lines; an element sharing a line with text stays inline. */
function onOwnLines(state: EditorState, element: ModelElement): boolean {
  return state.doc.lineAt(element.from).from === element.from && state.doc.lineAt(element.to).to === element.to;
}
