import type { Semantics } from './types';
import { equationSemantics } from './equation';
import { createPythonSemantics, type PythonHost } from './python';
import { xmileSemantics } from './xmile';

/** All semantics; Python needs a host because running it differs between the browser and Node. */
export function createSemantics(python: PythonHost): Record<string, Semantics> {
  const pythonSemantics = createPythonSemantics(python);
  return {
    [xmileSemantics.id]: xmileSemantics,
    [equationSemantics.id]: equationSemantics,
    [pythonSemantics.id]: pythonSemantics,
  };
}
