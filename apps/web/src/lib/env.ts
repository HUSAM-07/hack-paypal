/** Public, build-time config. Nothing secret may live here: it ships in the bundle. */
export const env = {
  wsUrl: resolveWs((import.meta.env.VITE_PACT_WS_URL as string | undefined) || ""),
  apiUrl: (import.meta.env.VITE_PACT_API_URL as string | undefined) || "",
  paypalClientId: (import.meta.env.VITE_PAYPAL_CLIENT_ID as string | undefined) || "",
};

export const useMock = env.wsUrl === "";

/**
 * A path like `/ws` means "this origin": the worker serves the app in production and
 * Vite proxies it in dev, so session cookies stay same-origin (SameSite=Strict).
 */
function resolveWs(url: string): string {
  if (!url.startsWith("/")) return url;
  const { protocol, host } = window.location;
  return `${protocol === "https:" ? "wss" : "ws"}://${host}${url}`;
}
