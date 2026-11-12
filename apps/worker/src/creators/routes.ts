/**
 * /creators: creator onboarding. Log in with PayPal gives the creator's payer id (their Payouts
 * `PAYPAL_ID`); the form publishes a VerifiedTest and its placebo through the engine's write API.
 * The page never sees the CITED token: the post goes to this worker, which checks the origin,
 * a session-bound form token and a per-IP limit, then writes server-side (internal caller).
 */
import { PRODUCTS } from "@cited/catalogue-mcp";
import { parseVenmoReceiver } from "@cited/engine/payout-method";
import { VerifiedTest } from "@pact/protocol";
import { type Context, Hono } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import { CITED_PREFIX, internalEngineFetch } from "../cited";
import { DEMO_PAGE_CSP } from "../cited-apps";
import type { Env } from "../env";
import { clientIp } from "../security";
import { authorizeUrl, exchange, IdentityError, identityMode } from "./identity";
import { consentPage, messagePage, publishPage, welcomePage } from "./page";
import {
  CREATOR_COOKIE,
  type CreatorSession,
  creatorIdFor,
  csrfOk,
  csrfToken,
  randomToken,
  SESSION_TTL_SEC,
  STATE_COOKIE,
  STATE_TTL_SEC,
  sign,
  verify,
} from "./session";

export const CREATORS_PREFIX = "/creators";
/** The one category the catalogue sells; tests outside it would never be shown. */
export const CREATOR_CATEGORY = "air-purifier";
export const DEFAULT_DISCLOSURE =
  "I may earn a commission from CITED when an AI agent buys after reading this test. The commission never affects my verdict.";

type C = Context<{ Bindings: Env }>;

const page = (html: string, status = 200) =>
  new Response(html, {
    status,
    headers: {
      "content-type": "text/html; charset=utf-8",
      "Content-Security-Policy": DEMO_PAGE_CSP,
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "same-origin",
      "Cache-Control": "no-store",
      "X-Frame-Options": "DENY",
    },
  });

const cookieOpts = (maxAge: number, sameSite: "Strict" | "Lax") =>
  ({ path: CREATORS_PREFIX, httpOnly: true, secure: true, sameSite, maxAge }) as const;

async function session(c: C): Promise<CreatorSession | null> {
  return verify<CreatorSession>(c.env.SESSION_SECRET, getCookie(c, CREATOR_COOKIE));
}

/** Browsers send Origin on every POST; without one, only a same-origin fetch metadata passes. */
function sameOrigin(c: C): boolean {
  const origin = c.req.header("Origin");
  if (origin) return origin === new URL(c.req.url).origin;
  return c.req.header("Sec-Fetch-Site") === "same-origin";
}

async function limited(c: C, what: string): Promise<boolean> {
  const { success } = await c.env.IP_LIMITER.limit({
    key: `creators-${what}:${clientIp(c.req.raw)}`,
  });
  return !success;
}

const engineUrl = (path: string) => `https://engine.internal${CITED_PREFIX}/api${path}`;

const studioUrl = (creatorId: string, name: string) =>
  `/studio/creator?${new URLSearchParams({ creator: creatorId, name })}`;

function verdictLabel(t: VerifiedTest): string {
  if (!t.verdictUpc) return "close call";
  const p = t.skus.find((s) => s.upc === t.verdictUpc);
  return p ? `${p.brand} ${p.name}` : t.verdictUpc;
}

async function publishedTests(c: C, creatorId: string) {
  try {
    const res = await internalEngineFetch(
      c.env,
      c.executionCtx,
    )(engineUrl(`/tests?creatorId=${encodeURIComponent(creatorId)}`));
    if (!res.ok) return [];
    const { tests } = (await res.json()) as {
      tests: { test: VerifiedTest; publishedAt: string }[];
    };
    return tests.map((t) => ({
      id: t.test.id,
      kind: t.test.kind,
      verdict: verdictLabel(t.test),
      publishedAt: t.publishedAt,
    }));
  } catch {
    return [];
  }
}

type PayoutView = {
  method: "PAYPAL" | "VENMO";
  label: string | null;
  typed?: string;
  error?: string;
  saved?: boolean;
};

/** The creator's saved payout choice (PayPal when none, or if the engine can't be reached). */
async function payoutChoice(c: C, creatorId: string): Promise<PayoutView> {
  try {
    const res = await internalEngineFetch(
      c.env,
      c.executionCtx,
    )(engineUrl(`/payout-method?creatorId=${encodeURIComponent(creatorId)}`));
    if (!res.ok) return { method: "PAYPAL", label: null };
    const out = (await res.json()) as { method?: string; label?: string | null };
    return out.method === "VENMO"
      ? { method: "VENMO", label: out.label ?? null }
      : { method: "PAYPAL", label: null };
  } catch {
    return { method: "PAYPAL", label: null };
  }
}

