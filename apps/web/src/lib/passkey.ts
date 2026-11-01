import { useMock } from "./env";

function b64urlToBytes(s: string): Uint8Array<ArrayBuffer> {
  const pad = s
    .replace(/-/g, "+")
    .replace(/_/g, "/")
    .padEnd(Math.ceil(s.length / 4) * 4, "=");
  const bin = atob(pad);
  const out = new Uint8Array(new ArrayBuffer(bin.length));
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function bytesToB64url(buf: ArrayBuffer | null): string | null {
  if (!buf) return null;
  let bin = "";
  for (const b of new Uint8Array(buf)) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export class PasskeyError extends Error {}

/**
 * WebAuthn assertion bound to the server-issued approval challenge. The JSON shape
 * matches `PublicKeyCredential.toJSON()` so the worker can verify it directly.
 * The mock server accepts a simulated assertion so the demo runs without a passkey.
 */
export async function getAssertion(challenge: string): Promise<unknown> {
  if (useMock) {
    await new Promise((r) => setTimeout(r, 1100));
    return { type: "mock-passkey", challenge };
  }
  if (!("PublicKeyCredential" in window) || !navigator.credentials) {
    throw new PasskeyError("This browser doesn't support passkeys.");
  }
  const cred = (await navigator.credentials.get({
    publicKey: {
      challenge: b64urlToBytes(challenge),
      userVerification: "required",
      timeout: 60_000,
    },
  })) as PublicKeyCredential | null;
  if (!cred) throw new PasskeyError("No passkey was used.");
  const r = cred.response as AuthenticatorAssertionResponse;
  return {
    id: cred.id,
    rawId: bytesToB64url(cred.rawId),
    type: cred.type,
    response: {
      clientDataJSON: bytesToB64url(r.clientDataJSON),
      authenticatorData: bytesToB64url(r.authenticatorData),
      signature: bytesToB64url(r.signature),
      userHandle: bytesToB64url(r.userHandle),
    },
    clientExtensionResults: cred.getClientExtensionResults(),
  };
}
