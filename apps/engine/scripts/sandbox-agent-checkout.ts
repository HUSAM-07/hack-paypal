/**
 * Real PayPal sandbox proof of the agent checkout (issue #84), through the engine's own code.
 *
 *   CITED_BUYER_VAULT_FILE=path/to/vault.json npx tsx apps/engine/scripts/sandbox-agent-checkout.ts path/to/.env
 *
 * The env file needs PAYPAL_CLIENT_ID, PAYPAL_CLIENT_SECRET and PAYPAL_SANDBOX_MERCHANT_EMAIL
 * (the sellers' payee). The vault file is JSON with `vault_id`: the buyer's vaulted PayPal wallet
 * (AGENT-CHECKOUT.md, step 1). Prints PayPal ids and statuses only: never credentials, vault
 * ids, payer ids or emails.
 *
 * What runs where:
 * - Real sandbox: the agent's Orders v2 orders (seller as payee, signed passport in `custom_id`,
 *   `items[].upc`, the vaulted wallet), their captures, the seller's refund (Agent Toolkit
 *   `create_refund`), the brand's deposit, the order read-backs and the creator's Payouts batch.
 * - PayPal delivers the real webhooks to the hosted subscription, which verifies their signature
 *   and records them at /api/cited/api/webhook-proof. The script waits for those records.
 * - The engine runs here, in process, in `PAYPAL_MODE=sandbox` on a fresh local D1. PayPal
 *   cannot reach it, so each event is replayed to its `/webhooks/paypal`: the body is the event
 *   as PayPal's events API returns it, re-signed with a throwaway local cert that this process
 *   serves at a sandbox-shaped cert URL. Everything after the signature check is the real code.
 *
 * The sandbox has one personal account, so the buyer who pays is also the creator's payout
 * receiver. The engine's abuse guard sees that (self_purchase) and holds the credit; the script
 * releases the hold through `POST /api/review-flags/:id/release`, as a reviewer would, so the
 * payout goes out. Amounts are small ($2.00 sales, $0.16 commission).
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createPayPal } from "@pact/paypal";
import { UPC_LEVOIT_CORE300, UPC_WINIX_A230, verifyPassport } from "@pact/protocol";
import { getPlatformProxy } from "wrangler";
import { createCatalogue } from "../../catalogue-mcp/src/catalogue";
import { checkout } from "../../catalogue-mcp/src/checkout";
import { offerIdFor } from "../../catalogue-mcp/src/offers";
import {
  SELLER_IDS,
  type Seller,
  type SellerId,
  sellersFromEnv,
} from "../../catalogue-mcp/src/sellers";
import type { Env } from "../src/env";
import { app } from "../src/index";

const ROOT = resolve(import.meta.dirname, "../../..");
const HOSTED = (
  process.env.CITED_HOSTED_URL ?? "https://pact-worker.vincent-wesley-liem.workers.dev"
).replace(/\/$/, "");
/** The hosted subscription PayPal signs our events for. */
const WEBHOOK_ID = process.env.CITED_WEBHOOK_ID ?? "8042373202922840X";
const PRICE_MINOR = 200;
const EXPOSED_BUYERS = 3;
const PLACEBO_SESSIONS = 8;
const MODEL = "scripted";
const API = "https://api-m.sandbox.paypal.com";
const REPLAY_CERT_URL = `${API}/v1/notifications/certs/CERT-cited-local-replay`;

// ───────────────────────── inputs ─────────────────────────

