import type { ComponentRenderProps } from "@openuidev/react-lang";
import type { PropsOf } from "@pact/catalog";
import type { Money, Pact, PactMember } from "@pact/protocol";
import {
  CalendarClock,
  Check,
  Clock,
  Handshake,
  LineChart,
  PieChart,
  RotateCcw,
  Target,
} from "lucide-react";
import { animate, motion, useMotionValue, useReducedMotion, useTransform } from "motion/react";
import { useContext, useEffect, useId, useMemo, useState } from "react";
import { NumberTicker } from "@/components/motion/number-ticker";
import { Button } from "@/components/ui/button";
import { formatMoney } from "@/lib/money";
import { EASE_OUT, SPRING_LAYOUT } from "@/lib/motion";
import { cn, relativeTime, shortDate } from "@/lib/utils";
import { useHostActions } from "../actions";
import { Amount, Avatar, CardSkeleton, GenCard, StateBadge, Well } from "../primitives";
import {
  LivePactsContext,
  type PactData,
  type ProductData,
  RefsContext,
  resolveRef,
} from "../refs";

type R<P> = ComponentRenderProps<P>;

function usePact(pactRef: string) {
  const refs = useContext(RefsContext);
  const live = useContext(LivePactsContext);
  const resolved = resolveRef(refs, pactRef, "pact");
  const livePact = resolved ? live[resolved.pact.id] : undefined;
  // A newer pactUpdate wins for state and member statuses; amounts stay from the ref.
  const data = useMemo(
    () =>
      resolved && livePact && livePact.updatedAt >= resolved.pact.updatedAt
        ? { ...resolved, pact: livePact }
        : resolved,
    [resolved, livePact],
  );
  const product: ProductData | undefined =
    data?.product ??
    (data && "productRef" in data.pact.trigger
      ? resolveRef(refs, data.pact.trigger.productRef, "product")
      : undefined);
  return { data, product };
}

function shareOf(data: PactData, userId: string): Money | undefined {
  return data.shares?.find((s) => s.userId === userId)?.share;
}

function conditionText(pact: Pact, product?: ProductData): string {
  const t = pact.trigger;
  switch (t.kind) {
    case "price":
      return `Buys ${product ? product.title.split(",")[0] : "the item"} at or below ${formatMoney(t.maxPrice, { compact: true })} · by ${shortDate(t.deadline)}`;
    case "schedule":
      return `Runs every ${t.everyDays} days${t.maxRuns ? ` · ${t.maxRuns} runs` : ""}`;
    case "quorum":
      return `Needs ${t.confirmationsNeeded} confirmations · by ${shortDate(t.expiresAt)}`;
    case "manual":
      return "Runs when the organizer confirms";
  }
}

const MEMBER_STATUS: Record<PactMember["status"], { label: string; cls: string }> = {
  invited: { label: "Invited", cls: "text-muted-foreground" },
  committed: { label: "Committed", cls: "text-success" },
  declined: { label: "Declined", cls: "text-danger" },
  revoked: { label: "Revoked", cls: "text-danger" },
  charged: { label: "Paid", cls: "text-success" },
  failed: { label: "Failed", cls: "text-danger" },
};

