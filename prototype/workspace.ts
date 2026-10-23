import type { FocusTarget } from '../app/story/elements';
import type { Experiment } from './data/types';

/** What chat and panel share: the selected artifact, model focus, live text and the drafts made in this session. */
export type Workspace = {
  experiment: Experiment;
  selected: () => string | undefined;
  select: (artifactId: string) => void;
  focus: (target: FocusTarget) => void;
  /** Markdown or HTML with live `model-*` elements, resolved against the experiment's pipeline. */
  markdown: (text: string) => HTMLElement;
  html: (html: string) => HTMLElement;
  drafted: (title: string) => boolean;
  createDraft: (title: string) => void;
};
