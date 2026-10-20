import * as P from '@observablehq/plot';
import { For, Match, Show, Switch } from 'solid-js';
import type { Pipeline, Provenance, Source } from '../../lib/runtime/pipeline';
import type { DatasetResult, NodeResult, RunResult } from '../../lib/runtime/run';
import type { Tensor } from '../../lib/runtime/tensor';
import type { VariableDescription } from '../../lib/semantics/types';
import type { Selection } from '../graph/GraphView';
import { collapsedLabel, domainOf, facetRowsOf, formatValue, rowsOf, shapeOf } from '../values';
import { CellMap, gridOf } from './CellMap';
import { Plot } from './Plot';

export function DetailPanel(props: {
  selection: Selection;
  result: RunResult;
  baseline?: RunResult;
  canOpen: (nodeId: string) => boolean;
  onOpen: (nodeId: string) => void;
  onClose: () => void;
}) {
  return (
    <aside class="detail">
      <button class="close" onClick={() => props.onClose()}>×</button>
      <Switch>
        <Match when={props.selection.kind === 'dataset' && props.result.datasets.get(props.selection.id)}>
          {(dataset) => (
            <DatasetDetail
              dataset={dataset()}
              baseline={props.baseline?.datasets.get(dataset().name)}
              pipeline={props.result.pipeline}
            />
          )}
        </Match>
        <Match when={props.selection.kind === 'node' && props.result.nodes.get(props.selection.id)}>
          {(node) => <NodeDetail node={node()} canOpen={props.canOpen(node().node.id)} onOpen={() => props.onOpen(node().node.id)} />}
        </Match>
      </Switch>
    </aside>
  );
}

function DatasetDetail(props: { dataset: DatasetResult; baseline?: DatasetResult; pipeline: Pipeline }) {
  const catalog = () => ('catalog' in props.dataset.producer ? props.dataset.producer.catalog : undefined);
  const producer = () => ('node' in props.dataset.producer ? props.dataset.producer.node : undefined);
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
          </>
        )}
      </Show>
      <Show when={props.dataset.error}>
        <p class="error">{props.dataset.error}</p>
      </Show>
      <Show when={producer()}>
        <p class="muted">Computed by node <code>{producer()}</code></p>
      </Show>
      <Show when={catalog()}>
        {(dataset) => (
          <>
            <Show when={'file' in dataset()}>
              <p class="muted">Loaded from <code>{(dataset() as { file: string }).file}</code></p>
            </Show>
            <ProvenanceView provenance={dataset().source} pipeline={props.pipeline} />
          </>
        )}
      </Show>
    </>
  );
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
        <Match when={'script' in p() && (p() as { script: string; from: string[]; method: string })}>
          {(derived) => (
            <>
              <span class="badge derived">derived</span>
              <p>{derived().method}</p>
              <p class="muted">Computed by <code>{derived().script}</code> from:</p>
              <For each={derived().from}>{(ref) => <SourceLink source={props.pipeline.sources[ref]} />}</For>
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

function NodeDetail(props: { node: NodeResult; canOpen: boolean; onOpen: () => void }) {
  const groups = () => groupVariables(props.node.description?.variables ?? [], props.node.node.inputs);
  return (
    <>
      <h2>{props.node.node.label}</h2>
      <p class="muted">
        <span class="semantics">{props.node.node.semantics}</span>
        <Show when={typeof props.node.node.model === 'string'}>
          {' '}· <code>{props.node.node.model as string}</code>
        </Show>
        {' '}· {props.node.status}
      </p>
      <Show when={props.canOpen}>
        <button class="open-model" onClick={() => props.onOpen()}>Open diagram</button>
      </Show>
      <Show when={props.node.node.description}>
        <p>{props.node.node.description}</p>
      </Show>
      <Show when={props.node.error}>
        <p class="error">{props.node.error}</p>
      </Show>
      <For each={props.node.warnings}>{(w) => <p class="warning">{w}</p>}</For>
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