export function PactCardView({ props }: R<PropsOf<"PactCard">>) {
  const { data, product } = usePact(props.pactRef);
  const { run, interactive, viewerId } = useHostActions();
  if (!data) return <CardSkeleton lines={4} label="Loading pact" />;
  const { pact } = data;
  const committed = pact.members.filter(
    (m) => m.status === "committed" || m.status === "charged",
  ).length;
  const me = pact.members.find((m) => m.userId === viewerId);
  const myShare = me ? shareOf(data, me.userId) : undefined;
  const canCommit =
    interactive &&
    me?.status === "invited" &&
    (pact.state === "collecting" || pact.state === "draft");
  return (
    <GenCard
      icon={Handshake}
      title={pact.title}
      aside={<StateBadge state={pact.state} />}
      label={`Pact: ${pact.title}`}
    >
      <p className="-mt-1.5 mb-3.5 text-[13px] leading-5 text-muted-foreground">
        {conditionText(pact, product)}
      </p>
      <Well className="px-1">
        <ul>
          {pact.members.map((m) => {
            const share = shareOf(data, m.userId);
            const st = MEMBER_STATUS[m.status];
            return (
              <li
                key={m.userId}
                className="flex min-h-12 items-center gap-3 border-t border-dashed border-border px-3 py-2 first:border-t-0"
              >
                <Avatar name={m.displayName} id={m.userId} size={28} />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium">
                    {m.displayName}
                    {m.userId === viewerId && (
                      <span className="ml-1.5 text-xs font-normal text-muted-foreground">you</span>
                    )}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    cap <Amount value={m.cap} compact />
                  </div>
                </div>
                <div className="text-right">
                  <div className="text-sm font-medium">
                    {share ? <Amount value={share} /> : "—"}
                  </div>
                  <motion.div
                    key={m.status}
                    initial={{ opacity: 0, y: 3 }}
                    animate={{ opacity: 1, y: 0 }}
                    className={cn("flex items-center justify-end gap-1 text-xs", st.cls)}
                  >
                    {(m.status === "committed" || m.status === "charged") && (
                      <Check className="size-3" strokeWidth={2.6} />
                    )}
                    {st.label}
                  </motion.div>
                </div>
              </li>
            );
          })}
        </ul>
      </Well>
      <div className="mt-3.5 flex items-center gap-3">
        <div
          className="flex flex-1 gap-1"
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={pact.members.length}
          aria-valuenow={committed}
          aria-label="Members committed"
        >
          {pact.members.map((m, i) => (
            <span key={m.userId} className="h-1.5 flex-1 overflow-hidden rounded-full bg-surface-3">
              <motion.span
                className="block h-full rounded-full bg-success"
                initial={false}
                animate={{ width: i < committed ? "100%" : "0%" }}
                transition={{ duration: 0.5, ease: EASE_OUT, delay: i * 0.06 }}
              />
            </span>
          ))}
        </div>
        <span className="tabular shrink-0 text-xs text-muted-foreground">
          {committed}/{pact.members.length} committed
        </span>
      </div>
      {(data.total || canCommit) && (
        <div className="mt-4 flex items-center justify-between gap-3">
          {data.total ? (
            <div>
              <div className="text-xs text-muted-foreground">Total</div>
              <div className="text-base font-semibold">
                <Amount value={data.total} />
              </div>
            </div>
          ) : (
            <span />
          )}
          {canCommit && (
            <Button onClick={() => run("openCommit", { pactRef: props.pactRef })} className="px-5">
              Commit
              {myShare ? (
                <>
                  {" "}
                  · <Amount value={myShare} />
                </>
              ) : null}
            </Button>
          )}
        </div>
      )}
    </GenCard>
  );
}

