import { Menu, PanelRight, Wallet as WalletIcon } from "lucide-react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { lazy, Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { ChatView, EmptyThread, useNameFor } from "@/chat/ChatView";
import { Composer } from "@/chat/Composer";
import {
  AnimatedToastStack,
  useAnimatedToastStack,
} from "@/components/motion/animated-toast-stack";
import { AvatarStack } from "@/components/spectrumui/avatar-stack";
import { Sheet } from "@/components/ui/sheet";
import { createHostActions, HostActionsContext } from "@/genui/actions";
import { HostDataContext } from "@/genui/components/money";
import { type PactData, type ProductData, resolveRef } from "@/genui/refs";
import { useMock } from "@/lib/env";
import { EASE_DRAWER } from "@/lib/motion";
import { cn } from "@/lib/utils";
import { USERS } from "@/mock/fixtures";
import type { ThreadState } from "@/protocol/store";
import { ProductSheet } from "@/shell/ProductSheet";
import { BrandMark, Sidebar } from "@/shell/Sidebar";
import { WalletPanel } from "@/shell/WalletPanel";
import {
  stageUiState,
  useConnection,
  useRuntime,
  useSendTurn,
  useThread,
  useThreadList,
  useThreads,
  useWallet,
} from "./runtime";

// The PayPal SDK bindings load only when someone opens the commit flow.
const CommitSheet = lazy(() =>
  import("@/paypal/CommitSheet").then((m) => ({ default: m.CommitSheet })),
);

type Theme = "dark" | "light";

function useTheme(): [Theme, () => void] {
  const [theme, setTheme] = useState<Theme>(() => {
    try {
      const saved = localStorage.getItem("pact-theme");
      if (saved === "light" || saved === "dark") return saved;
    } catch {}
    return "dark";
  });
  useEffect(() => {
    const root = document.documentElement;
    root.classList.toggle("dark", theme === "dark");
    root.style.colorScheme = theme;
    document
      .querySelector('meta[name="theme-color"]')
      ?.setAttribute("content", theme === "dark" ? "#0b0b0c" : "#fafafa");
    try {
      localStorage.setItem("pact-theme", theme);
    } catch {}
  }, [theme]);
  return [theme, () => setTheme((t) => (t === "dark" ? "light" : "dark"))];
}

function threadIdFromPath(): string | null {
  const m = /^\/app\/([^/]+)/.exec(window.location.pathname);
  return m?.[1] ? decodeURIComponent(m[1]) : null;
}

