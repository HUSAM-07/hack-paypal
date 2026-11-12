// Cloudflare layer for the shop vertical: ShopperAgent (per-user Durable Object = App Server),
// the /api/shop routes pact-worker mounts, the AG-UI adapter and the domain seam.

export { type ShopSummary, summarizeShop } from "@shop/commerce";
export { type ShopEnv, ShopperAgent } from "./agent";
export * from "./agui";
export * from "./domain";
export { readShopState, type ShopRouterOptions, shopRouter } from "./router";
export { migrateShopTables, SqlStateStore, type SqlTag, SqlThreadStore } from "./sql-store";
export { initialShopState, stubDomain } from "./stub-domain";
