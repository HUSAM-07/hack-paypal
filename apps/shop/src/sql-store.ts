/** ThreadStore on Durable Object SQLite (the Agent's `this.sql`). Rows hold JSON documents. */
import type { Item, Thread, Turn } from "@shop/agent-protocol";
import type { ApprovalItem, StoredEvent, ThreadStore } from "@shop/harness";

type SqlValue = string | number | boolean | null;
export type SqlTag = <T = Record<string, SqlValue>>(
  strings: TemplateStringsArray,
  ...values: SqlValue[]
) => T[];

export function migrateShopTables(sql: SqlTag) {
  sql`CREATE TABLE IF NOT EXISTS shop_threads (
    id TEXT PRIMARY KEY, updated_at TEXT NOT NULL, archived INTEGER NOT NULL, json TEXT NOT NULL)`;
  sql`CREATE TABLE IF NOT EXISTS shop_turns (
    thread_id TEXT NOT NULL, id TEXT NOT NULL, ord INTEGER NOT NULL, json TEXT NOT NULL,
    PRIMARY KEY (thread_id, id))`;
  sql`CREATE TABLE IF NOT EXISTS shop_items (
    thread_id TEXT NOT NULL, id TEXT NOT NULL, ord INTEGER NOT NULL, turn_id TEXT NOT NULL,
    pending_approval INTEGER NOT NULL, json TEXT NOT NULL, PRIMARY KEY (thread_id, id))`;
  sql`CREATE INDEX IF NOT EXISTS shop_items_pending ON shop_items (pending_approval)`;
  sql`CREATE TABLE IF NOT EXISTS shop_events (
    thread_id TEXT NOT NULL, seq INTEGER NOT NULL, method TEXT NOT NULL, item_id TEXT,
    params TEXT NOT NULL, PRIMARY KEY (thread_id, seq))`;
  sql`CREATE TABLE IF NOT EXISTS shop_seq (thread_id TEXT PRIMARY KEY, seq INTEGER NOT NULL)`;
  sql`CREATE TABLE IF NOT EXISTS shop_state (
    id INTEGER PRIMARY KEY CHECK (id = 1), version INTEGER NOT NULL, json TEXT NOT NULL)`;
}

const parse = <T>(rows: { json: string }[]): T[] => rows.map((r) => JSON.parse(r.json) as T);

export class SqlThreadStore implements ThreadStore {
  constructor(private readonly sql: SqlTag) {
    migrateShopTables(sql);
  }

  insertThread(t: Thread) {
    this.sql`INSERT INTO shop_threads (id, updated_at, archived, json)
      VALUES (${t.id}, ${t.updatedAt}, ${t.archived ? 1 : 0}, ${JSON.stringify(t)})`;
  }
  updateThread(t: Thread) {
    this.sql`UPDATE shop_threads SET updated_at = ${t.updatedAt}, archived = ${t.archived ? 1 : 0},
      json = ${JSON.stringify(t)} WHERE id = ${t.id}`;
  }
  getThread(id: string) {
    return parse<Thread>(
      this.sql<{ json: string }>`SELECT json FROM shop_threads WHERE id = ${id}`,
    )[0];
  }
  listThreads(o: { includeArchived: boolean; limit: number; offset: number }) {
    const archived = o.includeArchived ? 1 : 0;
    return parse<Thread>(
      this.sql<{ json: string }>`SELECT json FROM shop_threads WHERE archived <= ${archived}
        ORDER BY updated_at DESC, id DESC LIMIT ${o.limit} OFFSET ${o.offset}`,
    );
  }

  putTurn(t: Turn) {
    this.sql`INSERT INTO shop_turns (thread_id, id, ord, json)
      VALUES (${t.threadId}, ${t.id},
        (SELECT COALESCE(MAX(ord), 0) + 1 FROM shop_turns WHERE thread_id = ${t.threadId}),
        ${JSON.stringify(t)})
      ON CONFLICT (thread_id, id) DO UPDATE SET json = excluded.json`;
  }
  getTurn(threadId: string, id: string) {
    return parse<Turn>(
      this.sql<{
        json: string;
      }>`SELECT json FROM shop_turns WHERE thread_id = ${threadId} AND id = ${id}`,
    )[0];
  }
  listTurns(threadId: string) {
    return parse<Turn>(
      this.sql<{
        json: string;
      }>`SELECT json FROM shop_turns WHERE thread_id = ${threadId} ORDER BY ord`,
    );
  }

