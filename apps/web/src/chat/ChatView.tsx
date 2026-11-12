import type { Item, Pact } from "@pact/protocol";
import { ArrowDown, Sparkles } from "lucide-react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import {
  type ReactNode,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { AgentMessageBody } from "@/genui/AgentMessage";
import { HostActionsContext, useHostActions } from "@/genui/actions";
import { Avatar } from "@/genui/primitives";
import { LivePactsContext } from "@/genui/refs";
import { ApprovalSheet } from "@/host/ApprovalSheet";
import { LedgerRow, PactTimeline, Receipt, SystemNotice, ToolSteps } from "@/host/HostItems";
import { EASE_OUT } from "@/lib/motion";
import { cn } from "@/lib/utils";
import type { ThreadState } from "@/protocol/store";

type ItemOf<T extends Item["type"]> = Extract<Item, { type: T }>;

type Block =
  | { kind: "user"; item: ItemOf<"userMessage"> }
  | { kind: "agent"; item: ItemOf<"agentMessage"> }
  | { kind: "tools"; items: ItemOf<"toolCall">[] }
  | { kind: "timeline"; items: ItemOf<"pactUpdate">[] }
  | { kind: "payments"; items: ItemOf<"paymentEvent">[] }
  | { kind: "approval"; item: ItemOf<"approvalRequest"> }
  | { kind: "notice"; item: ItemOf<"systemNotice"> };

/** Folds the flat item list into render blocks; runs of tools/updates/payments group. */
export function toBlocks(items: Item[]): Block[] {
  const out: Block[] = [];
  for (const it of items) {
    const prev = out[out.length - 1];
    switch (it.type) {
      case "userMessage":
        out.push({ kind: "user", item: it });
        break;
      case "agentMessage":
        out.push({ kind: "agent", item: it });
        break;
      case "toolCall":
        if (prev?.kind === "tools") prev.items.push(it);
        else out.push({ kind: "tools", items: [it] });
        break;
      case "pactUpdate":
        if (prev?.kind === "timeline" && prev.items[0]?.pactId === it.pactId) prev.items.push(it);
        else out.push({ kind: "timeline", items: [it] });
        break;
      case "paymentEvent":
        if (prev?.kind === "payments") prev.items.push(it);
        else out.push({ kind: "payments", items: [it] });
        break;
      case "approvalRequest":
        out.push({ kind: "approval", item: it });
        break;
      case "systemNotice":
        out.push({ kind: "notice", item: it });
        break;
    }
  }
  return out;
}

export function useNameFor(pacts: Record<string, Pact>, fallback: Record<string, string>) {
  return useCallback(
    (userId: string) => {
      for (const p of Object.values(pacts)) {
        const m = p.members.find((x) => x.userId === userId);
        if (m) return m.displayName;
      }
      return fallback[userId] ?? "Member";
    },
    [pacts, fallback],
  );
}

function PactMark({ size = 28 }: { size?: number }) {
  return (
    <span
      aria-hidden
      className="flex shrink-0 items-center justify-center rounded-md bg-foreground text-background"
      style={{ width: size, height: size }}
    >
      <svg viewBox="0 0 32 32" className="size-[60%]" aria-hidden>
        <path
          d="M10 22V10h7a4 4 0 0 1 0 8h-7"
          fill="none"
          stroke="currentColor"
          strokeWidth="3"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <circle cx="22.5" cy="22.5" r="2.5" fill="var(--primary)" />
      </svg>
    </span>
  );
}

function Row({ children, gutter = true }: { children: ReactNode; gutter?: boolean }) {
  return <div className={cn("w-full", gutter && "pl-0 sm:pl-10")}>{children}</div>;
}

function Thinking() {
  return (
    <motion.div
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.25, ease: EASE_OUT }}
      className="flex items-center gap-3"
      data-testid="thinking"
    >
      <PactMark />
      <span className="text-shimmer text-sm">Thinking</span>
    </motion.div>
  );
}

