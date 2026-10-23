import { createResource, For, Match, Switch, type Accessor, type JSX } from 'solid-js';
import { render } from 'solid-js/web';
import { BASELINE } from '../../lib/runtime/runs';
import {
  storyAssumptions,
  storyClaim,
  storyFigure,
  storyLink,
  storySource,
  storyValue,
  type ScenarioRuns,
  type StoryTag,
} from '../../lib/story/resolve';
import { CellMap } from '../components/CellMap';
import { detailChart } from '../components/ValueView';
import { Plot } from '../components/Plot';
import { formatValue } from '../values';

export type FocusTarget = { scenario: string; dataset?: string; node?: string; open?: boolean };

export type StoryContext = {
  runs: ScenarioRuns;
  focus: (target: FocusTarget) => void;
  /** What the model pane currently shows, so the matching figure can be highlighted. */
  focused: Accessor<FocusTarget | undefined>;
  scenarioLabel: (name: string) => string;
};

type ViewProps = { attrs: Record<string, string>; content: string; context: StoryContext; host: HTMLElement };

const FIGURE_WIDTH = 590;

/** Root of a rendered story; the `model-*` elements inside it read the context from it when they connect. */
export function createStory(html: string, context: StoryContext): HTMLElement {
  defineElements();
  const story = document.createElement('model-story') as StoryRoot;
  story.context = context;
  story.innerHTML = html;
  return story;
}

const VIEWS: Record<StoryTag, (props: ViewProps) => JSX.Element> = {
  'model-value': ValueView,
  'model-figure': FigureView,
  'model-claim': ClaimView,
  'model-assumptions': AssumptionsView,
  'model-link': LinkView,
  'model-source': SourceView,
};

function defineElements(): void {
  if (!customElements.get('model-story')) customElements.define('model-story', StoryRoot);
  for (const tag of Object.keys(VIEWS)) {
    if (!customElements.get(tag)) customElements.define(tag, class extends StoryElement {});
  }
}

class StoryRoot extends HTMLElement {
  context?: StoryContext;
}

/** Light DOM, so story styles apply; the original content is kept as caption, claim text or fallback. */
class StoryElement extends HTMLElement {
  private content?: string;
  private dispose?: () => void;

  connectedCallback(): void {
    const context = (this.closest('model-story') as StoryRoot | null)?.context;
    if (!context || this.dispose) return;
    this.content ??= this.innerHTML;
    const props: ViewProps = {
      attrs: Object.fromEntries(this.getAttributeNames().map((name) => [name, this.getAttribute(name) ?? ''])),
      content: this.content,
      context,
      host: this,
    };
    const View = VIEWS[this.localName as StoryTag];
    this.replaceChildren();
    this.dispose = render(() => <View {...props} />, this);
  }

  disconnectedCallback(): void {
    this.dispose?.();
    this.dispose = undefined;
  }
}

function ValueView(props: ViewProps) {
  const [value] = createResource(() => storyValue(props.attrs, props.context.runs));
  return (
    <Switch fallback={<span class="story-pending" innerHTML={props.content} />}>
      <Match when={value.error}>
        <StoryError error={value.error} />
      </Match>
      <Match when={value()}>
        {(v) => (
          <button
            class="story-value"
            classList={{ active: isFocused(props.context, v().ref) }}
            title={v().description}
            onClick={() => focusFrom(props, { scenario: v().ref.scenario, dataset: v().ref.dataset })}
          >
            {v().text}
          </button>
        )}
      </Match>
    </Switch>
  );
}

function FigureView(props: ViewProps) {
  const [figure] = createResource(() => storyFigure(props.attrs, props.context.runs));
  const ref = () => ({ dataset: props.attrs.dataset ?? '', scenario: props.attrs.scenario ?? BASELINE });
  const onClick = (event: MouseEvent) => {
    if ((event.target as Element).closest('.map-controls')) return;
    focusFrom(props, ref());
  };
  return (
    <figure class="story-figure" classList={{ active: isFocused(props.context, ref()) }} onClick={onClick}>
      <Switch fallback={<div class="story-figure-pending">Running the model…</div>}>
        <Match when={figure.error}>
          <StoryError error={figure.error} />
        </Match>
        <Match when={figure()}>
          {(f) =>
            f().view === 'map' ? (
              <CellMap tensor={f().tensor} baseline={f().baseline} />
            ) : (
              <Plot class="story-chart" render={() => detailChart(f().tensor, f().baseline, FIGURE_WIDTH)} />
            )
          }
        </Match>
      </Switch>
      <figcaption>
        <span innerHTML={props.content} />
        <span class="story-source">
          <code>{ref().dataset}</code>
          {ref().scenario !== BASELINE ? ` · ${props.context.scenarioLabel(ref().scenario)}, baseline dashed` : ''}
          <span class="story-open"> · inspect in model →</span>
        </span>
      </figcaption>
    </figure>
  );
}

