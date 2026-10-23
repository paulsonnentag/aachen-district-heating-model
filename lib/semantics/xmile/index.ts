import type { Tensor } from '../../runtime/tensor';
import type { NodeOutput, Semantics } from '../types';
import { checkProvenance, describeXmile, parseXmile, portsOf } from './document';
import { checkModel, simulate } from './engine';

/** Stock-and-flow models in the OASIS XMILE format, run by our array evaluator. */
export const xmileSemantics: Semantics = {
  id: 'xmile',
  async prepare(node, readText) {
    if (typeof node.model !== 'string') throw new Error('An xmile node needs "model" to be a path to an .xmile file');
    const text = await readText(node.model);
    const model = parseXmile(text);
    return {
      ports: portsOf(model),
      issues: [...checkModel(model), ...checkProvenance(model)],
      description: describeXmile(model),
      fingerprint: text,
      execute: async (inputs) => runXmile(text, inputs.tensors),
    };
  },
};

export function runXmile(text: string, inputs: Record<string, Tensor>): NodeOutput {
  const { outputs, trace } = simulate(parseXmile(text), inputs);
  return { outputs, trace, warnings: [] };
}