export function ChatView({
  thread,
  viewerId,
  nameFor,
  empty,
}: {
  thread: ThreadState;
  viewerId: string;
  nameFor: (userId: string) => string;
  empty: ReactNode;
}) {
  const reduce = useReducedMotion();
  const items = useMemo(
    () => thread.order.map((id) => thread.items[id]).filter((x): x is Item => !!x),
    [thread.order, thread.items],
  );
  const blocks = useMemo(() => toBlocks(items), [items]);
  const latestRefs = useMemo(() => {
    const out: Record<string, unknown> = {};
    for (const it of items) if (it.type === "agentMessage") Object.assign(out, it.refs);
    return out;
  }, [items]);
  const scroller = useRef<HTMLDivElement>(null);
  const [atBottom, setAtBottom] = useState(true);
  const stick = useRef(true);

  const last = items[items.length - 1];
  const thinking =
    thread.activeTurnId !== null &&
    (!last ||
      last.type === "userMessage" ||
      (last.type === "toolCall" && last.status !== "inProgress"));

  const onScroll = () => {
    const el = scroller.current;
    if (!el) return;
    const near = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
    stick.current = near;
    setAtBottom(near);
  };

  const toBottom = useCallback(
    (smooth: boolean) => {
      const el = scroller.current;
      if (el)
        el.scrollTo({ top: el.scrollHeight, behavior: smooth && !reduce ? "smooth" : "auto" });
    },
    [reduce],
  );

  // Follow the stream while the reader is at the bottom; never yank them back up.
  useLayoutEffect(() => {
    if (stick.current) toBottom(false);
  });

  // biome-ignore lint/correctness/useExhaustiveDependencies: re-pin on thread switch only
  useEffect(() => {
    stick.current = true;
    toBottom(false);
  }, [thread.thread.id, toBottom]);

  // Content that grows after layout (images, cards settling) keeps the bottom pinned.
  useEffect(() => {
    const el = scroller.current?.firstElementChild;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      if (stick.current) toBottom(false);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [toBottom]);

  const lastUserIdx = blocks.findLastIndex((b) => b.kind === "user");
  const conversational = blocks.some((b) => b.kind === "user" || b.kind === "agent");

  return (
    <div className="relative min-h-0 flex-1">
      <div
        ref={scroller}
        onScroll={onScroll}
        className="scrollbar-thin h-full overflow-y-auto overscroll-contain"
        data-testid="chat-scroll"
      >
        <LivePactsContext.Provider value={thread.pacts}>
          <div className="mx-auto flex w-full max-w-[720px] flex-col gap-5 px-4 pb-6 pt-6 sm:px-6">
            {blocks.map((b, i) => {
              const key =
                b.kind === "tools" || b.kind === "timeline" || b.kind === "payments"
                  ? b.items[0]!.id
                  : b.item.id;
              return (
                <div key={key} className={cn(i === lastUserIdx && "scroll-mt-4")}>
                  {renderBlock(b, {
                    viewerId,
                    nameFor,
                    activeTurnId: thread.activeTurnId,
                    latestRefs,
                    items,
                  })}
                </div>
              );
            })}
            {!conversational && !thinking ? empty : null}
            <AnimatePresence>{thinking && <Thinking />}</AnimatePresence>
          </div>
        </LivePactsContext.Provider>
      </div>
      <AnimatePresence>
        {!atBottom && (
          <motion.button
            type="button"
            initial={{ opacity: 0, y: 8, scale: 0.9 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 8, scale: 0.9 }}
            transition={{ type: "spring", stiffness: 500, damping: 32 }}
            onClick={() => {
              stick.current = true;
              toBottom(true);
            }}
            aria-label="Jump to latest"
            className="absolute bottom-3 left-1/2 flex size-9 -translate-x-1/2 items-center justify-center rounded-lg bg-popover text-foreground shadow-pop hover:bg-muted"
          >
            <ArrowDown className="size-4" />
          </motion.button>
        )}
      </AnimatePresence>
    </div>
  );
}

function renderBlock(
  b: Block,
  ctx: {
    viewerId: string;
    nameFor: (id: string) => string;
    activeTurnId: string | null;
    latestRefs: Record<string, unknown>;
    items: Item[];
  },
): ReactNode {
  switch (b.kind) {
    case "user": {
      const mine = b.item.authorId === ctx.viewerId || b.item.id.startsWith("optimistic_");
      if (mine) {
        return (
          <motion.div
            initial={{ opacity: 0, y: 6, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            transition={{ duration: 0.3, ease: EASE_OUT }}
            className="flex justify-end"
          >
            <p
              data-testid="user-message"
              className={cn(
                "max-w-[85%] whitespace-pre-wrap break-words rounded-xl rounded-br-sm bg-primary text-primary-foreground px-4 py-2.5 text-[15px] leading-6",
                b.item.status === "inProgress" && "opacity-70",
              )}
            >
              {b.item.text}
            </p>
          </motion.div>
        );
      }
      const name = ctx.nameFor(b.item.authorId);
      return (
        <motion.div
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          className="flex items-end gap-2.5"
        >
          <Avatar name={name} id={b.item.authorId} size={28} />
          <div className="max-w-[80%]">
            <div className="mb-1 pl-1 text-xs text-muted-foreground">{name.split(" ")[0]}</div>
            <p className="whitespace-pre-wrap break-words rounded-xl rounded-bl-sm bg-muted px-4 py-2.5 text-[15px] leading-6">
              {b.item.text}
            </p>
          </div>
        </motion.div>
      );
    }
    case "agent":
      return <AgentBlock item={b.item} latestRefs={ctx.latestRefs} />;
    case "tools":
      return (
        <Row>
          <ToolSteps tools={b.items} />
        </Row>
      );
    case "timeline":
      return (
        <Row>
          <PactTimeline updates={b.items} />
        </Row>
      );
    case "payments": {
      const purchase = b.items.find((p) => p.kind === "purchased");
      if (purchase) {
        // Shares charged earlier in the same settlement turn belong on the receipt too.
        const charges = ctx.items.filter(
          (p): p is ItemOf<"paymentEvent"> =>
            p.type === "paymentEvent" &&
            p.kind === "charged" &&
            p.turnId === purchase.turnId &&
            p.pactId === purchase.pactId,
        );
        const rest = b.items.filter((p) => p !== purchase && !charges.includes(p));
        return (
          <Row>
            <div className="flex flex-col gap-2">
              <Receipt purchase={purchase} charges={charges} nameFor={ctx.nameFor} />
              {rest.map((p) => (
                <LedgerRow key={p.id} item={p} nameFor={ctx.nameFor} />
              ))}
            </div>
          </Row>
        );
      }
      return (
        <Row>
          <div className="flex max-w-[420px] flex-col gap-1.5">
            {b.items.map((p) => (
              <LedgerRow key={p.id} item={p} nameFor={ctx.nameFor} />
            ))}
          </div>
        </Row>
      );
    }
    case "approval":
      return (
        <Row>
          <div className="max-w-[440px]">
            <ApprovalSheet
              item={b.item}
              viewerId={ctx.viewerId}
              approverName={ctx.nameFor(b.item.approverId)}
            />
          </div>
        </Row>
      );
    case "notice":
      return <SystemNotice item={b.item} />;
  }
}

export function EmptyThread({ title, onPick }: { title: string; onPick: (text: string) => void }) {
  const suggestions = [
    "Find a PS6 and split it three ways when it drops under $450",
    "Send Ari $20 for snacks",
    "Show the coffee standing order",
    "Show my activity",
  ];
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, ease: EASE_OUT }}
      className="flex flex-col items-center py-10 text-center sm:py-16"
    >
      <span className="mb-4 flex size-12 items-center justify-center rounded-lg bg-primary-soft text-primary">
        <Sparkles className="size-5" />
      </span>
      <h2 className="display text-[34px]">{title}</h2>
      <p className="mt-1.5 max-w-sm text-sm text-muted-foreground">
        Ask Pact to watch a price, split a purchase, run a standing order or send money. Nothing
        moves without a mandate or your approval.
      </p>
      <div className="mt-6 grid w-full max-w-lg gap-2 sm:grid-cols-2">
        {suggestions.map((s, i) => (
          <motion.button
            key={s}
            type="button"
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.1 + i * 0.05, duration: 0.4, ease: EASE_OUT }}
            onClick={() => onPick(s)}
            className="rounded-lg border border-dashed border-border bg-card px-4 py-3 text-left text-sm leading-5 text-foreground/90 transition-[background-color,transform] duration-150 hover:bg-hover active:scale-[0.98]"
          >
            {s}
          </motion.button>
        ))}
      </div>
    </motion.div>
  );
}

/** Generated UI is inert while its message streams; actions unlock on completion. */
function AgentBlock({
  item,
  latestRefs,
}: {
  item: ItemOf<"agentMessage">;
  latestRefs: Record<string, unknown>;
}) {
  const base = useHostActions();
  const streaming = item.status === "inProgress";
  const value = useMemo(
    () => ({ ...base, interactive: base.interactive && !streaming }),
    [base, streaming],
  );
  // Only refs this message was given resolve; each resolves to its newest server version.
  const refs = useMemo(() => {
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(item.refs)) out[k] = latestRefs[k] ?? item.refs[k];
    return out;
  }, [item.refs, latestRefs]);
  return (
    <div className="flex gap-3" data-testid="agent-message" data-streaming={streaming || undefined}>
      <div className="hidden pt-0.5 sm:block">
        <PactMark />
      </div>
      <div className="min-w-0 flex-1">
        <HostActionsContext.Provider value={value}>
          <AgentMessageBody text={item.text} refs={refs} streaming={streaming} />
        </HostActionsContext.Provider>
      </div>
    </div>
  );
}
