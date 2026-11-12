import type { BrowserSession } from "@shop/agent-protocol";
import { Bot, Globe, Hand, Maximize2, Minimize2, MousePointer2, X } from "lucide-react";
import { useState } from "react";

export type PaneMode = "split" | "full";

function displayUrl(url: string) {
  try {
    const u = new URL(url);
    return { host: u.hostname.replace(/^www\./, ""), path: u.pathname === "/" ? "" : u.pathname };
  } catch {
    return { host: url, path: "" };
  }
}

/**
 * The agent's browser, Codex-style: split beside the chat or full view (⌘⇧B toggles the pane).
 * Shows Browser Run Live View when the server provides one, else the latest screenshot. Taking
 * control hands the live session to the person; Hand back returns it to the agent.
 */
export function BrowserPane({
  session,
  mode,
  onMode,
  onClose,
  onTakeControl,
  onHandBack,
}: {
  session: BrowserSession | undefined;
  mode: PaneMode;
  onMode: (m: PaneMode) => void;
  onClose: () => void;
  onTakeControl: (id: string) => Promise<unknown>;
  onHandBack: (id: string) => Promise<unknown>;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError((e as Error)?.message || "The browser didn't respond.");
    } finally {
      setBusy(false);
    }
  };
  const user = session?.controller === "user";
  const u = session ? displayUrl(session.url) : undefined;

  return (
    <section className="pane" aria-label="Browser" data-mode={mode}>
      <header className="pane__bar">
        <span className="pane__badge" data-who={user ? "user" : "agent"}>
          {user ? <MousePointer2 aria-hidden /> : <Bot aria-hidden />}
          {session ? (user ? "You're in control" : "Agent driving") : "Browser"}
        </span>
        <span className="pane__url" title={session?.url}>
          <Globe aria-hidden />
          {u ? (
            <>
              <span className="pane__host">{u.host}</span>
              <span className="pane__path">{u.path}</span>
            </>
          ) : (
            <span className="pane__path">No page open</span>
          )}
        </span>
        <span className="pane__actions">
          {session &&
            (user ? (
              <button
                type="button"
                className="pill-btn"
                disabled={busy}
                onClick={() => run(() => onHandBack(session.sessionId))}
              >
                <Bot aria-hidden /> Hand back
              </button>
            ) : (
              <button
                type="button"
                className="pill-btn pill-btn--primary"
                disabled={busy}
                onClick={() => run(() => onTakeControl(session.sessionId))}
              >
                <Hand aria-hidden /> Take control
              </button>
            ))}
          <button
            type="button"
            className="icon-btn pane__mode"
            onClick={() => onMode(mode === "split" ? "full" : "split")}
            aria-label={mode === "split" ? "Full view" : "Split view"}
            title={mode === "split" ? "Full view" : "Split view"}
          >
            {mode === "split" ? <Maximize2 aria-hidden /> : <Minimize2 aria-hidden />}
          </button>
          <button
            type="button"
            className="icon-btn"
            onClick={onClose}
            aria-label="Close browser (⌘⇧B)"
            title="Close (⌘⇧B)"
          >
            <X aria-hidden />
          </button>
        </span>
      </header>
      {error && (
        <p className="pane__error" role="alert">
          {error}
        </p>
      )}
      <div className="pane__view" data-who={user ? "user" : "agent"}>
        {session?.liveViewUrl ? (
          <iframe
            key={session.liveViewUrl}
            className="pane__frame"
            src={session.liveViewUrl}
            title={`Live view: ${session.title || u?.host || "page"}`}
            sandbox="allow-scripts allow-forms allow-popups"
            referrerPolicy="no-referrer"
            allow="clipboard-read; clipboard-write"
          />
        ) : session?.screenshotUrl ? (
          <img
            className="pane__shot"
            src={session.screenshotUrl}
            alt={`Screenshot of ${session.title || u?.host}`}
          />
        ) : (
          <div className="pane__empty">
            <Globe aria-hidden />
            <p>When the agent opens a page, you'll watch it here and can take over at any time.</p>
          </div>
        )}
        {session && !user && session.screenshotUrl && !session.liveViewUrl && (
          <span className="pane__watermark">Screenshot · updated live</span>
        )}
      </div>
    </section>
  );
}
