import { readdir, readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { Readable } from 'node:stream';
import type { ReadableStream } from 'node:stream/web';
import { defineConfig, type Plugin } from 'vitest/config';
import solid from 'vite-plugin-solid';

export default defineConfig({
  base: './',
  plugins: [solid(), remoteFiles()],
  publicDir: 'pipelines',
  worker: { format: 'es' },
  build: {
    target: 'esnext',
    rollupOptions: {
      input: {
        index: resolve(import.meta.dirname, 'index.html'),
        workbench: resolve(import.meta.dirname, 'workbench.html'),
        app: resolve(import.meta.dirname, 'app.html'),
      },
    },
  },
  test: {
    include: ['lib/**/*.test.ts'],
    environment: 'node',
  },
});

/** Fetches raw downloads for the page from publishers that send no CORS headers; only URLs a pipeline declares are served. */
function remoteFiles(): Plugin {
  return {
    name: 'remote-files',
    configureServer(server) {
      server.middlewares.use('/__remote', async (req, res) => {
        const url = new URL(req.url ?? '', 'http://dev').searchParams.get('url') ?? '';
        if (!(await declaredUrls()).has(url)) {
          res.statusCode = 403;
          res.end('Only the URLs of remote datasets in a pipeline can be fetched');
          return;
        }
        const upstream = await fetch(url);
        res.statusCode = upstream.status;
        res.setHeader('content-type', upstream.headers.get('content-type') ?? 'application/octet-stream');
        const length = upstream.headers.get('content-length');
        if (length) res.setHeader('content-length', length);
        if (upstream.body) Readable.fromWeb(upstream.body as ReadableStream).pipe(res);
        else res.end();
      });
    },
  };
}

async function declaredUrls(): Promise<Set<string>> {
  const root = join(import.meta.dirname, 'pipelines');
  const urls = new Set<string>();
  for (const dir of await readdir(root, { withFileTypes: true })) {
    if (!dir.isDirectory()) continue;
    const text = await readFile(join(root, dir.name, 'pipeline.json'), 'utf8').catch(() => undefined);
    const datasets: Record<string, { url?: string }> = text ? (JSON.parse(text).datasets ?? {}) : {};
    for (const dataset of Object.values(datasets)) if (dataset.url) urls.add(dataset.url);
  }
  return urls;
}
