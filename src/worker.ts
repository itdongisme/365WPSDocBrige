export interface Env {
  CACHE_BUCKET: R2Bucket;
  LRU_COORD: DurableObjectNamespace<LruCoordinator>;

  // Vars
  MAX_BYTES: string; // number in string
  ALLOW_ALL_SOURCES?: string;
  ALLOWED_SRC_HOSTS?: string;
  DOWNLOAD_ROUTE_PREFIX?: string;
  CACHE_ROUTE?: string;
  LOCK_TTL_MS?: string;
  PREFETCH_WINDOW_MS?: string;
}

type LruMeta = {
  size: number;
  createdAt: number;
  lastAccessAt: number;
};

type LockState = {
  holderId: string;
  expireAt: number;
};

const text = (s: string, status = 200, headers: Record<string, string> = {}) =>
  new Response(s, { status, headers: { 'content-type': 'text/plain; charset=utf-8', ...headers } });

function parseBoolean(value: string | undefined, defaultValue: boolean): boolean {
  if (value === undefined) return defaultValue;
  const v = value.toLowerCase();
  return v === '1' || v === 'true' || v === 'yes' || v === 'y';
}

function isAllowedSource(url: URL, env: Env): boolean {
  const allowAll = parseBoolean(env.ALLOW_ALL_SOURCES, false);
  if (allowAll) return true;
  const hosts = (env.ALLOWED_SRC_HOSTS || '').split(',').map(h => h.trim()).filter(Boolean);
  return hosts.includes(url.hostname) || hosts.some(h => url.hostname.endsWith(`.${h}`));
}

// removed sync sha256 helper; use async variant below

async function sha256HexAsync(input: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(input);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  const hashHex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
  return hashHex;
}

function parseIntWithDefault(value: string | undefined, defaultValue: number): number {
  if (!value) return defaultValue;
  const n = parseInt(value, 10);
  return Number.isFinite(n) ? n : defaultValue;
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    try {
      const url = new URL(request.url);
      const downloadPrefix = env.DOWNLOAD_ROUTE_PREFIX || '/d/';
      const cacheRoute = env.CACHE_ROUTE || '/cache';

      if (url.pathname === '/' || url.pathname === '') {
        return new Response(JSON.stringify({
          name: 'WPS → R2 Cache Gateway',
          usage: {
            cache: `${url.origin}${cacheRoute}?src=<encoded_url>&filename=<optional>`,
            download: `${url.origin}${downloadPrefix}<key>`
          }
        }, null, 2), { status: 200, headers: { 'content-type': 'application/json' } });
      }

      if (url.pathname.startsWith(downloadPrefix)) {
        const key = url.pathname.slice(downloadPrefix.length);
        if (!key) return text('key required', 400);
        return await handleDownload(key, request, env);
      }

      if (url.pathname === cacheRoute) {
        const srcParam = url.searchParams.get('src');
        if (!srcParam) return text('missing src', 400);
        const filenameParam = url.searchParams.get('filename');
        let source: URL;
        try {
          source = new URL(srcParam);
        } catch {
          return text('invalid src', 400);
        }
        if (!isAllowedSource(source, env)) {
          return text('source host not allowed', 403);
        }
        const keyDigest = await sha256HexAsync(source.toString());
        const key = buildObjectKeyWithDigest(keyDigest, source, filenameParam);
        const head = await env.CACHE_BUCKET.head(key);
        if (head) {
          await touchLru(env, key, head.size || 0);
          const location = `${url.origin}${downloadPrefix}${encodeURIComponent(key)}`;
          return new Response(null, { status: 302, headers: { Location: location } });
        }
        const resp = await cacheAndStore(source, key, request, env, ctx);
        return resp;
      }

      return text('Not found', 404);
    } catch (err: any) {
      return text(`Error: ${err?.message || String(err)}`, 500);
    }
  }
};

function buildObjectKeyWithDigest(digest: string, sourceUrl: URL, fileName?: string | null): string {
  if (fileName && fileName.length > 0) {
    return `${digest}/${fileName}`;
  }
  const base = sourceUrl.pathname.split('/').filter(Boolean).pop() || 'file';
  return `${digest}/${base}`;
}

