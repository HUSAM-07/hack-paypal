// The shop SPA. `mountShop(el, { wsUrl })` renders it into a host page (apps/web serves it at
// /shop via a shop.html entry); without `wsUrl` it runs on the in-browser MockHarness.
export { MockHarness, type MockOptions } from "./mock/harness";
export { type MountShopOptions, mountShop, type ShopHandle } from "./mount";
export { RpcError, ShopClient, type ShopClientOptions } from "./protocol/client";
export { applyPatch, type PatchOp } from "./protocol/patch";
export { type ClientState, reduce } from "./protocol/state";
export { type Connect, type Transport, webSocketTransport } from "./protocol/transport";
