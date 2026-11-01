import type { KeyValueStore } from "../store";

/**
 * PayPal delivers at-least-once and retries for up to 3 days, so key on the event id and
 * keep marks a bit longer than that. KV is eventually consistent; when two deliveries can
 * race, back this with Durable Object storage (single-threaded) instead.
 */
export function createWebhookDeduper(store: KeyValueStore, opts: { ttlSeconds?: number } = {}) {
  const ttlSeconds = opts.ttlSeconds ?? 4 * 86_400;
  const key = (eventId: string) => `paypal:webhook-seen:${eventId}`;
  return {
    /** True the first time an event id is seen; false for every redelivery. */
    async claim(eventId: string): Promise<boolean> {
      if (await store.get(key(eventId))) return false;
      await store.put(key(eventId), "1", { ttlSeconds });
      return true;
    },
    /** Undo a claim when processing failed, so PayPal's redelivery is handled. */
    async release(eventId: string): Promise<void> {
      await store.delete(key(eventId));
    },
  };
}
