import * as P from '@observablehq/plot';
import { createMemo, createSignal, For, Match, Show, Switch } from 'solid-js';
import type { Pipeline, Provenance, Source } from '../../lib/runtime/pipeline';
import type { DatasetResult, NodeResult, RunResult } from '../../lib/runtime/run';
import { tableFromTensor, type Table } from '../../lib/runtime/table';
import type { Tensor } from '../../lib/runtime/tensor';
import type { CacheInfo, VariableDescription } from '../../lib/semantics/types';
import { STATUS_LABELS, type Selection } from '../graph/GraphView';
import { groupOfNode, groupsOf, groupStatus, type GroupInfo } from '../graph/groups';
import { collapsedLabel, domainOf, facetRowsOf, formatBytes, formatValue, rowsOf, shapeOf } from '../values';
import { CellMap, gridOf } from './CellMap';
import { Plot } from './Plot';
import { spatialColumn, TableMap } from './TableMap';
import { TableView } from './TableView';

/** Computes the given nodes, and whatever they need, then refreshes the run. */
export type Compute = (nodeIds: string[], onLog: (line: string) => void) => Promise<void>;

export function DetailPanel(props: {
  selection: Selection;
  result: RunResult;
  baseline?: RunResult;
  expanded: string[];
  canOpen: (nodeId: string) => boolean;
  onOpen: (nodeId: string) => void;
  onSelect: (selection: Selection) => void;
  onToggleGroup: (groupId: string) => void;
  onCompute: Compute;
  onClose: () => void;
}) {
  const groups = createMemo(() => groupsOf(props.result));
  const wide = () => props.selection.kind === 'dataset' && Boolean(props.result.datasets.get(props.selection.id)?.table);
  return (
    <aside class="detail" classList={{ wide: wide() }}>
      <button class="close" onClick={() => props.onClose()}>×</button>
      <Switch>
        <Match when={props.selection.kind === 'dataset' && props.result.datasets.get(props.selection.id)}>
          {(dataset) => (
            <DatasetDetail
              dataset={dataset()}
              baseline={props.baseline?.datasets.get(dataset().name)}
              result={props.result}
              onSelect={props.onSelect}
              onCompute={props.onCompute}
            />
          )}
        </Match>
        <Match when={props.selection.kind === 'node' && props.result.nodes.get(props.selection.id)}>
          {(node) => (
            <NodeDetail
              node={node()}
              group={groups().get(groupOfNode(props.result, node().node.id) ?? '')}
              canOpen={props.canOpen(node().node.id)}
              onOpen={() => props.onOpen(node().node.id)}
              onSelect={props.onSelect}
              onCompute={props.onCompute}
            />
          )}
        </Match>
        <Match when={props.selection.kind === 'group' && groups().get(props.selection.id)}>
          {(info) => (
            <GroupDetail
              info={info()}
              result={props.result}
              expanded={props.expanded.includes(info().group.id)}
              onToggle={() => props.onToggleGroup(info().group.id)}
              onSelect={props.onSelect}
              onCompute={props.onCompute}
            />
          )}
        </Match>
      </Switch>
    </aside>
  );
}