/** The form's payout fields, checked before anything is sent: one message, worded for the creator. */
export function parsePayoutForm(
  method: unknown,
  venmo: unknown,
): { ok: true; method: "PAYPAL" | "VENMO"; venmo?: string } | { ok: false; error: string } {
  if (method === "PAYPAL") return { ok: true, method: "PAYPAL" };
  if (method !== "VENMO") return { ok: false, error: "Pick PayPal or Venmo." };
  const parsed = parseVenmoReceiver(clean(venmo, 40));
  if (!parsed.ok) return { ok: false, error: parsed.error };
  return { ok: true, method: "VENMO", venmo: clean(venmo, 40) };
}

/** Plain text: control characters out (newlines kept for summaries), trimmed, capped. */
function clean(raw: unknown, max: number, multiline = false): string {
  if (typeof raw !== "string") return "";
  const s = Array.from(raw, (ch) => {
    const code = ch.charCodeAt(0);
    if (multiline && (ch === "\n" || ch === "\r")) return ch;
    return code < 32 || code === 127 ? " " : ch;
  }).join("");
  const out = multiline
    ? s.replace(/\r\n?/g, "\n").replace(/\n{3,}/g, "\n\n")
    : s.replace(/\s+/g, " ");
  return out.trim().slice(0, max);
}

export interface TestForm {
  name: string;
  skus: string[];
  verdict: string;
  summary: string;
  disclosure: string;
  placeboTopic: string;
  placeboSummary: string;
}

/**
 * The form → the two VerifiedTests, validated by the protocol schema. Errors are worded for the
 * creator, one per field.
 */
export function buildTests(
  form: TestForm,
  creatorId: string,
  suffix: string,
): { ok: true; test: VerifiedTest; placebo: VerifiedTest } | { ok: false; errors: string[] } {
  const errors: string[] = [];
  const skus = [...new Set(form.skus)]
    .map((upc) => PRODUCTS.find((p) => p.upc === upc))
    .filter((p) => p !== undefined)
    .map((p) => ({ upc: p.upc, brand: p.brand, name: p.name }));
  if (!form.name) errors.push("Add the name you publish under.");
  if (skus.length < 2) errors.push("Pick at least two products: a test compares them.");
  const verdictUpc = form.verdict === "close" ? undefined : form.verdict;
  if (form.verdict !== "close" && !skus.some((s) => s.upc === verdictUpc))
    errors.push("Your verdict must be one of the products you tested, or a close call.");
  if (form.summary.length < 60)
    errors.push("Describe what you measured in at least 60 characters.");
  if (!/commission/i.test(form.disclosure))
    errors.push("The disclosure must say you may earn a commission.");
  if (!form.placeboTopic) errors.push("Give your placebo article a topic.");
  if (/purifier/i.test(form.placeboTopic))
    errors.push("The placebo must be about something other than air purifiers.");
  if (form.placeboSummary.length < 40)
    errors.push("Describe the placebo article in at least 40 characters.");
  if (errors.length) return { ok: false, errors };

  const topic = form.placeboTopic
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  const test = VerifiedTest.safeParse({
    id: `${creatorId}-t-${suffix}`,
    kind: "test",
    creatorId,
    category: CREATOR_CATEGORY,
    skus,
    ...(verdictUpc ? { verdictUpc } : {}),
    summary: form.summary,
    disclosure: form.disclosure,
  });
  const placebo = VerifiedTest.safeParse({
    id: `${creatorId}-p-${suffix}`,
    kind: "placebo",
    creatorId,
    category: topic.slice(0, 40) || "other",
    skus: [],
    summary: form.placeboSummary,
    disclosure: form.disclosure,
  });
  if (!test.success || !placebo.success)
    return { ok: false, errors: ["Something in the form isn't valid. Check each field."] };
  return { ok: true, test: test.data, placebo: placebo.data };
}

export const creators = new Hono<{ Bindings: Env }>();

