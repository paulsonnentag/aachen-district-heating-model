import type { RemoteFile } from '../../lib/runtime/datasets';
import { sha256Hex } from '../../lib/runtime/hash';
import { formatBytes } from '../values';

/** Some publishers send no CORS headers; the dev server can fetch those on the page's behalf. */
export async function download(file: RemoteFile, onLog: (line: string) => void): Promise<Uint8Array> {
  const host = new URL(file.url).host;
  onLog(`Downloading ${formatBytes(file.size)} from ${host}`);
  let response: Response;
  try {
    response = await fetch(file.url);
  } catch {
    if (!import.meta.env.DEV) throw new Error(`${host} does not allow downloads from a web page; run the dev server, which can fetch it for you`);
    onLog(`${host} does not allow direct downloads from a web page, fetching through the dev server`);
    response = await fetch(`${self.location.origin}/__remote?url=${encodeURIComponent(file.url)}`);
  }
  if (!response.ok) throw new Error(`Download failed (${response.status}): ${file.url}`);
  const bytes = await readWithProgress(response, file.size, (share) => onLog(`  ${host}: ${Math.round(share * 100)}%`));
  const hash = await sha256Hex(bytes);
  if (hash !== file.sha256) throw new Error(`${file.url} changed upstream: expected sha256 ${file.sha256.slice(0, 12)}…, got ${hash.slice(0, 12)}…`);
  onLog(`  ${host}: sha256 matches the pinned ${file.sha256.slice(0, 12)}…`);
  return bytes;
}

async function readWithProgress(response: Response, size: number, onProgress: (share: number) => void): Promise<Uint8Array> {
  const reader = response.body!.getReader();
  const chunks: Uint8Array[] = [];
  let received = 0;
  let reported = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    received += value.byteLength;
    if (received / size - reported >= 0.25) {
      reported = Math.floor((received / size) * 4) / 4;
      onProgress(Math.min(reported, 1));
    }
  }
  const bytes = new Uint8Array(received);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}
