import { DOMParser, type Element } from '@xmldom/xmldom';
import type { Issue } from '../../runtime/pipeline';
import type { ModelDescription } from '../types';
import { canonicalName, parseEquation, references } from './expression';

export type XmileModel = {
  /** Declared dimensions by canonical name; an empty list means the elements come from the bound inputs. */
  dims: Map<string, string[]>;
  variables: XmileVariable[];
  time: { start: number; stop: number; dt: number; method: string };
};

export type XmileVariable = {
  name: string;
  ident: string;
  kind: 'stock' | 'flow' | 'aux';
  access?: 'input' | 'output';
  dims: string[];
  equation: string;
  table?: Table;
  elementEquations: { subscript: string[]; equation: string; table?: Table }[];
  units?: string;
  inflows: string[];
  outflows: string[];
  unsupported: string[];
};

export type Table = { xs: number[]; ys: number[] };

const ALLOWED_LITERALS = new Set([0, 1]);
const UNSUPPORTED_TAGS = ['non_negative', 'conveyor', 'queue'];

export function parseXmile(text: string): XmileModel {
  const doc = new DOMParser().parseFromString(text, 'text/xml');
  const root = doc.documentElement;
  if (!root) throw new Error('Not an XMILE document');
  const modelEl = child(root, 'model');
  const variablesEl = modelEl && child(modelEl, 'variables');
  if (!variablesEl) throw new Error('XMILE file has no <model><variables>');
  return {
    dims: parseDims(root),
    variables: children(variablesEl).filter(isVariable).map(parseVariable),
    time: parseTime(root),
  };
}

export function portsOf(model: XmileModel): { inputs: string[]; outputs: string[] } {
  return {
    inputs: model.variables.filter((v) => v.access === 'input').map((v) => v.name),
    outputs: model.variables.filter((v) => v.access === 'output').map((v) => v.name),
  };
}

/** Every number must come from a dataset: non-input variables may only use the literals 0 and 1. */
export function checkProvenance(model: XmileModel): Issue[] {
  const issues: Issue[] = [];
  for (const variable of model.variables) {
    if (variable.access === 'input') continue;
    if (variable.table || variable.elementEquations.some((e) => e.table)) {
      issues.push({ severity: 'error', where: variable.name, message: 'Embedded lookup table: move the data into a dataset and declare an input' });
    }
    const equations = [variable.equation, ...variable.elementEquations.map((e) => e.equation)];
    for (const literal of equations.flatMap(numericLiterals)) {
      issues.push({ severity: 'error', where: variable.name, message: `Literal ${literal} in equation: declare it as an input backed by a dataset` });
    }
  }
  return issues;
}

export function numericLiterals(equation: string): number[] {
  const withoutSubscripts = equation.replace(/\[[^\]]*\]/g, '[]');
  const matches = withoutSubscripts.match(/(?<![A-Za-z_\d.])(\d+\.?\d*(?:e[+-]?\d+)?|\.\d+)(?![A-Za-z_\d.])/gi) ?? [];
  return matches.map(Number).filter((n) => !ALLOWED_LITERALS.has(n));
}

export function describeXmile(model: XmileModel): ModelDescription {
  const nameOf = new Map(model.variables.map((v) => [v.ident, v.name]));
  const flowName = (ident: string) => nameOf.get(ident) ?? ident;
  return {
    variables: model.variables.map((v) => ({
      name: v.name,
      kind: v.kind,
      role: v.access ?? 'internal',
      dims: v.dims,
      equation: v.elementEquations.length > 0
        ? v.elementEquations.map((e) => `[${e.subscript.join(', ')}] ${e.equation}`).join('; ')
        : v.equation,
      units: v.units,
      inflows: v.inflows.map(flowName),
      outflows: v.outflows.map(flowName),
      dependsOn: v.access === 'input' ? [] : dependenciesOf(v).flatMap((ident) => (nameOf.has(ident) && ident !== v.ident ? [nameOf.get(ident)!] : [])),
    })),
  };
}

