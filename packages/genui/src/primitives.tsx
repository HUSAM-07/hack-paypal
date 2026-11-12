import type { Money } from "@shop/agent-protocol";
import type { Merchant, Source } from "@shop/commerce/contract";
import { ShoppingBag, Star } from "lucide-react";
import { type ReactNode, useId, useState } from "react";
import { cn } from "./aui/lib/utils";
import { domainOf } from "./context";
import { formatMoney, percentOff } from "./money";

/** Amount from `Money` only. `size` picks the display scale; `struck` is a was-price. */
export function Price({
  value,
  size = "md",
  struck = false,
  trim = false,
  className,
}: {
  value: Money;
  size?: "sm" | "md" | "lg" | "xl";
  struck?: boolean;
  trim?: boolean;
  className?: string;
}) {
  const text = formatMoney(value, { trimZeroCents: trim });
  return struck ? (
    <s className={cn("g-price", "g-price--struck", className)} data-size={size}>
      <span className="g-sr">was </span>
      {text}
    </s>
  ) : (
    <span className={cn("g-price", className)} data-size={size}>
      {text}
    </span>
  );
}

export function PriceStack({
  price,
  listPrice,
  size = "lg",
}: {
  price: Money;
  listPrice?: Money | undefined;
  size?: "md" | "lg" | "xl";
}) {
  const off = listPrice ? percentOff(price, listPrice) : undefined;
  return (
    <span className="g-pricestack">
      <Price value={price} size={size} />
      {listPrice && off !== undefined && (
        <>
          <Price value={listPrice} size="sm" struck />
          <span className="g-chip g-chip--good">−{off}%</span>
        </>
      )}
    </span>
  );
}

export type Tone = "neutral" | "accent" | "good" | "warn" | "bad" | "paypal";

export function Pill({
  tone = "neutral",
  children,
  dot = false,
  live = false,
}: {
  tone?: Tone;
  children: ReactNode;
  dot?: boolean;
  live?: boolean;
}) {
  return (
    <span className="g-pill" data-tone={tone}>
      {dot && <span className="g-pill__dot" data-live={live ? "" : undefined} aria-hidden />}
      {children}
    </span>
  );
}

/** Product image with a calm placeholder when it's missing or fails to load. */
export function Thumb({
  src,
  alt,
  size = "md",
}: {
  src?: string | undefined;
  alt: string;
  size?: "sm" | "md" | "lg" | "fill";
}) {
  const [failed, setFailed] = useState(false);
  return (
    <span className="g-thumb" data-size={size}>
      {src && !failed ? (
        <img
          src={src}
          alt={alt}
          loading="lazy"
          decoding="async"
          referrerPolicy="no-referrer"
          onError={() => setFailed(true)}
        />
      ) : (
        <ShoppingBag aria-hidden className="g-thumb__ph" />
      )}
    </span>
  );
}

/** Merchant name with a monogram tile (no third-party favicon requests). */
export function MerchantChip({ merchant }: { merchant: Merchant }) {
  return (
    <span className="g-merchant" title={merchant.domain}>
      <span className="g-merchant__mono" aria-hidden>
        {merchant.name.slice(0, 1).toUpperCase()}
      </span>
      <span className="g-truncate">{merchant.name}</span>
    </span>
  );
}

export function Stars({ value, count }: { value: number; count: number }) {
  return (
    <span className="g-stars" title={`${value.toFixed(1)} out of 5 from ${count} ratings`}>
      <Star aria-hidden className="g-stars__icon" />
      <span className="g-tnum">{value.toFixed(1)}</span>
      <span className="g-muted g-tnum">({count.toLocaleString()})</span>
      <span className="g-sr">
        {value.toFixed(1)} out of 5 stars from {count} ratings
      </span>
    </span>
  );
}

