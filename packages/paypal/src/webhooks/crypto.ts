/**
 * Just enough DER/X.509 to pull the public key and validity window out of PayPal's
 * webhook signing cert, so self-verification runs on plain WebCrypto with no
 * `nodejs_compat` dependency.
 */

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

/** CRC-32 (IEEE), unsigned, as PayPal puts it in the signed message: a decimal integer. */
export function crc32(data: Uint8Array): number {
  let c = 0xffffffff;
  for (const byte of data) c = (CRC_TABLE[(c ^ byte) & 0xff] as number) ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

interface Tlv {
  tag: number;
  start: number;
  end: number;
  /** Offset of the tag byte, so `bytes.subarray(offset, end)` is the whole element. */
  offset: number;
}

function readTlv(b: Uint8Array, offset: number): Tlv {
  const tag = b[offset];
  let len = b[offset + 1];
  if (tag === undefined || len === undefined) throw new Error("DER: truncated");
  let p = offset + 2;
  if (len & 0x80) {
    const n = len & 0x7f;
    if (n === 0 || n > 4) throw new Error("DER: unsupported length");
    len = 0;
    for (let i = 0; i < n; i++) len = len * 256 + (b[p++] ?? Number.NaN);
  }
  const end = p + len;
  if (!Number.isFinite(end) || end > b.length) throw new Error("DER: length out of range");
  return { tag, start: p, end, offset };
}

function children(b: Uint8Array, parent: Tlv): Tlv[] {
  const out: Tlv[] = [];
  for (let p = parent.start; p < parent.end; ) {
    const c = readTlv(b, p);
    out.push(c);
    p = c.end;
  }
  return out;
}

const UTC_TIME = /^(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})Z$/;
const GENERALIZED_TIME = /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})Z$/;

function parseTime(b: Uint8Array, t: Tlv): number {
  const s = new TextDecoder().decode(b.subarray(t.start, t.end));
  const m = t.tag === 0x17 ? s.match(UTC_TIME) : t.tag === 0x18 ? s.match(GENERALIZED_TIME) : null;
  if (!m) throw new Error("X.509: unsupported time format");
  const [, y, mo, d, h, mi, se] = m.map(Number) as number[];
  // RFC 5280: two-digit UTCTime years 50–99 are 19xx.
  const year = t.tag === 0x17 ? ((y as number) < 50 ? 2000 : 1900) + (y as number) : (y as number);
  return Date.UTC(year, (mo as number) - 1, d, h, mi, se);
}

export interface ParsedCert {
  spki: Uint8Array<ArrayBuffer>;
  notBefore: number;
  notAfter: number;
}

export function pemToDer(pem: string): Uint8Array<ArrayBuffer> {
  const m = pem.match(/-----BEGIN CERTIFICATE-----([\s\S]+?)-----END CERTIFICATE-----/);
  if (!m?.[1]) throw new Error("X.509: no PEM certificate block");
  return base64ToBytes(m[1].replace(/\s+/g, ""));
}

/** Parses the first certificate in a PEM bundle (PayPal serves leaf first). */
export function parseCertificate(pem: string): ParsedCert {
  const der = pemToDer(pem);
  const cert = readTlv(der, 0);
  const tbs = children(der, cert)[0];
  if (!tbs) throw new Error("X.509: missing tbsCertificate");
  const f = children(der, tbs);
  // [0] EXPLICIT version is optional (v1 certs omit it).
  const i = f[0]?.tag === 0xa0 ? 1 : 0;
  const validity = f[i + 3];
  const spki = f[i + 5];
  if (!validity || !spki) throw new Error("X.509: malformed tbsCertificate");
  const [nb, na] = children(der, validity);
  if (!nb || !na) throw new Error("X.509: malformed validity");
  return {
    spki: der.slice(spki.offset, spki.end),
    notBefore: parseTime(der, nb),
    notAfter: parseTime(der, na),
  };
}

export function base64ToBytes(b64: string): Uint8Array<ArrayBuffer> {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
