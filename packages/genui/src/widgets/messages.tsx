import type { ItemOf, NotificationOf } from "@shop/agent-protocol";
import { AlertTriangle, ChevronRight, Info, XCircle } from "lucide-react";
import { memo, useState } from "react";
import Markdown from "react-markdown";
import rehypeSanitize from "rehype-sanitize";
import { type AwayItem, AwaySummary } from "../aui/away-summary";
import { ThinkingLoader } from "../aui/thinking-loader";
import { ToolCallCard, type ToolCallStatus } from "../aui/tool-call-card";
import { domainOf } from "../context";
import type { ToolCallItem } from "./types";

export function UserMessage({ item }: { item: ItemOf<"userMessage"> }) {
  return (
    <div className="genui g-user">
      <p className="g-user__bubble" dir="auto">
        {item.text}
      </p>
    </div>
  );
}

type Citation = { n: number; url: string; title: string };

/** Turn "[2]" markers into links to the cited source, so they render as citation chips. */
export function linkCitations(text: string, citations: Citation[] | undefined): string {
  if (!citations?.length) return text;
  const byN = new Map(citations.map((c) => [String(c.n), c.url]));
  return text.replace(/\[(\d{1,2})\](?!\()/g, (m, n: string) => {
    const url = byN.get(n);
    return url ? `[${n}](${url})` : m;
  });
}

/** Markdown is sanitized and links open outside the app; no raw HTML from the model. */
const MarkdownBody = memo(function MarkdownBody({
  text,
  citations,
}: {
  text: string;
  citations?: Citation[] | undefined;
}) {
  return (
    <Markdown
      rehypePlugins={[rehypeSanitize]}
      components={{
        a: ({ href, children }) => {
          const cite =
            typeof children === "string" && /^\d{1,2}$/.test(children)
              ? citations?.find((c) => String(c.n) === children && c.url === href)
              : undefined;
          return (
            <a
              href={href}
              target="_blank"
              rel="noopener noreferrer nofollow"
              {...(cite
                ? {
                    className: "g-cite",
                    title: cite.title,
                    "aria-label": `Source ${cite.n}: ${cite.title}`,
                  }
                : {})}
            >
              {children}
            </a>
          );
        },
      }}
    >
      {linkCitations(text, citations)}
    </Markdown>
  );
});

export function AgentMessage({ item }: { item: ItemOf<"agentMessage"> }) {
  const streaming = item.status === "inProgress";
  return (
    <div className="genui g-agent" data-streaming={streaming ? "" : undefined}>
      <div className="g-md" dir="auto">
        {item.text ? (
          <MarkdownBody text={item.text} citations={streaming ? undefined : item.citations} />
        ) : streaming ? (
          <ThinkingLoader variant="plain" size="sm" phases={["Writing"]} />
        ) : null}
        {streaming && item.text && <span className="g-caret" aria-hidden />}
      </div>
      {!streaming && item.citations && item.citations.length > 0 && (
        <ul className="g-cites" aria-label="Cited sources">
          {item.citations.map((c) => (
            <li key={c.n}>
              <a
                className="g-source"
                href={c.url}
                target="_blank"
                rel="noopener noreferrer nofollow"
                title={c.title}
              >
                <span className="g-source__n g-tnum">{c.n}</span>
                <span className="g-truncate">{domainOf(c.url)}</span>
              </a>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** Reasoning summary: a live "Thinking" pill, then a quiet disclosure with the summary. */
export function Reasoning({ item }: { item: ItemOf<"reasoning"> }) {
  const [open, setOpen] = useState(false);
  if (item.status === "inProgress") {
    const phases = item.summary
      ? [item.summary.split("\n").pop()?.slice(0, 80) || "Thinking"]
      : ["Thinking", "Comparing options", "Checking prices"];
    return (
      <div className="genui g-reasoning">
        <ThinkingLoader phases={phases} size="sm" />
      </div>
    );
  }
  const secs =
    item.completedAt && item.createdAt
      ? Math.max(1, Math.round((Date.parse(item.completedAt) - Date.parse(item.createdAt)) / 1000))
      : undefined;
  if (!item.summary) return null;
  return (
    <div className="genui g-reasoning">
      <button
        type="button"
        className="g-reasoning__toggle"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <ChevronRight aria-hidden className="g-ico g-reasoning__chev" />
        {secs ? `Thought for ${secs}s` : "Thought"}
      </button>
      {open && <p className="g-reasoning__text">{item.summary}</p>}
    </div>
  );
}

export function SystemNotice({ item }: { item: ItemOf<"systemNotice"> }) {
  const Icon = item.level === "error" ? XCircle : item.level === "warning" ? AlertTriangle : Info;
  return (
    <div
      className="genui g-notice"
      data-level={item.level}
      role={item.level === "info" ? "status" : "alert"}
    >
      <Icon aria-hidden className="g-ico" />
      <span>{item.text}</span>
    </div>
  );
}

const TCC_STATUS: Record<ToolCallItem["status"], ToolCallStatus> = {
  inProgress: "running",
  completed: "success",
  failed: "error",
  declined: "error",
};

/** Generic row for unknown tools, failed or declined calls, and results that don't validate. */
export function ToolCallFallback({ item, note }: { item: ToolCallItem; note?: string }) {
  const error =
    item.status === "declined" ? "You declined this." : (item.error ?? note ?? undefined);
  return (
    <div className="genui g-toolcall">
      <ToolCallCard
        name={item.name}
        status={TCC_STATUS[item.status]}
        summary={
          item.progress?.label && item.status === "inProgress" ? item.progress.label : item.summary
        }
        args={item.args}
        result={item.result}
        {...(error ? { error } : {})}
        startedAt={Date.parse(item.createdAt)}
        {...(item.completedAt
          ? { duration: Date.parse(item.completedAt) - Date.parse(item.createdAt) }
          : {})}
        openOnError={false}
      />
    </div>
  );
}

export type InboxEntry = NotificationOf<"inbox/added">;

const AWAY_KIND: Record<InboxEntry["level"], AwayItem["kind"]> = {
  actionRequired: "needs-you",
  warning: "failed",
  info: "done",
  success: "done",
};

/** "While you were away": inbox entries that arrived with no turn running. */
export function InboxSummary({
  entries,
  since,
  onOpen,
  onDismiss,
}: {
  entries: InboxEntry[];
  since?: string | undefined;
  onOpen?: (entry: InboxEntry) => void;
  onDismiss?: () => void;
}) {
  if (entries.length === 0) return null;
  const items: AwayItem[] = entries.map((e) => ({
    id: e.id,
    title: e.title,
    kind: AWAY_KIND[e.level],
    ...(e.body ? { detail: e.body } : {}),
    ...(e.threadId
      ? { action: e.level === "actionRequired" ? "Decide" : "Open" }
      : { action: false }),
  }));
  return (
    <div className="genui g-inbox">
      <AwaySummary
        items={items}
        {...(since ? { since } : {})}
        onAction={(id) => {
          const entry = entries.find((x) => x.id === id);
          if (entry) onOpen?.(entry);
        }}
        {...(onDismiss ? { onDismiss } : {})}
      />
    </div>
  );
}