creators.get("/", async (c) => {
  const mode = identityMode(c.env);
  const s = await session(c);
  if (!s) {
    const error = c.req.query("error");
    return page(
      welcomePage({
        simulated: mode !== "sandbox",
        ...(error === "denied"
          ? { error: "You cancelled the PayPal sign-in. Connect again when you're ready." }
          : error
            ? { error: "PayPal sign-in didn't finish. Try connecting again." }
            : {}),
      }),
    );
  }
  const creatorId = await creatorIdFor(s.payerId);
  const publishedId = c.req.query("published");
  const tests = await publishedTests(c, creatorId);
  return page(
    publishPage({
      name: s.name,
      payerId: s.payerId,
      creatorId,
      simulated: s.mode === "simulated",
      csrf: await csrfToken(c.env.SESSION_SECRET, s),
      products: PRODUCTS,
      category: CREATOR_CATEGORY,
      defaultDisclosure: DEFAULT_DISCLOSURE,
      dashboardUrl: studioUrl(creatorId, c.req.query("as") ?? s.name),
      tests,
      payout: {
        ...(await payoutChoice(c, creatorId)),
        ...(c.req.query("payout") === "saved" ? { saved: true } : {}),
      },
      ...(publishedId && tests.some((t) => t.id === publishedId)
        ? {
            published: {
              testId: publishedId,
              studioUrl: studioUrl(creatorId, c.req.query("as") ?? s.name),
            },
          }
        : {}),
    }),
  );
});

creators.get("/connect", async (c) => {
  if (await limited(c, "auth"))
    return page(
      messagePage("Slow down", "Too many sign-ins from here. Try again in a minute."),
      429,
    );
  const mode = identityMode(c.env);
  if (!mode)
    return page(messagePage("Sign-in unavailable", "PayPal isn't configured for CITED here."), 503);
  const state = randomToken();
  let target: string;
  try {
    const signed = await sign(c.env.SESSION_SECRET, {
      state,
      exp: Math.floor(Date.now() / 1000) + STATE_TTL_SEC,
    });
    target = authorizeUrl(c.env, mode, { origin: new URL(c.req.url).origin, state });
    setCookie(c, STATE_COOKIE, signed, cookieOpts(STATE_TTL_SEC, "Lax"));
  } catch (e) {
    console.error("creator connect failed", (e as Error).name);
    return page(
      messagePage("Sign-in unavailable", "PayPal sign-in isn't configured for this deployment."),
      503,
    );
  }
  return c.redirect(target, 302);
});

/** Simulated mode only: our stand-in for PayPal's consent screen. */
creators.get("/paypal/simulated", (c) => {
  if (identityMode(c.env) !== "simulated") return c.notFound();
  const state = c.req.query("state") ?? "";
  if (!/^[A-Za-z0-9_-]{16,64}$/.test(state))
    return page(messagePage("Sign-in expired", "Start again from Connect PayPal."), 400);
  return page(
    consentPage({
      state,
      redirectUri: `${new URL(c.req.url).origin}/creators/callback`,
      code: `sim_${randomToken(15)}`,
    }),
  );
});

creators.get("/callback", async (c) => {
  if (await limited(c, "auth"))
    return page(
      messagePage("Slow down", "Too many sign-ins from here. Try again in a minute."),
      429,
    );
  const mode = identityMode(c.env);
  const stored = await verify<{ state: string; exp: number }>(
    c.env.SESSION_SECRET,
    getCookie(c, STATE_COOKIE),
  );
  deleteCookie(c, STATE_COOKIE, { path: CREATORS_PREFIX, secure: true });
  const state = c.req.query("state");
  // `state` proves this browser started the sign-in, so nobody can log a creator into their account.
  if (!mode || !stored || !state || state !== stored.state)
    return c.redirect("/creators?error=state", 302);
  if (c.req.query("error")) return c.redirect("/creators?error=denied", 302);
  const code = c.req.query("code");
  if (!code || code.length > 512) return c.redirect("/creators?error=code", 302);
  try {
    const member = await exchange(c.env, mode, { origin: new URL(c.req.url).origin, code });
    const s: CreatorSession = {
      payerId: member.payerId,
      name: member.name,
      mode,
      exp: Math.floor(Date.now() / 1000) + SESSION_TTL_SEC,
    };
    setCookie(
      c,
      CREATOR_COOKIE,
      await sign(c.env.SESSION_SECRET, s),
      cookieOpts(SESSION_TTL_SEC, "Lax"),
    );
  } catch (e) {
    console.error(
      "creator sign-in failed",
      e instanceof IdentityError ? e.message : (e as Error).name,
    );
    return c.redirect("/creators?error=exchange", 302);
  }
  return c.redirect("/creators", 302);
});