function Sparkline({ points, target, id }: { points: number[]; target: number; id: string }) {
  const reduce = useReducedMotion();
  const w = 300;
  const h = 72;
  const min = Math.min(...points, target) * 0.985;
  const max = Math.max(...points, target) * 1.015;
  const x = (i: number) => (i / Math.max(1, points.length - 1)) * w;
  const y = (v: number) => h - ((v - min) / (max - min || 1)) * h;
  const d = points.map((v, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(" ");
  const area = `${d} L${w},${h} L0,${h} Z`;
  const last = points[points.length - 1] ?? 0;
  const below = last <= target;
  return (
    <div className="relative">
      <svg
        viewBox={`0 0 ${w} ${h}`}
        preserveAspectRatio="none"
        className="h-[72px] w-full overflow-visible"
        aria-hidden
      >
        <defs>
          <linearGradient id={`${id}-fill`} x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor="currentColor" stopOpacity="0.14" />
            <stop offset="100%" stopColor="currentColor" stopOpacity="0" />
          </linearGradient>
        </defs>
        <line
          x1="0"
          x2={w}
          y1={y(target)}
          y2={y(target)}
          stroke="var(--primary)"
          strokeDasharray="4 5"
          strokeWidth="1.25"
          vectorEffect="non-scaling-stroke"
          opacity="0.8"
        />
        <g className={below ? "text-success" : "text-foreground"}>
          <motion.path
            d={area}
            fill={`url(#${id}-fill)`}
            initial={reduce ? false : { opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.5, duration: 0.6 }}
          />
          <motion.path
            d={d}
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            vectorEffect="non-scaling-stroke"
            initial={reduce ? false : { pathLength: 0 }}
            animate={{ pathLength: 1 }}
            transition={{ duration: 0.9, ease: EASE_OUT }}
          />
        </g>
      </svg>
      {/* An HTML dot, so the non-uniform SVG scale can't stretch it into an ellipse. */}
      <motion.span
        aria-hidden
        className={cn(
          "absolute size-2 -translate-x-1/2 -translate-y-1/2 rounded-full ring-4",
          below ? "bg-success ring-success-soft" : "bg-foreground ring-fill-strong",
        )}
        style={{ left: "100%", top: `${(y(last) / h) * 100}%` }}
        initial={reduce ? false : { scale: 0 }}
        animate={{ scale: 1 }}
        transition={{ delay: 0.9, type: "spring", stiffness: 500, damping: 22 }}
      />
    </div>
  );
}

function MoneyTicker({ value }: { value: Money }) {
  return (
    <NumberTicker
      value={value.amountMinor}
      startOnView={false}
      format={(v) => formatMoney({ amountMinor: v, currency: value.currency })}
      className="tracking-tight"
    />
  );
}

export function PriceWatchView({ props }: R<PropsOf<"PriceWatch">>) {
  const { data, product } = usePact(props.pactRef);
  const gid = useId().replace(/:/g, "");
  if (!data || data.pact.trigger.kind !== "price" || !data.watch)
    return <CardSkeleton lines={3} label="Loading price watch" />;
  const { trigger } = data.pact;
  const { watch } = data;
  if (trigger.maxPrice.currency !== watch.current.currency)
    return <CardSkeleton lines={3} label="Loading price watch" />;
  const gap = watch.current.amountMinor - trigger.maxPrice.amountMinor;
  const hit = gap <= 0;
  const pts = watch.history.map((p) => p.price.amountMinor);
  return (
    <GenCard
      icon={LineChart}
      title={product ? product.title : "Price watch"}
      tone={hit ? "success" : "accent"}
      aside={
        <span className="flex shrink-0 items-center gap-1 text-xs text-muted-foreground">
          <Clock className="size-3.5" /> {relativeTime(trigger.deadline)}
        </span>
      }
    >
      <div className="flex items-end justify-between gap-4">
        <div>
          <div className="text-xs text-muted-foreground">Now</div>
          <div className={cn("text-[28px] font-semibold leading-9", hit && "text-success")}>
            <MoneyTicker value={watch.current} />
          </div>
        </div>
        <div className="text-right">
          <div className="flex items-center justify-end gap-1 text-xs text-muted-foreground">
            <Target className="size-3.5" /> Target
          </div>
          <div className="text-[17px] font-medium leading-7">
            <Amount value={trigger.maxPrice} />
          </div>
        </div>
      </div>
      <div className="mt-3">
        {pts.length > 1 && (
          <Sparkline points={pts} target={trigger.maxPrice.amountMinor} id={gid} />
        )}
      </div>
      <div className="mt-3 flex items-center justify-between text-xs">
        <span
          className={cn(
            "rounded-full px-2 py-1 font-medium",
            hit ? "bg-success-soft text-success-text" : "bg-surface-2 text-muted-foreground",
          )}
        >
          {hit ? (
            "Target hit"
          ) : (
            <>{formatMoney({ amountMinor: gap, currency: watch.current.currency })} above target</>
          )}
        </span>
        <span className="text-muted-foreground">Checked {relativeTime(watch.checkedAt)}</span>
      </div>
    </GenCard>
  );
}

/** Largest-remainder split of an integer total by weights, each capped. Sums to the total. */
export function splitByWeights(totalMinor: number, weights: number[]): number[] {
  const sum = weights.reduce((a, b) => a + b, 0) || 1;
  const raw = weights.map((w) => (totalMinor * w) / sum);
  const floors = raw.map(Math.floor);
  let rem = totalMinor - floors.reduce((a, b) => a + b, 0);
  const order = raw.map((r, i) => ({ i, f: r - Math.floor(r) })).sort((a, b) => b.f - a.f);
  for (const { i } of order) {
    if (rem <= 0) break;
    floors[i]! += 1;
    rem--;
  }
  return floors;
}

function WeightSlider({
  value,
  onChange,
  label,
}: {
  value: number;
  onChange: (v: number) => void;
  label: string;
}) {
  const mv = useMotionValue(value);
  useEffect(() => {
    const c = animate(mv, value, { type: "spring", stiffness: 700, damping: 50, mass: 0.5 });
    return c.stop;
  }, [value, mv]);
  const width = useTransform(mv, (v) => `${((v - 1) / 4) * 100}%`);
  return (
    <div className="relative flex h-6 flex-1 items-center">
      <div className="absolute inset-x-0 h-1.5 rounded-full bg-surface-3" />
      <motion.div className="absolute left-0 h-1.5 rounded-full bg-primary" style={{ width }} />
      <input
        type="range"
        min={1}
        max={5}
        step={1}
        value={value}
        aria-label={label}
        onChange={(e) => onChange(Number(e.target.value))}
        className="relative h-6 w-full cursor-pointer appearance-none bg-transparent [&::-moz-range-thumb]:size-4 [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:border-0 [&::-moz-range-thumb]:bg-background [&::-moz-range-thumb]:shadow-[0_0_0_1.5px_var(--primary)] [&::-webkit-slider-thumb]:size-4 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-background [&::-webkit-slider-thumb]:shadow-[0_0_0_1.5px_var(--primary)] [&::-webkit-slider-thumb]:transition-transform active:[&::-webkit-slider-thumb]:scale-110"
      />
    </div>
  );
}

export function SplitBreakdownView({ props }: R<PropsOf<"SplitBreakdown">>) {
  const { data } = usePact(props.pactRef);
  const { run, stageUiState, interactive } = useHostActions();
  const [mode, setMode] = useState<"equal" | "weights">("equal");
  const [weights, setWeights] = useState<Record<string, number>>({});
  const [dirty, setDirty] = useState(false);
  const layout = useId();
  const members = data?.pact.members ?? [];
  const total = data?.total;
  const preview = useMemo(() => {
    if (!total) return null;
    const ws = members.map((m) => (mode === "equal" ? 1 : (weights[m.userId] ?? 1)));
    return splitByWeights(total.amountMinor, ws);
  }, [members, total, mode, weights]);
  if (!data || !total || !preview) return <CardSkeleton lines={3} label="Loading split" />;
  const editable = props.editable && interactive;
  const overCap = members.some((m, i) => (preview[i] ?? 0) > m.cap.amountMinor);

  const update = (nextMode: typeof mode, nextWeights = weights) => {
    setMode(nextMode);
    setWeights(nextWeights);
    setDirty(true);
    stageUiState({
      split: {
        pactRef: props.pactRef,
        kind: nextMode,
        ...(nextMode === "weights"
          ? {
              weights: Object.fromEntries(
                members.map((m) => [m.userId, nextWeights[m.userId] ?? 1]),
              ),
            }
          : {}),
      },
    });
  };

  return (
    <GenCard
      icon={PieChart}
      title="Who pays what"
      tone="neutral"
      aside={
        editable ? (
          <div className="relative flex rounded-lg bg-fill p-0.5 text-xs font-medium">
            {(["equal", "weights"] as const).map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => update(m)}
                aria-pressed={mode === m}
                className={cn(
                  "relative h-6 rounded-md px-2.5 capitalize transition-colors",
                  mode === m ? "text-foreground" : "text-muted-foreground",
                )}
              >
                {mode === m && (
                  <motion.span
                    layoutId={`${layout}-seg`}
                    transition={SPRING_LAYOUT}
                    className="absolute inset-0 rounded-md bg-background shadow-[0_0_0_1px_var(--border)]"
                  />
                )}
                <span className="relative">{m === "equal" ? "Equal" : "By weight"}</span>
              </button>
            ))}
          </div>
        ) : null
      }
    >
      <ul className="space-y-3">
        {members.map((m, i) => {
          const amt = preview[i] ?? 0;
          const pct = Math.min(100, (amt / Math.max(1, m.cap.amountMinor)) * 100);
          const over = amt > m.cap.amountMinor;
          return (
            <li key={m.userId}>
              <div className="flex items-center gap-2.5">
                <Avatar name={m.displayName} id={m.userId} size={24} />
                <span className="min-w-0 flex-1 truncate text-sm">{m.displayName}</span>
                <span className={cn("tabular text-sm font-medium", over && "text-danger")}>
                  {formatMoney({ amountMinor: amt, currency: total.currency })}
                </span>
              </div>
              {mode === "weights" && editable ? (
                <div className="mt-1.5 flex items-center gap-3 pl-[34px]">
                  <WeightSlider
                    label={`${m.displayName} weight`}
                    value={weights[m.userId] ?? 1}
                    onChange={(v) => update("weights", { ...weights, [m.userId]: v })}
                  />
                  <span className="tabular w-6 text-right text-xs text-muted-foreground">
                    ×{weights[m.userId] ?? 1}
                  </span>
                </div>
              ) : (
                <div className="mt-1.5 ml-[34px] h-1.5 overflow-hidden rounded-full bg-surface-3">
                  <motion.div
                    className={cn("h-full rounded-full", over ? "bg-danger" : "bg-primary")}
                    initial={false}
                    animate={{ width: `${pct}%` }}
                    transition={{ type: "spring", stiffness: 360, damping: 32 }}
                  />
                </div>
              )}
              <div className="mt-1 pl-[34px] text-[11px] text-subtle-foreground">
                of <Amount value={m.cap} compact /> cap
              </div>
            </li>
          );
        })}
      </ul>
      {editable && dirty && (
        <motion.div
          initial={{ opacity: 0, y: 4 }}
          animate={{ opacity: 1, y: 0 }}
          className="mt-4 flex items-center justify-between gap-2"
        >
          <button
            type="button"
            onClick={() => {
              setMode("equal");
              setWeights({});
              setDirty(false);
              stageUiState({ split: null });
            }}
            className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
          >
            <RotateCcw className="size-3.5" /> Reset
          </button>
          <Button
            size="sm"
            disabled={overCap}
            onClick={() => run("issueTurn", { text: "Use this split" })}
          >
            {overCap ? "Over someone's cap" : "Use this split"}
          </Button>
        </motion.div>
      )}
    </GenCard>
  );
}

