import { type PayPalConfig, Transport } from "./http";
import { clientTokenApi, identityApi } from "./identity";
import { invoicingApi } from "./invoicing";
import { authorizationsApi, capturesApi, ordersApi } from "./orders";
import { payoutsApi } from "./payouts";
import { agentToolkitApi } from "./toolkit";
import { vaultApi } from "./vault";
import {
  type PostbackVerifyInput,
  type SelfVerifyInput,
  type VerifyResult,
  verifyWebhookPostback,
  verifyWebhookSelf,
} from "./webhooks/verify";

/**
 * A typed PayPal REST client for Workers. No policy checks live here: every caller of a
 * mutating method must have run `authorize()` from `@pact/policy` first.
 */
export function createPayPal(cfg: PayPalConfig) {
  const t = new Transport(cfg);
  return {
    env: cfg.env,
    orders: ordersApi(t),
    authorizations: authorizationsApi(t),
    captures: capturesApi(t),
    vault: vaultApi(t),
    payouts: payoutsApi(t),
    invoicing: invoicingApi(t),
    identity: identityApi(t),
    clientToken: clientTokenApi(t, cfg.now),
    /** PayPal Agent Toolkit tools, run through this client's auth and fetch. */
    agentToolkit: agentToolkitApi(t),
    webhooks: {
      /** Ask PayPal to verify (production path). */
      verifyByPostback: (input: PostbackVerifyInput) => verifyWebhookPostback(t, input),
      /** Verify locally with WebCrypto (also works for simulator events). */
      verifySelf: (input: Omit<SelfVerifyInput, "env">) =>
        verifyWebhookSelf({
          ...input,
          env: cfg.env,
          ...(cfg.fetch && !input.fetch ? { fetch: cfg.fetch } : {}),
        }),
    },
  };
}

export type PayPalClient = ReturnType<typeof createPayPal>;

export type VerifyWebhookInput =
  | ({ strategy: "postback"; paypal: PayPalClient } & PostbackVerifyInput)
  | ({ strategy: "self" } & SelfVerifyInput);

/** One entry point for both strategies. Verify before parsing or acting on the event. */
export function verifyWebhook(input: VerifyWebhookInput): Promise<VerifyResult> {
  if (input.strategy === "postback") {
    const { paypal, strategy: _s, ...rest } = input;
    return paypal.webhooks.verifyByPostback(rest);
  }
  const { strategy: _s, ...rest } = input;
  return verifyWebhookSelf(rest);
}
