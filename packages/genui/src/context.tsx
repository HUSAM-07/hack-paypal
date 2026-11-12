import type { ShopActionName, ShopState } from "@shop/commerce/contract";
import { createContext, useContext, useEffect, useState } from "react";

/**
 * What a widget may do and read. The host (an app speaking the agent protocol) supplies it;
 * widgets never talk to the network themselves.
 */
export type WidgetContext = {
  /** Run a product action without a chat turn (`action/invoke`). Rejects on server error. */
  invoke: (name: ShopActionName | (string & {}), args?: unknown) => Promise<unknown>;
  /** Answer an approval (`approval/request` response or `approval/respond`). */
  respondApproval: (
    approvalId: string,
    decision: "approve" | "deny",
    extra?: { edits?: Record<string, unknown>; assertion?: unknown },
  ) => Promise<void>;
  /** Send a chat message on the user's behalf (a widget button like "Watch price"). */
  sendMessage?: (text: string, uiState?: Record<string, unknown>) => void;
  /** Show a live browser session in the host's browser pane. */
  openBrowser?: (sessionId: string) => void;
  /**
   * Latest product state. Widgets prefer it over the (older) tool result for live fields:
   * a watch's status and price, an order's cooling-off window.
   */
  state?: ShopState | undefined;
  /** Passkey step-up for approvals that ask for it; resolves to the WebAuthn assertion JSON. */
  stepUp?: () => Promise<unknown>;
  /** Real PayPal JS SDK (v6) for wallet vaulting. Without it a stand-in walks the same actions. */
  paypal?: { clientToken: () => Promise<string>; environment?: "sandbox" | "production" };
  locale?: string;
};

const noop = async () => undefined;

export const defaultWidgetContext: WidgetContext = {
  invoke: noop,
  respondApproval: async () => {},
};

const Ctx = createContext<WidgetContext>(defaultWidgetContext);

export const WidgetProvider = Ctx.Provider;

export function useWidgetContext(): WidgetContext {
  return useContext(Ctx);
}

/** A clock that ticks every `ms` while `active`. Shared by countdowns so they agree. */
export function useNow(active = true, ms = 1000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(id);
  }, [active, ms]);
  return now;
}

/** "in 4m", "2h ago", "just now". */
export function relativeTime(iso: string | undefined, now: number): string {
  if (!iso) return "";
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return "";
  const s = Math.round((t - now) / 1000);
  const abs = Math.abs(s);
  const unit =
    abs < 45
      ? null
      : abs < 3600
        ? `${Math.round(abs / 60)}m`
        : abs < 86400
          ? `${Math.round(abs / 3600)}h`
          : `${Math.round(abs / 86400)}d`;
  if (!unit) return s >= 0 ? "in a moment" : "just now";
  return s >= 0 ? `in ${unit}` : `${unit} ago`;
}

/** mm:ss for countdowns. */
export function clock(totalSeconds: number): string {
  const s = Math.max(0, Math.ceil(totalSeconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = String(s % 60).padStart(2, "0");
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${sec}` : `${m}:${sec}`;
}

/** Hostname without "www.", for chips; the raw string when it isn't a URL. */
export function domainOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}
