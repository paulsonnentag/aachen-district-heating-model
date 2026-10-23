/**
 * A read-only CORS proxy for tools running in Patchwork: `GET /?url=<encoded url>` fetches the
 * page server-side and returns it with CORS headers. Only origins in ALLOWED_ORIGINS get those
 * headers, so other sites can't use it from a browser (non-browser clients can still call it).
 */
type Env = { ALLOWED_ORIGINS: string };

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const origin = request.headers.get('Origin') ?? '';
    const allowed = env.ALLOWED_ORIGINS.split(',').map((o) => o.trim());
    if (!allowed.includes(origin)) return new Response('Origin not allowed', { status: 403 });
    const cors = corsHeaders(origin);
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
    if (request.method !== 'GET' && request.method !== 'HEAD') return new Response('Only GET and HEAD', { status: 405, headers: cors });

    const target = parseTarget(new URL(request.url).searchParams.get('url'));
    if (!target) return new Response('Pass an http(s) URL as ?url=', { status: 400, headers: cors });

    let upstream: Response;
    try {
      upstream = await fetch(target, { method: request.method, headers: upstreamHeaders(request), redirect: 'follow' });
    } catch (error) {
      return new Response(`Could not reach ${target.host}: ${error instanceof Error ? error.message : String(error)}`, { status: 502, headers: cors });
    }
    const headers = new Headers(cors);
    for (const name of ['content-type', 'content-length', 'last-modified', 'etag']) {
      const value = upstream.headers.get(name);
      if (value) headers.set(name, value);
    }
    headers.set('X-Final-Url', upstream.url);
    return new Response(upstream.body, { status: upstream.status, statusText: upstream.statusText, headers });
  },
};

function parseTarget(raw: string | null): URL | undefined {
  if (!raw) return undefined;
  try {
    const url = new URL(raw);
    return url.protocol === 'http:' || url.protocol === 'https:' ? url : undefined;
  } catch {
    return undefined;
  }
}

/** Cookies and the caller's origin are not forwarded; some sites refuse requests without a browser-like agent. */
function upstreamHeaders(request: Request): Headers {
  return new Headers({
    'User-Agent': 'Mozilla/5.0 (compatible; PatchworkCorsProxy/1.0; +https://patchwork.inkandswitch.com)',
    Accept: request.headers.get('Accept') ?? '*/*',
    'Accept-Language': request.headers.get('Accept-Language') ?? 'en,de;q=0.8',
  });
}

function corsHeaders(origin: string): Headers {
  return new Headers({
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
    'Access-Control-Allow-Headers': '*',
    'Access-Control-Expose-Headers': 'Content-Type, Content-Length, Last-Modified, ETag, X-Final-Url',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  });
}
