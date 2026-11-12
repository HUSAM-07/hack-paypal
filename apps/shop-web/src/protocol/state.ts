import type {
  BrowserSession,
  Item,
  NotificationOf,
  ServerNotificationMethod,
  Thread,
  Turn,
} from "@shop/agent-protocol";
import type { ShopState } from "@shop/commerce/contract";
import { applyPatch, type PatchOp } from "./patch";

export type ConnectionStatus = "connecting" | "open" | "reconnecting" | "offline" | "unauthorized";

export type InboxEntry = NotificationOf<"inbox/added">;

/** One subscribed thread: its items in arrival order and the last seq applied. */
export type ThreadView = {
  itemIds: string[];
  items: Record<string, Item>;
  turns: Record<string, Turn>;
  /** The turn still running (inProgress or awaitingApproval), if any. */
  activeTurnId: string | undefined;
  lastSeq: number;
};

export type ClientState = {
  status: ConnectionStatus;
  userId: string | undefined;
  serverCapabilities: string[];
  threads: Record<string, Thread>;
  activeThreadId: string | undefined;
  views: Record<string, ThreadView>;
  shop: { version: number; state: ShopState } | undefined;
  /** Set when a patch didn't apply; the client fetches a fresh snapshot and clears it. */
  shopStale: boolean;
  browser: Record<string, BrowserSession>;
  inbox: InboxEntry[];
  /** approvalId → JSON-RPC id of the server request waiting for our answer. */
  pendingApprovals: Record<string, string | number>;
  error: string | undefined;
};

export const initialState: ClientState = {
  status: "connecting",
  userId: undefined,
  serverCapabilities: [],
  threads: {},
  activeThreadId: undefined,
  views: {},
  shop: undefined,
  shopStale: false,
  browser: {},
  inbox: [],
  pendingApprovals: {},
  error: undefined,
};

export const emptyView = (): ThreadView => ({
  itemIds: [],
  items: {},
  turns: {},
  activeTurnId: undefined,
  lastSeq: 0,
});

const RUNNING = new Set<Turn["status"]>(["inProgress", "awaitingApproval"]);

function putItem(view: ThreadView, item: Item): ThreadView {
  const known = item.id in view.items;
  return {
    ...view,
    items: { ...view.items, [item.id]: item },
    itemIds: known ? view.itemIds : [...view.itemIds, item.id],
  };
}

function patchItem(view: ThreadView, itemId: string, fn: (item: Item) => Item): ThreadView {
  const item = view.items[itemId];
  if (!item) return view;
  return { ...view, items: { ...view.items, [itemId]: fn(item) } };
}

function putTurn(view: ThreadView, turn: Turn): ThreadView {
  const running = RUNNING.has(turn.status);
  return {
    ...view,
    turns: { ...view.turns, [turn.id]: turn },
    activeTurnId: running ? turn.id : view.activeTurnId === turn.id ? undefined : view.activeTurnId,
  };
}

function threadIdOf(method: string, params: Record<string, unknown>): string | undefined {
  if (typeof params.threadId === "string") return params.threadId;
  const nested = (params.item ?? params.turn ?? params.thread) as
    | { threadId?: string; id?: string }
    | undefined;
  if (method.startsWith("thread/")) return nested?.id;
  return nested?.threadId;
}

/** Apply one thread-scoped notification to its view (seq already checked by the caller). */
function reduceThread(
  view: ThreadView,
  method: string,
  params: Record<string, unknown>,
): ThreadView {
  switch (method as ServerNotificationMethod) {
    case "turn/started":
    case "turn/completed":
      return putTurn(view, (params as NotificationOf<"turn/started">).turn);
    case "item/started":
    case "item/completed":
      return putItem(view, (params as NotificationOf<"item/started">).item);
    case "item/agentMessage/delta": {
      const p = params as NotificationOf<"item/agentMessage/delta">;
      return patchItem(view, p.itemId, (it) =>
        it.type === "agentMessage" ? { ...it, text: it.text + p.delta } : it,
      );
    }
    case "item/reasoning/delta": {
      const p = params as NotificationOf<"item/reasoning/delta">;
      return patchItem(view, p.itemId, (it) =>
        it.type === "reasoning" ? { ...it, summary: it.summary + p.delta } : it,
      );
    }
    case "item/toolCall/progress": {
      const p = params as NotificationOf<"item/toolCall/progress">;
      return patchItem(view, p.itemId, (it) =>
        it.type === "toolCall"
          ? {
              ...it,
              progress: {
                label: p.label,
                ...(p.fraction !== undefined ? { fraction: p.fraction } : {}),
              },
            }
          : it,
      );
    }
    default:
      return view;
  }
}

