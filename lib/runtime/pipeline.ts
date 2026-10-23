import { z } from 'zod';

export const PipelineSchema = z.lazy(() =>
  z.object({
    id: z.string(),
    title: z.string(),
    description: z.string().optional(),
    sources: z.record(z.string(), SourceSchema),
    datasets: z.record(z.string(), DatasetSchema),
    nodes: z.array(NodeSchema),
    groups: z.array(GroupSchema).default([]),
    /** The view each dataset shows first, e.g. `{ "street_length": "map" }`; others start with their first view. */
    views: z.record(z.string(), z.string()).default({}),
  }),
);

/** Nodes shown as one box until expanded; the group's inputs and outputs follow from its nodes' wiring. */
export const GroupSchema = z.lazy(() =>
  z.object({
    id: z.string(),
    label: z.string(),
    description: z.string().optional(),
    nodes: z.array(z.string()).min(1),
  }),
);

/**
 * Ports wired to datasets: `{ port: dataset }`, or a list of datasets when each port has its dataset's name.
 * Outputs may be left out when the model names them in `model.outputs`.
 */
export const NodeSchema = z.lazy(() =>
  z
    .object({
      id: z.string(),
      label: z.string(),
      semantics: z.string(),
      model: z.union([z.string(), z.record(z.string(), z.unknown())]),
      inputs: WiringSchema,
      outputs: WiringSchema.optional(),
      description: z.string().optional(),
    })
    .transform((node) => ({ ...node, outputs: node.outputs ?? sameNames(Object.keys(modelOutputs(node.model))) })),
);

const WiringSchema = z.union([z.record(z.string(), z.string()), z.array(z.string()).transform(sameNames)]);

function sameNames(names: string[]): Record<string, string> {
  return Object.fromEntries(names.map((name) => [name, name]));
}

function modelOutputs(model: string | Record<string, unknown>): object {
  const outputs = typeof model === 'object' ? model.outputs : undefined;
  return outputs && typeof outputs === 'object' ? outputs : {};
}

export const DatasetSchema = z.lazy(() => z.union([InlineDatasetSchema, FileDatasetSchema, RemoteFileDatasetSchema]));

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

/** A raw download that nodes read as a file rather than as a tensor, pinned by its hash. */
const RemoteFileDatasetSchema = z.lazy(() =>
  z.object({
    url: z.string(),
    sha256: z.string().regex(/^[0-9a-f]{64}$/),
    size: z.number().int().positive(),
    format: z.string(),
    /** Read the file into a table, when something needs it, instead of handing nodes the file. */
    decode: DecodeSchema.optional(),
    source: ProvenanceSchema,
    description: z.string().optional(),
  }),
);

export const ColumnSpecSchema = z.object({
  unit: z.string().optional(),
  crs: z.string().optional(),
  description: z.string().optional(),
});

const DecodeSchema = z.object({
  kind: z.literal('table'),
  description: z.string().optional(),
  columns: z.record(z.string(), ColumnSpecSchema).default({}),
});

export type NestedValue = number | { [key: string]: NestedValue };

const NestedValueSchema: z.ZodType<NestedValue> = z.lazy(() =>
  z.union([z.number(), z.record(z.string(), NestedValueSchema)]),
);

/** Every catalog value is read from a source or stated as an assumption; anything derived is computed by a node. */
export const ProvenanceSchema = z.union([
  z.strictObject({ ref: z.string(), locator: z.string(), note: z.string().optional() }),
  z.strictObject({ assumption: z.string() }),
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
export type PipelineGroup = z.infer<typeof GroupSchema>;
export type Dataset = z.infer<typeof DatasetSchema>;
export type RemoteFileDataset = z.infer<typeof RemoteFileDatasetSchema>;
export type Decode = z.infer<typeof DecodeSchema>;
export type Provenance = z.infer<typeof ProvenanceSchema>;
export type Source = z.infer<typeof SourceSchema>;
export type Scenario = z.infer<typeof ScenarioSchema>;
export type PipelineIndex = z.infer<typeof IndexSchema>;

export type Issue = {
  severity: 'error' | 'warning';
  where: string;
  message: string;
};

export function isRemoteFile(dataset: Dataset): dataset is RemoteFileDataset {
  return 'url' in dataset;
}

export function isAssumption(provenance: Provenance): provenance is { assumption: string } {
  return 'assumption' in provenance;
}

export function provenanceKind(provenance: Provenance): 'sourced' | 'assumption' {
  return 'assumption' in provenance ? 'assumption' : 'sourced';
}

export function sourceRefs(provenance: Provenance): string[] {
  return 'ref' in provenance ? [provenance.ref] : [];
}
