import { createSignal, For, Match, Show, Switch } from 'solid-js';
import type { Pipeline, Provenance, Source } from '../../lib/runtime/pipeline';
import type { DatasetResult, NodeResult, RunResult } from '../../lib/runtime/run';
import type { CacheInfo, VariableDescription } from '../../lib/semantics/types';
import { groupOfNode, groupStatus, type GroupInfo } from '../graph/groups';
import { formatBytes } from '../values';
import type { Actions } from '../workbench';

export const CACHE_LABELS = { snapshot: 'from snapshot', stored: 'from browser cache', computed: 'computed' } as const;
export const STATUS_LABELS: Record<NodeResult['status'], string> = {
  ok: 'ok',
  error: 'error',
  idle: 'not computed',
  skipped: 'skipped',
  invalid: 'invalid',
};

/** Where a dataset comes from and how to get it computed; shown below its view. */
export function DatasetInfo(props: { dataset: DatasetResult; result: RunResult; actions: Actions }) {
  const catalog = () => ('catalog' in props.dataset.producer ? props.dataset.producer.catalog : undefined);
  const producer = () => ('node' in props.dataset.producer ? props.result.nodes.get(props.dataset.producer.node) : undefined);
  const decodable = () => {
    const c = catalog();
    return c !== undefined && 'decode' in c && c.decode !== undefined;
  };
  const readers = () => props.result.pipeline.nodes.filter((n) => Object.values(n.inputs).includes(props.dataset.name));
  const compute = (label: string) => (
    <Show when={props.dataset.compute}>
      {(work) => <ComputeButton label={label} run={(onLog) => props.actions.compute(work(), onLog)} />}
    </Show>
  );
  return (
    <div class="info">
      <Show when={catalog()?.description ?? tableDescription(props.dataset, props.result)}>{(text) => <p>{text()}</p>}</Show>
      <Show when={props.dataset.file}>
        {(file) => (
          <>
            <p class="muted">
              Raw download · {file().format} · {formatBytes(file().size)} ·{' '}
              {decodable() ? 'decoded into a table when something needs it' : 'fetched only when a step that reads it has to run'}
            </p>
            <p class="download-link">
              <a href={file().url} target="_blank" rel="noreferrer">{new URL(file().url).host}{new URL(file().url).pathname}</a>
            </p>
            <p class="muted">
              Pinned to sha256 <code>{file().sha256.slice(0, 16)}…</code>; a changed file upstream is reported, not used.
            </p>
            <Show when={decodable() && !props.dataset.table}>{compute('Download and decode')}</Show>
            <Show when={!decodable() && readers().length > 0}>
              <p>
                Decoded by{' '}
                <For each={readers()}>
                  {(node, i) => (
                    <>
                      {i() > 0 ? ', ' : ''}
                      <NodeLink id={node.id} actions={props.actions} />
                    </>
                  )}
                </For>
                ; their outputs show what is inside.
              </p>
            </Show>
          </>
        )}
      </Show>
      <Show when={producer()}>
        {(node) => (
          <>
            <p class="muted">
              Computed by <NodeLink id={node().node.id} actions={props.actions} />
            </p>
            <Show when={node().status === 'idle'}>
              <p class="muted">Not computed yet: nothing in this run needed it.</p>
              {compute('Compute it')}
            </Show>
          </>
        )}
      </Show>
      <Show when={catalog()}>
        {(dataset) => (
          <>
            <Show when={'file' in dataset()}>
              <p class="muted">Loaded from <code>{(dataset() as { file: string }).file}</code></p>
            </Show>
            <ProvenanceView provenance={dataset().source} pipeline={props.result.pipeline} />
          </>
        )}
      </Show>
    </div>
  );
}

function tableDescription(dataset: DatasetResult, result: RunResult): string | undefined {
  if (!('node' in dataset.producer)) return undefined;
  const node = result.nodes.get(dataset.producer.node)?.node;
  const model = node?.model as { outputs?: Record<string, { description?: string }> } | undefined;
  const port = Object.entries(node?.outputs ?? {}).find(([, name]) => name === dataset.name)?.[0];
  return port ? model?.outputs?.[port]?.description : undefined;
}

function ProvenanceView(props: { provenance: Provenance; pipeline: Pipeline }) {
  const p = () => props.provenance;
  return (
    <div class="provenance">
      <Switch>
        <Match when={'assumption' in p() && (p() as { assumption: string })}>
          {(assumed) => (
            <>
              <span class="badge assumption">assumption</span>
              <p>{assumed().assumption}</p>
            </>
          )}
        </Match>
        <Match when={'ref' in p() && (p() as { ref: string; locator: string; note?: string })}>
          {(sourced) => (
            <>
              <span class="badge sourced">sourced</span>
              <SourceLink source={props.pipeline.sources[sourced().ref]} />
              <p class="locator">“{sourced().locator}”</p>
              <Show when={sourced().note}>
                <p class="muted">{sourced().note}</p>
              </Show>
            </>
          )}
        </Match>
      </Switch>
    </div>
  );
}

