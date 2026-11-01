/**
 * Log in with PayPal (OpenID Connect) and the JS SDK v6 client token. User access and
 * refresh tokens are credentials: keep them server-side and never log them.
 */
import type { PayPalEnv, Transport } from "./http";
import {
  AccessToken,
  type UserInfo,
  UserInfo as UserInfoSchema,
  type UserTokens,
  UserTokens as UserTokensSchema,
} from "./schemas";

const WEB_BASE: Record<PayPalEnv, string> = {
  sandbox: "https://www.sandbox.paypal.com",
  live: "https://www.paypal.com",
};

export const DEFAULT_LOGIN_SCOPES = [
  "openid",
  "email",
  "https://uri.paypal.com/services/paypalattributes",
];

export function identityApi(t: Transport) {
  return {
    /** The URL to send a member to. `state` must be an unguessable value bound to their session. */
    authorizeUrl(input: { redirectUri: string; state: string; scopes?: string[] }): string {
      const q = new URLSearchParams({
        flowEntry: "static",
        client_id: t.clientId,
        response_type: "code",
        scope: (input.scopes ?? DEFAULT_LOGIN_SCOPES).join(" "),
        redirect_uri: input.redirectUri,
        state: input.state,
      });
      return `${WEB_BASE[t.env]}/signin/authorize?${q}`;
    },
    /** Authorization codes are single-use, so this is never retried. */
    async exchangeCode(code: string, opts?: { redirectUri?: string }): Promise<UserTokens> {
      const form = new URLSearchParams({ grant_type: "authorization_code", code });
      if (opts?.redirectUri) form.set("redirect_uri", opts.redirectUri);
      return t.request({
        method: "POST",
        route: "/v1/oauth2/token#authorization_code",
        path: "/v1/oauth2/token",
        form,
        schema: UserTokensSchema,
        idempotent: false,
        auth: { kind: "basic" },
      });
    },
    async refresh(refreshToken: string): Promise<UserTokens> {
      return t.request({
        method: "POST",
        route: "/v1/oauth2/token#refresh_token",
        path: "/v1/oauth2/token",
        form: new URLSearchParams({ grant_type: "refresh_token", refresh_token: refreshToken }),
        schema: UserTokensSchema,
        idempotent: true,
        auth: { kind: "basic" },
      });
    },
    async userinfo(userAccessToken: string): Promise<UserInfo> {
      return t.request({
        method: "GET",
        route: "/v1/identity/oauth2/userinfo",
        path: "/v1/identity/oauth2/userinfo",
        query: { schema: "paypalv1.1" },
        schema: UserInfoSchema,
        idempotent: true,
        auth: { kind: "bearer", token: userAccessToken },
      });
    },
  };
}

export function primaryEmail(info: UserInfo): string | undefined {
  return info.emails?.find((e) => e.primary)?.value ?? info.emails?.[0]?.value ?? info.email;
}

export interface ClientTokenInput {
  /** Needed by Fastlane; harmless otherwise. Bare hostnames, e.g. `pact.example.com`. */
  domains?: string[];
  /** Saved payment methods: show a customer's vaulted wallets. */
  targetCustomerId?: string;
  /** Saved payment methods for one vault id (`vault_id:<id>` claim). */
  vaultId?: string;
}

export interface ClientToken {
  token: string;
  expiresAt: number;
}

/**
 * A browser-safe, short-lived (~15 min) token for JS SDK v6 (`clientToken`). Not cached:
 * it's scoped by the request parameters and cheap to mint.
 */
export function clientTokenApi(t: Transport, now: () => number = Date.now) {
  return async (input: ClientTokenInput = {}): Promise<ClientToken> => {
    const form = new URLSearchParams({
      grant_type: "client_credentials",
      response_type: "client_token",
    });
    for (const d of input.domains ?? []) form.append("domains[]", d);
    if (input.targetCustomerId) form.set("target_customer_id", input.targetCustomerId);
    if (input.vaultId) {
      const claim = input.vaultId.startsWith("B-") ? "billing_agreement_id" : "vault_id";
      form.append("claims[]", `${claim}:${input.vaultId}`);
    }
    const res = await t.request({
      method: "POST",
      route: "/v1/oauth2/token#client_token",
      path: "/v1/oauth2/token",
      form,
      schema: AccessToken,
      idempotent: true,
      auth: { kind: "basic" },
    });
    return { token: res.access_token, expiresAt: now() + res.expires_in * 1000 };
  };
}