creators.post("/tests", async (c) => {
  if (!sameOrigin(c))
    return page(messagePage("Not allowed", "Publish from the CITED creators page."), 403);
  if (await limited(c, "write"))
    return page(
      messagePage("Slow down", "Too many requests from here. Try again in a minute."),
      429,
    );
  const s = await session(c);
  if (!s) return c.redirect("/creators", 303);
  const body = await c.req.parseBody({ all: true });
  if (!(await csrfOk(c.env.SESSION_SECRET, s, body.csrf)))
    return page(messagePage("Form expired", "Reload the creators page and publish again."), 403);
  const rawSkus = body.skus;
  const form: TestForm = {
    name: clean(body.name, 80),
    skus: (Array.isArray(rawSkus) ? rawSkus : rawSkus === undefined ? [] : [rawSkus])
      .filter((x): x is string => typeof x === "string")
      .slice(0, 8),
    verdict: clean(body.verdict, 16),
    summary: clean(body.summary, 1200, true),
    disclosure: clean(body.disclosure, 400),
    placeboTopic: clean(body.placeboTopic, 40),
    placeboSummary: clean(body.placeboSummary, 1200, true),
  };
  const creatorId = await creatorIdFor(s.payerId);
  const built = buildTests(form, creatorId, randomToken(6).replace(/[^A-Za-z0-9]/g, "x"));
  const rerender = async (errors: string[], status: number) =>
    page(
      publishPage({
        name: s.name,
        payerId: s.payerId,
        creatorId,
        simulated: s.mode === "simulated",
        csrf: await csrfToken(c.env.SESSION_SECRET, s),
        products: PRODUCTS,
        category: CREATOR_CATEGORY,
        defaultDisclosure: DEFAULT_DISCLOSURE,
        dashboardUrl: studioUrl(creatorId, form.name || s.name),
        values: { ...form, skus: form.skus },
        errors,
        tests: await publishedTests(c, creatorId),
        payout: await payoutChoice(c, creatorId),
      }),
      status,
    );
  if (!built.ok) return rerender(built.errors, 422);
  const res = await internalEngineFetch(c.env, c.executionCtx)(engineUrl("/tests"), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      creator: { creatorId, name: form.name, paypalId: s.payerId },
      test: built.test,
      placebo: built.placebo,
    }),
  });
  if (!res.ok) {
    console.error("creator publish rejected", res.status);
    return rerender(["CITED couldn't store the test. Try publishing again."], 502);
  }
  const q = new URLSearchParams({ published: built.test.id, as: form.name });
  return c.redirect(`/creators?${q}`, 303);
});

creators.post("/payout", async (c) => {
  if (!sameOrigin(c))
    return page(
      messagePage("Not allowed", "Save your payout choice from the CITED creators page."),
      403,
    );
  if (await limited(c, "write"))
    return page(
      messagePage("Slow down", "Too many requests from here. Try again in a minute."),
      429,
    );
  const s = await session(c);
  if (!s) return c.redirect("/creators", 303);
  const body = await c.req.parseBody();
  if (!(await csrfOk(c.env.SESSION_SECRET, s, body.csrf)))
    return page(messagePage("Form expired", "Reload the creators page and save again."), 403);
  const creatorId = await creatorIdFor(s.payerId);
  const choice = parsePayoutForm(body.method, body.venmo);
  const rerender = async (error: string, status: number) =>
    page(
      publishPage({
        name: s.name,
        payerId: s.payerId,
        creatorId,
        simulated: s.mode === "simulated",
        csrf: await csrfToken(c.env.SESSION_SECRET, s),
        products: PRODUCTS,
        category: CREATOR_CATEGORY,
        defaultDisclosure: DEFAULT_DISCLOSURE,
        dashboardUrl: studioUrl(creatorId, s.name),
        tests: await publishedTests(c, creatorId),
        payout: {
          ...(await payoutChoice(c, creatorId)),
          typed: clean(body.venmo, 40),
          error,
        },
      }),
      status,
    );
  if (!choice.ok) return rerender(choice.error, 422);
  const res = await internalEngineFetch(c.env, c.executionCtx)(engineUrl("/payout-method"), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      creator: { creatorId, name: s.name, paypalId: s.payerId },
      method: choice.method,
      ...(choice.venmo ? { venmo: choice.venmo } : {}),
    }),
  });
  if (!res.ok) {
    console.error("creator payout choice rejected", res.status);
    return rerender("CITED couldn't save that. Try again.", 502);
  }
  return c.redirect("/creators?payout=saved", 303);
});

creators.post("/disconnect", async (c) => {
  if (!sameOrigin(c))
    return page(messagePage("Not allowed", "Disconnect from the CITED creators page."), 403);
  const s = await session(c);
  const body = await c.req.parseBody();
  if (s && (await csrfOk(c.env.SESSION_SECRET, s, body.csrf)))
    deleteCookie(c, CREATOR_COOKIE, { path: CREATORS_PREFIX, secure: true });
  return c.redirect("/creators", 303);
});