function DatasetDetail(props: {
  dataset: DatasetResult;
  baseline?: DatasetResult;
  result: RunResult;
  onSelect: (selection: Selection) => void;
  onCompute: Compute;
}) {
  const catalog = () => ('catalog' in props.dataset.producer ? props.dataset.producer.catalog : undefined);
  const producer = () => ('node' in props.dataset.producer ? props.result.nodes.get(props.dataset.producer.node) : undefined);
  const readers = () => props.result.pipeline.nodes.filter((n) => Object.values(n.inputs).includes(props.dataset.name));
  return (
    <>
      <h2>{props.dataset.name}</h2>
      <Show when={catalog()?.description}>
        <p>{catalog()!.description}</p>
      </Show>
      <Show when={props.dataset.tensor}>
        {(tensor) => (
          <>
            <p class="muted">
              {tensor().unit} · {tensor().dims.length > 0 ? tensor().dims.join(' × ') : 'scalar'}
              <Show when={collapsedLabel(tensor())}>{(label) => <> · chart shows {label()}</>}</Show>
            </p>
            <Plot class="detail-chart" render={() => detailChart(tensor(), props.baseline?.tensor)} />
            <Show when={gridOf(tensor())}>
              <h3>Map</h3>
              <CellMap tensor={tensor()} baseline={props.baseline?.tensor} />
            </Show>
            <Show
              when={props.dataset.source}
              fallback={<Collapsible title="Values as a table" table={() => tableFromTensor(tensor())} />}
            >
              {(source) => (
                <>
                  <h3>Rows of the file</h3>
                  <TableView table={source()} />
                </>
              )}
            </Show>
          </>
        )}
      </Show>
      <Show when={props.dataset.table}>
        {(table) => (
          <>
            <p class="muted">
              table · {table().rows.toLocaleString('en')} rows × {Object.keys(table().columns).length} columns
            </p>
            <Show when={tableDescription(props.dataset, props.result)}>{(text) => <p>{text()}</p>}</Show>
            <Show when={spatialColumn(table())}>
              <h3>Map</h3>
              <TableMap table={table()} />
            </Show>
            <h3>Rows</h3>
            <TableView table={table()} />
          </>
        )}
      </Show>
      <Show when={props.dataset.file}>
        {(file) => (
          <>
            <p class="muted">
              Raw download · {file().format} · {formatBytes(file().size)} · fetched only when a node that reads it has to run
            </p>
            <p class="download-link">
              <a href={file().url} target="_blank" rel="noreferrer">{new URL(file().url).host}{new URL(file().url).pathname}</a>
            </p>
            <p class="muted">
              Pinned to sha256 <code>{file().sha256.slice(0, 16)}…</code>; a changed file upstream is reported, not used.
            </p>
            <Show when={readers().length > 0}>
              <p>
                Decoded by{' '}
                <For each={readers()}>
                  {(node, i) => (
                    <>
                      {i() > 0 ? ', ' : ''}
                      <NodeLink id={node.id} onSelect={props.onSelect} />
                    </>
                  )}
                </For>
                ; select their outputs to see what is inside.
              </p>
            </Show>
          </>
        )}
      </Show>
      <Show when={props.dataset.error}>
        <p class="error">{props.dataset.error}</p>
      </Show>
      <Show when={producer()}>
        {(node) => (
          <>
            <p class="muted">
              Computed by node <NodeLink id={node().node.id} onSelect={props.onSelect} />
            </p>
            <Show when={node().status === 'idle'}>
              <p class="muted">Not computed yet: nothing in this run needed it.</p>
              <ComputeButton label="Compute it" run={(onLog) => props.onCompute([node().node.id], onLog)} />
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
    </>
  );
}

/** A table that is only built once it is opened, since tensors over thousands of cells make long ones. */
function Collapsible(props: { title: string; table: () => Table }) {
  const [open, setOpen] = createSignal(false);
  return (
    <details class="collapsible" onToggle={(e) => setOpen(e.currentTarget.open)}>
      <summary>{props.title}</summary>
      <Show when={open()}>
        <TableView table={props.table()} />
      </Show>
    </details>
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

function NodeDetail(props: {
  node: NodeResult;
  group?: GroupInfo;
  canOpen: boolean;
  onOpen: () => void;
  onSelect: (selection: Selection) => void;
  onCompute: Compute;
}) {
  const groups = () => groupVariables(props.node.description?.variables ?? [], props.node.node.inputs);
  const code = () => props.node.description?.code;
  return (
    <>
      <h2>{props.node.node.label}</h2>
      <p class="muted">
        <span class="semantics">{props.node.node.semantics}</span>
        <Show when={typeof props.node.node.model === 'string' ? (props.node.node.model as string) : code()?.path}>
          {(path) => <>{' '}· <code>{path()}{code()?.entry ? ` ${code()!.entry}()` : ''}</code></>}
        </Show>
        {' '}· {STATUS_LABELS[props.node.status]}
      </p>
      <Show when={props.group}>
        {(info) => (
          <p class="muted">
            Step of{' '}
            <button class="link" onClick={() => props.onSelect({ kind: 'group', id: info().group.id })}>{info().group.label}</button>
          </p>
        )}
      </Show>
      <Show when={props.canOpen}>
        <button class="open-model" onClick={() => props.onOpen()}>{code() ? 'Open script' : 'Open diagram'}</button>
      </Show>
      <Show when={props.node.node.description}>
        <p>{props.node.node.description}</p>
      </Show>
      <Show when={props.node.status === 'idle'}>
        <p class="muted">Not computed: the results downstream were reused, so nothing in this run needed it.</p>
        <ComputeButton label="Compute this step" run={(onLog) => props.onCompute([props.node.node.id], onLog)} />
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
                        <Show when={v.equation}><code class="equation">{v.equation}</code></Show>
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
    </>
  );
}

function GroupDetail(props: {
  info: GroupInfo;
  result: RunResult;
  expanded: boolean;
  onToggle: () => void;
  onSelect: (selection: Selection) => void;
  onCompute: Compute;
}) {
  const status = () => groupStatus(props.info);
  const downloads = () =>
    props.info.inputs.reduce((total, name) => total + (props.result.datasets.get(name)?.file?.size ?? 0), 0);
  return (
    <>
      <h2>{props.info.group.label}</h2>
      <p class="muted">
        group · {props.info.nodes.length} steps · {status().computed} computed
      </p>
      <button class="open-model" onClick={() => props.onToggle()}>{props.expanded ? 'Collapse into one box' : 'Show the steps'}</button>
      <Show when={props.info.group.description}>
        <p>{props.info.group.description}</p>
      </Show>
      <Show when={status().idle.length > 0}>
        <p class="muted">
          {status().idle.length} steps are not computed, because the results downstream were reused. Computing them downloads
          up to {formatBytes(downloads())} and runs them in this browser.
        </p>
        <ComputeButton label="Compute all steps" run={(onLog) => props.onCompute(status().idle, onLog)} />
      </Show>
      <h3>Steps</h3>
      <table class="variables">
        <tbody>
          <For each={props.info.nodes}>
            {(node) => (
              <tr>
                <td class="var-name">
                  <NodeLink id={node.node.id} onSelect={props.onSelect} />
                </td>
                <td>
                  <div class="var-description">{node.node.label}</div>
                  <div class="muted">
                    {STATUS_LABELS[node.status]}
                    <Show when={node.cache}>{(cache) => <> · {cache().origin}</>}</Show>
                  </div>
                </td>
              </tr>
            )}
          </For>
        </tbody>
      </table>
      <h3>Reads</h3>
      <DatasetLinks names={props.info.inputs} onSelect={props.onSelect} />
      <h3>Makes</h3>
      <DatasetLinks names={props.info.outputs} onSelect={props.onSelect} />
    </>
  );
}

function DatasetLinks(props: { names: string[]; onSelect: (selection: Selection) => void }) {
  return (
    <p class="links">
      <For each={props.names}>
        {(name) => (
          <button class="link" onClick={() => props.onSelect({ kind: 'dataset', id: name })}>
            {name}
          </button>
        )}
      </For>
    </p>
  );
}

function NodeLink(props: { id: string; onSelect: (selection: Selection) => void }) {
  return (
    <button class="link" onClick={() => props.onSelect({ kind: 'node', id: props.id })}>
      <code>{props.id}</code>
    </button>
  );
}

/** Runs a computation and shows its log as it goes; on success the run refreshes and replaces this view. */
function ComputeButton(props: { label: string; run: (onLog: (line: string) => void) => Promise<void> }) {
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
      <button class="open-model py-run" disabled={running()} onClick={start}>
        {running() ? 'Computing…' : props.label}
      </button>
      <Show when={running() || log().length > 0}>
        <pre ref={box} class="node-log live">{log().join('\n')}</pre>
      </Show>
      <Show when={error()}>
        <pre class="error py-error">{error()}</pre>
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
      <span class="muted">It is reused only while the script, runtime and the lineage of its inputs match (key <code>{props.cache.key.slice(0, 12)}…</code>).</span>
    </p>
  );
}

function groupVariables(
  variables: VariableDescription[],
  wiring: Record<string, string>,
): { title: string; variables: VariableDescription[] }[] {
  const internal = variables.filter((v) => v.role !== 'input');
  const inputs = variables
    .filter((v) => v.role === 'input')
    .map((v) => ({ ...v, equation: wiring[v.name] ? `← ${wiring[v.name]}` : 'not wired' }));
  return [
    { title: 'Stocks', variables: internal.filter((v) => v.kind === 'stock') },
    { title: 'Flows', variables: internal.filter((v) => v.kind === 'flow') },
    { title: 'Variables', variables: internal.filter((v) => v.kind === 'aux') },
    { title: 'Inputs', variables: inputs },
  ];
}

export function detailChart(tensor: Tensor, baseline?: Tensor, width = 380): Element {
  const shape = shapeOf(tensor);
  if (shape.kind === 'series') {
    const { facet, rows } = facetRowsOf(tensor);
    const base = baseline ? facetRowsOf(baseline).rows : [];
    const fy = facet ? 'facet' : undefined;
    return P.plot({
      width,
      height: facet ? 120 * new Set(rows.map((r) => r.facet)).size : 220,
      marginLeft: 56,
      marginRight: facet ? 56 : 20,
      y: { grid: true, label: tensor.unit },
      x: { label: null, tickFormat: 'd' },
      fy: facet ? { label: null } : undefined,
      color: { legend: Boolean(shape.by), type: 'categorical' },
      marks: [
        P.lineY(base, { x: 'year', y: 'value', stroke: 'key', fy, strokeDasharray: '3,2', strokeOpacity: 0.5 }),
        P.lineY(rows, { x: 'year', y: 'value', stroke: 'key', fy, strokeWidth: 1.8, tip: true }),
      ],
    });
  }
  const rows = rowsOf(tensor, shape);
  if (shape.kind === 'scalar') {
    const p = document.createElement('p');
    p.className = 'detail-scalar';
    p.textContent = `${formatValue(rows[0]!.value)} ${tensor.unit}`;
    return p;
  }
  if (shape.kind === 'bars') {
    return P.plot({
      width,
      height: 26 * rows.length + 40,
      marginLeft: 80,
      x: { grid: true, label: tensor.unit },
      y: { label: null, domain: rows.map((r) => r.key) },
      marks: [P.barX(rows, { x: 'value', y: 'key', fill: 'var(--accent)', tip: true })],
    });
  }
  if (shape.kind !== 'grid') throw new Error('Unexpected shape');
  return P.plot({
    width,
    height: 28 * new Set(rows.map((r) => r.row)).size + 50,
    marginLeft: 80,
    x: { axis: 'top', label: null, domain: domainOf(tensor, shape.cols) },
    y: { label: null, domain: domainOf(tensor, shape.rows) },
    color: { scheme: 'blues', legend: true, label: tensor.unit },
    marks: [
      P.cell(rows, { x: 'col', y: 'row', fill: 'value', inset: 1, tip: true }),
      P.text(rows, { x: 'col', y: 'row', text: (r: { value: number }) => formatValue(r.value), fill: 'black' }),
    ],
  });
}