async function handleDownload(key: string, request: Request, env: Env): Promise<Response> {
  const obj = await env.CACHE_BUCKET.get(key);
  if (!obj) return text('Not found', 404);
  await touchLru(env, key, obj.size || 0);

  const headers = new Headers();
  if (obj.httpMetadata?.contentType) headers.set('content-type', obj.httpMetadata.contentType);
  if (obj.size !== undefined) headers.set('content-length', String(obj.size));
  headers.set('etag', obj.etag);
  if (obj.httpMetadata?.contentDisposition) headers.set('content-disposition', obj.httpMetadata.contentDisposition);
  headers.set('cache-control', 'private, max-age=0, must-revalidate');

  return new Response(obj.body, { status: 200, headers });
}

async function cacheAndStore(source: URL, key: string, request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  const coordinator = env.LRU_COORD.get(env.LRU_COORD.idFromName('global'));
  const acquireResp = await coordinator.fetch('https://do/lock', { method: 'POST', body: JSON.stringify({ type: 'acquire', key }) });
  if (!acquireResp.ok) {
    return text(`failed to acquire lock: ${acquireResp.status}`, 500);
  }
  const lockResult = await acquireResp.json() as { acquired: boolean };
  if (!lockResult.acquired) {
    // Poll until available or timeout
    for (let i = 0; i < 60; i++) {
      await sleep(1000);
      const head = await env.CACHE_BUCKET.head(key);
      if (head) {
        await touchLru(env, key, head.size || 0);
        return new Response(null, { status: 302, headers: { Location: new URL(request.url).origin + (env.DOWNLOAD_ROUTE_PREFIX || '/d/') + encodeURIComponent(key) } });
      }
    }
    return text('timeout waiting for object', 504);
  }

  let releaseNeeded = true;
  try {
    const upstream = await fetch(source.toString(), { method: 'GET' });
    if (!upstream.ok || !upstream.body) {
      return text(`upstream error: ${upstream.status}`, 502);
    }

    // Stream to R2
    const contentType = upstream.headers.get('content-type') || 'application/octet-stream';
    const contentDisposition = inferContentDispositionFromUrl(key, source, upstream.headers.get('content-disposition'));
    const put = await env.CACHE_BUCKET.put(key, upstream.body, {
      httpMetadata: { contentType, contentDisposition }
    });
    const size = put.size || (await env.CACHE_BUCKET.head(key))?.size || 0;
    await updateMetaAndEvict(env, key, size);

    // redirect to download
    const location = new URL(request.url).origin + (env.DOWNLOAD_ROUTE_PREFIX || '/d/') + encodeURIComponent(key);
    return new Response(null, { status: 302, headers: { Location: location } });
  } catch (e: any) {
    return text(`cache error: ${e?.message || String(e)}`, 500);
  } finally {
    if (releaseNeeded) {
      ctx.waitUntil(coordinator.fetch('https://do/lock', { method: 'POST', body: JSON.stringify({ type: 'release', key }) }).then(() => {}));
    }
  }
}

function inferContentDispositionFromUrl(key: string, source: URL, upstreamDisposition: string | null): string | undefined {
  if (upstreamDisposition) return upstreamDisposition;
  const fileName = decodeURIComponent(key.split('/').slice(1).join('/'));
  return `attachment; filename*=UTF-8''${encodeRFC5987ValueChars(fileName)}`;
}

