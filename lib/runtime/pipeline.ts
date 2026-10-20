import { z } from 'zod';

export const PipelineSchema = z.lazy(() =>
  z.object({
    id: z.string(),
    title: z.string(),
    description: z.string().optional(),
    sources: z.record(z.string(), SourceSchema),
    datasets: z.record(z.string(), DatasetSchema),
    nodes: z.array(NodeSchema),
  }),
);

export const NodeSchema = z.lazy(() =>
  z.object({
    id: z.string(),
    label: z.string(),
    semantics: z.string(),
    model: z.union([z.string(), z.record(z.string(), z.unknown())]),
    inputs: z.record(z.string(), z.string()),
    outputs: z.record(z.string(), z.string()),
    description: z.string().optional(),
  }),
);

export const DatasetSchema = z.lazy(() => z.union([InlineDatasetSchema, FileDatasetSchema]));

const InlineDatasetSchema = z.lazy(() =>
  z.object({
    value: NestedValueSchema,
    dims: z.array(z.string()).default([]),
    unit: z.string(),
    source: ProvenanceSchema,
    description: z.string().optional(),
  }),
);

const FileDatasetSchema = z.lazy(() =>
  z.object({
    file: z.string(),
    dims: z.record(z.string(), z.string()),
    column: z.string(),
    unit: z.string(),
    source: ProvenanceSchema,
    description: z.string().optional(),
  }),
);

export type NestedValue = number | { [key: string]: NestedValue };

const NestedValueSchema: z.ZodType<NestedValue> = z.lazy(() =>
  z.union([z.number(), z.record(z.string(), NestedValueSchema)]),
);

export const ProvenanceSchema = z.union([
  z.strictObject({ ref: z.string(), locator: z.string(), note: z.string().optional() }),
  z.strictObject({ assumption: z.string() }),
  z.strictObject({ script: z.string(), from: z.array(z.string()).min(1), method: z.string() }),
]);

export const SourceSchema = z.object({
  title: z.string(),
  url: z.string(),
  publisher: z.string().optional(),
  license: z.string().optional(),
  verification: z.enum(['primaryRead', 'snippetOnly', 'unverified']),
});

export const ScenarioSchema = z.object({
  label: z.string(),
  expectation: z.string().optional(),
  patch: z.record(z.string(), z.unknown()),
});

export const IndexSchema = z.object({
  pipelines: z.array(
    z.object({ path: z.string(), scenarios: z.array(z.string()).default([]), story: z.string().optional() }),
  ),
});

export type Pipeline = z.infer<typeof PipelineSchema>;
export type PipelineNode = z.infer<typeof NodeSchema>;
export type Dataset = z.infer<typeof DatasetSchema>;
export type Provenance = z.infer<typeof ProvenanceSchema>;
export type Source = z.infer<typeof SourceSchema>;
export type Scenario = z.infer<typeof ScenarioSchema>;
export type PipelineIndex = z.infer<typeof IndexSchema>;

export type Issue = {
  severity: 'error' | 'warning';
  where: string;
  message: string;
};

export function isAssumption(provenance: Provenance): provenance is { assumption: string } {
  return 'assumption' in provenance;
}

/** Sourced: read from one document; derived: computed from sources by a preparation script. */
export function provenanceKind(provenance: Provenance): 'sourced' | 'assumption' | 'derived' {
  if ('assumption' in provenance) return 'assumption';
  return 'script' in provenance ? 'derived' : 'sourced';
}

export function sourceRefs(provenance: Provenance): string[] {
  if ('ref' in provenance) return [provenance.ref];
  return 'from' in provenance ? provenance.from : [];
}
