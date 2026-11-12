import { createContext, useContext, useSyncExternalStore } from "react";
import type { ShopClient } from "../protocol/client";
import type { ClientState } from "../protocol/state";

export const ClientContext = createContext<ShopClient | null>(null);

export function useClient(): ShopClient {
  const c = useContext(ClientContext);
  if (!c) throw new Error("ShopClient missing: render inside <ClientContext.Provider>");
  return c;
}

/** The whole client state; components read what they need (the reducer keeps references stable). */
export function useClientState(): ClientState {
  const c = useClient();
  return useSyncExternalStore(c.subscribe, c.getState, c.getState);
}
