/** `wallet.startConnect` returns the PayPal setup token; accept either field name. */
export function setupTokenOf(r: unknown): string {
  const o = (r ?? {}) as { setupTokenId?: unknown; vaultSetupToken?: unknown };
  const t = o.setupTokenId ?? o.vaultSetupToken;
  if (typeof t !== "string" || !t) throw new Error("PayPal didn't return a setup token.");
  return t;
}