/** Numbered source chips. Titles come from the web: plain text only. */
export function SourceChips({ sources, label = "Sources" }: { sources: Source[]; label?: string }) {
  if (sources.length === 0) return null;
  return (
    <div className="g-sources">
      <span className="g-label">{label}</span>
      <ul className="g-sources__list">
        {sources.map((s) => (
          <li key={s.n}>
            <a
              className="g-source"
              href={s.url}
              target="_blank"
              rel="noopener noreferrer nofollow"
              title={s.title}
            >
              <span className="g-source__n g-tnum">{s.n}</span>
              <span className="g-truncate">{domainOf(s.url)}</span>
            </a>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function Skeleton({ w, h = 12, r }: { w?: number | string; h?: number; r?: number }) {
  return (
    <span
      className="g-skel"
      aria-hidden
      style={{ width: w ?? "100%", height: h, borderRadius: r ?? 6 }}
    />
  );
}

/** Small card section header: mono label left, extra content right. */
export function CardHead({
  icon,
  label,
  right,
}: {
  icon?: ReactNode;
  label: ReactNode;
  right?: ReactNode;
}) {
  return (
    <div className="g-cardhead">
      {icon && (
        <span className="g-cardhead__icon" aria-hidden>
          {icon}
        </span>
      )}
      <span className="g-label">{label}</span>
      {right && <span className="g-cardhead__right">{right}</span>}
    </div>
  );
}

/**
 * Price history line with a dashed target. Points are minor units; the y-range always includes
 * the target so "how far to go" reads at a glance.
 */
export function Sparkline({
  points,
  target,
  width = 240,
  height = 56,
  label,
}: {
  points: number[];
  target?: number | undefined;
  width?: number;
  height?: number;
  label: string;
}) {
  const id = useId();
  const pad = 4;
  const all = target === undefined ? points : [...points, target];
  if (points.length === 0) return <span className="g-spark g-spark--empty" aria-hidden />;
  const min = Math.min(...all);
  const max = Math.max(...all);
  const span = max - min || 1;
  const x = (i: number) =>
    points.length === 1 ? width / 2 : pad + (i * (width - pad * 2)) / (points.length - 1);
  const y = (v: number) => pad + (1 - (v - min) / span) * (height - pad * 2);
  const d = points.map((v, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join("");
  const last = points[points.length - 1] ?? 0;
  const area = `${d}L${x(points.length - 1).toFixed(1)},${height}L${x(0).toFixed(1)},${height}Z`;
  const hit = target !== undefined && last <= target;
  return (
    <svg
      className="g-spark"
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="none"
      role="img"
      aria-label={label}
      data-hit={hit ? "" : undefined}
    >
      <title>{label}</title>
      <defs>
        <linearGradient id={`${id}-fill`} x1="0" x2="0" y1="0" y2="1">
          <stop offset="0" stopColor="currentColor" stopOpacity="0.18" />
          <stop offset="1" stopColor="currentColor" stopOpacity="0" />
        </linearGradient>
      </defs>
      {target !== undefined && (
        <line
          className="g-spark__target"
          x1={0}
          x2={width}
          y1={y(target)}
          y2={y(target)}
          vectorEffect="non-scaling-stroke"
        />
      )}
      <path d={area} fill={`url(#${id}-fill)`} stroke="none" />
      <path className="g-spark__line" d={d} vectorEffect="non-scaling-stroke" />
      <circle
        className="g-spark__dot"
        cx={x(points.length - 1)}
        cy={y(last)}
        r={2.75}
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}

/** Circular countdown: the ring empties as `remaining` approaches 0. */
export function CountdownRing({
  remaining,
  total,
  size = 44,
  children,
}: {
  remaining: number;
  total: number;
  size?: number;
  children?: ReactNode;
}) {
  const r = (size - 5) / 2;
  const c = 2 * Math.PI * r;
  const frac = total > 0 ? Math.max(0, Math.min(1, remaining / total)) : 0;
  return (
    <span className="g-ring" style={{ width: size, height: size }}>
      <svg viewBox={`0 0 ${size} ${size}`} aria-hidden>
        <circle className="g-ring__track" cx={size / 2} cy={size / 2} r={r} />
        <circle
          className="g-ring__bar"
          cx={size / 2}
          cy={size / 2}
          r={r}
          strokeDasharray={c}
          strokeDashoffset={c * (1 - frac)}
        />
      </svg>
      <span className="g-ring__label">{children}</span>
    </span>
  );
}
