/**
 * The one storage seam this package needs (token cache, cert cache, webhook dedupe).
 * Shaped so a Workers KV namespace or Durable Object storage is a three-line adapter.
 */
export interface KeyValueStore {
  get(key: string): Promise<string | null | undefined>;
  put(key: string, value: string, opts: { ttlSeconds: number }): Promise<void>;
  delete(key: string): Promise<void>;
}

/** In-process store with TTLs. Fine for tests and a single isolate; not shared across isolates. */
export function memoryStore(now: () => number = Date.now): KeyValueStore {
  const data = new Map<string, { value: string; expiresAt: number }>();
  return {
    async get(key) {
      const hit = data.get(key);
      if (!hit) return null;
      if (hit.expiresAt <= now()) {
        data.delete(key);
        return null;
      }
      return hit.value;
    },
    async put(key, value, { ttlSeconds }) {
      data.set(key, { value, expiresAt: now() + ttlSeconds * 1000 });
    },
    async delete(key) {
      data.delete(key);
    },
  };
}