function useIsWide(query: string) {
  const [wide, setWide] = useState(() => window.matchMedia(query).matches);
  useEffect(() => {
    const mq = window.matchMedia(query);
    const on = () => setWide(mq.matches);
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, [query]);
  return wide;
}

/** Newest version of a ref across the thread's agent messages. */
function findRef(thread: ThreadState | undefined, refId: string): Record<string, unknown> | null {
  if (!thread) return null;
  for (let i = thread.order.length - 1; i >= 0; i--) {
    const it = thread.items[thread.order[i]!];
    if (it?.type === "agentMessage" && refId in it.refs) return it.refs;
  }
  return null;
}

const MOCK_NAMES = Object.fromEntries(Object.entries(USERS).map(([id, u]) => [id, u.name]));

export function App() {
  const { client } = useRuntime();
  const reduce = useReducedMotion();
  const [theme, toggleTheme] = useTheme();
  const connection = useConnection();
  const threads = useThreadList();
  const [activeId, setActiveId] = useState<string | null>(threadIdFromPath);
  const [navOpen, setNavOpen] = useState(false);
  const [walletOpen, setWalletOpen] = useState(false);
  const [walletPinned, setWalletPinned] = useState(true);
  const [draft, setDraft] = useState<string | null>(null);
  const [commitRef, setCommitRef] = useState<string | null>(null);
  const [commitOpen, setCommitOpen] = useState(false);
  const [product, setProduct] = useState<ProductData | null>(null);
  const xl = useIsWide("(min-width: 1280px)");
  const lg = useIsWide("(min-width: 1024px)");
  const toasts = useAnimatedToastStack({ limit: 3 });
  const { wallet } = useWallet();

  useEffect(() => {
    if (!activeId && threads[0]) setActiveId(threads[0].id);
  }, [activeId, threads]);
  useEffect(() => {
    if (activeId && window.location.pathname !== `/app/${activeId}`) {
      window.history.replaceState(null, "", `/app/${encodeURIComponent(activeId)}`);
    }
  }, [activeId]);
  useEffect(() => {
    const on = () => setActiveId(threadIdFromPath());
    window.addEventListener("popstate", on);
    return () => window.removeEventListener("popstate", on);
  }, []);

  useThreads(activeId);
  const thread = useThread(activeId);
  const send = useSendTurn(activeId);
  const viewerId = client.userId ?? "";
  const nameFor = useNameFor(thread?.pacts ?? {}, useMock ? MOCK_NAMES : {});

  const select = (id: string) => {
    setNavOpen(false);
    if (id === activeId) return;
    window.history.pushState(null, "", `/app/${encodeURIComponent(id)}`);
    setActiveId(id);
  };

  const newThread = async () => {
    try {
      const { thread: t } = await client.request("thread/start", {
        title: "New pact",
        memberIds: [],
      });
      select(t.id);
    } catch {
      toasts.showToast({ title: "Couldn't start a thread", status: "error" });
    }
  };

  const sendText = useCallback(
    async (text: string) => {
      await send(text);
    },
    [send],
  );

  const actions = useMemo(
    () =>
      createHostActions(
        {
          issueTurn: ({ text }) => {
            void sendText(text).catch((e: Error) =>
              toasts.showToast({ title: e.message, status: "error" }),
            );
          },
          openProduct: ({ productRef }) => {
            const refs = findRef(thread, productRef);
            const p = refs ? resolveRef(refs, productRef, "product") : undefined;
            if (p) setProduct(p);
          },
          openCommit: ({ pactRef }) => {
            setCommitRef(pactRef);
            setCommitOpen(true);
          },
          copy: ({ text }) => {
            void navigator.clipboard?.writeText(text);
            toasts.showToast({ title: "Copied", status: "success" });
          },
          stageUiState: (patch) => {
            if (activeId) stageUiState(activeId, patch);
          },
        },
        { interactive: connection === "open" || connection === "reconnecting", viewerId },
      ),
    [thread, sendText, toasts.showToast, activeId, connection, viewerId],
  );

  const commitData: PactData | undefined = useMemo(() => {
    if (!commitRef) return undefined;
    const refs = findRef(thread, commitRef);
    return refs ? resolveRef(refs, commitRef, "pact") : undefined;
  }, [commitRef, thread]);

  const status =
    connection === "reconnecting"
      ? "Reconnecting… anything you send will go out when you're back."
      : connection === "connecting"
        ? "Connecting…"
        : null;

  const members = (thread?.thread.memberIds ?? []).map((id) => ({
    name: id === viewerId ? "You" : nameFor(id),
  }));
  const showWalletColumn = xl && walletPinned;

  const sidebar = (
    <Sidebar
      threads={threads}
      activeId={activeId}
      onSelect={select}
      onNew={newThread}
      theme={theme}
      onToggleTheme={toggleTheme}
      connection={connection}
      me={useMock && USERS.user_alex ? USERS.user_alex : { name: "You", email: "" }}
      mock={useMock}
    />
  );

  return (
    <HostActionsContext.Provider value={actions}>
      <HostDataContext.Provider value={{ activity: wallet?.activity ?? null }}>
        <div
          className="flex h-dvh w-full overflow-hidden bg-background"
          data-connection={connection}
        >
          {lg && (
            <div className="w-[264px] shrink-0 border-r border-border bg-background">{sidebar}</div>
          )}

          <main className="flex min-w-0 flex-1 flex-col">
            <header className="flex h-14 shrink-0 items-center gap-2 border-b border-border px-2 sm:px-4">
              {!lg && (
                <button
                  type="button"
                  onClick={() => setNavOpen(true)}
                  aria-label="Open threads"
                  className="flex size-9 items-center justify-center rounded-full text-muted-foreground hover:bg-surface-2 hover:text-foreground active:scale-90"
                >
                  <Menu className="size-[18px]" />
                </button>
              )}
              <div className="min-w-0 flex-1">
                <AnimatePresence mode="wait" initial={false}>
                  <motion.h1
                    key={thread?.thread.id ?? "none"}
                    initial={reduce ? false : { opacity: 0, y: 4 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -4 }}
                    transition={{ duration: 0.18 }}
                    className="truncate text-[15px] font-semibold"
                  >
                    {thread?.thread.title ?? (lg ? "" : <BrandMark />)}
                  </motion.h1>
                </AnimatePresence>
              </div>
              {members.length > 1 && (
                <div className="hidden sm:block">
                  <AvatarStack items={members} size="sm" max={4} />
                </div>
              )}
              <button
                type="button"
                onClick={() => (xl ? setWalletPinned((p) => !p) : setWalletOpen(true))}
                aria-label={xl ? (walletPinned ? "Hide wallet" : "Show wallet") : "Open wallet"}
                aria-pressed={xl ? walletPinned : undefined}
                className={cn(
                  "flex size-9 items-center justify-center rounded-full transition-[background-color,color,transform] active:scale-90",
                  showWalletColumn
                    ? "bg-surface-2 text-foreground"
                    : "text-muted-foreground hover:bg-surface-2 hover:text-foreground",
                )}
              >
                {xl ? (
                  <PanelRight className="size-[18px]" />
                ) : (
                  <WalletIcon className="size-[18px]" />
                )}
              </button>
            </header>

            {thread ? (
              <ChatView
                thread={thread}
                viewerId={viewerId}
                nameFor={nameFor}
                empty={
                  <EmptyThread
                    title={thread.thread.title}
                    onPick={(s) => void sendText(s).catch(() => setDraft(s))}
                  />
                }
              />
            ) : (
              <div className="flex flex-1 items-center justify-center">
                <span className="text-shimmer text-sm">Loading your threads</span>
              </div>
            )}

            <Composer
              onSend={sendText}
              {...(thread?.activeTurnId
                ? {
                    onStop: () => {
                      void client
                        .request("turn/interrupt", {
                          threadId: thread.thread.id,
                          turnId: thread.activeTurnId!,
                        })
                        .catch(() => {});
                    },
                  }
                : {})}
              busy={!!thread?.activeTurnId}
              disabled={!thread}
              status={status}
              draft={draft}
              onDraftConsumed={() => setDraft(null)}
            />
          </main>

          <AnimatePresence initial={false}>
            {showWalletColumn && (
              <motion.div
                key="wallet"
                initial={reduce ? false : { width: 0, opacity: 0 }}
                animate={{ width: 340, opacity: 1 }}
                exit={{ width: 0, opacity: 0 }}
                transition={{ duration: 0.35, ease: EASE_DRAWER }}
                className="shrink-0 overflow-hidden border-l border-border bg-background"
              >
                <div className="h-full w-[340px]">
                  <WalletPanel />
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* Mobile / tablet nav drawer */}
        <AnimatePresence>
          {!lg && navOpen && (
            <>
              <motion.div
                className="fixed inset-0 z-40 bg-black/50"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                onClick={() => setNavOpen(false)}
              />
              <motion.div
                role="dialog"
                aria-label="Threads"
                className="fixed inset-y-0 left-0 z-50 w-[min(300px,86vw)] bg-background shadow-pop"
                initial={{ x: "-100%" }}
                animate={{ x: 0 }}
                exit={{ x: "-100%" }}
                transition={reduce ? { duration: 0 } : { duration: 0.38, ease: EASE_DRAWER }}
                drag="x"
                dragConstraints={{ left: 0, right: 0 }}
                dragElastic={{ left: 0.5, right: 0 }}
                onDragEnd={(_, i) => (i.offset.x < -80 || i.velocity.x < -500) && setNavOpen(false)}
              >
                {sidebar}
              </motion.div>
            </>
          )}
        </AnimatePresence>

        <Sheet
          open={!xl && walletOpen}
          onOpenChange={setWalletOpen}
          title="Wallet"
          className="sm:w-[min(420px,calc(100vw-32px))]"
        >
          <WalletPanel embedded />
        </Sheet>

        {activeId && commitRef && (
          <Suspense fallback={null}>
            <CommitSheet
              open={commitOpen}
              onOpenChange={setCommitOpen}
              threadId={activeId}
              data={commitData}
              viewerId={viewerId}
              onDone={(msg) => toasts.showToast({ title: msg, status: "success" })}
            />
          </Suspense>
        )}
        <ProductSheet
          product={product}
          onOpenChange={(o) => !o && setProduct(null)}
          onUse={(p) => {
            setProduct(null);
            void sendText(`Go with the ${p.title}`).catch(() => {});
          }}
        />
        <AnimatedToastStack
          toasts={toasts.toasts}
          onDismiss={toasts.dismissToast}
          position="top-center"
        />
      </HostDataContext.Provider>
    </HostActionsContext.Provider>
  );
}