function SourceLink(props: { source?: Source }) {
  return (
    <Show when={props.source}>
      {(source) => (
        <p>
          <a href={source().url} target="_blank" rel="noreferrer">{source().title}</a>
          <span class={`verification ${source().verification}`}>{source().verification}</span>
        </p>
      )}
    </Show>
  );
}

/** What a step is, what it read and printed, and the variables it defines. */
export function NodeDetail(props: { node: NodeResult; result: RunResult; actions: Actions }) {
  const groups = () => groupVariables(props.node.description?.variables ?? [], props.node.node.inputs);
  const code = () => props.node.description?.code;
  const group = () => props.result.pipeline.groups.find((g) => g.id === groupOfNode(props.result, props.node.node.id));
  return (
    <div class="info">
      <p class="muted">
        <span class="semantics">{props.node.node.semantics}</span>
        <Show when={typeof props.node.node.model === 'string' ? (props.node.node.model as string) : code()?.path}>
          {(path) => <>{' '}· <code>{path()}{code()?.entry ? ` ${code()!.entry}()` : ''}</code></>}
        </Show>
        {' '}· {STATUS_LABELS[props.node.status]}
      </p>
      <Show when={group()}>
        {(g) => (
          <p class="muted">
            Step of{' '}
            <button class="link" onClick={() => props.actions.reveal({ kind: 'group', id: g().id })}>{g().label}</button>
          </p>
        )}
      </Show>
      <Show when={props.actions.canOpen(props.node.node.id)}>
        <button class="open-model" onClick={() => props.actions.open(props.node.node.id)}>{code() ? 'Open script' : 'Open diagram'}</button>
      </Show>
      <Show when={props.node.node.description}>
        <p>{props.node.node.description}</p>
      </Show>
      <Show when={props.node.status === 'idle' && props.node.compute}>
        {(work) => (
          <>
            <p class="muted">Not computed: the results downstream were reused, so nothing in this run needed it.</p>
            <ComputeButton label="Compute this step" run={(onLog) => props.actions.compute(work(), onLog)} />
          </>
        )}
      </Show>
      <Show when={props.node.error}>
        <p class="error">{props.node.error}</p>
      </Show>
      <For each={props.node.warnings}>{(w) => <p class="warning">{w}</p>}</For>
      <Show when={props.node.cache}>{(cache) => <CacheNote cache={cache()} />}</Show>
      <Show when={props.node.log?.length}>
        <h3>Log</h3>
        <pre class="node-log">{props.node.log!.join('\n')}</pre>
      </Show>
      <For each={groups()}>
        {(group) => (
          <Show when={group.variables.length > 0}>
            <h3>{group.title}</h3>
            <table class="variables">
              <tbody>
                <For each={group.variables}>
                  {(v) => (
                    <tr>
                      <td class="var-name">
                        {v.name}
                        <Show when={v.dims.length > 0}><span class="dims">[{v.dims.join(', ')}]</span></Show>
                      </td>
                      <td>
                        <Show when={v.wired} fallback={<Show when={v.equation}><code class="equation">{v.equation}</code></Show>}>
                          {(name) => (
                            <code class="equation">
                              ← <DatasetLink name={name()} actions={props.actions} />
                            </code>
                          )}
                        </Show>
                        <Show when={v.description}><div class="var-description">{v.description}</div></Show>
                        <Show when={v.inflows?.length || v.outflows?.length}>
                          <div class="flows">
                            <Show when={v.inflows?.length}>in: {v.inflows!.join(', ')} </Show>
                            <Show when={v.outflows?.length}>out: {v.outflows!.join(', ')}</Show>
                          </div>
                        </Show>
                        <Show when={v.units}><div class="muted">{v.units}</div></Show>
                      </td>
                    </tr>
                  )}
                </For>
              </tbody>
            </table>
          </Show>
        )}
      </For>
    </div>
  );
}

/** A group's purpose, its steps and the datasets it reads and makes. */
export function GroupDetail(props: { info: GroupInfo; result: RunResult; actions: Actions }) {
  const status = () => groupStatus(props.info);
  return (
    <div class="info">
      <p class="muted">
        group · {props.info.nodes.length} steps · {status().computed} computed
      </p>
      <Show when={props.info.group.description}>
        <p>{props.info.group.description}</p>
      </Show>
      <Show when={status().idle.length > 0}>
        <p class="muted">
          {status().idle.length} steps are not computed, because the results downstream were reused. Computing them downloads
          up to {formatBytes(downloadSize(props.info, props.result))} and runs them in this browser.
        </p>
        <ComputeButton label="Compute all steps" run={(onLog) => computeGroup(props.info, props.result, props.actions, onLog)} />
      </Show>
      <h3>Steps</h3>
      <table class="variables">
        <tbody>
          <For each={props.info.nodes}>
            {(node) => (
              <tr>
                <td class="var-name">
                  <NodeLink id={node.node.id} actions={props.actions} />
                </td>
                <td>
                  <div class="var-description">{node.node.label}</div>
                  <div class="muted">
                    {STATUS_LABELS[node.status]}
                    <Show when={node.cache}>{(cache) => <> · {CACHE_LABELS[cache().origin]}</>}</Show>
                  </div>
                </td>
              </tr>
            )}
          </For>
        </tbody>
      </table>
      <h3>Reads</h3>
      <DatasetLinks names={props.info.inputs} actions={props.actions} />
      <h3>Makes</h3>
      <DatasetLinks names={props.info.outputs} actions={props.actions} />
    </div>
  );
}

