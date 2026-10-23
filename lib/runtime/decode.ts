import type { FetchFile, RemoteFile } from './datasets';
import type { Decode } from './pipeline';
import { tableFromColumns, type Table } from './table';

/** Formats the runtime reads into a table itself, so a plain download needs no node to be inspected. */
export const DECODABLE_FORMATS = ['GeoJSON'];

const decoded = new Map<string, Promise<Table>>();
const done = new Map<string, Table>();

/** Downloads and decodes a file once per session; later runs get the same table. */
export function decodeFile(file: RemoteFile, decode: Decode, key: string, fetchFile: FetchFile, onLog: (line: string) => void): Promise<Table> {
  let table = decoded.get(key);
  if (!table) {
    table = (async () => {
      const bytes = await fetchFile(file, onLog);
      onLog(`Decoding ${file.format} into a table`);
      const result = decodeBytes(bytes, file.format, decode);
      onLog(`${result.rows.toLocaleString('en')} rows × ${Object.keys(result.columns).length} columns`);
      done.set(key, result);
      return result;
    })();
    decoded.set(key, table);
    table.catch(() => decoded.get(key) === table && decoded.delete(key));
  }
  return table;
}

/** The table, if this session decoded the file already. */
export function decodedTable(key: string): Table | undefined {
  return done.get(key);
}

function decodeBytes(bytes: Uint8Array, format: string, decode: Decode): Table {
  switch (format) {
    case 'GeoJSON':
      return geoJsonTable(JSON.parse(new TextDecoder().decode(bytes)), decode);
    default:
      throw new Error(`Cannot decode ${format}; the runtime reads ${DECODABLE_FORMATS.join(', ')}`);
  }
}

type Feature = { id?: string | number; properties?: Record<string, unknown> | null; geometry: unknown };

/** One row per feature: its id, every property, then the geometry (in WGS 84 unless the spec says otherwise). */
function geoJsonTable(collection: { features?: Feature[] }, decode: Decode): Table {
  const features = collection.features;
  if (!Array.isArray(features)) throw new Error('GeoJSON: not a FeatureCollection');
  const names = new Set<string>(['id']);
  for (const feature of features) for (const name of Object.keys(feature.properties ?? {})) names.add(name);
  names.add('geometry');
  const data: Record<string, unknown[]> = {};
  for (const name of names) data[name] = [];
  for (const feature of features) {
    for (const name of names) {
      const value = name === 'id' ? feature.id : name === 'geometry' ? feature.geometry : feature.properties?.[name];
      data[name]!.push(value ?? null);
    }
  }
  return tableFromColumns(data, { geometry: { crs: 'EPSG:4326' }, ...decode.columns });
}
