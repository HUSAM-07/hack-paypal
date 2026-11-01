/**
 * Test-only: mint an RSA keypair and a self-signed X.509 cert with WebCrypto plus a tiny
 * DER encoder, and sign webhook transmissions the way PayPal does.
 */
import { crc32 } from "../webhooks/crypto";

type Bytes = Uint8Array<ArrayBuffer>;

function concat(...parts: Uint8Array[]): Bytes {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

function derLength(n: number): Uint8Array {
  if (n < 0x80) return Uint8Array.of(n);
  const bytes: number[] = [];
  for (let v = n; v > 0; v = Math.floor(v / 256)) bytes.unshift(v & 0xff);
  return Uint8Array.of(0x80 | bytes.length, ...bytes);
}

const tlv = (tag: number, ...content: Uint8Array[]) => {
  const body = concat(...content);
  return concat(Uint8Array.of(tag), derLength(body.length), body);
};
const seq = (...c: Uint8Array[]) => tlv(0x30, ...c);
const set = (...c: Uint8Array[]) => tlv(0x31, ...c);
const int = (n: number) => tlv(0x02, Uint8Array.of(n));
const nul = () => tlv(0x05);
const utf8 = (s: string) => tlv(0x0c, new TextEncoder().encode(s));
const bitString = (b: Uint8Array) => tlv(0x03, Uint8Array.of(0), b);
const octetString = (b: Uint8Array) => tlv(0x04, b);

function oid(dotted: string): Bytes {
  const [a = 0, b = 0, ...rest] = dotted.split(".").map(Number);
  const out = [40 * a + b];
  for (const arc of rest) {
    const chunk: number[] = [];
    for (let v = arc; ; v = Math.floor(v / 128)) {
      chunk.unshift((v & 0x7f) | (chunk.length ? 0x80 : 0));
      if (v < 128) break;
    }
    out.push(...chunk);
  }
  return tlv(0x06, Uint8Array.from(out));
}

function time(d: Date): Bytes {
  const p = (n: number) => String(n).padStart(2, "0");
  const body = `${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}${p(d.getUTCHours())}${p(d.getUTCMinutes())}${p(d.getUTCSeconds())}Z`;
  const y = d.getUTCFullYear();
  // RFC 5280: UTCTime through 2049, GeneralizedTime from 2050.
  return y < 2050
    ? tlv(0x17, new TextEncoder().encode(`${p(y % 100)}${body}`))
    : tlv(0x18, new TextEncoder().encode(`${y}${body}`));
}

const toB64 = (b: Uint8Array) => btoa(String.fromCharCode(...b));

export interface TestSigner {
  certPem: string;
  privateKey: CryptoKey;
  spki: Bytes;
}

export async function makeTestCert(opts: { notBefore: Date; notAfter: Date }): Promise<TestSigner> {
  const kp = (await crypto.subtle.generateKey(
    {
      name: "RSASSA-PKCS1-v1_5",
      modulusLength: 2048,
      publicExponent: Uint8Array.of(1, 0, 1),
      hash: "SHA-256",
    },
    true,
    ["sign", "verify"],
  )) as CryptoKeyPair;
  // Cast: workers-types widens exportKey to ArrayBuffer | JsonWebKey; "spki" is always bytes.
  const spki = new Uint8Array((await crypto.subtle.exportKey("spki", kp.publicKey)) as ArrayBuffer);
  const sha256WithRSA = seq(oid("1.2.840.113549.1.1.11"), nul());
  const name = seq(set(seq(oid("2.5.4.3"), utf8("messageverificationcerts.sandbox.paypal.com"))));
  const tbs = seq(
    tlv(0xa0, int(2)),
    int(1),
    sha256WithRSA,
    name,
    seq(time(opts.notBefore), time(opts.notAfter)),
    name,
    spki,
    // Extensions, so the parser has to skip a trailing [3] like real certs.
    tlv(0xa3, seq(seq(oid("2.5.29.19"), octetString(seq())))),
  );
  const sig = new Uint8Array(await crypto.subtle.sign("RSASSA-PKCS1-v1_5", kp.privateKey, tbs));
  const der = seq(tbs, sha256WithRSA, bitString(sig));
  const b64 = toB64(der).replace(/(.{64})/g, "$1\n");
  return {
    certPem: `-----BEGIN CERTIFICATE-----\n${b64}\n-----END CERTIFICATE-----\n`,
    privateKey: kp.privateKey,
    spki,
  };
}

export const TEST_CERT_URL =
  "https://api.sandbox.paypal.com/v1/notifications/certs/CERT-360caa42-fca2a594-test";

export async function signWebhook(
  signer: TestSigner,
  input: {
    rawBody: string;
    webhookId: string;
    transmissionId?: string;
    transmissionTime?: string;
    certUrl?: string;
  },
): Promise<Record<string, string>> {
  const transmissionId = input.transmissionId ?? "69cd13f0-d67a-11e5-baa3-778b53f4ae55";
  const transmissionTime = input.transmissionTime ?? "2026-11-01T10:00:00Z";
  const msg = `${transmissionId}|${transmissionTime}|${input.webhookId}|${crc32(new TextEncoder().encode(input.rawBody))}`;
  const sig = new Uint8Array(
    await crypto.subtle.sign("RSASSA-PKCS1-v1_5", signer.privateKey, new TextEncoder().encode(msg)),
  );
  return {
    "paypal-transmission-id": transmissionId,
    "paypal-transmission-time": transmissionTime,
    "paypal-transmission-sig": toB64(sig),
    "paypal-cert-url": input.certUrl ?? TEST_CERT_URL,
    "paypal-auth-algo": "SHA256withRSA",
  };
}
