import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import type { Env } from "../src/env";
import { SHOP_PAGE_CSP, withShopPageHeaders } from "../src/security";
import { api, devLogin } from "./helpers/client";

const db = (env as unknown as Env).DB;
const now = () => new Date().toISOString();

describe("0011_shop migration", () => {
  it("links one Google sub to one user", async () => {
    const { userId } = await devLogin(`sp${crypto.randomUUID().slice(0, 8)}`);
    const insert = (sub: string) =>
      db
        .prepare(
          "INSERT INTO shop_oauth_accounts (provider, sub, user_id, email, created_at) VALUES ('google', ?, ?, NULL, ?)",
        )
        .bind(sub, userId, now())
        .run();
    await insert("sub-1");
    await expect(insert("sub-1")).rejects.toThrow(/UNIQUE|PRIMARY KEY/);
    // Unknown users are refused (foreign key).
    await expect(
      db
        .prepare(
          "INSERT INTO shop_oauth_accounts (provider, sub, user_id, created_at) VALUES ('google', 'sub-2', 'usr_missing', ?)",
        )
        .bind(now())
        .run(),
    ).rejects.toThrow(/FOREIGN KEY/);
  });

  it("indexes due watches and mirrors orders by PayPal id", async () => {
    const { userId } = await devLogin(`sp${crypto.randomUUID().slice(0, 8)}`);
    const past = new Date(Date.now() - 60_000).toISOString();
    const future = new Date(Date.now() + 3_600_000).toISOString();
    await db.batch([
      db
        .prepare(
          "INSERT INTO shop_watch_index (watch_id, user_id, next_check_at, status, updated_at) VALUES (?, ?, ?, 'active', ?)",
        )
        .bind(`w-due-${userId}`, userId, past, now()),
      db
        .prepare(
          "INSERT INTO shop_watch_index (watch_id, user_id, next_check_at, status, updated_at) VALUES (?, ?, ?, 'active', ?)",
        )
        .bind(`w-later-${userId}`, userId, future, now()),
    ]);
    const due = await db
      .prepare(
        "SELECT watch_id FROM shop_watch_index WHERE user_id = ? AND status = 'active' AND next_check_at <= ?",
      )
      .bind(userId, now())
      .all<{ watch_id: string }>();
    expect(due.results.map((r) => r.watch_id)).toEqual([`w-due-${userId}`]);

    const order = (id: string, paypalId: string, currency = "USD") =>
      db
        .prepare(
          "INSERT INTO shop_orders (id, user_id, paypal_order_id, status, total_minor, currency, created_at, updated_at) VALUES (?, ?, ?, 'coolingOff', 27900, ?, ?, ?)",
        )
        .bind(id, userId, paypalId, currency, now(), now())
        .run();
    await order(`o1-${userId}`, `PP-${userId}`);
    await expect(order(`o2-${userId}`, `PP-${userId}`)).rejects.toThrow(/UNIQUE/);
    await expect(order(`o3-${userId}`, `PP3-${userId}`, "DOLLARS")).rejects.toThrow(/CHECK/);
    const found = await db
      .prepare("SELECT user_id, total_minor FROM shop_orders WHERE paypal_order_id = ?")
      .bind(`PP-${userId}`)
      .first();
    expect(found).toEqual({ user_id: userId, total_minor: 27900 });
  });
});

describe("shop page CSP", () => {
  it("allows Live View frames and same-origin sockets, without wildcards", () => {
    expect(SHOP_PAGE_CSP).toContain("frame-src https://*.paypal.com https://live.browser.run");
    expect(SHOP_PAGE_CSP).toContain("connect-src 'self' https://*.paypal.com");
    expect(SHOP_PAGE_CSP).not.toMatch(/connect-src[^;]*\swss:/);
    expect(SHOP_PAGE_CSP).toContain("frame-ancestors 'none'");
    expect(SHOP_PAGE_CSP).not.toContain("'unsafe-eval'");
    const res = withShopPageHeaders(new Response("<!doctype html>", { headers: { "x-a": "1" } }));
    expect(res.headers.get("content-security-policy")).toBe(SHOP_PAGE_CSP);
    expect(res.headers.get("x-a")).toBe("1");
  });

  it("leaves the API policy strict", async () => {
    const res = await api("/api/health");
    expect(res.headers.get("content-security-policy")).toBe(
      "default-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'",
    );
  });
});
