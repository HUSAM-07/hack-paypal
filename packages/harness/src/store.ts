/**
 * Persistence for threads, turns, items and the per-thread event log. Synchronous on purpose:
 * the production store is Durable Object SQLite, whose API is synchronous, and a synchronous
 * store means no other request can interleave between reading and writing a turn.
 */
import type { Item, ItemOf, Thread, Turn } from "@shop/agent-protocol";

export type ApprovalItem = ItemOf<"approvalRequest">;

export interface StoredEvent {
  seq: number;
  method: string;
  params: unknown;
}

export interface ThreadStore {
  insertThread(thread: Thread): void;
  updateThread(thread: Thread): void;
  getThread(threadId: string): Thread | undefined;
  /** Most recently updated first. `offset` is the pagination cursor. */
  listThreads(opts: { includeArchived: boolean; limit: number; offset: number }): Thread[];

  /** Insert or replace by (threadId, id). */
  putTurn(turn: Turn): void;
  getTurn(threadId: string, turnId: string): Turn | undefined;
  /** In start order. */
  listTurns(threadId: string): Turn[];

  /** Insert or replace by (threadId, id); a replaced item keeps its original position. */
  putItem(item: Item): void;
  getItem(threadId: string, itemId: string): Item | undefined;
  /** In insertion order, optionally for one turn. */
  listItems(threadId: string, turnId?: string): Item[];
  /** Undecided approval items across every thread. */
  listPendingApprovals(): ApprovalItem[];

  /** Append a thread-scoped notification and return its seq (1, 2, 3… per thread). */
  appendEvent(threadId: string, method: string, params: unknown, itemId?: string): number;
  eventsAfter(threadId: string, afterSeq: number): StoredEvent[];
  lastSeq(threadId: string): number;
  /** Drop an item's delta events once its `item/completed` carries the full text. */
  compactDeltas(threadId: string, itemId: string): void;
}

const isDelta = (method: string) => method.endsWith("/delta") || method.endsWith("/progress");

/** In-memory store for tests and Node hosts. */
export class MemoryThreadStore implements ThreadStore {
  private threads = new Map<string, Thread>();
  private turns = new Map<string, Turn[]>();
  private items = new Map<string, Item[]>();
  private events = new Map<string, (StoredEvent & { itemId?: string })[]>();
  private seqs = new Map<string, number>();

  insertThread(thread: Thread) {
    if (this.threads.has(thread.id)) throw new Error(`thread exists: ${thread.id}`);
    this.threads.set(thread.id, structuredClone(thread));
  }
  updateThread(thread: Thread) {
    this.threads.set(thread.id, structuredClone(thread));
  }
  getThread(threadId: string) {
    const t = this.threads.get(threadId);
    return t && structuredClone(t);
  }
  listThreads(opts: { includeArchived: boolean; limit: number; offset: number }) {
    return [...this.threads.values()]
      .filter((t) => opts.includeArchived || !t.archived)
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || b.id.localeCompare(a.id))
      .slice(opts.offset, opts.offset + opts.limit)
      .map((t) => structuredClone(t));
  }

  putTurn(turn: Turn) {
    const list = this.turns.get(turn.threadId) ?? [];
    const i = list.findIndex((t) => t.id === turn.id);
    if (i >= 0) list[i] = structuredClone(turn);
    else list.push(structuredClone(turn));
    this.turns.set(turn.threadId, list);
  }
  getTurn(threadId: string, turnId: string) {
    const t = this.turns.get(threadId)?.find((x) => x.id === turnId);
    return t && structuredClone(t);
  }
  listTurns(threadId: string) {
    return (this.turns.get(threadId) ?? []).map((t) => structuredClone(t));
  }

  putItem(item: Item) {
    const list = this.items.get(item.threadId) ?? [];
    const i = list.findIndex((x) => x.id === item.id);
    if (i >= 0) list[i] = structuredClone(item);
    else list.push(structuredClone(item));
    this.items.set(item.threadId, list);
  }
  getItem(threadId: string, itemId: string) {
    const i = this.items.get(threadId)?.find((x) => x.id === itemId);
    return i && structuredClone(i);
  }
  listItems(threadId: string, turnId?: string) {
    return (this.items.get(threadId) ?? [])
      .filter((i) => turnId === undefined || i.turnId === turnId)
      .map((i) => structuredClone(i));
  }
  listPendingApprovals() {
    return [...this.items.values()]
      .flat()
      .filter((i): i is ApprovalItem => i.type === "approvalRequest" && i.decision === undefined)
      .map((i) => structuredClone(i));
  }

  appendEvent(threadId: string, method: string, params: unknown, itemId?: string) {
    const seq = (this.seqs.get(threadId) ?? 0) + 1;
    this.seqs.set(threadId, seq);
    const list = this.events.get(threadId) ?? [];
    list.push({ seq, method, params: structuredClone(params), ...(itemId ? { itemId } : {}) });
    this.events.set(threadId, list);
    return seq;
  }
  eventsAfter(threadId: string, afterSeq: number) {
    return (this.events.get(threadId) ?? [])
      .filter((e) => e.seq > afterSeq)
      .map(({ seq, method, params }) => ({ seq, method, params: structuredClone(params) }));
  }
  lastSeq(threadId: string) {
    return this.seqs.get(threadId) ?? 0;
  }
  compactDeltas(threadId: string, itemId: string) {
    const list = this.events.get(threadId);
    if (!list) return;
    this.events.set(
      threadId,
      list.filter((e) => !(e.itemId === itemId && isDelta(e.method))),
    );
  }
}
