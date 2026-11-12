import type { Money } from "@pact/protocol";
import type { Order, ShopState, Watch } from "./contract";

type WatchStatus = Watch["status"];
type OrderStatus = Order["status"];

/** What the apps home (/home) shows on the Shop tile: counts and the latest few, no history. */
export interface ShopSummary {
  watching: number;
  needsReview: number;
  coolingOff: number;
  orders: number;
  walletConnected: boolean;
  wallet?: string;
  recentWatches: { id: string; title: string; target: Money; last?: Money; status: WatchStatus }[];
  recentOrders: {
    id: string;
    title: string;
    total: Money;
    status: OrderStatus;
    coolingOffEndsAt?: string;
  }[];
}

const LATEST = 3;

/** Newest first by ISO timestamp (text order is time order). */
const newest = <T>(xs: readonly T[], at: (x: T) => string) =>
  [...xs].sort((a, b) => (at(a) < at(b) ? 1 : at(a) > at(b) ? -1 : 0)).slice(0, LATEST);

export function summarizeShop(state: ShopState): ShopSummary {
  const { watches, orders, wallet } = state;
  return {
    watching: watches.filter((w) => w.status === "active").length,
    needsReview: watches.filter((w) => w.status === "needsReview").length,
    coolingOff: orders.filter((o) => o.status === "coolingOff").length,
    orders: orders.length,
    walletConnected: wallet.connected,
    ...(wallet.connected && wallet.label ? { wallet: wallet.label } : {}),
    recentWatches: newest(watches, (w) => w.createdAt).map((w) => ({
      id: w.id,
      title: w.offer.title,
      target: w.targetPrice,
      ...(w.lastCheck?.price ? { last: w.lastCheck.price } : {}),
      status: w.status,
    })),
    recentOrders: newest(orders, (o) => o.createdAt).map((o) => ({
      id: o.id,
      title: o.offer.title,
      total: o.total,
      status: o.status,
      ...(o.coolingOffEndsAt ? { coolingOffEndsAt: o.coolingOffEndsAt } : {}),
    })),
  };
}
