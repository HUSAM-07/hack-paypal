import { startAuthentication, startRegistration } from "@simplewebauthn/browser";
import { env } from "./env";

/** The signed-in member, as the worker's `/api/auth/*` routes return it. */
export interface Me {
  userId: string;
  username: string;
  displayName: string;
}

export class AuthError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = "AuthError";
  }
}

async function post<T>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${env.apiUrl}${path}`, {
    method: "POST",
    credentials: "include",
    headers: { "content-type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  if (!res.ok) {
    const msg = await res
      .json()
      .then((b: { error?: string }) => b.error)
      .catch(() => undefined);
    throw new AuthError(msg ?? `Request failed (${res.status})`, res.status);
  }
  return (await res.json()) as T;
}

/** The current session, or null when signed out. */
export async function me(): Promise<Me | null> {
  const res = await fetch(`${env.apiUrl}/api/auth/me`, { credentials: "include" });
  if (res.status === 401) return null;
  if (!res.ok) throw new AuthError(`Couldn't reach Pact (${res.status})`, res.status);
  return (await res.json()) as Me;
}

/** Creates an account bound to a new passkey on this device. */
export async function registerPasskey(
  username: string,
  displayName?: string,
  inviteCode?: string,
): Promise<Me> {
  const optionsJSON = await post<Parameters<typeof startRegistration>[0]["optionsJSON"]>(
    "/api/auth/register/options",
    { username, ...(displayName ? { displayName } : {}), ...(inviteCode ? { inviteCode } : {}) },
  );
  const response = await startRegistration({ optionsJSON });
  return post<Me>("/api/auth/register/verify", { response });
}

/** Signs in with any passkey this device holds for Pact (discoverable credential). */
export async function signInWithPasskey(): Promise<Me> {
  const optionsJSON =
    await post<Parameters<typeof startAuthentication>[0]["optionsJSON"]>("/api/auth/login/options");
  const response = await startAuthentication({ optionsJSON });
  return post<Me>("/api/auth/login/verify", { response });
}

/** Passwordless test user; the worker only exposes this with `DEV_AUTH=1`. */
export function devSignIn(username: string): Promise<Me> {
  return post<Me>("/api/auth/dev-login", { username });
}

export async function signOut(): Promise<void> {
  await post("/api/auth/logout");
}

/**
 * Step-up assertion for one approval. The worker issues options whose challenge is
 * the approval's own, and only to its approver, so the signature can't be replayed
 * against a different payment.
 */
export async function stepUpAssertion(threadId: string, approvalId: string): Promise<unknown> {
  const optionsJSON = await post<Parameters<typeof startAuthentication>[0]["optionsJSON"]>(
    "/api/auth/step-up/options",
    { threadId, approvalId },
  );
  return startAuthentication({ optionsJSON });
}