const envFile = process.argv[2];
const vaultFile = process.env.CITED_BUYER_VAULT_FILE;
if (!envFile || !vaultFile) {
  throw new Error(
    "usage: CITED_BUYER_VAULT_FILE=<vault.json> sandbox-agent-checkout.ts <env file>",
  );
}
const vars = new Map<string, string>();
for (const line of readFileSync(envFile, "utf8").split("\n")) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/);
  // A value may carry a note after a space: the first token is the value.
  if (m?.[1] && m[2] !== undefined) {
    vars.set(m[1], m[2].replace(/^["']|["']$/g, "").split(/\s+/)[0] ?? "");
  }
}
const need = (k: string) => {
  const v = vars.get(k);
  if (!v) throw new Error(`${k} missing from the env file`);
  return v;
};
const vaultId = (JSON.parse(readFileSync(vaultFile, "utf8")) as { vault_id?: string }).vault_id;
if (!vaultId) throw new Error("the vault file has no vault_id");

const clientId = need("PAYPAL_CLIENT_ID");
const clientSecret = need("PAYPAL_CLIENT_SECRET");
const payeeEmail = need("PAYPAL_SANDBOX_MERCHANT_EMAIL");
const paypal = createPayPal({ clientId, clientSecret, env: "sandbox" });

const evidence: Record<string, unknown> = { startedAt: new Date().toISOString() };
const log = (step: string, data: unknown) =>
  console.log(`\n# ${step}\n${JSON.stringify(data, null, 2)}`);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ───────────────────────── raw PayPal reads ─────────────────────────

let token: string | undefined;
async function pp(path: string): Promise<Record<string, unknown>> {
  if (!token) {
    const res = await fetch(`${API}/v1/oauth2/token`, {
      method: "POST",
      headers: { Authorization: `Basic ${btoa(`${clientId}:${clientSecret}`)}` },
      body: "grant_type=client_credentials",
    });
    token = ((await res.json()) as { access_token: string }).access_token;
  }
  const res = await fetch(`${API}${path}`, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) throw new Error(`GET ${path.split("?")[0]}: ${res.status}`);
  return (await res.json()) as Record<string, unknown>;
}

type PayPalEvent = {
  id: string;
  event_type: string;
  create_time: string;
  resource: Record<string, unknown>;
};

/** The event PayPal created for this resource, from PayPal's events API. */
async function paypalEvent(type: string, resourceId: string): Promise<PayPalEvent> {
  for (let i = 0; i < 40; i++) {
    const q = new URLSearchParams({ event_type: type, page_size: "50" });
    const page = (await pp(`/v1/notifications/webhooks-events?${q}`)) as { events?: PayPalEvent[] };
    const hit = page.events?.find(
      (e) =>
        e.resource?.id === resourceId ||
        (e.resource?.batch_header as { payout_batch_id?: string } | undefined)?.payout_batch_id ===
          resourceId,
    );
    if (hit) return hit;
    await sleep(5000);
  }
  throw new Error(`no ${type} event for ${resourceId}`);
}

type Proof = {
  eventId: string;
  eventType: string;
  signedFor: string;
  verified: boolean;
  transmissionId: string;
  resourceId: string | null;
};

/** The hosted engine's record of PayPal delivering that event, signature verified. */
async function hostedProof(
  eventId: string,
  tries = 6,
  match?: { eventType: string; resourceId: string },
): Promise<Proof | null> {
  for (let i = 0; i < tries; i++) {
    const res = await fetch(`${HOSTED}/api/cited/api/webhook-proof`);
    if (res.ok) {
      const body = (await res.json()) as { proofs?: Proof[] } | Proof[];
      const rows = Array.isArray(body) ? body : (body.proofs ?? []);
      const hit = rows.find(
        (p) =>
          p.verified &&
          (p.eventId === eventId ||
            (match && p.eventType === match.eventType && p.resourceId === match.resourceId)),
      );
      if (hit) return hit;
    }
    await sleep(5000);
  }
  return null;
}

// ───────────────────────── the local replay signer ─────────────────────────

const dir = mkdtempSync(join(tmpdir(), "cited-sandbox-"));
execFileSync(
  "openssl",
  [
    "req",
    "-x509",
    "-newkey",
    "rsa:2048",
    "-nodes",
    "-days",
    "2",
    "-subj",
    "/CN=cited-local-replay",
    "-keyout",
    join(dir, "key.pem"),
    "-out",
    join(dir, "cert.pem"),
  ],
  { stdio: "ignore" },
);
const certPem = readFileSync(join(dir, "cert.pem"), "utf8");
const keyDer = Buffer.from(
  readFileSync(join(dir, "key.pem"), "utf8").replace(/-----[^-]+-----|\s/g, ""),
  "base64",
);
const signKey = await crypto.subtle.importKey(
  "pkcs8",
  keyDer,
  { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
  false,
  ["sign"],
);

// Serve the replay cert at its URL; every other request goes out untouched.
const realFetch = globalThis.fetch;
globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  if (url === REPLAY_CERT_URL) return Promise.resolve(new Response(certPem, { status: 200 }));
  return realFetch(input, init);
}) as typeof fetch;

const CRC = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
const crc32 = (b: Uint8Array) => {
  let c = 0xffffffff;
  for (const x of b) c = (CRC[(c ^ x) & 0xff] as number) ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};

// ───────────────────────── the engine, in process ─────────────────────────

execFileSync(
  "npx",
  [
    "wrangler",
    "d1",
    "migrations",
    "apply",
    "cited",
    "--local",
    "--persist-to",
    dir,
    "-c",
    "apps/engine/wrangler.jsonc",
  ],
  { cwd: ROOT, stdio: "ignore" },
);
const proxy = await getPlatformProxy<{ DB: D1Database }>({
  configPath: join(ROOT, "apps/engine/wrangler.jsonc"),
  persist: { path: join(dir, "v3") },
});
const passportKey = crypto.randomUUID();
const engineEnv: Env = {
  DB: proxy.env.DB,
  PAYPAL_MODE: "sandbox",
  MODEL_PROVIDER: "fake",
  PASSPORT_KEY: passportKey,
  PAYPAL_WEBHOOK_ID: WEBHOOK_ID,
  PAYPAL_CLIENT_ID: clientId,
  PAYPAL_CLIENT_SECRET: clientSecret,
  ENGINE_OPEN_API: "1",
};

async function engine<T = Record<string, unknown>>(
  method: string,
  path: string,
  body?: unknown,
): Promise<T> {
  const res = await app.fetch(
    new Request(`http://engine.local${path}`, {
      method,
      headers: { "content-type": "application/json" },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    }),
    engineEnv,
  );
  const out = (await res.json()) as T;
  if (res.status >= 400) throw new Error(`${method} ${path}: ${res.status} ${JSON.stringify(out)}`);
  return out;
}

/** Replays a PayPal event to the engine's webhook route, signed as PayPal signs. */
async function replay(event: PayPalEvent) {
  const raw = JSON.stringify(event);
  const transmissionId = crypto.randomUUID();
  const transmissionTime = new Date().toISOString();
  const message = `${transmissionId}|${transmissionTime}|${WEBHOOK_ID}|${crc32(new TextEncoder().encode(raw))}`;
  const sig = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    signKey,
    new TextEncoder().encode(message),
  );
  const res = await app.fetch(
    new Request("http://engine.local/webhooks/paypal", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "paypal-auth-algo": "SHA256withRSA",
        "paypal-cert-url": REPLAY_CERT_URL,
        "paypal-transmission-id": transmissionId,
        "paypal-transmission-sig": Buffer.from(sig).toString("base64"),
        "paypal-transmission-time": transmissionTime,
      },
      body: raw,
    }),
    engineEnv,
  );
  const out = await res.json();
  if (res.status >= 400)
    throw new Error(`webhook ${event.event_type}: ${res.status} ${JSON.stringify(out)}`);
  return out;
}