export type Event =
  | { type: "status"; status: ConnectionStatus; error?: string }
  | { type: "initialized"; userId: string; capabilities: string[] }
  | { type: "notification"; method: string; params: unknown; seq?: number | undefined }
  | { type: "threads"; threads: Thread[] }
  | { type: "subscribed"; threadId: string }
  | { type: "activate"; threadId: string | undefined }
  | { type: "approvalRequested"; approvalId: string; rpcId: string | number; item: Item }
  | { type: "approvalAnswered"; approvalId: string }
  | { type: "inboxDismissed" }
  | { type: "shopSnapshot"; version: number; state: ShopState }
  | { type: "localItem"; threadId: string; item: Item };

export function reduce(state: ClientState, ev: Event): ClientState {
  switch (ev.type) {
    case "status":
      // Server-request ids die with their socket; after a drop, answers go by approvalId.
      return ev.status === "open"
        ? { ...state, status: ev.status, error: ev.error }
        : { ...state, status: ev.status, error: ev.error, pendingApprovals: {} };
    case "initialized":
      return {
        ...state,
        userId: ev.userId,
        serverCapabilities: ev.capabilities,
        status: "open",
        error: undefined,
      };
    case "threads": {
      const threads = { ...state.threads };
      for (const t of ev.threads) threads[t.id] = t;
      return { ...state, threads };
    }
    case "subscribed":
      return state.views[ev.threadId]
        ? state
        : { ...state, views: { ...state.views, [ev.threadId]: emptyView() } };
    case "activate":
      return { ...state, activeThreadId: ev.threadId };
    case "approvalRequested": {
      const tid = ev.item.threadId;
      const view = state.views[tid] ?? emptyView();
      return {
        ...state,
        views: { ...state.views, [tid]: putItem(view, ev.item) },
        pendingApprovals: { ...state.pendingApprovals, [ev.approvalId]: ev.rpcId },
      };
    }
    case "approvalAnswered": {
      const { [ev.approvalId]: _, ...rest } = state.pendingApprovals;
      return { ...state, pendingApprovals: rest };
    }
    case "inboxDismissed":
      return { ...state, inbox: [] };
    case "shopSnapshot":
      return { ...state, shop: { version: ev.version, state: ev.state }, shopStale: false };
    case "localItem": {
      const view = state.views[ev.threadId] ?? emptyView();
      return { ...state, views: { ...state.views, [ev.threadId]: putItem(view, ev.item) } };
    }
    case "notification":
      return reduceNotification(
        state,
        ev.method,
        (ev.params ?? {}) as Record<string, unknown>,
        ev.seq,
      );
  }
}

function reduceNotification(
  state: ClientState,
  method: string,
  params: Record<string, unknown>,
  seq: number | undefined,
): ClientState {
  switch (method as ServerNotificationMethod) {
    case "state/snapshot": {
      const p = params as NotificationOf<"state/snapshot">;
      return {
        ...state,
        shop: { version: p.version, state: p.state as ShopState },
        shopStale: false,
      };
    }
    case "state/patch": {
      const p = params as NotificationOf<"state/patch">;
      if (!state.shop || state.shop.version !== p.baseVersion) {
        // Out of order or missed one: never guess, resync.
        return state.shop && p.version <= state.shop.version
          ? state
          : { ...state, shopStale: true };
      }
      try {
        const next = applyPatch(state.shop.state, p.ops as PatchOp[]);
        return { ...state, shop: { version: p.version, state: next } };
      } catch {
        return { ...state, shopStale: true };
      }
    }
    case "browser/updated": {
      const { session } = params as NotificationOf<"browser/updated">;
      return { ...state, browser: { ...state.browser, [session.sessionId]: session } };
    }
    case "inbox/added": {
      const entry = params as InboxEntry;
      if (state.inbox.some((e) => e.id === entry.id)) return state;
      return { ...state, inbox: [...state.inbox, entry] };
    }
    case "thread/started":
    case "thread/updated": {
      const { thread } = params as NotificationOf<"thread/started">;
      state = { ...state, threads: { ...state.threads, [thread.id]: thread } };
      break;
    }
    default:
      break;
  }

  const tid = threadIdOf(method, params);
  if (!tid) return state;
  const view = state.views[tid];
  if (!view) {
    // Not subscribed (or thread/started for a new one): nothing more to apply.
    return state;
  }
  if (seq !== undefined && seq <= view.lastSeq) return state; // replayed duplicate
  const next = reduceThread(view, method, params);
  const lastSeq = seq !== undefined ? seq : view.lastSeq;
  return { ...state, views: { ...state.views, [tid]: { ...next, lastSeq } } };
}

/** Threads newest first, archived last. */
export function sortedThreads(state: ClientState): Thread[] {
  return Object.values(state.threads)
    .filter((t) => !t.archived)
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}