function encodeRFC5987ValueChars(str: string): string {
  return encodeURIComponent(str)
    .replace(/['()]/g, escape)
    .replace(/\*/g, '%2A')
    .replace(/%(7C|60|5E)/g, unescape);
}

async function updateMetaAndEvict(env: Env, key: string, size: number): Promise<void> {
  const coordinator = env.LRU_COORD.get(env.LRU_COORD.idFromName('global'));
  const maxBytes = parseIntWithDefault(env.MAX_BYTES, 9 * 1024 * 1024 * 1024);
  const res = await coordinator.fetch('https://do/meta', { method: 'POST', body: JSON.stringify({ type: 'upsert', key, size, maxBytes }) });
  if (!res.ok) throw new Error('failed to update meta');
}

async function touchLru(env: Env, key: string, size: number): Promise<void> {
  const coordinator = env.LRU_COORD.get(env.LRU_COORD.idFromName('global'));
  await coordinator.fetch('https://do/meta', { method: 'POST', body: JSON.stringify({ type: 'touch', key, size }) });
}

function sleep(ms: number): Promise<void> { return new Promise(r => setTimeout(r, ms)); }

export class LruCoordinator {
  state: DurableObjectState;
  env: Env;
  // in-memory, reset on restart
  meta: Map<string, LruMeta> = new Map();
  totalSize: number = 0;
  locks: Map<string, LockState> = new Map();

  constructor(state: DurableObjectState, env: Env) {
    this.state = state;
    this.env = env;
    this.state.blockConcurrencyWhile(async () => {
      const snapshot = await this.state.storage.get<{ meta: [string, LruMeta][], totalSize: number }>('snapshot');
      if (snapshot) {
        this.meta = new Map(snapshot.meta);
        this.totalSize = snapshot.totalSize || 0;
      }
    });
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const now = Date.now();
    if (url.pathname === '/lock' && request.method === 'POST') {
      const body = await request.json() as { type: 'acquire' | 'release'; key: string };
      const ttl = parseIntWithDefault(this.env.LOCK_TTL_MS, 10 * 60 * 1000);
      if (body.type === 'acquire') {
        const lock = this.locks.get(body.key);
        if (!lock || lock.expireAt <= now) {
          this.locks.set(body.key, { holderId: crypto.randomUUID(), expireAt: now + ttl });
          return json({ acquired: true });
        } else {
          return json({ acquired: false });
        }
      }
      if (body.type === 'release') {
        this.locks.delete(body.key);
        return json({ ok: true });
      }
      return json({ ok: false }, 400);
    }

    if (url.pathname === '/meta' && request.method === 'POST') {
      const body = await request.json() as { type: 'upsert' | 'touch'; key: string; size: number; maxBytes?: number };
      if (!body || !body.key) return json({ error: 'bad body' }, 400);
      if (body.type === 'touch') {
        const prev = this.meta.get(body.key);
        if (prev) {
          prev.lastAccessAt = now;
          this.meta.set(body.key, prev);
        } else {
          this.meta.set(body.key, { size: body.size, createdAt: now, lastAccessAt: now });
          this.totalSize += body.size;
        }
        await this.persist();
        return json({ ok: true, totalSize: this.totalSize });
      }
      if (body.type === 'upsert') {
        const existing = this.meta.get(body.key);
        if (existing) {
          this.totalSize -= existing.size;
        }
        this.meta.set(body.key, { size: body.size, createdAt: now, lastAccessAt: now });
        this.totalSize += body.size;
        const maxBytes = body.maxBytes ?? parseIntWithDefault(this.env.MAX_BYTES, 9 * 1024 * 1024 * 1024);
        await this.evictIfNeeded(maxBytes);
        await this.persist();
        return json({ ok: true, totalSize: this.totalSize });
      }
      return json({ ok: false }, 400);
    }

    return json({ ok: false, error: 'not found' }, 404);
  }

  private async evictIfNeeded(maxBytes: number): Promise<void> {
    while (this.totalSize > maxBytes && this.meta.size > 0) {
      const lruEntry = this.findLeastRecentlyUsed();
      if (!lruEntry) break;
      const [key, meta] = lruEntry;
      try {
        await (this.env.CACHE_BUCKET as any).delete(key);
      } catch {}
      this.meta.delete(key);
      this.totalSize -= meta.size;
    }
  }

  private findLeastRecentlyUsed(): [string, LruMeta] | null {
    let oldestKey: string | null = null;
    let oldest: LruMeta | null = null;
    for (const [k, v] of this.meta.entries()) {
      if (!oldest || v.lastAccessAt < oldest.lastAccessAt) {
        oldest = v; oldestKey = k;
      }
    }
    if (!oldestKey || !oldest) return null;
    return [oldestKey, oldest];
  }

  private async persist(): Promise<void> {
    await this.state.storage.put('snapshot', { meta: Array.from(this.meta.entries()), totalSize: this.totalSize });
  }
}

function json(obj: any, status = 200): Response {
  return new Response(JSON.stringify(obj), { status, headers: { 'content-type': 'application/json; charset=utf-8' } });
}

