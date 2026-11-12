import type { Item } from "@shop/agent-protocol";
import { InboxSummary, renderItem, type WidgetContext } from "@shop/genui";
import { ArrowDown } from "lucide-react";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { useClient, useClientState } from "./store";

const SUGGESTIONS = [
  {
    title: "Find noise-cancelling headphones",
    prompt: "Find the best noise-cancelling headphones under $350",
  },
  {
    title: "Watch a price, buy on a drop",
    prompt: "Tell me when the Sony XM6 drops under $280, buy it if it's under $270",
  },
  {
    title: "Sony or Bose for flights?",
    prompt: "Which is better for long flights, the Sony XM6 or the Bose QC Ultra?",
  },
];

export function EmptyState({ onPick }: { onPick: (prompt: string) => void }) {
  return (
    <div className="empty">
      <h1 className="empty__title">
        What are you <em>shopping</em> for?
      </h1>
      <p className="empty__sub">
        I search PayPal sellers and the web, watch prices while you're away, and only spend money
        with your OK.
      </p>
      <ul className="empty__grid">
        {SUGGESTIONS.map((s) => (
          <li key={s.title}>
            <button type="button" className="suggestion" onClick={() => onPick(s.prompt)}>
              <span className="suggestion__title">{s.title}</span>
              <span className="suggestion__prompt">{s.prompt}</span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** What a screen reader hears: finished answers and approval requests, never token-by-token. */
function announcement(item: Item): string | undefined {
  if (item.type === "agentMessage" && item.status === "completed") {
    const plain = item.text.replace(/[*_`#>[\]]/g, "").replace(/\(\s*\d+\s*\)/g, "");
    return plain.length > 280 ? `${plain.slice(0, 277)}…` : plain;
  }
  if (item.type === "approvalRequest" && item.status === "inProgress")
    return `Needs your approval: ${item.title}.`;
  if (item.type === "toolCall" && item.status === "failed") return `${item.summary} failed.`;
  return undefined;
}

export function Thread({
  ctx,
  onSuggestion,
}: {
  ctx: WidgetContext;
  onSuggestion: (p: string) => void;
}) {
  const client = useClient();
  const s = useClientState();
  const view = s.activeThreadId ? s.views[s.activeThreadId] : undefined;
  const items = view ? view.itemIds.map((id) => view.items[id]).filter((x): x is Item => !!x) : [];
  const running = !!view?.activeTurnId;

  const scroller = useRef<HTMLDivElement>(null);
  const column = useRef<HTMLDivElement>(null);
  const pinned = useRef(true);
  const [showJump, setShowJump] = useState(false);
  const [live, setLive] = useState("");
  const announced = useRef(new Set<string>());

  const toBottom = useCallback(() => {
    const el = scroller.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, []);

  // Stick to the bottom while content grows (streaming, cards resolving, images), unless the
  // reader scrolled up themselves. Only user input unpins; layout changes never do.
  useLayoutEffect(() => {
    if (pinned.current) toBottom();
  });
  useEffect(() => {
    const el = scroller.current;
    const col = column.current;
    if (!el || !col) return;
    let userIntent = false;
    const intent = () => {
      userIntent = true;
    };
    const onScroll = () => {
      const near = el.scrollHeight - el.scrollTop - el.clientHeight < 64;
      if (near) pinned.current = true;
      else if (userIntent) pinned.current = false;
      userIntent = false;
      setShowJump(!pinned.current);
    };
    const ro =
      typeof ResizeObserver === "undefined"
        ? undefined
        : new ResizeObserver(() => {
            if (pinned.current) toBottom();
          });
    ro?.observe(col);
    el.addEventListener("scroll", onScroll, { passive: true });
    el.addEventListener("wheel", intent, { passive: true });
    el.addEventListener("touchmove", intent, { passive: true });
    el.addEventListener("keydown", intent);
    return () => {
      ro?.disconnect();
      el.removeEventListener("scroll", onScroll);
      el.removeEventListener("wheel", intent);
      el.removeEventListener("touchmove", intent);
      el.removeEventListener("keydown", intent);
    };
  }, [toBottom]);
  // A new thread, or a message the person just sent, always lands at the bottom.
  const lastUserItem = [...items].reverse().find((i) => i.type === "userMessage")?.id;
  // biome-ignore lint/correctness/useExhaustiveDependencies: re-pin on thread switch and on a new user message
  useEffect(() => {
    pinned.current = true;
    setShowJump(false);
    toBottom();
  }, [s.activeThreadId, lastUserItem, toBottom]);
  // biome-ignore lint/correctness/useExhaustiveDependencies: reset announcements on thread switch only
  useEffect(() => {
    announced.current = new Set(items.map((i) => `${i.id}:${i.status}`));
  }, [s.activeThreadId]);

  useEffect(() => {
    for (const it of items) {
      const key = `${it.id}:${it.status}`;
      if (announced.current.has(key)) continue;
      announced.current.add(key);
      const text = announcement(it);
      if (text) setLive(text);
    }
  }, [items]);

  const inbox = s.inbox;
  const empty = items.length === 0;

  return (
    <div className="thread">
      <div
        ref={scroller}
        className="thread__scroll"
        role="log"
        aria-label="Conversation"
        aria-busy={running}
        tabIndex={-1}
      >
        <div className="thread__col" ref={column}>
          {inbox.length > 0 && (
            <InboxSummary
              entries={inbox}
              since={inbox[0]?.at}
              onOpen={(e) => e.threadId && void client.openThread(e.threadId)}
              onDismiss={() => client.dismissInbox()}
            />
          )}
          {empty && !s.activeThreadId ? (
            <EmptyState onPick={onSuggestion} />
          ) : (
            items.map((item) => (
              <div key={item.id} className="thread__item" data-type={item.type}>
                {renderItem(item, ctx)}
              </div>
            ))
          )}
          {running && items.at(-1)?.type === "userMessage" && (
            <div className="thread__item">
              <span className="working">
                <span className="working__dot" aria-hidden /> Working…
              </span>
            </div>
          )}
        </div>
      </div>
      {showJump && (
        <button
          type="button"
          className="jump"
          onClick={() => {
            pinned.current = true;
            setShowJump(false);
            toBottom();
          }}
        >
          <ArrowDown aria-hidden /> Latest
        </button>
      )}
      <div className="sr-only" aria-live="polite" aria-atomic="true">
        {live}
      </div>
      <div className="sr-only" role="status">
        {running ? "The agent is working." : ""}
      </div>
    </div>
  );
}
