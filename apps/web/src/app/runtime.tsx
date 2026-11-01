import type { Item, Thread } from "@pact/protocol";
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { createHttpApi, type PactApi } from "@/lib/api";
import { env, useMock } from "@/lib/env";
import { createMockApi } from "@/mock/api";
import { MockServer } from "@/mock/server";
import { type ConnectionState, PactClient } from "@/protocol/client";
import { type StoreState, ThreadStore } from "@/protocol/store";

export interface Runtime {
  client: PactClient;
  store: ThreadStore;
  api: PactApi;
  mock: MockServer | null;
}

declare global {
  interface Window {
    __pactMock?: MockServer;
    __pactStore?: ThreadStore;
  }
}

/** Builds the runtime: the in-browser mock server unless `VITE_PACT_WS_URL` is set. */
export function createRuntime(opts: { speed?: number } = {}): Runtime {
  const store = new ThreadStore();
  let mock: MockServer | null = null;
  let client: PactClient;
  if (useMock) {
    mock = new MockServer();
    mock.speed = opts.speed ?? 1;
    const m = mock;
    client = new PactClient({ connect: () => m.connect() });
    if (import.meta.env.DEV || import.meta.env.MODE === "test") window.__pactMock = mock;
  } else {
    client = new PactClient({ connect: () => new WebSocket(env.wsUrl) });
  }
  client.onNotification((n) => store.apply(n));
  if (import.meta.env.DEV) window.__pactStore = store;
  return { client, store, api: mock ? createMockApi(mock) : createHttpApi(), mock };
}

const RuntimeContext = createContext<Runtime | null>(null);

export function RuntimeProvider({ runtime, children }: { runtime: Runtime; children: ReactNode }) {
  useEffect(() => {
    runtime.client.start();
    return () => runtime.client.stop();
  }, [runtime]);
  return <RuntimeContext.Provider value={runtime}>{children}</RuntimeContext.Provider>;
}

export function useRuntime(): Runtime {
  const r = useContext(RuntimeContext);
  if (!r) throw new Error("RuntimeProvider missing");
  return r;
}

export function useStore<T>(select: (s: StoreState) => T): T {
  const { store } = useRuntime();
  return useSyncExternalStore(store.subscribe, () => select(store.getSnapshot()));
}

export function useConnection(): ConnectionState {
  const { client } = useRuntime();
  return useSyncExternalStore(
    (fn) => client.onState(fn),
    () => client.state,
  );
}

/** Loads the thread list once connected and keeps the active thread subscribed. */
export function useThreads(activeId: string | null) {
  const { client, store } = useRuntime();
  const state = useConnection();
  useEffect(() => {
    if (state !== "open") return;
    client
      .request("thread/list", {})
      .then((r) => store.setThreads(r.threads))
      .catch(() => {});
  }, [state, client, store]);
  useEffect(() => {
    if (activeId && state === "open") void client.subscribe(activeId).catch(() => {});
  }, [activeId, state, client]);
}

/**
 * UI state that generated components changed (sliders, toggles), held per thread
 * until the next `turn/start` carries it to the model.
 */
const pendingUiState = new Map<string, Record<string, unknown>>();

export function stageUiState(threadId: string, patch: Record<string, unknown>) {
  pendingUiState.set(threadId, { ...pendingUiState.get(threadId), ...patch });
}

export function useSendTurn(threadId: string | null) {
  const { client, store } = useRuntime();
  return useCallback(
    async (text: string, uiState?: Record<string, unknown>) => {
      if (!threadId || !text.trim()) return;
      const staged = pendingUiState.get(threadId);
      pendingUiState.delete(threadId);
      const merged = staged || uiState ? { ...staged, ...uiState } : undefined;
      const optimistic: Item = {
        id: `optimistic_${Date.now().toString(36)}`,
        threadId,
        turnId: "pending",
        status: "inProgress",
        createdAt: new Date().toISOString(),
        type: "userMessage",
        authorId: client.userId ?? "me",
        text: text.trim(),
        ...(merged ? { uiState: merged } : {}),
      };
      store.addOptimistic(optimistic);
      try {
        await client.request("turn/start", {
          threadId,
          text: text.trim(),
          ...(merged ? { uiState: merged } : {}),
        });
      } catch {
        store.removeItem(threadId, optimistic.id);
        if (merged) pendingUiState.set(threadId, merged);
        throw new Error("Couldn't send. Check your connection and try again.");
      }
    },
    [client, store, threadId],
  );
}

export function useThread(threadId: string | null) {
  return useStore((s) => (threadId ? s.threads[threadId] : undefined));
}

export function useThreadList(): Thread[] {
  const threads = useStore((s) => s.threads);
  const order = useStore((s) => s.threadOrder);
  return useMemo(
    () => order.map((id) => threads[id]?.thread).filter((t): t is Thread => !!t && !t.archived),
    [threads, order],
  );
}

/** Wallet data from REST, refreshed whenever a payment or pact event lands. */
export function useWallet() {
  const { api, store } = useRuntime();
  const [wallet, setWallet] = useState<Awaited<ReturnType<PactApi["wallet"]>> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const refresh = useCallback(() => {
    api
      .wallet()
      .then((w) => {
        setWallet(w);
        setError(null);
      })
      .catch(() => setError("Wallet unavailable"));
  }, [api]);
  const lastCount = useRef(0);
  useEffect(() => {
    refresh();
    return store.subscribe(() => {
      const s = store.getSnapshot();
      let n = 0;
      for (const t of Object.values(s.threads))
        for (const id of t.order) {
          const it = t.items[id];
          if (it?.type === "paymentEvent" || it?.type === "pactUpdate") n++;
        }
      if (n !== lastCount.current) {
        lastCount.current = n;
        refresh();
      }
    });
  }, [refresh, store]);
  return { wallet, error, refresh };
}