function ClaimView(props: ViewProps) {
  const [claim] = createResource(() => storyClaim(props.attrs, props.context.runs));
  return (
    <Switch fallback={<div class="story-claim pending" innerHTML={props.content} />}>
      <Match when={claim.error}>
        <StoryError error={claim.error} />
      </Match>
      <Match when={claim()}>
        {(c) => (
          <div
            class="story-claim"
            classList={{ holds: c().holds, fails: !c().holds, active: isFocused(props.context, c().ref) }}
            title={c().description}
            onClick={() => focusFrom(props, { scenario: c().ref.scenario, dataset: c().ref.dataset })}
          >
            <span class="story-claim-badge">{c().holds ? '✓ holds' : '✗ fails'}</span>
            <span class="story-claim-text" innerHTML={props.content} />
            <span class="story-claim-check">
              Checked against the model: <code>{c().ref.dataset}</code> = {formatValue(c().left)} is {c().holds ? '' : 'not '}
              {c().relation} {formatValue(c().right)}
            </span>
          </div>
        )}
      </Match>
    </Switch>
  );
}

function AssumptionsView(props: ViewProps) {
  const [result] = createResource(() => storyAssumptions(props.attrs, props.context.runs));
  const count = (kind: string) => result()?.inputs.filter((i) => i.kind === kind).length ?? 0;
  return (
    <Switch fallback={<div class="story-figure-pending">Tracing inputs…</div>}>
      <Match when={result.error}>
        <StoryError error={result.error} />
      </Match>
      <Match when={result()}>
        {(r) => (
          <div class="story-inputs">
            <p class="muted">
              <code>{r().ref.dataset}</code> depends on {r().inputs.length} inputs: {count('assumption')} assumptions and{' '}
              {count('sourced')} read from a source.
            </p>
            <ul>
              <For each={r().inputs}>
                {(input) => (
                  <li>
                    <button
                      class="story-input"
                      classList={{ active: isFocused(props.context, { scenario: r().ref.scenario, dataset: input.dataset }) }}
                      title={input.text}
                      onClick={() => focusFrom(props, { scenario: r().ref.scenario, dataset: input.dataset })}
                    >
                      <span class={`badge ${input.kind}`}>{input.kind}</span>
                      <code>{input.dataset}</code>
                    </button>
                  </li>
                )}
              </For>
            </ul>
          </div>
        )}
      </Match>
    </Switch>
  );
}

function LinkView(props: ViewProps) {
  const [link] = createResource(() => storyLink(props.attrs, props.context.runs));
  return (
    <Switch fallback={<span innerHTML={props.content} />}>
      <Match when={link.error}>
        <StoryError error={link.error} />
      </Match>
      <Match when={link()}>
        {(l) => <button class="story-link" onClick={() => focusFrom(props, l())} innerHTML={props.content} />}
      </Match>
    </Switch>
  );
}

function SourceView(props: ViewProps) {
  const [source] = createResource(() => storySource(props.attrs, props.context.runs));
  return (
    <Switch fallback={<span innerHTML={props.content} />}>
      <Match when={source.error}>
        <StoryError error={source.error} />
      </Match>
      <Match when={source()}>
        {(s) => (
          <a
            class="story-source-link"
            classList={{ unverified: s().verification !== 'primaryRead' }}
            href={s().url}
            target="_blank"
            rel="noreferrer"
            title={`${s().title}${s().publisher ? ` · ${s().publisher}` : ''} · ${s().verification}`}
            innerHTML={props.content}
          />
        )}
      </Match>
    </Switch>
  );
}

function StoryError(props: { error: unknown }) {
  const message = () => (props.error instanceof Error ? props.error.message : String(props.error));
  return <span class="story-error" title={message()}>⚠ {message()}</span>;
}

function focusFrom(props: ViewProps, target: FocusTarget): void {
  props.context.focus(target);
  requestAnimationFrame(() => props.host.scrollIntoView({ block: 'nearest', behavior: 'smooth' }));
}

function isFocused(context: StoryContext, ref: { scenario: string; dataset: string }): boolean {
  const focused = context.focused();
  return focused?.dataset === ref.dataset && focused.scenario === ref.scenario;
}