function dependenciesOf(variable: XmileVariable): string[] {
  const names = new Set<string>();
  for (const equation of [variable.equation, ...variable.elementEquations.map((e) => e.equation)]) {
    try {
      for (const name of references(parseEquation(equation)).names) names.add(name);
    } catch {
      // reported by checkModel
    }
  }
  return [...names];
}

function parseVariable(el: Element): XmileVariable {
  const name = el.getAttribute('name') ?? '';
  const access = el.getAttribute('access');
  const dimsEl = child(el, 'dimensions');
  return {
    name,
    ident: canonicalName(name),
    kind: el.tagName as XmileVariable['kind'],
    access: access === 'input' || access === 'output' ? access : undefined,
    dims: dimsEl ? children(dimsEl).map((d) => canonicalName(d.getAttribute('name') ?? '')) : [],
    equation: text(child(el, 'eqn')),
    table: parseTable(child(el, 'gf')),
    elementEquations: children(el)
      .filter((c) => c.tagName === 'element')
      .map((e) => ({
        subscript: (e.getAttribute('subscript') ?? '').split(',').map((s) => s.trim()),
        equation: text(child(e, 'eqn')),
        table: parseTable(child(e, 'gf')),
      })),
    units: child(el, 'units') ? text(child(el, 'units')) : undefined,
    inflows: children(el).filter((c) => c.tagName === 'inflow').map((c) => canonicalName(text(c))),
    outflows: children(el).filter((c) => c.tagName === 'outflow').map((c) => canonicalName(text(c))),
    unsupported: children(el).map((c) => c.tagName).filter((tag) => UNSUPPORTED_TAGS.includes(tag)),
  };
}

function parseTable(gf: Element | undefined): Table | undefined {
  if (!gf) return undefined;
  const ys = numbers(text(child(gf, 'ypts')));
  const xptsEl = child(gf, 'xpts');
  if (xptsEl) return { xs: numbers(text(xptsEl)), ys };
  const scale = child(gf, 'xscale');
  const min = Number(scale?.getAttribute('min') ?? 0);
  const max = Number(scale?.getAttribute('max') ?? ys.length - 1);
  return { xs: ys.map((_, i) => min + ((max - min) * i) / Math.max(1, ys.length - 1)), ys };
}

function parseDims(root: Element): Map<string, string[]> {
  const dims = new Map<string, string[]>();
  const container = child(root, 'dimensions');
  if (!container) return dims;
  for (const dim of children(container)) {
    dims.set(canonicalName(dim.getAttribute('name') ?? ''), children(dim).map((e) => e.getAttribute('name') ?? ''));
  }
  return dims;
}

function parseTime(root: Element): XmileModel['time'] {
  const specs = child(root, 'sim_specs');
  if (!specs) throw new Error('XMILE file has no <sim_specs>');
  const read = (tag: string) => Number(text(child(specs, tag)));
  return { start: read('start'), stop: read('stop'), dt: read('dt') || 1, method: (specs.getAttribute('method') ?? 'euler').toLowerCase() };
}

function isVariable(el: Element): boolean {
  return el.tagName === 'stock' || el.tagName === 'flow' || el.tagName === 'aux';
}

function children(el: Element): Element[] {
  const out: Element[] = [];
  for (let n = el.firstChild; n; n = n.nextSibling) if (n.nodeType === 1) out.push(n as Element);
  return out;
}

function child(el: Element, tag: string): Element | undefined {
  for (let n = el.firstChild; n; n = n.nextSibling) if (n.nodeType === 1 && (n as Element).tagName === tag) return n as Element;
  return undefined;
}

function text(el: Element | undefined): string {
  return (el?.textContent ?? '').trim();
}

function numbers(value: string): number[] {
  return value.split(',').map(Number);
}
