// /shop: the shopping agent (apps/shop-web) against the worker's ShopperAgent at /api/shop/ws.
// `?mock` runs the in-page MockHarness instead, for demos without a backend.
// The theme is shop-web's copy of the CITED light theme until feat/ui-redesign lands its shared
// tokens; then this imports those instead.
import "@shop/web/site-theme.css";
import { mountShop } from "@shop/web";

const el = document.getElementById("root");
if (el) {
  const mock = new URLSearchParams(window.location.search).has("mock");
  const wsUrl = `${window.location.protocol === "https:" ? "wss" : "ws"}://${window.location.host}/api/shop/ws`;
  mountShop(el, {
    ...(mock ? {} : { wsUrl }),
    signInUrl: "/api/auth/google/start?returnTo=/shop",
  });
}
