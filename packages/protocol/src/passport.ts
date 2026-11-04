import { CUSTOM_ID_MAX, decodePassportBody, encodePassportBody, type PassportBody } from "./cited";

/** 12 bytes (96 bits) of HMAC-SHA256, base64url: 16 chars. Enough to forbid forgery, short enough for `custom_id`. */
const SIG_BYTES = 12;
const SEP = ".";
const MAX_LIST = 4;

export type PassportFailure = "too_long" | "malformed" | "bad_signature" | "unknown_version";
export type PassportVerification =
  | { ok: true; body: PassportBody }
  | { ok: false; reason: PassportFailure };

// The protocol package is built against bare ES2023 libs (no DOM, no Workers types), so the
// WebCrypto globals are typed locally to the few calls used here.
interface WebCryptoLike {
  subtle: {
    importKey(
      format: "raw",
      key: Uint8Array,
      algo: { name: "HMAC"; hash: "SHA-256" },
      extractable: boolean,
      usages: string[],
    ): Promise<unknown>;
    sign(algo: "HMAC", key: unknown, data: Uint8Array): Promise<ArrayBuffer>;
  };
}
const webcrypto = (globalThis as unknown as { crypto: WebCryptoLike }).crypto;
const g = globalThis as unknown as {
  TextEncoder: new () => { encode(s: string): Uint8Array };
  btoa(s: string): string;
};
const enc = new g.TextEncoder();

function b64url(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return g.btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function mac(payload: string, key: string | Uint8Array): Promise<string> {
  const raw = typeof key === "string" ? enc.encode(key) : key;
  const k = await webcrypto.subtle.importKey("raw", raw, { name: "HMAC", hash: "SHA-256" }, false, [
    "sign",
  ]);
  const sig = new Uint8Array(await webcrypto.subtle.sign("HMAC", k, enc.encode(payload)));
  return b64url(sig.subarray(0, SIG_BYTES));
}

/** Equal-length strings only; no early exit on the first differing byte. */
function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** `v1|sess|arm|creators|stores.<sig>`. Throws if the token would not fit in `custom_id`. */
export async function signPassport(body: PassportBody, key: string | Uint8Array): Promise<string> {
  const payload = encodePassportBody(body);
  const token = `${payload}${SEP}${await mac(payload, key)}`;
  if (token.length > CUSTOM_ID_MAX) {
    throw new Error(`passport is ${token.length} chars, over the ${CUSTOM_ID_MAX} custom_id limit`);
  }
  return token;
}

export async function verifyPassport(
  token: string,
  key: string | Uint8Array,
): Promise<PassportVerification> {
  if (token.length > CUSTOM_ID_MAX) return { ok: false, reason: "too_long" };
  const cut = token.lastIndexOf(SEP);
  if (cut < 0) return { ok: false, reason: "malformed" };
  const payload = token.slice(0, cut);
  const sig = token.slice(cut + 1);
  if (!payload.startsWith("v1|")) {
    return { ok: false, reason: /^v\d+\|/.test(payload) ? "unknown_version" : "malformed" };
  }
  // Check the signature before parsing so forged bodies never reach the decoder.
  if (!constantTimeEqual(sig, await mac(payload, key))) {
    return { ok: false, reason: "bad_signature" };
  }
  try {
    return { ok: true, body: decodePassportBody(payload) };
  } catch {
    return { ok: false, reason: "malformed" };
  }
}

/** Records a store the agent viewed. Deduplicates; once full, the oldest store is dropped. */
export function addStoreViewed(body: PassportBody, storeId: string): PassportBody {
  if (body.storesViewed.includes(storeId)) return body;
  const storesViewed = [...body.storesViewed, storeId].slice(-MAX_LIST);
  return { ...body, storesViewed };
}
