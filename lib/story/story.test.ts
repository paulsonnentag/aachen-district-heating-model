import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadIndex } from '../runtime/load';
import { createRunCache } from '../runtime/runs';
import { createSemantics } from '../semantics';
import { nodePythonHost } from '../semantics/python/node';
import { checkElement, STORY_TAGS, storyValue, type ScenarioRuns, type StoryElement } from './resolve';

const root = join(import.meta.dirname, '../../pipelines');
const readText = (path: string) => readFile(join(root, path), 'utf8');
const runOf = createRunCache(readText, createSemantics(nodePythonHost()));
const entries = await loadIndex(readText);

describe.each(entries.filter((e) => e.story).map((e) => [e.story!, e] as const))('story %s', (story, entry) => {
  const runs: ScenarioRuns = (scenario) => runOf(entry, scenario);

  it('only uses known elements, each with a closing tag', async () => {
    const markdown = await readText(story);
    expect(markdown).not.toMatch(/<model-[a-z-]+[^>]*\/>/);
    const tags = [...markdown.matchAll(/<(model-[a-z-]+)/g)].map((m) => m[1]);
    expect(tags.filter((t) => !(STORY_TAGS as readonly string[]).includes(t!))).toEqual([]);
  });

  it('resolves every element against the model, and every claim has the verdict its text expects', async () => {
    const problems: string[] = [];
    for (const { element } of storyElements(await readText(story))) {
      await checkElement(element, runs).catch((error: Error) => problems.push(`${render(element)}: ${error.message}`));
    }
    expect(problems).toEqual([]);
  }, 60_000);

  it('rejects a claim whose verdict contradicts its expect attribute', async () => {
    const claim = (expect: string) => ({ tag: 'model-claim', attrs: { dataset: 'dh_target_gap', year: '2045', below: '0', expect } });
    if (!entry.path.startsWith('heat-transition/')) return;
    await expect(checkElement(claim('fails'), runs)).resolves.toBeUndefined();
    await expect(checkElement(claim('holds'), runs)).rejects.toThrow(/Claim fails but the text expects it to hold/);
  });

  /** Fallback text is what GitHub and plain Markdown previews show; run with UPDATE_STORIES=1 to rewrite it. */
  it('keeps the fallback text of every value in sync with the model', async () => {
    const markdown = await readText(story);
    let updated = '';
    let last = 0;
    const stale: string[] = [];
    for (const { element, content, start, end } of storyElements(markdown)) {
      if (element.tag !== 'model-value') continue;
      const { text } = await storyValue(element.attrs, runs);
      if (content.trim() !== text) stale.push(`${render(element)}: "${content.trim()}" should be "${text}"`);
      updated += markdown.slice(last, start) + text;
      last = end;
    }
    updated += markdown.slice(last);
    if (process.env.UPDATE_STORIES) await writeFile(join(root, story), updated);
    else expect(stale).toEqual([]);
  }, 60_000);
});

type Found = { element: StoryElement; content: string; start: number; end: number };

/** Elements with their inner content and its position, for checking and rewriting fallbacks. */
function storyElements(markdown: string): Found[] {
  const found: Found[] = [];
  for (const match of markdown.matchAll(/<(model-[a-z-]+)((?:\s+[a-z-]+(?:="[^"]*")?)*)\s*>([\s\S]*?)<\/\1>/g)) {
    const attrs = Object.fromEntries([...match[2]!.matchAll(/([a-z-]+)(?:="([^"]*)")?/g)].map((a) => [a[1]!, a[2] ?? '']));
    const start = match.index + match[0].indexOf('>') + 1;
    found.push({ element: { tag: match[1]!, attrs }, content: match[3]!, start, end: start + match[3]!.length });
  }
  return found;
}

function render(element: StoryElement): string {
  const attrs = Object.entries(element.attrs).map(([k, v]) => (v ? `${k}="${v}"` : k));
  return `<${element.tag} ${attrs.join(' ')}>`;
}
