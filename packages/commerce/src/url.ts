import { ShopError } from "./deps";

const PRIVATE_V4 = [
  /^0\./,
  /^10\./,
  /^127\./,
  /^169\.254\./,
  /^172\.(1[6-9]|2\d|3[01])\./,
  /^192\.168\./,
  /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./,
];

/**
 * URLs come from web search and the model, so a server-side fetch must not reach internal
 * hosts. Literal-host check only (Workers can't resolve DNS first); Workers' own egress
 * already refuses private ranges.
 */
export function assertPublicHttpUrl(raw: string): URL {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    throw new ShopError("invalid_url", "That isn't a valid web address.");
  }
  const host = u.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  const bad =
    (u.protocol !== "https:" && u.protocol !== "http:") ||
    u.username !== "" ||
    u.password !== "" ||
    host === "localhost" ||
    host.endsWith(".localhost") ||
    host.endsWith(".internal") ||
    host.endsWith(".local") ||
    // IPv6 literals: refuse them all (loopback, ULA, link-local, v4-mapped…).
    host.includes(":") ||
    PRIVATE_V4.some((r) => r.test(host)) ||
    !host.includes(".");
  if (bad) throw new ShopError("invalid_url", "Only public http(s) pages can be read.");
  return u;
}

export function hostnameOf(raw: string): string {
  try {
    return new URL(raw).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

/** Short stable hash (FNV-1a, base36) for deterministic ids from URLs. */
export function shortHash(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 0x01000193) >>> 0;
  let g = 0x9e3779b9;
  for (let i = s.length - 1; i >= 0; i--) g = Math.imul(g ^ s.charCodeAt(i), 0x85ebca6b) >>> 0;
  return h.toString(36).padStart(7, "0") + g.toString(36).padStart(7, "0");
}
