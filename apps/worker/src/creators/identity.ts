/**
 * Log in with PayPal for creators. Sandbox talks to PayPal's Identity API; simulated mode sends
 * the creator to our own clearly labelled consent page and exchanges the code with the PayPal
 * mock, which answers userinfo with a payer id derived from the code.
 */
import { createPayPal, createPayPalFromEnv, primaryEmail } from "@pact/paypal";
import type { Env } from "../env";

/** Openid + PayPal account attributes: the scope that carries `payer_id`. */
export const CREATOR_SCOPES = [
  "openid",
  "profile",
  "email",
  "https://uri.paypal.com/services/paypalattributes",
];

export type IdentityMode = "simulated" | "sandbox";

export function identityMode(env: Env): IdentityMode | null {
  const m = env.CITED_PAYPAL_MODE ?? env.PAYPAL_MODE;
  return m === "simulated" || m === "sandbox" ? m : null;
}

export interface PayPalMember {
  payerId: string;
  name: string;
  email?: string;
}

export class IdentityError extends Error {}

function client(env: Env, mode: IdentityMode) {
  if (mode === "simulated") return createPayPalFromEnv({ PAYPAL_MODE: "simulated" }).paypal;
  if (!env.PAYPAL_CLIENT_ID || !env.PAYPAL_CLIENT_SECRET)
    throw new IdentityError("PayPal sandbox credentials are not configured");
  return createPayPal({
    clientId: env.PAYPAL_CLIENT_ID,
    clientSecret: env.PAYPAL_CLIENT_SECRET,
    env: "sandbox",
  });
}

/** Where "Connect PayPal" sends the creator. */
export function authorizeUrl(
  env: Env,
  mode: IdentityMode,
  input: { origin: string; state: string },
): string {
  const redirectUri = `${input.origin}/creators/callback`;
  if (mode === "simulated") {
    const q = new URLSearchParams({ state: input.state, redirect_uri: redirectUri });
    return `${input.origin}/creators/paypal/simulated?${q}`;
  }
  return client(env, mode).identity.authorizeUrl({
    redirectUri,
    state: input.state,
    scopes: CREATOR_SCOPES,
  });
}

/** Code → user token → userinfo. The user token is used once here and never stored. */
export async function exchange(
  env: Env,
  mode: IdentityMode,
  input: { origin: string; code: string },
): Promise<PayPalMember> {
  const paypal = client(env, mode);
  const tokens = await paypal.identity.exchangeCode(input.code, {
    redirectUri: `${input.origin}/creators/callback`,
  });
  const info = await paypal.identity.userinfo(tokens.access_token);
  if (!info.payer_id || !/^[A-Z0-9]{8,20}$/.test(info.payer_id))
    throw new IdentityError("PayPal did not return a payer id");
  const email = primaryEmail(info);
  return {
    payerId: info.payer_id,
    name: (info.name ?? "").trim().slice(0, 80) || "PayPal creator",
    ...(email ? { email } : {}),
  };
}
