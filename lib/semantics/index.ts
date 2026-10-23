import type { Semantics } from './types';
import { createAggregateSemantics } from './aggregate';
import { equationSemantics } from './equation';
import { createPythonSemantics, type PythonHost } from './python';
import { xmileSemantics } from './xmile';

/** All semantics; Python needs a host because running it differs between the browser and Node. */
export function createSemantics(python: PythonHost): Record<string, Semantics> {
  const pythonSemantics = createPythonSemantics(python);
  const aggregateSemantics = createAggregateSemantics(python.store);
  return {
    [xmileSemantics.id]: xmileSemantics,
    [equationSemantics.id]: equationSemantics,
    [pythonSemantics.id]: pythonSemantics,
    [aggregateSemantics.id]: aggregateSemantics,
  };
}
