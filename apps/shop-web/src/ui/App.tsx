import { Toaster, toast, type WidgetContext } from "@shop/genui";
import { Globe, Menu, Settings as SettingsIcon, WifiOff } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { BrowserPane, type PaneMode } from "./BrowserPane";
import { Composer, type ComposerHandle } from "./Composer";
import { SettingsBody } from "./Settings";
import { Sheet } from "./Sheet";
import { Sidebar } from "./Sidebar";
import { SignIn } from "./SignIn";
import { useClient, useClientState } from "./store";
import { Thread } from "./Thread";

export type AppOptions = {
  /** Where "Sign in with Google" goes when the server refuses the socket. */
  signInUrl?: string;
  paypal?: WidgetContext["paypal"];
  stepUp?: WidgetContext["stepUp"];
};

function useMedia(query: string) {
  const [m, setM] = useState(() =>
    typeof window === "undefined" ? false : window.matchMedia(query).matches,
  );
  useEffect(() => {
    const mq = window.matchMedia(query);
    const on = () => setM(mq.matches);
    on();
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, [query]);
  return m;
}

export function App({ options = {} }: { options?: AppOptions }) {
  const client = useClient();
  const s = useClientState();
  const wide = useMedia("(min-width: 1024px)");
  const [navOpen, setNavOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [paneOpen, setPaneOpen] = useState(false);
  const [paneMode, setPaneMode] = useState<PaneMode>("split");
  const [browserId, setBrowserId] = useState<string | undefined>();
  const composer = useRef<ComposerHandle>(null);

  const view = s.activeThreadId ? s.views[s.activeThreadId] : undefined;
  const running = !!view?.activeTurnId;
  const thread = s.activeThreadId ? s.threads[s.activeThreadId] : undefined;
  const sessions = Object.values(s.browser).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  const session = (browserId ? s.browser[browserId] : undefined) ?? sessions[0];

  // A new browser session opens the pane once (split view on wide screens).
  const seenSessions = useRef(new Set<string>());
  useEffect(() => {
    for (const b of sessions) {
      if (seenSessions.current.has(b.sessionId)) continue;
      seenSessions.current.add(b.sessionId);
      setBrowserId(b.sessionId);
      if (wide) setPaneOpen(true);
      else
        toast.info("The agent opened a page", {
          action: { label: "Watch", onClick: () => setPaneOpen(true) },
        });
    }
  }, [sessions, wide]);

  // Inbox entries and money events surface as calm toasts too.
  const seenInbox = useRef(new Set<string>());
  useEffect(() => {
    for (const e of s.inbox) {
      if (seenInbox.current.has(e.id)) continue;
      seenInbox.current.add(e.id);
      const fn =
        e.level === "success" ? toast.success : e.level === "warning" ? toast.error : toast.info;
      fn(e.title, { ...(e.body ? { description: e.body } : {}) });
    }
  }, [s.inbox]);

  const send = useCallback(
    async (text: string, uiState?: Record<string, unknown>) => {
      try {
        await client.send(text, uiState);
      } catch (e) {
        toast.error("Couldn't send that", { description: (e as Error).message });
        throw e;
      }
    },
    [client],
  );

  const ctx: WidgetContext = useMemo(
    () => ({
      invoke: async (name, args) => {
        try {
          return await client.invoke(name, args);
        } catch (e) {
          toast.error("That didn't go through", { description: (e as Error).message });
          throw e;
        }
      },
      respondApproval: (id, decision, extra) => client.respondApproval(id, decision, extra),
      sendMessage: (text, uiState) => void send(text, uiState).catch(() => {}),
      openBrowser: (id) => {
        setBrowserId(id);
        setPaneOpen(true);
      },
      state: s.shop?.state,
      ...(options.stepUp ? { stepUp: options.stepUp } : {}),
      ...(options.paypal ? { paypal: options.paypal } : {}),
    }),
    [client, send, s.shop?.state, options.stepUp, options.paypal],
  );

  // ⌘⇧B browser pane, ⌘K new chat, ⌘, settings.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      if (!mod) return;
      const k = e.key.toLowerCase();
      if (k === "b" && e.shiftKey) {
        e.preventDefault();
        setPaneOpen((o) => !o);
      } else if (k === "k" && !e.shiftKey) {
        e.preventDefault();
        client.newThread();
        composer.current?.focus();
      } else if (k === ",") {
        e.preventDefault();
        setSettingsOpen(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [client]);

  if (s.status === "unauthorized")
    return <SignIn {...(options.signInUrl ? { url: options.signInUrl } : {})} />;

  const offline = s.status === "offline" || s.status === "reconnecting";
  const sidebar = (
    <Sidebar
      ctx={ctx}
      onNavigate={() => setNavOpen(false)}
      onOpenSettings={() => setSettingsOpen(true)}
    />
  );
  const pane = (
    <BrowserPane
      session={session}
      mode={wide ? paneMode : "full"}
      onMode={setPaneMode}
      onClose={() => setPaneOpen(false)}
      onTakeControl={(id) => client.takeControl(id)}
      onHandBack={(id) => client.handBack(id)}
    />
  );

  return (
    <div
      className="app"
      data-pane={paneOpen && wide ? paneMode : "closed"}
      data-wide={wide ? "" : undefined}
    >
      <a className="skip" href="#composer-input">
        Skip to message box
      </a>
      {wide && <aside className="app__side">{sidebar}</aside>}

      <main className="app__main" id="main">
        <header className="topbar">
          {!wide && (
            <button
              type="button"
              className="icon-btn"
              aria-label="Open menu"
              onClick={() => setNavOpen(true)}
            >
              <Menu aria-hidden />
            </button>
          )}
          <h1 className="topbar__title">{thread?.title ?? "New chat"}</h1>
          {running && (
            <span className="topbar__status">
              <span className="live-dot" aria-hidden /> Working
            </span>
          )}
          {offline && (
            <button type="button" className="topbar__offline" onClick={() => client.reconnect()}>
              <WifiOff aria-hidden />{" "}
              {s.status === "reconnecting" ? "Reconnecting…" : "Offline · retry"}
            </button>
          )}
          <span className="topbar__actions">
            <button
              type="button"
              className="icon-btn"
              aria-pressed={paneOpen}
              aria-label="Browser (⌘⇧B)"
              title="Browser (⌘⇧B)"
              onClick={() => setPaneOpen((o) => !o)}
            >
              <Globe aria-hidden />
              {sessions.length > 0 && !paneOpen && <span className="badge-dot" aria-hidden />}
            </button>
            <button
              type="button"
              className="icon-btn"
              aria-label="Settings (⌘,)"
              title="Settings (⌘,)"
              onClick={() => setSettingsOpen(true)}
            >
              <SettingsIcon aria-hidden />
            </button>
          </span>
        </header>

        <Thread ctx={ctx} onSuggestion={(p) => void send(p).catch(() => {})} />

        <div className="app__composer">
          <Composer
            ref={composer}
            running={running}
            disabled={s.status !== "open"}
            onSend={(t) => send(t)}
            onInterrupt={() => void client.interrupt()}
          />
          <p className="app__fine">
            Shop only spends with your approval or a rule you approved. Every purchase can be undone
            during its window.
          </p>
        </div>
      </main>

      {wide && paneOpen && <aside className="app__pane">{pane}</aside>}

      {!wide && (
        <Sheet
          open={navOpen}
          onClose={() => setNavOpen(false)}
          title="Menu"
          side="left"
          className="sheet--nav"
        >
          {sidebar}
        </Sheet>
      )}
      {!wide && (
        <Sheet
          open={paneOpen}
          onClose={() => setPaneOpen(false)}
          title="Browser"
          side="bottom"
          className="sheet--pane"
        >
          {pane}
        </Sheet>
      )}
      <Sheet open={settingsOpen} onClose={() => setSettingsOpen(false)} title="Settings">
        <SettingsBody ctx={ctx} />
      </Sheet>
      <Toaster position={wide ? "bottom-right" : "top-center"} />
    </div>
  );
}
