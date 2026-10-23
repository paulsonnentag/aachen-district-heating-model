import { createEffect, createSignal } from 'solid-js';
import type { RunResult } from '../lib/runtime/run';
import type { ViewName } from './components/ValueView';
import { groupOfDataset, groupOfNode, groupsOf } from './graph/groups';

export type Selection = { kind: 'dataset' | 'node' | 'group'; id: string };

/** Runs work that updates the run's results in place, then refreshes the run so everything downstream shows them. */
export type Compute = (work: (onLog: (line: string) => void) => Promise<void>, onLog: (line: string) => void) => Promise<void>;

/** What the graph, the expanded boxes and the fullscreen view can do. */
export type Actions = {
  select: (selection: Selection | undefined) => void;
  /** Selects the item, expands it in place and scrolls to it; in fullscreen, shows it there instead. */
  reveal: (selection: Selection) => void;
  toggle: (selection: Selection) => void;
  isExpanded: (selection: Selection) => boolean;
  fullscreen: (selection: Selection | undefined) => void;
  canOpen: (nodeId: string) => boolean;
  open: (nodeId: string) => void;
  compute: Compute;
  /** The view picked for a dataset, if one was. */
  viewOf: (dataset: string) => ViewName | undefined;
  setView: (dataset: string, view: ViewName) => void;
};

/** The state of one model pane: what is selected, expanded in place, fullscreen, and which view each dataset shows. */
export function createWorkbench(options: {
  result: () => RunResult | undefined;
  refresh: () => Promise<unknown>;
  canOpen: (nodeId: string) => boolean;
  open: (nodeId: string) => void;
}) {
  const [selection, setSelection] = createSignal<Selection>();
  const [expanded, setExpanded] = createSignal<string[]>([]);
  const [full, setFull] = createSignal<Selection>();
  const [views, setViews] = createSignal<Record<string, ViewName>>({});
  const [reveal, setReveal] = createSignal<Selection | undefined>(undefined, { equals: false });

  const expand = (target: Selection) => setExpanded((keys) => (keys.includes(keyOf(target)) ? keys : [...keys, keyOf(target)]));
  createEffect(() => {
    const s = selection();
    const result = options.result();
    if (!s || !result) return;
    const group = s.kind === 'node' ? groupOfNode(result, s.id) : s.kind === 'dataset' ? groupOfDataset(groupsOf(result), s.id) : undefined;
    if (group) expand({ kind: 'group', id: group });
  });

  const focus = (target: Selection | undefined) => {
    setSelection(target);
    if (!target) return;
    expand(target);
    setReveal(target);
  };
  const actions: Actions = {
    select: setSelection,
    reveal: (target) => {
      focus(target);
      if (full()) setFull(target);
    },
    toggle: (target) => {
      const key = keyOf(target);
      const open = expanded().includes(key);
      setExpanded((keys) => (open ? keys.filter((k) => k !== key) : [...keys, key]));
      setSelection(target);
    },
    isExpanded: (target) => expanded().includes(keyOf(target)),
    fullscreen: setFull,
    canOpen: options.canOpen,
    open: options.open,
    compute: async (work, onLog) => {
      await work(onLog);
      await options.refresh();
    },
    viewOf: (dataset) => views()[dataset],
    setView: (dataset, view) => setViews((all) => ({ ...all, [dataset]: view })),
  };
  const reset = () => {
    setSelection(undefined);
    setExpanded([]);
    setFull(undefined);
    setViews({});
  };
  return { selection, setSelection, expanded, setExpanded, full, setFull, views, setViews, reveal, focus, actions, reset };
}

export type Workbench = ReturnType<typeof createWorkbench>;

export function keyOf(selection: Selection): string {
  return `${selection.kind}:${selection.id}`;
}

/** `kind:id`; a bare id names a group, as in links made before datasets and nodes could expand. */
export function parseKey(key: string): Selection | undefined {
  const at = key.indexOf(':');
  if (at < 0) return key ? { kind: 'group', id: key } : undefined;
  const kind = key.slice(0, at);
  const id = key.slice(at + 1);
  return (kind === 'dataset' || kind === 'node' || kind === 'group') && id ? { kind, id } : undefined;
}