export function ScheduleCardView({ props }: R<PropsOf<"ScheduleCard">>) {
  const { data } = usePact(props.pactRef);
  const { viewerId } = useHostActions();
  if (!data || data.pact.trigger.kind !== "schedule")
    return <CardSkeleton lines={4} label="Loading schedule" />;
  const t = data.pact.trigger;
  const runs = data.nextRuns ?? [];
  const mine = shareOf(data, viewerId);
  return (
    <GenCard
      icon={CalendarClock}
      title={data.pact.title}
      aside={<StateBadge state={data.pact.state} />}
    >
      <p className="-mt-1.5 mb-3.5 text-[13px] text-muted-foreground">
        Every {t.everyDays} days{t.maxRuns ? ` · up to ${t.maxRuns} runs` : ""}
        {mine ? (
          <>
            {" "}
            · your share <Amount value={mine} />
          </>
        ) : null}
      </p>
      <Well className="px-1">
        <ol>
          {runs.slice(0, 4).map((at, i) => {
            const d = new Date(at);
            return (
              <motion.li
                key={at}
                initial={{ opacity: 0, x: -4 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: i * 0.05, duration: 0.3, ease: EASE_OUT }}
                className="flex min-h-12 items-center gap-3 border-t border-dashed border-border px-3 py-2 first:border-t-0"
              >
                <span
                  className={cn(
                    "flex size-9 shrink-0 flex-col items-center justify-center rounded-md leading-none",
                    i === 0 ? "bg-primary-soft text-primary" : "bg-fill text-muted-foreground",
                  )}
                >
                  <span className="font-mono text-[9px] uppercase">
                    {d.toLocaleDateString(undefined, { month: "short" })}
                  </span>
                  <span className="text-sm font-semibold">{d.getDate()}</span>
                </span>
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium">{i === 0 ? "Next run" : `Run ${i + 1}`}</div>
                  <div className="text-xs text-muted-foreground">{relativeTime(at)}</div>
                </div>
                {data.total && (
                  <span className="text-sm font-medium">
                    <Amount value={data.total} />
                  </span>
                )}
              </motion.li>
            );
          })}
        </ol>
      </Well>
    </GenCard>
  );
}