/** Computes every step of the group that is not computed yet, in pipeline order. */
export function computeGroup(info: GroupInfo, result: RunResult, actions: Actions, onLog: (line: string) => void): Promise<void> {
  const idle = groupStatus(info).idle;
  return actions.compute(async (log) => {
    for (const id of idle) await result.nodes.get(id)?.compute?.(log);
  }, onLog);
}

export function downloadSize(info: GroupInfo, result: RunResult): number {
  return [...info.inputs, ...info.internal].reduce((total, name) => total + (result.datasets.get(name)?.file?.size ?? 0), 0);
}

function DatasetLinks(props: { names: string[]; actions: Actions }) {
  return (
    <p class="links">
      <For each={props.names}>{(name) => <DatasetLink name={name} actions={props.actions} />}</For>
    </p>
  );
}

function DatasetLink(props: { name: string; actions: Actions }) {
  return (
    <button class="link" onClick={() => props.actions.reveal({ kind: 'dataset', id: props.name })}>
      {props.name}
    </button>
  );
}

function NodeLink(props: { id: string; actions: Actions }) {
  return (
    <button class="link" onClick={() => props.actions.reveal({ kind: 'node', id: props.id })}>
      <code>{props.id}</code>
    </button>
  );
}

/** Runs a computation and shows its log as it goes; `inline` shows only the latest line, for tight spaces. */
export function ComputeButton(props: { label: string; run: (onLog: (line: string) => void) => Promise<void>; inline?: boolean }) {
  const [running, setRunning] = createSignal(false);
  const [log, setLog] = createSignal<string[]>([]);
  const [error, setError] = createSignal<string>();
  let box: HTMLPreElement | undefined;
  const start = async () => {
    setRunning(true);
    setLog([]);
    setError(undefined);
    try {
      await props.run((line) => {
        setLog((lines) => [...lines, line]);
        box?.scrollTo({ top: box.scrollHeight });
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setRunning(false);
    }
  };
  return (
    <>
      <button
        class="open-model py-run"
        disabled={running()}
        onClick={(e) => {
          e.stopPropagation();
          void start();
        }}
      >
        {running() ? 'Computing…' : props.label}
      </button>
      <Show
        when={props.inline}
        fallback={
          <>
            <Show when={running() || log().length > 0}>
              <pre ref={box} class="node-log live">{log().join('\n')}</pre>
            </Show>
            <Show when={error()}>
              <pre class="error py-error">{error()}</pre>
            </Show>
          </>
        }
      >
        <span class="compute-status" classList={{ error: error() !== undefined }} title={error() ?? log().join('\n')}>
          {error() ?? log().at(-1) ?? ''}
        </span>
      </Show>
    </>
  );
}

export function CacheNote(props: { cache: CacheInfo }) {
  const made = () => `${props.cache.runtime} on ${new Date(props.cache.createdAt).toLocaleString()} in ${props.cache.seconds} s`;
  return (
    <p class="cache-note">
      <Switch>
        <Match when={props.cache.origin === 'snapshot'}>Result from the committed snapshot, made with {made()}.</Match>
        <Match when={props.cache.origin === 'stored'}>Result from this browser's cache, computed with {made()}.</Match>
        <Match when={props.cache.origin === 'computed'}>Computed with {made()}.</Match>
      </Switch>{' '}
      <span class="muted">It is reused only while the model, runtime and the lineage of its inputs match (key <code>{props.cache.key.slice(0, 12)}…</code>).</span>
    </p>
  );
}

function groupVariables(
  variables: VariableDescription[],
  wiring: Record<string, string>,
): { title: string; variables: (VariableDescription & { wired?: string })[] }[] {
  const internal = variables.filter((v) => v.role !== 'input');
  const inputs = variables
    .filter((v) => v.role === 'input')
    .map((v) => ({ ...v, wired: wiring[v.name], equation: wiring[v.name] ? '' : 'not wired' }));
  return [
    { title: 'Stocks', variables: internal.filter((v) => v.kind === 'stock') },
    { title: 'Flows', variables: internal.filter((v) => v.kind === 'flow') },
    { title: 'Variables', variables: internal.filter((v) => v.kind === 'aux') },
    { title: 'Inputs', variables: inputs },
  ];
}
