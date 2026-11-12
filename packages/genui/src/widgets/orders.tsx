import type { Order } from "@shop/commerce/contract";
import { CheckCircle2, CircleSlash, Package, Receipt, RotateCcw, XCircle } from "lucide-react";
import { useState } from "react";
import { clock, useNow, useWidgetContext } from "../context";
import { formatMoney } from "../money";
import {
  CardHead,
  CountdownRing,
  MerchantChip,
  Pill,
  Price,
  Skeleton,
  Thumb,
  type Tone,
} from "../primitives";
import { PayPalMark } from "./products";
import type { ToolWidgetProps } from "./types";

const STATUS: Record<Order["status"], { label: string; tone: Tone }> = {
  coolingOff: { label: "Undo window", tone: "warn" },
  captured: { label: "Paid", tone: "good" },
  voided: { label: "Cancelled", tone: "neutral" },
  refunded: { label: "Refunded", tone: "neutral" },
  partiallyRefunded: { label: "Partly refunded", tone: "neutral" },
  failed: { label: "Failed", tone: "bad" },
};

export function OrderStatusPill({ status }: { status: Order["status"] }) {
  const s = STATUS[status];
  return (
    <Pill tone={s.tone} dot>
      {s.label}
    </Pill>
  );
}

export function useLiveOrder(order: Order): Order {
  const { state } = useWidgetContext();
  return state?.orders.find((o) => o.id === order.id) ?? order;
}

export function OrderCard({ order: initial }: { order: Order }) {
  const ctx = useWidgetContext();
  const o = useLiveOrder(initial);
  const cooling = o.status === "coolingOff";
  const now = useNow(cooling, 250);
  const [busy, setBusy] = useState<"order.cancel" | "order.captureNow" | null>(null);
  const [error, setError] = useState<string | null>(null);

  const ends = o.coolingOffEndsAt ? Date.parse(o.coolingOffEndsAt) : undefined;
  const start = Date.parse(o.createdAt);
  const total = ends !== undefined ? Math.max(1, (ends - start) / 1000) : 0;
  const remaining = ends !== undefined ? Math.max(0, (ends - now) / 1000) : 0;

  const act = async (name: "order.cancel" | "order.captureNow") => {
    setBusy(name);
    setError(null);
    try {
      await ctx.invoke(name, { orderId: o.id });
    } catch (e) {
      setError((e as Error)?.message || "That didn't go through. Nothing changed.");
    } finally {
      setBusy(null);
    }
  };

  return (
    <article
      className="genui g-card g-order"
      data-status={o.status}
      aria-label={`Order: ${o.offer.title}`}
    >
      <header className="g-order__head">
        <Thumb src={o.offer.imageUrl} alt="" size="md" />
        <div className="g-order__id">
          <span className="g-order__title">{o.offer.title}</span>
          <MerchantChip merchant={o.offer.merchant} />
        </div>
        <OrderStatusPill status={o.status} />
      </header>

      {cooling && (
        <section className="g-cool" aria-label="Undo window">
          <CountdownRing remaining={remaining} total={total} size={52}>
            <span className="g-tnum">{clock(remaining)}</span>
          </CountdownRing>
          <div className="g-cool__text">
            <strong>Authorized, not charged yet.</strong>
            <span className="g-muted">
              PayPal holds {formatMoney(o.total)}. Undo before the timer ends and no money moves.
            </span>
            {/* Announced once, not every tick. */}
            <span className="g-sr" aria-live="polite">
              {remaining <= 60 && remaining > 0 ? "Less than a minute left to undo." : ""}
            </span>
          </div>
          <div className="g-cool__actions">
            <button
              type="button"
              className="g-btn g-btn--danger"
              disabled={busy !== null || remaining <= 0}
              onClick={() => act("order.cancel")}
            >
              <RotateCcw aria-hidden className="g-ico" />
              {busy === "order.cancel" ? "Undoing…" : "Undo purchase"}
            </button>
            <button
              type="button"
              className="g-btn g-btn--ghost g-btn--sm"
              disabled={busy !== null || remaining <= 0}
              onClick={() => act("order.captureNow")}
            >
              {busy === "order.captureNow" ? "Paying…" : "Pay now"}
            </button>
          </div>
        </section>
      )}

      {o.status === "voided" && (
        <div className="g-callout" data-tone="neutral">
          <CircleSlash aria-hidden className="g-ico" />
          <div>
            <strong>Cancelled.</strong> The authorization was voided; no money moved.
          </div>
        </div>
      )}
      {o.status === "failed" && (
        <div className="g-callout" data-tone="bad" role="alert">
          <XCircle aria-hidden className="g-ico" />
          <div>
            <strong>Purchase failed.</strong> {o.failureReason ?? "PayPal declined it."} You were
            not charged.
          </div>
        </div>
      )}

      <dl className="g-receipt" data-final={o.status === "captured" ? "" : undefined}>
        {o.status === "captured" && (
          <div className="g-receipt__stamp">
            <CheckCircle2 aria-hidden className="g-ico" />
            Paid with <PayPalMark />
          </div>
        )}
        <div>
          <dt>Item</dt>
          <dd>
            <Price value={o.offer.price} size="sm" /> × {o.quantity}
          </dd>
        </div>
        {o.offer.shipping && (
          <div>
            <dt>Shipping</dt>
            <dd>
              {o.offer.shipping.amountMinor === 0 ? (
                "Free"
              ) : (
                <Price value={o.offer.shipping} size="sm" />
              )}
            </dd>
          </div>
        )}
        <div className="g-receipt__total">
          <dt>Total</dt>
          <dd>
            <Price value={o.total} size="md" />
          </dd>
        </div>
        <div>
          <dt>PayPal order</dt>
          <dd className="g-mono g-truncate">{o.paypal.orderId}</dd>
        </div>
        {o.paypal.captureId && (
          <div>
            <dt>Capture</dt>
            <dd className="g-mono g-truncate">{o.paypal.captureId}</dd>
          </div>
        )}
        {o.watchId && (
          <div>
            <dt>Placed by</dt>
            <dd>Your auto-buy rule</dd>
          </div>
        )}
      </dl>
      {error && (
        <p className="g-error" role="alert">
          {error}
        </p>
      )}
    </article>
  );
}