  putItem(i: Item) {
    const pending = i.type === "approvalRequest" && i.decision === undefined ? 1 : 0;
    this.sql`INSERT INTO shop_items (thread_id, id, ord, turn_id, pending_approval, json)
      VALUES (${i.threadId}, ${i.id},
        (SELECT COALESCE(MAX(ord), 0) + 1 FROM shop_items WHERE thread_id = ${i.threadId}),
        ${i.turnId}, ${pending}, ${JSON.stringify(i)})
      ON CONFLICT (thread_id, id) DO UPDATE SET json = excluded.json,
        pending_approval = excluded.pending_approval`;
  }
  getItem(threadId: string, id: string) {
    return parse<Item>(
      this.sql<{
        json: string;
      }>`SELECT json FROM shop_items WHERE thread_id = ${threadId} AND id = ${id}`,
    )[0];
  }
  listItems(threadId: string, turnId?: string) {
    return turnId === undefined
      ? parse<Item>(
          this.sql<{
            json: string;
          }>`SELECT json FROM shop_items WHERE thread_id = ${threadId} ORDER BY ord`,
        )
      : parse<Item>(
          this.sql<{ json: string }>`SELECT json FROM shop_items
            WHERE thread_id = ${threadId} AND turn_id = ${turnId} ORDER BY ord`,
        );
  }
  listPendingApprovals() {
    return parse<ApprovalItem>(
      this.sql<{
        json: string;
      }>`SELECT json FROM shop_items WHERE pending_approval = 1 ORDER BY ord`,
    );
  }

  appendEvent(threadId: string, method: string, params: unknown, itemId?: string) {
    const row = this.sql<{
      seq: number;
    }>`INSERT INTO shop_seq (thread_id, seq) VALUES (${threadId}, 1)
      ON CONFLICT (thread_id) DO UPDATE SET seq = seq + 1 RETURNING seq`;
    const seq = row[0]?.seq ?? 1;
    this.sql`INSERT INTO shop_events (thread_id, seq, method, item_id, params)
      VALUES (${threadId}, ${seq}, ${method}, ${itemId ?? null}, ${JSON.stringify(params)})`;
    return seq;
  }
  eventsAfter(threadId: string, afterSeq: number): StoredEvent[] {
    return this.sql<{ seq: number; method: string; params: string }>`SELECT seq, method, params
      FROM shop_events WHERE thread_id = ${threadId} AND seq > ${afterSeq} ORDER BY seq`.map(
      (r) => ({
        seq: r.seq,
        method: r.method,
        params: JSON.parse(r.params),
      }),
    );
  }
  lastSeq(threadId: string) {
    return (
      this.sql<{ seq: number }>`SELECT seq FROM shop_seq WHERE thread_id = ${threadId}`[0]?.seq ?? 0
    );
  }
  compactDeltas(threadId: string, itemId: string) {
    this.sql`DELETE FROM shop_events WHERE thread_id = ${threadId} AND item_id = ${itemId}
      AND (method LIKE '%/delta' OR method LIKE '%/progress')`;
  }
}

/** Versioned product state for `state/snapshot` and `state/patch`. */
export class SqlStateStore {
  constructor(private readonly sql: SqlTag) {
    migrateShopTables(sql);
  }
  read(): { version: number; state: unknown } | undefined {
    const r = this.sql<{
      version: number;
      json: string;
    }>`SELECT version, json FROM shop_state WHERE id = 1`[0];
    return r && { version: r.version, state: JSON.parse(r.json) };
  }
  write(version: number, state: unknown) {
    this
      .sql`INSERT INTO shop_state (id, version, json) VALUES (1, ${version}, ${JSON.stringify(state)})
      ON CONFLICT (id) DO UPDATE SET version = excluded.version, json = excluded.json`;
  }
}

/**
 * Server-only product state (vault ids, mandates, checkouts). Never broadcast and never part of
 * `state/*`; kept in its own row so a state diff can't leak it.
 */
export class SqlPrivateStore {
  constructor(private readonly sql: SqlTag) {
    sql`CREATE TABLE IF NOT EXISTS shop_private (id INTEGER PRIMARY KEY CHECK (id = 1), json TEXT NOT NULL)`;
  }
  read(): unknown {
    const r = this.sql<{ json: string }>`SELECT json FROM shop_private WHERE id = 1`[0];
    return r ? JSON.parse(r.json) : undefined;
  }
  write(value: unknown) {
    this.sql`INSERT INTO shop_private (id, json) VALUES (1, ${JSON.stringify(value)})
      ON CONFLICT (id) DO UPDATE SET json = excluded.json`;
  }
}
