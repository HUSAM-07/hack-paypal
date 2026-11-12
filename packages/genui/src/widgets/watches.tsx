import type { Watch } from "@shop/commerce/contract";
import { AlertTriangle, BellRing, Pause, Play, ShieldCheck, X, Zap } from "lucide-react";
import { useState } from "react";
import { relativeTime, useNow, useWidgetContext } from "../context";
import { formatMoney } from "../money";
import {
  CardHead,
  MerchantChip,
  Pill,
  Price,
  Skeleton,
  Sparkline,
  Thumb,
  type Tone,
} from "../primitives";
import type { ToolWidgetProps } from "./types";

const STATUS: Record<Watch["status"], { label: string; tone: Tone; live?: boolean }> = {
  active: { label: "Watching", tone: "accent", live: true },
  paused: { label: "Paused", tone: "neutral" },
  triggered: { label: "Target hit", tone: "good" },
  needsReview: { label: "Needs review", tone: "warn" },
  completed: { label: "Done", tone: "good" },
  cancelled: { label: "Cancelled", tone: "neutral" },
  expired: { label: "Expired", tone: "neutral" },
};

export function WatchStatusPill({ status }: { status: Watch["status"] }) {
  const s = STATUS[status];
  return (
    <Pill tone={s.tone} dot live={s.live ?? false}>
      {s.label}
    </Pill>
  );
}

/** The live copy of a watch from product state, else the one the tool returned. */
export function useLiveWatch(watch: Watch): Watch {
  const { state } = useWidgetContext();
  return state?.watches.find((w) => w.id === watch.id) ?? watch;
}

function currentPrice(w: Watch) {
  return w.lastCheck?.price ?? w.offer.price;
}

function sparkLabel(w: Watch) {
  const pts = w.history.map((h) => h.amountMinor);
  if (pts.length === 0) return "No price history yet";
  const cur = { amountMinor: pts[pts.length - 1] ?? 0, currency: w.targetPrice.currency };
  return `Price history, ${pts.length} checks. Now ${formatMoney(cur)}, target ${formatMoney(w.targetPrice)}.`;
}

export function WatchCard({ watch: initial }: { watch: Watch }) {
  const ctx = useWidgetContext();
  const w = useLiveWatch(initial);
  const now = useNow(true, 30_000);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const act = async (name: string) => {
    setBusy(name);
    setError(null);
    try {
      await ctx.invoke(name, { watchId: w.id });
    } catch (e) {
      setError((e as Error)?.message || "That didn't go through. Try again.");
    } finally {
      setBusy(null);
    }
  };
  const price = currentPrice(w);
  const toGo =
    price.currency === w.targetPrice.currency
      ? price.amountMinor - w.targetPrice.amountMinor
      : undefined;
  const open = w.status === "active" || w.status === "paused" || w.status === "needsReview";
  return (
    <article className="genui g-card g-watch" aria-label={`Price watch: ${w.offer.title}`}>
      <header className="g-watch__head">
        <Thumb src={w.offer.imageUrl} alt="" size="md" />
        <div className="g-watch__id">
          <span className="g-watch__title">{w.offer.title}</span>
          <MerchantChip merchant={w.offer.merchant} />
        </div>
        <WatchStatusPill status={w.status} />
      </header>

      <div className="g-watch__figures">
        <div>
          <span className="g-label">Now</span>
          <Price value={price} size="xl" />
        </div>
        <div>
          <span className="g-label">Target</span>
          <Price value={w.targetPrice} size="lg" />
        </div>
        <div className="g-watch__togo">
          {toGo !== undefined && toGo > 0 ? (
            <span className="g-muted">
              {formatMoney({ amountMinor: toGo, currency: price.currency })} to go
            </span>
          ) : toGo !== undefined ? (
            <span className="g-good">At or under target</span>
          ) : null}
        </div>
      </div>

      <Sparkline
        points={w.history.map((h) => h.amountMinor)}
        target={w.targetPrice.amountMinor}
        width={480}
        height={64}
        label={sparkLabel(w)}
      />

      {w.autoBuy && (
        <div className="g-rule" data-approved={w.autoBuy.mandateId ? "" : undefined}>
          <span className="g-rule__icon" aria-hidden>
            {w.autoBuy.mandateId ? <ShieldCheck /> : <Zap />}
          </span>
          <div className="g-rule__text">
            <strong>
              {w.autoBuy.mandateId ? "Auto-buy on" : "Auto-buy waiting for your approval"}
            </strong>
            <span className="g-muted">
              Up to {formatMoney(w.autoBuy.maxUnitPrice)} each, {formatMoney(w.autoBuy.maxTotal)}{" "}
              total · until {new Date(w.autoBuy.expiresAt).toLocaleDateString()}
            </span>
          </div>
        </div>
      )}

      {w.status === "needsReview" && (
        <div className="g-callout" data-tone="warn" role="alert">
          <AlertTriangle aria-hidden className="g-ico" />
          <div>
            <strong>Paused before buying.</strong> {w.reviewReason ?? "Something looked off."}
          </div>
          <button
            type="button"
            className="g-btn g-btn--quiet g-btn--sm"
            disabled={busy !== null}
            onClick={() => act("watch.approveReview")}
          >
            It's fine, continue
          </button>
        </div>
      )}

      <footer className="g-watch__foot">
        <span className="g-muted g-watch__meta">
          <BellRing aria-hidden className="g-ico" />
          Every{" "}
          {w.everyMinutes >= 60 ? `${Math.round(w.everyMinutes / 60)}h` : `${w.everyMinutes}m`}
          {w.status === "active" && w.nextCheckAt && (
            <> · next {relativeTime(w.nextCheckAt, now)}</>
          )}
          {w.lastCheck && <> · checked {relativeTime(w.lastCheck.checkedAt, now)}</>}
        </span>
        {open && (
          <span className="g-watch__actions">
            {w.status === "paused" ? (
              <button
                type="button"
                className="g-btn g-btn--quiet g-btn--sm"
                disabled={busy !== null}
                onClick={() => act("watch.resume")}
              >
                <Play aria-hidden className="g-ico" /> Resume
              </button>
            ) : (
              <button
                type="button"
                className="g-btn g-btn--quiet g-btn--sm"
                disabled={busy !== null}
                onClick={() => act("watch.pause")}
              >
                <Pause aria-hidden className="g-ico" /> Pause
              </button>
            )}
            <button
              type="button"
              className="g-btn g-btn--ghost g-btn--sm"
              disabled={busy !== null}
              onClick={() => act("watch.cancel")}
            >
              <X aria-hidden className="g-ico" /> Stop watching
            </button>
          </span>
        )}
      </footer>
      {error && (
        <p className="g-error" role="alert">
          {error}
        </p>
      )}
    </article>
  );
}

