import "@shop/genui/styles.css";
import "./styles/app.css";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { MockHarness, type MockOptions } from "./mock/harness";
import { ShopClient } from "./protocol/client";
import { webSocketTransport } from "./protocol/transport";
import { App, type AppOptions } from "./ui/App";
import { ClientContext } from "./ui/store";
import { applyTheme } from "./ui/theme";

export type MountShopOptions = AppOptions & {
  /**
   * The agent's WebSocket (e.g. "/api/shop/ws"). Leave it out to run against the in-browser
   * MockHarness: every widget, approvals, a watch firing, cooling-off and undo, no backend.
   */
  wsUrl?: string;
  mock?: MockOptions;
};

export type ShopHandle = { client: ShopClient; harness?: MockHarness; unmount: () => void };

/**
 * Mount the shop SPA into `el`. The host page must load the CITED theme (site-theme.css in
 * apps/web; the standalone entry imports a copy) before this runs.
 */
export function mountShop(el: HTMLElement, options: MountShopOptions = {}): ShopHandle {
  applyTheme();
  const harness = options.wsUrl ? undefined : new MockHarness(options.mock);
  const client = new ShopClient({
    connect: harness ? harness.connect : webSocketTransport(options.wsUrl as string),
  }).start();
  const appOptions: AppOptions = {
    ...options,
    // The mock has no WebAuthn challenge; it stands in for the passkey prompt.
    ...(harness && !options.stepUp
      ? { stepUp: () => new Promise((r) => setTimeout(() => r({ mock: "passkey" }), 600)) }
      : {}),
  };
  const root = createRoot(el);
  root.render(
    <StrictMode>
      <ClientContext.Provider value={client}>
        <App options={appOptions} />
      </ClientContext.Provider>
    </StrictMode>,
  );
  return {
    client,
    ...(harness ? { harness } : {}),
    unmount: () => {
      root.unmount();
      client.stop();
      harness?.dispose();
    },
  };
}
