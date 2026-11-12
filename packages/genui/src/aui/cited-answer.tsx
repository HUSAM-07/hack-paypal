import {
  forwardRef,
  type HTMLAttributes,
  type KeyboardEvent,
  type ReactNode,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
import { cn, useControllable, useIsoLayoutEffect } from "./lib/utils";
import "./cited-answer.css";

export type CitedSegment = {
  text: string;
  /** Source ids – one marker each */
  cite?: string[];
  /** Starts a new paragraph */
  paragraph?: boolean;
};

export type CitedSource = {
  id: string;
  title: string;
  site: string;
  url?: string;
  date?: string;
  /** The passage your retrieval step used */
  quote?: string;
  /** Exact phrases of the quote to mark; without it shared words are marked */
  highlight?: string[];
  icon?: ReactNode;
  /** Tint of the letter glyph when there is no icon */
  tone?: "gray" | "green" | "blue" | "violet" | "orange";
};

export interface CitedAnswerProps extends Omit<HTMLAttributes<HTMLDivElement>, "children"> {
  /** The answer in order. Leave out both `segments` and `sources` to render the built-in example. */
  segments?: CitedSegment[];
  /** Numbered in this order, one chip each */
  sources?: CitedSource[];
  /** Pages read while searching – shown in the head */
  pagesRead?: number;
  /** Id of the source whose preview is open (controlled); `null` closes it */
  open?: string | null;
  /** Id of the source whose preview is open at first */
  defaultOpen?: string;
  /** Called by Open source. With it the link doesn't navigate on its own */
  onOpenSource?: (source: CitedSource) => void;
  /** Called when a preview opens, switches or closes */
  onPreviewChange?: (id: string | null) => void;
  /** A button in the last row of the card, e.g. Follow up */
  action?: { label: string; onClick: () => void };
}

/** The example the card shows when it gets no data of its own. */
export const DEFAULT_CITED_SOURCES: CitedSource[] = [
  {
    id: "caching",
    site: "Tokenwise",
    title: "Prompt caching, explained: what gets stored and for how long",
    url: "https://tokenwise.dev/blog/prompt-caching",
    date: "Sep 18, 2026",
    quote:
      "A cached prefix is read instead of recomputed. On prompts over 10,000 tokens this cut time to first token by up to 80% in our tests, and cached input is billed at a fraction of the normal rate.",
    highlight: ["read instead of recomputed", "cut time to first token by up to 80%"],
  },
  {
    id: "prompts",
    site: "Latency Notes",
    title: "Designing cache-friendly prompts",
    url: "https://latencynotes.io/cache-friendly-prompts",
    date: "Aug 2, 2026",
    tone: "green",
    quote:
      "Keep the stable part – system prompt, tool definitions, long documents – at the very start, and put anything that changes per request after it. A single changed character early on invalidates everything behind it.",
    highlight: [
      "at the very start",
      "anything that changes per request after it",
      "invalidates everything behind it",
    ],
  },
  {
    id: "semantic",
    site: "Inference Weekly",
    title: "Semantic caching for LLM apps in production",
    url: "https://inferenceweekly.com/semantic-caching",
    date: "Jul 24, 2026",
    tone: "green",
    quote:
      "For FAQ-style traffic, the semantic cache answered 31% of requests without calling the model at all, at a median of 40 ms. We only serve a stored answer above a similarity of 0.92.",
    highlight: ["31% of requests", "median of 40 ms"],
  },
];

export const DEFAULT_CITED_SEGMENTS: CitedSegment[] = [
  {
    text: "The biggest win is prompt caching: the provider reuses the processed start of your prompt, so a long system prompt isn't recomputed on every call.",
    cite: ["caching"],
  },
  {
    text: " On prompts over 10K tokens that can cut time to first token by up to 80%.",
    cite: ["caching"],
  },
  {
    text: " It only works while that start stays identical, so put the system prompt, tools and long documents first and anything that changes per request last.",
    cite: ["prompts", "caching"],
  },
  {
    text: "For repeated questions, add a semantic cache in front of the model: close matches get a stored answer in about 40 ms,",
    cite: ["semantic"],
    paragraph: true,
  },
  {
    text: " which covered nearly a third of FAQ-style traffic in one production setup.",
    cite: ["semantic"],
  },
  {
    text: " Stream the rest, so people see the first words while the answer is still being written.",
  },
];

const NO_SEGMENTS: CitedSegment[] = [];
const NO_SOURCES: CitedSource[] = [];

const PATHS = {
  close: "M4.75 4.75l6.5 6.5m0-6.5-6.5 6.5",
  open: "M6.5 4.5h5v5M11.25 4.75 4.5 11.5",
  copy: "M6.75 5.5h5c.69 0 1.25.56 1.25 1.25v5c0 .69-.56 1.25-1.25 1.25h-5c-.69 0-1.25-.56-1.25-1.25v-5c0-.69.56-1.25 1.25-1.25ZM10.5 3.5A1.25 1.25 0 0 0 9.25 3h-5C3.56 3 3 3.56 3 4.25v5c0 .54.34 1 .82 1.17",
  check: "M3.75 8.4 6.6 11.2 12.25 5",
  arrow: "M3.5 8h9M8.75 4.25 12.5 8l-3.75 3.75",
};

function Icon({ d }: { d: string }) {
  return (
    <svg viewBox="0 0 16 16" className="aui-ca__icon" aria-hidden="true">
      <path d={d} />
    </svg>
  );
}

function Glyph({ source }: { source: CitedSource }) {
  return (
    <span
      className="aui-ca__glyph"
      data-tone={source.icon ? undefined : (source.tone ?? "gray")}
      aria-hidden="true"
    >
      {source.icon ??
        source.site
          .replace(/^www\./, "")
          .charAt(0)
          .toUpperCase()}
    </span>
  );
}

const domain = (s: CitedSource) =>
  s.url
    ? s.url
        .replace(/^https?:\/\//, "")
        .replace(/^www\./, "")
        .split("/")[0]
    : s.site;

/** Split a quote into plain text and marked phrases. */
function markQuote(quote: string, phrases: string[]): ReactNode[] {
  const ranges: [number, number][] = [];
  const lower = quote.toLowerCase();
  for (const p of phrases) {
    if (!p) continue;
    let from = 0;
    let at: number;
    while ((at = lower.indexOf(p.toLowerCase(), from)) !== -1) {
      ranges.push([at, at + p.length]);
      from = at + p.length;
    }
  }
  ranges.sort((a, b) => a[0] - b[0]);
  const merged: [number, number][] = [];
  for (const r of ranges) {
    const last = merged[merged.length - 1];
    if (last && r[0] <= last[1]) last[1] = Math.max(last[1], r[1]);
    else merged.push([...r]);
  }
  const out: ReactNode[] = [];
  let pos = 0;
  merged.forEach(([a, b], i) => {
    if (a > pos) out.push(quote.slice(pos, a));
    out.push(<mark key={i}>{quote.slice(a, b)}</mark>);
    pos = b;
  });
  if (pos < quote.length) out.push(quote.slice(pos));
  return out;
}

/** Without explicit phrases: words of 5+ letters (and numbers) shared with the citing sentences. */
function autoPhrases(quote: string, sentences: string[]): string[] {
  const norm = (w: string) => w.toLowerCase().replace(/[^\p{L}\p{N}%]/gu, "");
  const pool = new Set(sentences.join(" ").split(/\s+/).map(norm).filter(Boolean));
  return quote
    .split(/\s+/)
    .map((w) => w.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}%]+$/gu, ""))
    .filter((w) => (w.length >= 5 || /\d/.test(w)) && pool.has(norm(w)));
}

