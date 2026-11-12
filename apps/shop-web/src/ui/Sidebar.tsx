import { OrderRow, WatchRow, type WidgetContext, WidgetProvider } from "@shop/genui";
import { MessageSquare, Plus, Settings } from "lucide-react";
import { sortedThreads } from "../protocol/state";
import { useClient, useClientState } from "./store";

export function Sidebar({
  ctx,
  onNavigate,
  onOpenSettings,
}: {
  ctx: WidgetContext;
  /** Called after a thread or item is picked (the mobile drawer closes). */
  onNavigate: () => void;
  onOpenSettings: () => void;
}) {
  const client = useClient();
  const s = useClientState();
  const threads = sortedThreads(s);
  const watches = (s.shop?.state.watches ?? []).filter((w) =>
    ["active", "paused", "triggered", "needsReview"].includes(w.status),
  );
  const orders = (s.shop?.state.orders ?? []).slice(0, 5);
  const wallet = s.shop?.state.wallet;

  const open = (threadId: string | undefined) => {
    if (threadId) void client.openThread(threadId);
    onNavigate();
  };

  return (
    <nav className="sidebar" aria-label="Shop">
      <div className="sidebar__brand">
        <span className="brand-mark" aria-hidden>
          S
        </span>
        <span className="brand-name">Shop</span>
        <span className="ui-label brand-tag">with PayPal</span>
      </div>

      <button
        type="button"
        className="new-chat"
        onClick={() => {
          client.newThread();
          onNavigate();
        }}
      >
        <Plus aria-hidden /> New chat
        <kbd className="kbd" aria-hidden>
          ⌘K
        </kbd>
      </button>

      <div className="sidebar__scroll">
        <section className="side-section" aria-labelledby="side-threads">
          <h2 className="ui-label side-section__h" id="side-threads">
            Chats
          </h2>
          {threads.length === 0 ? (
            <p className="side-empty">Your chats show up here.</p>
          ) : (
            <ul>
              {threads.map((t) => {
                const running = !!s.views[t.id]?.activeTurnId;
                return (
                  <li key={t.id}>
                    <button
                      type="button"
                      className="thread-row"
                      aria-current={t.id === s.activeThreadId ? "page" : undefined}
                      onClick={() => open(t.id)}
                    >
                      <MessageSquare aria-hidden className="thread-row__icon" />
                      <span className="thread-row__title">{t.title}</span>
                      {running && (
                        <>
                          <span className="live-dot" title="Working" aria-hidden />
                          <span className="sr-only">(working)</span>
                        </>
                      )}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        <WidgetProvider value={ctx}>
          <section className="side-section" aria-labelledby="side-watch">
            <h2 className="ui-label side-section__h" id="side-watch">
              Watchlist
              {watches.length > 0 && <span className="side-count">{watches.length}</span>}
            </h2>
            {watches.length === 0 ? (
              <p className="side-empty">Ask me to watch a price. I'll check while you're away.</p>
            ) : (
              <ul>
                {watches.map((w) => (
                  <li key={w.id}>
                    <WatchRow watch={w} onSelect={() => open(w.threadId)} />
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="side-section" aria-labelledby="side-orders">
            <h2 className="ui-label side-section__h" id="side-orders">
              Orders
            </h2>
            {orders.length === 0 ? (
              <p className="side-empty">Nothing bought yet.</p>
            ) : (
              <ul>
                {orders.map((o) => (
                  <li key={o.id}>
                    <OrderRow order={o} />
                  </li>
                ))}
              </ul>
            )}
          </section>
        </WidgetProvider>
      </div>

      <button type="button" className="sidebar__foot" onClick={onOpenSettings}>
        <span className="wallet-dot" data-on={wallet?.connected ? "" : undefined} aria-hidden />
        <span className="sidebar__foot-text">
          {wallet?.connected ? (wallet.label ?? "PayPal connected") : "PayPal not connected"}
        </span>
        <Settings aria-hidden className="sidebar__foot-icon" />
        <span className="sr-only">Open settings</span>
      </button>
    </nav>
  );
}