export function OrderRow({ order: initial, onSelect }: { order: Order; onSelect?: () => void }) {
  const o = useLiveOrder(initial);
  const now = useNow(o.status === "coolingOff", 1000);
  const ends = o.coolingOffEndsAt ? Date.parse(o.coolingOffEndsAt) : 0;
  const body = (
    <>
      <Thumb src={o.offer.imageUrl} alt="" size="sm" />
      <span className="g-watchrow__main">
        <span className="g-truncate g-watchrow__title">{o.offer.title}</span>
        <span className="g-watchrow__sub">
          <Price value={o.total} size="sm" />
          {o.status === "coolingOff" ? (
            <span className="g-warn g-tnum">undo {clock((ends - now) / 1000)}</span>
          ) : (
            <span className="g-muted">{STATUS[o.status].label}</span>
          )}
        </span>
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

function OrderSkeleton({ label }: { label: string }) {
  return (
    <section className="genui g-card g-order" aria-busy="true" aria-label={label}>
      <CardHead icon={<Package />} label={<span className="aui-shimmer">{label}</span>} />
      <div className="g-order__head">
        <Skeleton w={44} h={44} r={10} />
        <div className="g-stack-sm" style={{ flex: 1 }}>
          <Skeleton w="60%" h={14} />
          <Skeleton w="30%" />
        </div>
      </div>
      <Skeleton h={52} r={10} />
    </section>
  );
}

export function BuyOfferWidget({ item, result }: ToolWidgetProps<"buy_offer">) {
  if (!result) return <OrderSkeleton label={item.progress?.label ?? "Authorizing with PayPal"} />;
  return <OrderCard order={result.order} />;
}
export function CancelOrderWidget({ item, result }: ToolWidgetProps<"cancel_order">) {
  if (!result) return <OrderSkeleton label={item.progress?.label ?? "Voiding the authorization"} />;
  return <OrderCard order={result.order} />;
}
export function ListOrdersWidget({ item, result }: ToolWidgetProps<"list_orders">) {
  if (!result) return <OrderSkeleton label={item.progress?.label ?? "Loading your orders"} />;
  return (
    <section className="genui g-card g-list" aria-label="Your orders">
      <CardHead
        icon={<Receipt />}
        label={`${result.orders.length} ${result.orders.length === 1 ? "order" : "orders"}`}
      />
      {result.orders.length === 0 ? (
        <p className="g-empty">No orders yet.</p>
      ) : (
        <ul>
          {result.orders.map((o) => (
            <li key={o.id}>
              <OrderRow order={o} />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
