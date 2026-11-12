import type { Source } from "@shop/commerce/contract";
import { ArrowUpRight, FileText, Globe, MonitorPlay, Tag } from "lucide-react";
import { useState } from "react";
import { CitedAnswer, type CitedSegment, type CitedSource } from "../aui/cited-answer";
import { domainOf, relativeTime, useNow, useWidgetContext } from "../context";
import { CardHead, Pill, Price, Skeleton } from "../primitives";
import type { ToolWidgetProps } from "./types";

const CITE = /\s*\[(\d+)\]/g;

/**
 * Turn "Sentence one [1]. Sentence two [2][3].\n\nNext paragraph" into CitedAnswer segments:
 * one segment per sentence, its [n] markers lifted into `cite`. Text stays plain text.
 */
export function toCitedSegments(answer: string, sourceIds: Set<string>): CitedSegment[] {
  const out: CitedSegment[] = [];
  const paragraphs = answer
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean);
  for (const para of paragraphs) {
    const sentences = para.match(/[^.!?]+[.!?]*(?:\s*\[\d+\])*\s*/g) ?? [para];
    sentences.forEach((raw, i) => {
      const cite = [...raw.matchAll(CITE)]
        .map((m) => m[1] as string)
        .filter((id) => sourceIds.has(id));
      const text = raw.replace(CITE, "");
      if (!text.trim()) return;
      out.push({
        text,
        ...(cite.length ? { cite: [...new Set(cite)] } : {}),
        ...(i === 0 ? { paragraph: true } : {}),
      });
    });
  }
  return out;
}

export function toCitedSources(sources: Source[]): CitedSource[] {
  return [...sources]
    .sort((a, b) => a.n - b.n)
    .map((s) => ({ id: String(s.n), title: s.title, site: domainOf(s.url), url: s.url }));
}

export function WebResearchWidget({ item, args, result }: ToolWidgetProps<"web_research">) {
  if (!result) {
    return (
      <section className="genui g-block g-card" aria-busy="true" aria-label="Researching">
        <CardHead
          icon={<Globe />}
          label={<span className="aui-shimmer">{item.progress?.label ?? "Reading the web"}</span>}
        />
        {args?.question && <p className="g-muted g-question">{args.question}</p>}
        <div className="g-stack-sm">
          <Skeleton w="96%" />
          <Skeleton w="88%" />
          <Skeleton w="64%" />
        </div>
      </section>
    );
  }
  const sources = toCitedSources(result.sources);
  const segments = toCitedSegments(result.answer, new Set(sources.map((s) => s.id)));
  return (
    <section className="genui g-block" aria-label="Research answer">
      <CitedAnswer
        segments={segments}
        sources={sources}
        onOpenSource={(s) => {
          if (s.url) window.open(s.url, "_blank", "noopener,noreferrer");
        }}
      />
    </section>
  );
}

export function OpenPageWidget({ item, args, result }: ToolWidgetProps<"open_page">) {
  const ctx = useWidgetContext();
  const [expanded, setExpanded] = useState(false);
  const url = result?.url ?? args?.url;
  if (!result) {
    return (
      <section className="genui g-block g-card" aria-busy="true" aria-label="Opening page">
        <CardHead
          icon={<FileText />}
          label={<span className="aui-shimmer">{item.progress?.label ?? "Opening page"}</span>}
          right={url ? <span className="g-muted g-truncate">{domainOf(url)}</span> : undefined}
        />
        <div className="g-stack-sm">
          <Skeleton w="70%" h={14} />
          <Skeleton w="100%" />
          <Skeleton w="92%" />
        </div>
      </section>
    );
  }
  return (
    <section className="genui g-block g-card" aria-label={`Page: ${result.title}`}>
      <CardHead
        icon={<FileText />}
        label={domainOf(result.url)}
        right={
          result.sessionId && ctx.openBrowser ? (
            <button
              type="button"
              className="g-btn g-btn--quiet g-btn--sm"
              onClick={() => result.sessionId && ctx.openBrowser?.(result.sessionId)}
            >
              <MonitorPlay aria-hidden className="g-ico" /> Show in browser
            </button>
          ) : undefined
        }
      />
      <a
        className="g-page__title"
        href={result.url}
        target="_blank"
        rel="noopener noreferrer nofollow"
      >
        {result.title || result.url}
        <ArrowUpRight aria-hidden className="g-ico" />
      </a>
      {/* Page text is untrusted: plain text, clamped. */}
      <p className="g-page__excerpt" data-clamped={expanded ? undefined : ""}>
        {result.excerpt}
      </p>
      {result.excerpt.length > 280 && (
        <button type="button" className="g-link" onClick={() => setExpanded((v) => !v)}>
          {expanded ? "Show less" : "Show more"}
        </button>
      )}
    </section>
  );
}

const METHOD_LABEL = {
  jsonLd: "Page data",
  exaContents: "Live crawl",
  browserRun: "Browser",
  paypalCatalogue: "PayPal catalogue",
} as const;

export function CheckPriceWidget({ item, args, result }: ToolWidgetProps<"check_price">) {
  const now = useNow(true, 30_000);
  const url = result?.url ?? args?.url;
  if (!result) {
    return (
      <div className="genui g-row g-card" aria-busy="true">
        <Tag aria-hidden className="g-ico g-muted" />
        <span className="aui-shimmer">{item.progress?.label ?? "Checking the live price"}</span>
        {url && <span className="g-muted g-truncate">{domainOf(url)}</span>}
      </div>
    );
  }
  return (
    <section className="genui g-row g-card" aria-label="Live price">
      <Tag aria-hidden className="g-ico g-muted" />
      <Price value={result.price} size="md" />
      {result.shipping && result.shipping.amountMinor > 0 && (
        <span className="g-muted">
          + <Price value={result.shipping} size="sm" /> ship
        </span>
      )}
      {result.inStock === false ? (
        <Pill tone="bad">Out of stock</Pill>
      ) : result.inStock ? (
        <Pill tone="good">In stock</Pill>
      ) : null}
      {result.variant && <span className="g-muted g-truncate">{result.variant}</span>}
      <span className="g-row__end g-muted">
        <span className="g-label">{METHOD_LABEL[result.method]}</span> ·{" "}
        {relativeTime(result.checkedAt, now)}
      </span>
    </section>
  );
}
