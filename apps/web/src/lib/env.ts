/** Public, build-time config. Nothing secret may live here: it ships in the bundle. */
export const env = {
  wsUrl: (import.meta.env.VITE_PACT_WS_URL as string | undefined) || "",
  apiUrl: (import.meta.env.VITE_PACT_API_URL as string | undefined) || "",
  paypalClientId: (import.meta.env.VITE_PAYPAL_CLIENT_ID as string | undefined) || "",
};

export const useMock = env.wsUrl === "";
