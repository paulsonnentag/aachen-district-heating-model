import { z } from 'zod';
import type { Issue } from '../../runtime/pipeline';
import { coordsOf, type Tensor } from '../../runtime/tensor';
import type { NodeOutput, Semantics } from '../types';
import { numericLiterals } from '../xmile/document';
import { runXmile } from '../xmile';

const EquationModelSchema = z.object({
  variables: z.record(
    z.string(),
    z.object({
      equation: z.string(),
      units: z.string(),
      dims: z.array(z.string()).default([]),
    }),
  ),
});

type EquationModel = z.infer<typeof EquationModelSchema>;

/** Static calculations written as XMILE expressions; runs once, or once per year if an input varies by year. */
export const equationSemantics: Semantics = {
  id: 'equation',
  async prepare(node) {
    const model = EquationModelSchema.parse(node.model);
    return {
      ports: { inputs: null, outputs: Object.keys(model.variables) },
      issues: checkLiterals(model),
      description: {
        variables: [
          ...Object.keys(node.inputs).map((name) => ({ name, kind: 'aux' as const, role: 'input' as const, dims: [], equation: '' })),
          ...Object.entries(model.variables).map(([name, v]) => ({
            name,
            kind: 'aux' as const,
            role: 'output' as const,
            dims: v.dims,
            equation: v.equation,
            units: v.units,
          })),
        ],
      },
      execute: (inputs) => runEquations(model, inputs),
    };
  },
};

async function runEquations(model: EquationModel, inputs: Record<string, Tensor>): Promise<NodeOutput> {
  const years = [...new Set(Object.values(inputs).flatMap((t) => coordsOf(t, 'year') ?? []))].map(Number);
  const timeVarying = years.length > 0;
  const { outputs, warnings } = runXmile(toXmile(model, inputs, timeVarying ? years : [0]), inputs);
  if (timeVarying) return { outputs, warnings };
  return { outputs: Object.fromEntries(Object.entries(outputs).map(([k, t]) => [k, dropYear(t)])), warnings };
}

function toXmile(model: EquationModel, inputs: Record<string, Tensor>, years: number[]): string {
  const dims = collectDims(inputs);
  for (const [name, variable] of Object.entries(model.variables)) {
    for (const dim of variable.dims) if (!dims.has(dim)) throw new Error(`${name}: dimension "${dim}" does not appear in any input`);
  }
  const dimsXml = [...dims].map(([dim, elems]) => `<dim name="${escape(dim)}">${elems.map((e) => `<elem name="${escape(e)}"/>`).join('')}</dim>`).join('');
  const variable = (name: string, access: string, dimList: string[], equation: string, units: string) =>
    `<aux name="${escape(name)}" access="${access}">${dimList.length > 0 ? `<dimensions>${dimList.map((d) => `<dim name="${escape(d)}"/>`).join('')}</dimensions>` : ''}<eqn>${escape(equation)}</eqn><units>${escape(units)}</units></aux>`;
  const inputVars = Object.entries(inputs).map(([name, t]) => variable(name, 'input', t.dims.filter((d) => d !== 'year'), '0', t.unit));
  const outputVars = Object.entries(model.variables).map(([name, v]) => variable(name, 'output', v.dims, v.equation, v.units));
  return `<?xml version="1.0" encoding="utf-8"?>
<xmile version="1.0" xmlns="http://docs.oasis-open.org/xmile/ns/XMILE/v1.0">
<header><name>equation</name><vendor>model-workbench</vendor><product version="1">model-workbench</product></header>
<sim_specs method="Euler" time_units="year"><start>${Math.min(...years)}</start><stop>${Math.max(...years)}</stop><dt>1</dt></sim_specs>
${dims.size > 0 ? `<dimensions>${dimsXml}</dimensions>` : ''}
<model><variables>${[...inputVars, ...outputVars].join('')}</variables></model>
</xmile>`;
}

function collectDims(inputs: Record<string, Tensor>): Map<string, string[]> {
  const dims = new Map<string, string[]>();
  for (const [name, tensor] of Object.entries(inputs)) {
    for (const [i, dim] of tensor.dims.entries()) {
      if (dim === 'year') continue;
      const coords = tensor.coords[i]!;
      const known = dims.get(dim);
      if (!known) dims.set(dim, coords);
      else if (known.length !== coords.length || !coords.every((c) => known.includes(c))) {
        throw new Error(`Input ${name}: coordinates of "${dim}" differ from other inputs`);
      }
    }
  }
  return dims;
}

function checkLiterals(model: EquationModel): Issue[] {
  return Object.entries(model.variables).flatMap(([name, v]) =>
    numericLiterals(v.equation).map((literal) => ({
      severity: 'error' as const,
      where: name,
      message: `Literal ${literal} in equation: declare it as an input backed by a dataset`,
    })),
  );
}

function dropYear(tensor: Tensor): Tensor {
  return { ...tensor, dims: tensor.dims.slice(1), coords: tensor.coords.slice(1) };
}

function escape(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
