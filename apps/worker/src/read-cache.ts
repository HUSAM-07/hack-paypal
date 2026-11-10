/**
 * A short cache for the engine's read API as the console and AG Studio poll it (every 2s per
 * open tab). Each read costs D1 rows, and D1 has a daily read limit; with this, any number of
 * tabs cost one engine read per path per TTL. Writes never go through it, and a visitor's private
 * Studio changes are applied after the read, so the shared data cached here is the same for all.
 *
 * Two layers: this isolate's memory (always works), then the Cache API, which shares across
 * isolates in a colo where it is available (it may do nothing on some hostnames; that's fine).
 */
export const READ_CACHE_TTL_MS = 10_000;

interface Entry {
  at: number;
  status: number;
  headers: [string, string][];
  body: string;
}

const memory = new Map<string, Entry>();
const inflight = new Map<string, Promise<Entry>>();
/** Bumped by clearReadCache so old Cache API entries are never read again. */
let generation = 0;

export function clearReadCache(): void {
  memory.clear();
  inflight.clear();
  generation += 1;
}

const toResponse = (e: Entry) => new Response(e.body, { status: e.status, headers: e.headers });

function edgeCache(): Cache | undefined {
  try {
    return (globalThis as unknown as { caches?: { default?: Cache } }).caches?.default;
  } catch {
    return undefined;
  }
}

/**
 * Serves a GET from the cache when it is younger than the TTL; otherwise loads it once (callers
 * arriving meanwhile share that load) and keeps only 200s. Anything but GET goes straight through.
 */
export async function cachedRead(
  req: Request,
  load: (req: Request) => Promise<Response>,
  opts: { ttlMs?: number; now?: () => number } = {},
): Promise<Response> {
  if (req.method !== "GET") return load(req);
  const ttl = opts.ttlMs ?? READ_CACHE_TTL_MS;
  const now = opts.now ?? Date.now;
  const url = new URL(req.url);
  const key = `${url.pathname}${url.search}`;
  const hit = memory.get(key);
  if (hit && now() - hit.at < ttl) return toResponse(hit);

  let pending = inflight.get(key);
  if (!pending) {
    pending = (async (): Promise<Entry> => {
      const cache = edgeCache();
      const edgeKey = new Request(`https://cited-read-cache.internal/g${generation}${key}`);
      const fromEdge = await cache?.match(edgeKey).catch(() => undefined);
      const res = fromEdge ?? (await load(req));
      const entry: Entry = {
        at: now(),
        status: res.status,
        headers: [...res.headers].filter(([k]) => k !== "set-cookie"),
        body: await res.text(),
      };
      if (entry.status === 200) {
        memory.set(key, entry);
        if (cache && !fromEdge) {
          const stored = toResponse(entry);
          stored.headers.set("cache-control", `max-age=${Math.ceil(ttl / 1000)}`);
          await cache.put(edgeKey, stored).catch(() => undefined);
        }
      }
      return entry;
    })().finally(() => inflight.delete(key));
    inflight.set(key, pending);
  }
  return toResponse(await pending);
}
