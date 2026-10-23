import { heatTransition } from './heat-transition';
import { housing } from './housing';
import type { Artifact, Draft, Experiment } from './types';

export const experiments: Experiment[] = [heatTransition, housing];

export function findExperiment(id: string | null): Experiment {
  return experiments.find((e) => e.id === id) ?? experiments[0]!;
}

export function artifactsOf(experiment: Experiment): Artifact[] {
  return experiment.chat.flatMap((message) => message.blocks.filter((block): block is Artifact => 'id' in block));
}

export function draftsOf(experiment: Experiment): Draft[] {
  return artifactsOf(experiment).filter((a): a is Draft => a.kind === 'draft');
}
