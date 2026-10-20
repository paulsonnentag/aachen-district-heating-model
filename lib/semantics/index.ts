import type { Semantics } from './types';
import { equationSemantics } from './equation';
import { xmileSemantics } from './xmile';

export const semantics: Record<string, Semantics> = {
  [xmileSemantics.id]: xmileSemantics,
  [equationSemantics.id]: equationSemantics,
};
