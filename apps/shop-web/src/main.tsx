// Standalone dev entry: `npm run dev -w @shop/web`. `?ws=/api/shop/ws` talks to a real server;
// otherwise the MockHarness runs in the page.
// The one CITED theme (generated from packages/protocol/src/theme.ts); apps/web owns the file.
import "../../web/src/styles/site-theme.css";
import { mountShop } from "./mount";

const el = document.getElementById("root");
if (el) {
  const ws =
    new URLSearchParams(window.location.search).get("ws") ?? import.meta.env.VITE_SHOP_WS_URL;
  const handle = mountShop(el, ws ? { wsUrl: ws } : {});
  // Handy in the console for demos: __shop.harness.dropAll() simulates a network drop.
  (window as unknown as { __shop: unknown }).__shop = handle;
}
