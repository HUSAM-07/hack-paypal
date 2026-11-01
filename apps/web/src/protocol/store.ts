import type { Item, Pact, Thread, TurnStatus } from "@pact/protocol";
import type { z } from "zod";
import type { AnyNotification } from "./client";

export interface ThreadState {
  thread: Thread;
  /** Item ids in arrival order; `items` holds the latest version of each. */
  order: string[];
  items: Record<string, Item>;
  activeTurnId: string | null;
  lastTurnStatus: z.infer<typeof TurnStatus> | null;
  onlineUserIds: string[];
  /** Latest known version of every pact mentioned in this thread. */
  pacts: Record<string, Pact>;
}

export interface StoreState {
  threads: Record<string, ThreadState>;
  threadOrder: string[];
}

type Listener = () => void;

function emptyThread(thread: Thread): ThreadState {
  return {
    thread,
    order: [],
    items: {},
    activeTurnId: null,
    lastTurnStatus: null,
    onlineUserIds: [],
    pacts: {},
  };
}

/**
 * Items-per-thread store. Pure reducer over protocol notifications plus a tiny
 * subscribe/getSnapshot pair for `useSyncExternalStore`. Every update replaces only
 * the touched thread object so React can bail out on untouched threads.
 */
export class ThreadStore {
  private state: StoreState = { threads: {}, threadOrder: [] };
  private listeners = new Set<Listener>();

  getSnapshot = (): StoreState => this.state;

  subscribe = (fn: Listener): (() => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };

  setThreads(threads: Thread[]) {
    const next: Record<string, ThreadState> = { ...this.state.threads };
    for (const t of threads)
      next[t.id] = next[t.id] ? { ...next[t.id]!, thread: t } : emptyThread(t);
    this.commit({
      threads: next,
      threadOrder: dedupe([...threads.map((t) => t.id), ...this.state.threadOrder]),
    });
  }

  upsertThread(thread: Thread) {
    const existing = this.state.threads[thread.id];
    this.commit({
      threads: {
        ...this.state.threads,
        [thread.id]: existing ? { ...existing, thread } : emptyThread(thread),
      },
      threadOrder: dedupe([thread.id, ...this.state.threadOrder]),
    });
  }

  /** Inserts a user message before the server echoes it, so sending feels instant. */
  addOptimistic(item: Item) {
    this.patchThread(item.threadId, (t) => putItem(t, item));
  }

  removeItem(threadId: string, itemId: string) {
    this.patchThread(threadId, (t) => {
      if (!t.items[itemId]) return t;
      const items = { ...t.items };
      delete items[itemId];
      return { ...t, items, order: t.order.filter((id) => id !== itemId) };
    });
  }

  apply(n: AnyNotification) {
    switch (n.method) {
      case "thread/started":
        this.upsertThread(n.params.thread);
        return;
      case "turn/started":
        this.patchThread(n.params.threadId, (t) => ({ ...t, activeTurnId: n.params.turnId }));
        return;
      case "turn/completed":
        this.patchThread(n.params.threadId, (t) => ({
          ...t,
          activeTurnId: t.activeTurnId === n.params.turnId ? null : t.activeTurnId,
          lastTurnStatus: n.params.status,
        }));
        return;
      case "item/started":
      case "item/completed": {
        const item = n.params.item;
        // The worker withdraws a message whose UI failed validation and resends a fixed one.
        if (item.type === "agentMessage" && item.status === "failed" && item.text === "") {
          this.removeItem(item.threadId, item.id);
          return;
        }
        this.patchThread(item.threadId, (t) => {
          // A server-echoed user message replaces its optimistic twin.
          let base = t;
          if (item.type === "userMessage") {
            const twin = t.order.find((id) => {
              const o = t.items[id];
              return (
                id.startsWith("optimistic_") && o?.type === "userMessage" && o.text === item.text
              );
            });
            if (twin) {
              const items = { ...t.items };
              delete items[twin];
              base = { ...t, items, order: t.order.map((id) => (id === twin ? item.id : id)) };
            }
          }
          const withItem = putItem(base, item);
          if (item.type === "pactUpdate") {
            return { ...withItem, pacts: { ...withItem.pacts, [item.pactId]: item.pact } };
          }
          return withItem;
        });
        return;
      }
      case "item/agentMessage/delta":
        this.patchThread(n.params.threadId, (t) => {
          const item = t.items[n.params.itemId];
          if (!item || item.type !== "agentMessage") return t;
          return {
            ...t,
            items: { ...t.items, [item.id]: { ...item, text: item.text + n.params.delta } },
          };
        });
        return;
      case "thread/presence":
        this.patchThread(n.params.threadId, (t) => ({
          ...t,
          onlineUserIds: n.params.onlineUserIds,
        }));
        return;
    }
  }

  private patchThread(threadId: string, fn: (t: ThreadState) => ThreadState) {
    const t = this.state.threads[threadId];
    if (!t) return;
    const next = fn(t);
    if (next === t) return;
    this.commit({ ...this.state, threads: { ...this.state.threads, [threadId]: next } });
  }

  private commit(next: StoreState) {
    this.state = next;
    for (const fn of this.listeners) fn();
  }
}

function putItem(t: ThreadState, item: Item): ThreadState {
  const exists = item.id in t.items || t.order.includes(item.id);
  return {
    ...t,
    items: { ...t.items, [item.id]: item },
    order: exists ? t.order : [...t.order, item.id],
  };
}

function dedupe(ids: string[]): string[] {
  return [...new Set(ids)];
}