/** One-line watch for lists and the sidebar. */
export function WatchRow({ watch: initial, onSelect }: { watch: Watch; onSelect?: () => void }) {
  const w = useLiveWatch(initial);
  const price = currentPrice(w);
  const body = (
    <>
      <Thumb src={w.offer.imageUrl} alt="" size="sm" />
      <span className="g-watchrow__main">
        <span className="g-truncate g-watchrow__title">{w.offer.title}</span>
        <span className="g-watchrow__sub">
          <Price value={price} size="sm" />
          <span className="g-muted">→ {formatMoney(w.targetPrice, { trimZeroCents: true })}</span>
        </span>
      </span>
      <span className="g-watchrow__spark">
        <Sparkline
          points={w.history.slice(-24).map((h) => h.amountMinor)}
          target={w.targetPrice.amountMinor}
          width={64}
          height={24}
          label={sparkLabel(w)}
        />
      </span>
      <span className="g-watchrow__dot" data-status={w.status} title={STATUS[w.status].label}>
        <span className="g-sr">{STATUS[w.status].label}</span>
      </span>
    </>
  );
  return onSelect ? (
    <button type="button" className="g-watchrow" onClick={onSelect}>
      {body}
    </button>
  ) : (
    <div className="g-watchrow">{body}</div>
  );
}

function WatchSkeleton({ label }: { label: string }) {
  return (
    <section className="genui g-card g-watch" aria-busy="true" aria-label={label}>
      <CardHead icon={<BellRing />} label={<span className="aui-shimmer">{label}</span>} />
      <div className="g-watch__head">
        <Skeleton w={44} h={44} r={10} />
        <div className="g-stack-sm" style={{ flex: 1 }}>
          <Skeleton w="70%" h={14} />
          <Skeleton w="30%" />
        </div>
      </div>
      <Skeleton h={64} r={8} />
    </section>
  );
}

export function CreateWatchWidget({ item, result }: ToolWidgetProps<"create_watch">) {
  if (!result) return <WatchSkeleton label={item.progress?.label ?? "Setting up the watch"} />;
  return <WatchCard watch={result.watch} />;
}
export function UpdateWatchWidget({ item, result }: ToolWidgetProps<"update_watch">) {
  if (!result) return <WatchSkeleton label={item.progress?.label ?? "Updating the watch"} />;
  return <WatchCard watch={result.watch} />;
}
export function CancelWatchWidget({ item, result }: ToolWidgetProps<"cancel_watch">) {
  if (!result) return <WatchSkeleton label={item.progress?.label ?? "Stopping the watch"} />;
  return <WatchCard watch={result.watch} />;
}

export function ListWatchesWidget({ item, result }: ToolWidgetProps<"list_watches">) {
  if (!result) return <WatchSkeleton label={item.progress?.label ?? "Loading your watches"} />;
  return (
    <section className="genui g-card g-list" aria-label="Your price watches">
      <CardHead
        icon={<BellRing />}
        label={`${result.watches.length} ${result.watches.length === 1 ? "watch" : "watches"}`}
      />
      {result.watches.length === 0 ? (
        <p className="g-empty">No price watches yet. Ask me to watch something.</p>
      ) : (
        <ul>
          {result.watches.map((w) => (
            <li key={w.id}>
              <WatchRow watch={w} />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
