/** One research question with its chat, pipeline and the tasks still open on main. */
export type Experiment = {
  id: string;
  title: string;
  question: string;
  summary: string;
  status: 'active' | 'parked';
  /** Directory of the pipeline in `pipelines/index.json`. */
  pipeline: string;
  updated: string;
  chat: Message[];
  /** Tasks still open on main, pointing at nodes and datasets of the live pipeline. */
  tasks: Task[];
};

export type Message = {
  id: string;
  author: 'paul' | 'agent';
  time: string;
  blocks: Block[];
};

/** Text is Markdown; it may contain live `model-*` elements that resolve against the experiment's pipeline. */
export type Block = { kind: 'text'; text: string } | { kind: 'tools'; calls: string[] } | Artifact;

export type Artifact = EvidenceMap | Plan | Draft | TaskList | SourceList | Run | Backlog;

export type EvidenceMap = {
  kind: 'evidence';
  id: string;
  title: string;
  layers: { name: string; question: string; evidence: 'solid' | 'partial' | 'gap'; note: string }[];
};

export type Plan = {
  kind: 'plan';
  id: string;
  title: string;
  idea: string;
  recommended?: boolean;
  outcome: 'chosen' | 'not-pursued';
  /** Why it was chosen or set aside. */
  reason?: string;
  data: { label: string; status: 'found' | 'partial' | 'missing' }[];
  answers: string[];
  limits: string[];
  sketch?: Sketch;
  /** The draft created from this plan. */
  draft?: string;
};

export type Draft = {
  kind: 'draft';
  id: string;
  title: string;
  state: 'open' | 'merged';
  changes: Change[];
  sketch?: Sketch;
  /** Story skeleton; `<sketch-claim>` marks a claim that can't be checked yet. */
  story?: string;
  /** The draft's result is what main shows now, so the panel shows the live model. */
  live?: boolean;
};

export type Change = { op: 'add' | 'change' | 'remove'; text: string };

export type TaskList = {
  kind: 'tasks';
  id: string;
  title: string;
  tasks: (Task & { doneIn?: string })[];
};

export type SourceList = {
  kind: 'sources';
  id: string;
  title: string;
  sources: Source[];
};

export type Source = {
  title: string;
  publisher: string;
  url: string;
  verification: 'primaryRead' | 'snippetOnly' | 'unverified';
  note?: string;
};

export type Run = {
  kind: 'run';
  id: string;
  title: string;
  checks: { label: string; holds: boolean }[];
  warnings?: string[];
  /** Live `model-*` elements, computed when the chat loads. */
  live?: string;
};

export type Backlog = {
  kind: 'backlog';
  id: string;
  title: string;
  items: { title: string; reason: string }[];
};

/** A pipeline before it is built: nodes without semantics are sketches, datasets without data are missing. */
export type Sketch = {
  datasets: Record<string, SketchDataset>;
  nodes: Record<string, SketchNode>;
  tasks: Record<string, Task>;
};

export type SketchDataset = {
  dims: string[];
  unit: string;
  data?: 'sourced' | 'assumption' | 'derived';
};

export type SketchNode = {
  label: string;
  semantics?: string;
  inputs: Record<string, string>;
  outputs: Record<string, string>;
};

export type Task = {
  instructions: string;
  nodes?: string[];
  datasets?: string[];
};