/** What the pointer or the focus is on: one marker in one sentence, or a whole source. */
type Hot = { id: string; from: "mark"; at: number } | { id: string; from: "source" };
type Caption = { key: string; node: ReactNode; tone?: "ok" };

const SWAP_OUT_MS = 240;
const NOTE_MS = 1800;

export const CitedAnswer = forwardRef<HTMLDivElement, CitedAnswerProps>(function CitedAnswer(
  {
    segments: segmentsProp,
    sources: sourcesProp,
    pagesRead,
    open: openProp,
    defaultOpen,
    onOpenSource,
    onPreviewChange,
    action,
    className,
    onKeyDown,
    ...rest
  },
  ref,
) {
  const uid = useId();
  // the example only shows up when the card gets no data at all
  const bare = segmentsProp === undefined && sourcesProp === undefined;
  const segments = segmentsProp ?? (bare ? DEFAULT_CITED_SEGMENTS : NO_SEGMENTS);
  const sources = sourcesProp ?? (bare ? DEFAULT_CITED_SOURCES : NO_SOURCES);

  const byId = useMemo(() => new Map(sources.map((s, i) => [s.id, { s, n: i + 1 }])), [sources]);
  const [openRaw, setOpen] = useControllable<string | null>(
    openProp,
    defaultOpen ?? null,
    onPreviewChange,
  );
  const open = openRaw != null && byId.has(openRaw) ? openRaw : null;

  // pointer and focus share one slot – whichever moved last wins, like the highlight it drives
  const [hotRaw, setHot] = useState<Hot | null>(null);
  const hot = hotRaw && byId.has(hotRaw.id) ? hotRaw : null;

  const [copied, setCopied] = useState(false);
  const noteTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const chipRefs = useRef(new Map<string, HTMLButtonElement>());
  useEffect(() => () => clearTimeout(noteTimer.current), []);

  // the preview keeps its last source while it folds away
  const [last, setLast] = useState<string | null>(open);
  if (open && open !== last) {
    setLast(open);
    setCopied(false);
  }
  const shown = byId.get(open ?? last ?? "");
  const current = open ? byId.get(open) : undefined;

  const toggle = (id: string) => setOpen(open === id ? null : id);

  // group segments into paragraphs, skipping unknown citations
  const paragraphs = useMemo(() => {
    const out: { seg: CitedSegment; cite: string[]; i: number }[][] = [];
    segments.forEach((seg, i) => {
      if (seg.paragraph || out.length === 0) out.push([]);
      out[out.length - 1]?.push({ seg, cite: (seg.cite ?? []).filter((c) => byId.has(c)), i });
    });
    return out;
  }, [segments, byId]);
  const sentences = segments.length;
  const backed = segments.filter((s) => (s.cite ?? []).some((c) => byId.has(c))).length;
  const citedIn = (id: string) => segments.filter((s) => s.cite?.includes(id)).length;

  /* ---- chips that fit on one line, the rest behind "+N" ---- */
  const chipsRef = useRef<HTMLDivElement>(null);
  const rulerRef = useRef<HTMLDivElement>(null);
  const [fit, setFit] = useState(sources.length);
  const [showAll, setShowAll] = useState(false);
  const focusChip = useRef<string | null>(null);
  useIsoLayoutEffect(() => {
    const box = chipsRef.current;
    const ruler = rulerRef.current;
    if (!box || !ruler) return;
    const measure = () => {
      const items = [...ruler.children] as HTMLElement[];
      const more = items.pop();
      // a wrapping row (narrow cards, the classic look) shows every chip
      if (getComputedStyle(box).flexWrap !== "nowrap") return setFit(items.length);
      const avail = box.clientWidth;
      const gap = 4;
      const widths = items.map((el) => el.offsetWidth);
      const total = widths.reduce((a, w) => a + w, 0) + gap * Math.max(0, widths.length - 1);
      if (total <= avail) return setFit(widths.length);
      const moreW = (more?.offsetWidth ?? 32) + gap;
      let used = 0;
      let n = 0;
      for (const w of widths) {
        if (used + w + (n ? gap : 0) + moreW > avail) break;
        used += w + (n ? gap : 0);
        n++;
      }
      setFit(Math.max(1, n));
    };
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(measure);
    ro.observe(box);
    return () => ro.disconnect();
  }, [sources, showAll]);
  const visibleChips = showAll ? sources : sources.slice(0, fit);
  const hidden = sources.length - visibleChips.length;
  useEffect(() => {
    if (!showAll || !focusChip.current) return;
    chipRefs.current.get(focusChip.current)?.focus();
    focusChip.current = null;
  }, [showAll]);

  const onChipKey = (e: KeyboardEvent<HTMLElement>) => {
    const els = [...(chipsRef.current?.querySelectorAll<HTMLElement>("button") ?? [])];
    const i = els.indexOf(e.currentTarget);
    let next = -1;
    if (e.key === "ArrowRight") next = Math.min(els.length - 1, i + 1);
    else if (e.key === "ArrowLeft") next = Math.max(0, i - 1);
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = els.length - 1;
    if (next < 0) return;
    e.preventDefault();
    els[next]?.focus();
  };

  /* ---- preview ---- */
  const citing = useMemo(
    () => (shown ? segments.filter((s) => s.cite?.includes(shown.s.id)).map((s) => s.text) : []),
    [shown, segments],
  );
  const quoteNodes = useMemo(() => {
    const s = shown?.s;
    if (!s?.quote) return null;
    return markQuote(s.quote, s.highlight ?? autoPhrases(s.quote, citing));
  }, [shown, citing]);

  /** Close and, when asked, hand the focus to the source's chip. */
  const closePreview = (refocus: boolean) => {
    const id = open;
    if (!id) return;
    setOpen(null);
    if (refocus) chipRefs.current.get(id)?.focus({ preventScroll: true });
  };
  const copyQuote = () => {
    if (!shown?.s.quote) return;
    navigator.clipboard
      ?.writeText(`“${shown.s.quote}” – ${shown.s.title}, ${shown.s.site}`)
      .catch(() => {});
    setCopied(true);
    clearTimeout(noteTimer.current);
    noteTimer.current = setTimeout(() => setCopied(false), NOTE_MS);
  };

  /* ---- last row ---- */
  const hotSrc = hot ? byId.get(hot.id) : undefined;
  const dot = <span className="aui-ca__dot">·</span>;
  const caption: Caption = copied
    ? { key: "copied", node: "Quote copied", tone: "ok" }
    : hot && hotSrc
      ? hot.from === "mark"
        ? {
            key: `m:${hot.id}`,
            node: (
              <>
                <b>{hotSrc.s.site}</b> {dot} {hotSrc.s.title}
              </>
            ),
          }
        : {
            key: `s:${hot.id}`,
            node: (
              <>
                <b>{hotSrc.s.site}</b> {dot} cited in {citedIn(hot.id)} sentence
                {citedIn(hot.id) === 1 ? "" : "s"}
              </>
            ),
          }
      : current
        ? {
            key: `o:${open}`,
            node: (
              <>
                Quote from <b>{current.s.site}</b>
              </>
            ),
          }
        : sentences
          ? {
              key: "d",
              node: (
                <>
                  <b>{backed}</b> of {sentences} sentence{sentences === 1 ? "" : "s"} backed by a
                  source
                </>
              ),
            }
          : { key: "e", node: "No answer yet" };

  // the line that was there blurs out while the new one comes in
  const shownCap = useRef(caption);
  const [leaving, setLeaving] = useState<Caption | null>(null);
  useIsoLayoutEffect(() => {
    const prev = shownCap.current;
    shownCap.current = caption;
    if (prev.key === caption.key) return;
    setLeaving(prev);
    const t = setTimeout(() => setLeaving(null), SWAP_OUT_MS);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [caption.key]);
  shownCap.current = shownCap.current.key === caption.key ? caption : shownCap.current;

  const label = (s: CitedSource, n: number) => `Source ${n}: ${s.site} – ${s.title}`;
  const previewId = `${uid}-preview`;

  return (
    <div
      ref={ref}
      role="group"
      aria-label="Answer with sources"
      {...rest}
      className={cn("aui-root aui-ca", className)}
      data-hot={hot?.from}
      onKeyDown={(e) => {
        onKeyDown?.(e);
        if (e.defaultPrevented || e.key !== "Escape" || !open) return;
        // wherever the focus sat (a marker, a chip, the preview), it lands on the open source's chip
        closePreview(true);
      }}
    >
      <span className="aui-ca__card-bg" aria-hidden="true" />

      <div className="aui-ca__head">
        {sources.length > 0 && (
          <span className="aui-ca__stack" aria-hidden="true">
            {sources.slice(0, 3).map((s) => (
              <Glyph source={s} key={s.id} />
            ))}
          </span>
        )}
        <span className="aui-ca__meta">
          <span>
            {sources.length
              ? `${sources.length} source${sources.length === 1 ? "" : "s"}`
              : "No sources"}
          </span>
          {pagesRead != null && (
            <span>
              <span className="aui-ca__dot"> · </span>
              {pagesRead} page{pagesRead === 1 ? "" : "s"} read
            </span>
          )}
        </span>
      </div>

      <div className="aui-ca__text">
        {paragraphs.map((para, pi) => (
          <p className="aui-ca__p" dir="auto" key={pi}>
            {para.map(({ seg, cite, i }) => {
              const lead = seg.text.match(/^\s*/)![0];
              const trail = seg.text.match(/\s*$/)![0];
              const core = seg.text.trim();
              const cut = core.lastIndexOf(" ");
              const head = cite.length && cut > 0 ? core.slice(0, cut + 1) : "";
              const tail = cite.length ? (cut > 0 ? core.slice(cut + 1) : core) : "";
              const hl =
                (hot?.from === "mark" && hot.at === i) ||
                (hot?.from === "source" && cite.includes(hot.id)) ||
                (open !== null && cite.includes(open));
              const marker = (id: string) => {
                const { s, n } = byId.get(id)!;
                const mark: Hot = { id, from: "mark", at: i };
                return (
                  <button
                    key={id}
                    type="button"
                    className="aui-ca__marker"
                    data-source={id}
                    aria-label={label(s, n)}
                    aria-expanded={open === id}
                    aria-controls={previewId}
                    data-lit={
                      hot?.id === id && (hot.from === "source" || hot.at === i) ? "" : undefined
                    }
                    onClick={() => toggle(id)}
                    onPointerEnter={() => setHot(mark)}
                    onPointerLeave={() => setHot(null)}
                    onFocus={() => setHot(mark)}
                    onBlur={() => setHot(null)}
                  >
                    {n}
                  </button>
                );
              };
              return (
                <span key={i}>
                  {lead}
                  <span
                    className="aui-ca__seg"
                    data-hl={hl ? "" : undefined}
                    data-dim={hot?.from === "source" && !hl ? "" : undefined}
                  >
                    {cite.length ? (
                      <>
                        {head}
                        <span className="aui-ca__keep">
                          {tail}
                          {marker(cite[0] as string)}
                        </span>
                        {cite.slice(1).map(marker)}
                      </>
                    ) : (
                      core
                    )}
                  </span>
                  {trail}
                </span>
              );
            })}
          </p>
        ))}
      </div>

      {sources.length > 0 && (
        <div
          className="aui-ca__chips"
          role="list"
          aria-label="Sources"
          ref={chipsRef}
          data-all={showAll ? "" : undefined}
        >
          {visibleChips.map((s) => {
            const n = byId.get(s.id)!.n;
            const src: Hot = { id: s.id, from: "source" };
            return (
              <span className="aui-ca__chip-item" role="listitem" key={s.id}>
                <button
                  ref={(el) => {
                    if (el) chipRefs.current.set(s.id, el);
                    else chipRefs.current.delete(s.id);
                  }}
                  type="button"
                  className="aui-ca__chip"
                  data-source={s.id}
                  aria-label={label(s, n)}
                  aria-expanded={open === s.id}
                  aria-controls={previewId}
                  data-lit={hot?.id === s.id ? "" : undefined}
                  data-dim={hot && hot.id !== s.id ? "" : undefined}
                  onClick={() => toggle(s.id)}
                  onKeyDown={onChipKey}
                  onPointerEnter={() => setHot(src)}
                  onPointerLeave={() => setHot(null)}
                  onFocus={() => setHot(src)}
                  onBlur={() => setHot(null)}
                >
                  <Glyph source={s} />
                  <span className="aui-ca__chip-name" dir="auto" title={s.site}>
                    {s.site}
                  </span>
                  <span className="aui-ca__chip-num">{n}</span>
                </button>
              </span>
            );
          })}
          {hidden > 0 && (
            <span className="aui-ca__chip-item" role="listitem">
              <button
                type="button"
                className="aui-ca__more"
                aria-label={`Show ${hidden} more source${hidden === 1 ? "" : "s"}`}
                onKeyDown={onChipKey}
                onClick={() => {
                  focusChip.current = sources[visibleChips.length]?.id ?? null;
                  setShowAll(true);
                }}
              >
                +{hidden}
              </button>
            </span>
          )}
        </div>
      )}
      <div className="aui-ca__ruler" ref={rulerRef} aria-hidden="true">
        {sources.map((s, i) => (
          <span className="aui-ca__chip" data-chip="" key={s.id}>
            <Glyph source={s} />
            <span className="aui-ca__chip-name">{s.site}</span>
            <span className="aui-ca__chip-num">{i + 1}</span>
          </span>
        ))}
        <span className="aui-ca__more" data-more="">
          +{sources.length}
        </span>
      </div>

      <div
        className="aui-ca__fold"
        id={previewId}
        role="region"
        aria-label={current ? `Source ${current.n}: ${current.s.site}` : "Source"}
        data-open={current ? "" : undefined}
        inert={!current}
      >
        <div className="aui-ca__clip">
          {shown && (
            <div className="aui-ca__preview" key={shown.s.id}>
              <div className="aui-ca__pv-head">
                <Glyph source={shown.s} />
                <span className="aui-ca__pv-meta">
                  <span className="aui-ca__pv-domain" title={shown.s.url}>
                    {domain(shown.s)}
                  </span>
                  {shown.s.date && (
                    <span className="aui-ca__pv-date">
                      <span className="aui-ca__dot"> · </span>
                      {shown.s.date}
                    </span>
                  )}
                </span>
                <span className="aui-ca__pv-num" aria-hidden="true">
                  {shown.n}
                </span>
                <button
                  type="button"
                  className="aui-ca__close"
                  aria-label="Close source"
                  onClick={() => closePreview(true)}
                >
                  <Icon d={PATHS.close} />
                </button>
              </div>
              <div className="aui-ca__pv-title" dir="auto" title={shown.s.title}>
                {shown.s.title}
              </div>
              {quoteNodes && (
                <blockquote className="aui-ca__quote" dir="auto">
                  {quoteNodes}
                </blockquote>
              )}
              <div className="aui-ca__pv-actions">
                <a
                  className="aui-ca__btn aui-ca__btn--main"
                  href={shown.s.url ?? "#"}
                  target="_blank"
                  rel="noreferrer noopener"
                  onClick={(e) => {
                    if (onOpenSource) {
                      e.preventDefault();
                      onOpenSource(shown.s);
                    } else if (!shown.s.url) e.preventDefault();
                  }}
                >
                  <Icon d={PATHS.open} />
                  Open source
                </a>
                {shown.s.quote && (
                  <button
                    type="button"
                    className="aui-ca__btn"
                    aria-label="Copy quote"
                    data-done={copied ? "" : undefined}
                    onClick={copyQuote}
                  >
                    <span className="aui-ca__btn-icon" key={String(copied)}>
                      <Icon d={copied ? PATHS.check : PATHS.copy} />
                    </span>
                    <span className="aui-ca__btn-text">{copied ? "Copied" : "Copy quote"}</span>
                  </button>
                )}
              </div>
            </div>
          )}
        </div>
      </div>

      <div className="aui-ca__foot">
        <span className="aui-ca__caption" aria-live="polite">
          <span className="aui-ca__swap">
            {leaving && leaving.key !== caption.key && (
              <span
                className="aui-ca__swap-item"
                key={leaving.key}
                data-tone={leaving.tone}
                data-out=""
                aria-hidden="true"
              >
                {leaving.node}
              </span>
            )}
            <span className="aui-ca__swap-item" key={caption.key} data-tone={caption.tone}>
              {caption.node}
            </span>
          </span>
        </span>
        {action && (
          <button
            type="button"
            className="aui-ca__action"
            title={action.label}
            onClick={action.onClick}
          >
            <span className="aui-ca__action-label">{action.label}</span>
            <Icon d={PATHS.arrow} />
          </button>
        )}
      </div>
    </div>
  );
});
CitedAnswer.displayName = "CitedAnswer";
