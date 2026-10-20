export type Tensor = {
  dims: string[];
  coords: string[][];
  values: Float64Array;
  unit: string;
};

export function scalar(value: number, unit: string): Tensor {
  return { dims: [], coords: [], values: Float64Array.of(value), unit };
}

export function size(tensor: Tensor): number {
  return tensor.coords.reduce((n, c) => n * c.length, 1);
}

export function get(tensor: Tensor, at: Record<string, string>): number {
  let offset = 0;
  for (const [i, dim] of tensor.dims.entries()) {
    const coords = tensor.coords[i]!;
    const key = at[dim];
    const index = key === undefined ? -1 : coords.indexOf(key);
    if (index < 0) throw new Error(`No coordinate ${dim}=${key}`);
    offset = offset * coords.length + index;
  }
  return tensor.values[offset]!;
}

export function* entries(tensor: Tensor): Generator<[Record<string, string>, number]> {
  const total = size(tensor);
  for (let offset = 0; offset < total; offset++) {
    const at: Record<string, string> = {};
    let rest = offset;
    for (let i = tensor.dims.length - 1; i >= 0; i--) {
      const coords = tensor.coords[i]!;
      at[tensor.dims[i]!] = coords[rest % coords.length]!;
      rest = Math.floor(rest / coords.length);
    }
    yield [at, tensor.values[offset]!];
  }
}

export function coordsOf(tensor: Tensor, dim: string): string[] | undefined {
  const i = tensor.dims.indexOf(dim);
  return i < 0 ? undefined : tensor.coords[i];
}

/** Sums over every dimension not listed in `keep`. */
export function sumExcept(tensor: Tensor, keep: string[]): Tensor {
  return reduceExcept(tensor, keep, 'sum');
}

/** Sums or averages over every dimension not listed in `keep`. */
export function reduceExcept(tensor: Tensor, keep: string[], mode: 'sum' | 'mean'): Tensor {
  const kept = tensor.dims.filter((d) => keep.includes(d));
  const coords = kept.map((d) => coordsOf(tensor, d)!);
  const resultSize = coords.reduce((n, c) => n * c.length, 1);
  const values = new Float64Array(resultSize);
  const keptStrides = new Map(kept.map((d, i) => [d, coords.slice(i + 1).reduce((n, c) => n * c.length, 1)]));
  const targetStrides = tensor.dims.map((d) => keptStrides.get(d) ?? 0);
  const lengths = tensor.coords.map((c) => c.length);
  const index = new Array<number>(lengths.length).fill(0);
  for (let offset = 0; offset < tensor.values.length; offset++) {
    let target = 0;
    for (let i = 0; i < lengths.length; i++) target += index[i]! * targetStrides[i]!;
    values[target] = values[target]! + tensor.values[offset]!;
    for (let i = lengths.length - 1; i >= 0; i--) {
      if (++index[i]! < lengths[i]!) break;
      index[i] = 0;
    }
  }
  if (mode === 'mean') {
    const count = tensor.values.length / resultSize;
    for (let i = 0; i < resultSize; i++) values[i] = values[i]! / count;
  }
  return { dims: kept, coords, values, unit: tensor.unit };
}

/** Fixes the given dimensions at one coordinate each; the result varies by the remaining dimensions. */
export function select(tensor: Tensor, at: Record<string, string>): Tensor {
  const strides = tensor.coords.map((_, i) => tensor.coords.slice(i + 1).reduce((n, c) => n * c.length, 1));
  let base = 0;
  for (const [i, dim] of tensor.dims.entries()) {
    if (at[dim] === undefined) continue;
    const index = tensor.coords[i]!.indexOf(at[dim]);
    if (index < 0) throw new Error(`No coordinate ${dim}=${at[dim]}`);
    base += index * strides[i]!;
  }
  const free = tensor.dims.flatMap((dim, i) => (at[dim] === undefined ? [i] : []));
  const lengths = free.map((i) => tensor.coords[i]!.length);
  const values = new Float64Array(lengths.reduce((n, l) => n * l, 1));
  const index = new Array<number>(free.length).fill(0);
  for (let offset = 0; offset < values.length; offset++) {
    let source = base;
    for (let k = 0; k < free.length; k++) source += index[k]! * strides[free[k]!]!;
    values[offset] = tensor.values[source]!;
    for (let k = free.length - 1; k >= 0; k--) {
      if (++index[k]! < lengths[k]!) break;
      index[k] = 0;
    }
  }
  return { dims: free.map((i) => tensor.dims[i]!), coords: free.map((i) => tensor.coords[i]!), values, unit: tensor.unit };
}