/** Wait for PayPal's event, the hosted proof of its delivery, then replay it to the engine. */
async function deliver(type: string, resourceId: string) {
  const event = await paypalEvent(type, resourceId);
  const proof = await hostedProof(event.id, 6, { eventType: type, resourceId });
  const engineReply = await replay(event);
  return {
    eventType: type,
    eventId: event.id,
    resourceId,
    hostedProof: proof
      ? {
          verified: proof.verified,
          signedFor: proof.signedFor,
          transmissionId: proof.transmissionId,
        }
      : null,
    engineReply,
  };
}

try {
  // ───────────── setup: brand, creator, sellers, a small deposit ─────────────
  const usd = (amountMinor: number) => ({ amountMinor, currency: "USD" });
  const base = sellersFromEnv({});
  const sellers = {} as Record<SellerId, Seller>;
  for (const id of SELLER_IDS) {
    sellers[id] = {
      ...base[id],
      payee: { email_address: payeeEmail },
      prices: { [UPC_WINIX_A230]: usd(PRICE_MINOR), [UPC_LEVOIT_CORE300]: usd(PRICE_MINOR) },
    };
  }
  const catalogue = createCatalogue({ seed: `sandbox-${Date.now()}`, passportKey, sellers });

  await engine("POST", "/api/brands", {
    brandId: "winix",
    name: "Winix",
    category: "air-purifiers",
    upc: UPC_WINIX_A230,
  });
  await engine("POST", "/api/brands", {
    brandId: "levoit",
    name: "Levoit",
    category: "air-purifiers",
    upc: UPC_LEVOIT_CORE300,
  });
  // No payout receiver yet: it is linked after the sales, before the payout (see the header).
  await engine("POST", "/api/creators", { creatorId: "housefresh", name: "HouseFresh" });
  await engine("POST", "/api/listings", {
    listings: SELLER_IDS.flatMap((shopId) =>
      [UPC_WINIX_A230, UPC_LEVOIT_CORE300].map((upc) => ({
        shopId,
        upc,
        priceMinor: PRICE_MINOR,
        currency: "USD",
      })),
    ),
  });

  // The brand's deposit. The engine's own deposit order waits for the brand to approve at
  // PayPal; a headless run pays the same order shape from the vaulted sandbox wallet instead and
  // records it the way captureDeposit does.
  const dep = await paypal.orders.create(
    {
      intent: "CAPTURE",
      purchase_units: [
        {
          amount: usd(100),
          payee: { email_address: payeeEmail },
          reference_id: "cited-dep-winix",
          custom_id: "cited-dep:winix",
          description: "CITED air-purifiers programme deposit",
        },
      ],
      payment_source: { paypal: { vault_id: vaultId } },
    } as Parameters<typeof paypal.orders.create>[0],
    { requestId: `cited-sbx-dep-${evidence.startedAt}` },
  );
  const depCapture = dep.purchase_units?.[0]?.payments?.captures?.[0];
  if (!depCapture?.id || depCapture.status !== "COMPLETED")
    throw new Error("deposit did not capture");
  await engineEnv.DB.prepare(
    `INSERT INTO deposits (id, brand_id, category, kind, idem_key, order_id, capture_id, amount_minor,
       currency, status, created_at) VALUES ('dep_winix_initial', 'winix', 'air-purifiers', 'initial',
       'initial', ?, ?, 100, 'USD', 'captured', ?)`,
  )
    .bind(dep.id, depCapture.id, new Date().toISOString())
    .run();
  evidence.deposit = { orderId: dep.id, captureId: depCapture.id, amount: "1.00 USD" };
  log("deposit (real sandbox)", evidence.deposit);

  // ───────────── agent sessions ─────────────
  const sessions: { sessionId: string; arm: string; passport: string }[] = [];
  let exposed = 0;
  let placebo = 0;
  for (let i = 0; i < 400 && (exposed < EXPOSED_BUYERS || placebo < PLACEBO_SESSIONS); i++) {
    const r = await catalogue.search({ query: "air purifier for a bedroom" });
    const v = await verifyPassport(r.passport, passportKey);
    if (!v.ok) throw new Error("catalogue passport did not verify");
    const arm = v.body.arm;
    if (arm === "test" && exposed >= EXPOSED_BUYERS) continue;
    if (arm === "placebo" && placebo >= PLACEBO_SESSIONS) continue;
    if (arm === "test") exposed++;
    if (arm === "placebo") placebo++;
    sessions.push({ sessionId: v.body.sessionId, arm, passport: r.passport });
  }

  const sales: Record<string, unknown>[] = [];
  for (const s of sessions) {
    let passport = s.passport;
    if (s.arm === "test") {
      // The scripted agent reads Lumen's offer for the Winix the creator's test recommends.
      passport = (await catalogue.search({ query: "winix a230", passport, sellerId: "lumen" }))
        .passport;
    }
    const v = await verifyPassport(passport, passportKey);
    if (!v.ok) throw new Error("passport");
    await engine("POST", "/api/sessions", {
      sessionId: s.sessionId,
      model: MODEL,
      arm: s.arm,
      category: "air-purifiers",
      creatorsSeen: v.body.creatorsSeen,
      storesViewed: v.body.storesViewed,
    });
    if (s.arm !== "test") continue;
    const out = await checkout(
      { catalogue, paypal, buyerVaultId: vaultId },
      { offerId: offerIdFor("lumen", UPC_WINIX_A230), passport },
    );
    sales.push({
      sessionId: s.sessionId,
      orderId: out.orderId,
      captureId: out.captureId,
      status: out.status,
      seller: out.seller.id,
      upc: out.upc,
      total: `${(out.total.amountMinor / 100).toFixed(2)} ${out.total.currency}`,
      customIdChars: out.customId?.length ?? 0,
    });
  }
  evidence.sessions = {
    test: exposed,
    placebo,
    none: sessions.length - exposed - placebo,
    model: MODEL,
  };
  evidence.sales = sales;
  log("agent checkouts (real sandbox orders, vaulted wallet)", evidence.sales);

  // Read one order back from PayPal: payee, custom_id and UPC are what PayPal holds.
  const first = sales[0] as { orderId: string; captureId: string };
  const order = (await pp(`/v2/checkout/orders/${first.orderId}`)) as {
    purchase_units: {
      custom_id?: string;
      reference_id?: string;
      items?: { upc?: unknown }[];
      payee?: unknown;
    }[];
  };
  const pu = order.purchase_units[0];
  const readBack = await verifyPassport(pu?.custom_id ?? "", passportKey);
  evidence.readBack = {
    orderId: first.orderId,
    referenceId: pu?.reference_id,
    customIdVerifies: readBack.ok,
    upc: pu?.items?.[0]?.upc,
    payeeSet: Boolean(pu?.payee),
  };
  log("order read back from PayPal", evidence.readBack);

  // ───────────── captures reach the engine ─────────────
  const captureEvents = [];
  for (const s of sales as { captureId: string }[]) {
    captureEvents.push(await deliver("PAYMENT.CAPTURE.COMPLETED", s.captureId));
  }
  evidence.captureEvents = captureEvents;
  log("PAYMENT.CAPTURE.COMPLETED: hosted proof + engine replay", captureEvents);

  const recompute = await engine("POST", "/api/credits/recompute");
  type CreditRow = {
    id: string;
    captureId: string;
    state: string;
    amountMinor: number;
    voidReason: string | null;
    payoutBatchId: string | null;
  };
  const creditsOf = async () =>
    (
      await engine<{ creators: { creatorId: string; credits: CreditRow[] }[] }>(
        "GET",
        "/api/credits",
      )
    ).creators.find((c) => c.creatorId === "housefresh")?.credits ?? [];
  const credited = await creditsOf();
  evidence.recompute = {
    summary: recompute,
    credits: credited.map((c) => ({
      captureId: c.captureId,
      state: c.state,
      amountMinor: c.amountMinor,
      voidReason: c.voidReason,
      payoutBatchId: c.payoutBatchId,
    })),
  };
  log("engine credits after recompute", evidence.recompute);
  if (credited.length < 2) throw new Error("expected at least two credited sales");

  // ───────────── a return: the seller refunds one credited sale ─────────────
  const refunded = credited[0] as CreditRow;
  const refund = await paypal.agentToolkit.createRefund(
    refunded.captureId,
    {},
    {
      requestId: `cited-refund-${refunded.captureId}-full`,
    },
  );
  const refundEvent = await deliver("PAYMENT.CAPTURE.REFUNDED", refund.id);
  const afterRefund = await creditsOf();
  evidence.refund = {
    captureId: refunded.captureId,
    refundId: refund.id,
    status: refund.status,
    event: refundEvent,
    creditStatus: afterRefund.find((c) => c.id === refunded.id)?.state,
  };
  log("refund (Agent Toolkit create_refund) + PAYMENT.CAPTURE.REFUNDED", evidence.refund);

  // ───────────── day 31: payout ─────────────
  const buyer = (await pp(`/v2/checkout/orders/${first.orderId}`)) as {
    payer?: { payer_id?: string };
  };
  if (!buyer.payer?.payer_id) throw new Error("order has no payer id");
  await engine("POST", "/api/creators", {
    creatorId: "housefresh",
    name: "HouseFresh",
    paypalId: buyer.payer.payer_id,
  });
  const day31 = await engine<{ payout: { status: string } }>("POST", "/api/clock/advance", {
    days: 31,
  });
  const flags = (
    await engine<{ flags: { id: string; reason: string; status: string; hold: boolean }[] }>(
      "GET",
      "/api/review-flags",
    )
  ).flags.filter((f) => f.hold && f.status === "open");
  for (const f of flags) await engine("POST", `/api/review-flags/${f.id}/release`);
  let run = await engine<Record<string, unknown>>("POST", "/api/payouts/run");
  for (let i = 0; i < 12 && ["PENDING", "PROCESSING"].includes(String(run.batchStatus)); i++) {
    await sleep(5000);
    await engine("POST", "/api/payouts/refresh");
    const p = await engine<{ batches?: { paypalBatchId?: string; status?: string }[] }>(
      "GET",
      "/api/payouts",
    );
    const b = p.batches?.find((x) => x.paypalBatchId === run.paypalBatchId);
    if (b?.status) run = { ...run, batchStatus: b.status };
  }
  const batch = run.paypalBatchId
    ? ((await pp(`/v1/payments/payouts/${run.paypalBatchId}`)) as {
        batch_header: {
          batch_status: string;
          sender_batch_header: { sender_batch_id: string };
          amount?: unknown;
        };
        items: {
          payout_item_id: string;
          transaction_id?: string;
          transaction_status: string;
          payout_item: { amount: unknown; recipient_type: string };
        }[];
      })
    : undefined;
  const finalCredits = await creditsOf();
  evidence.payout = {
    day31Run: day31.payout.status,
    guardHolds: flags.map((f) => f.reason),
    released: flags.length,
    senderBatchId: run.senderBatchId,
    payoutBatchId: run.paypalBatchId,
    batchStatus: batch?.batch_header.batch_status,
    items: batch?.items.map((i) => ({
      payoutItemId: i.payout_item_id,
      transactionId: i.transaction_id,
      status: i.transaction_status,
      amount: i.payout_item.amount,
      recipientType: i.payout_item.recipient_type,
    })),
    credits: finalCredits.map((c) => ({
      captureId: c.captureId,
      state: c.state,
      amountMinor: c.amountMinor,
      voidReason: c.voidReason,
      payoutBatchId: c.payoutBatchId,
    })),
  };
  log("payout (real sandbox batch)", evidence.payout);
  if (batch?.batch_header.batch_status) {
    try {
      const ev = await paypalEvent(
        `PAYMENT.PAYOUTSBATCH.${batch.batch_header.batch_status}`,
        String(run.paypalBatchId),
      );
      const proof = await hostedProof(ev.id);
      evidence.payoutEvent = {
        eventId: ev.id,
        hostedProof: proof && { signedFor: proof.signedFor, transmissionId: proof.transmissionId },
      };
      log("payout webhook", evidence.payoutEvent);
    } catch (e) {
      log("payout webhook", { note: (e as Error).message });
    }
  }
  // PayPal retries a delivery the hosted site missed; give late proofs up to five minutes.
  const delivered = [
    ...(evidence.captureEvents as { eventId: string; hostedProof: unknown }[]),
    (evidence.refund as { event: { eventId: string; hostedProof: unknown } }).event,
  ];
  for (const d of delivered as {
    eventId: string;
    eventType: string;
    resourceId: string;
    hostedProof: unknown;
  }[]) {
    if (d.hostedProof) continue;
    const p = await hostedProof(d.eventId, 60, d);
    d.hostedProof = p
      ? { verified: p.verified, signedFor: p.signedFor, transmissionId: p.transmissionId }
      : "not recorded within 5 minutes";
  }
  log("hosted webhook proofs (PayPal's own deliveries, signature verified)", delivered);
} finally {
  globalThis.fetch = realFetch;
  await proxy.dispose();
  rmSync(dir, { recursive: true, force: true });
}
