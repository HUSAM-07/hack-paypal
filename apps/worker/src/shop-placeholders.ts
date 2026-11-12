/**
 * TEMPORARY. wrangler refuses to deploy a Durable Object or Workflow binding whose class the
 * entrypoint doesn't export, and wrangler.jsonc binds SHOPPER (ShopperAgent) and CHECKOUT
 * (CheckoutWorkflow) before apps/shop ships them. These stand-ins keep the config deployable;
 * nothing routes to them while SHOP_ENABLED is off.
 *
 * Integrator: delete this file and export the real classes from src/index.ts instead.
 */
import { DurableObject, WorkflowEntrypoint } from "cloudflare:workers";
import type { Env } from "./env";

export class ShopperAgent extends DurableObject<Env> {
  override async fetch(): Promise<Response> {
    return Response.json({ error: "not_found" }, { status: 404 });
  }
}

export class CheckoutWorkflow extends WorkflowEntrypoint<Env> {
  override async run(): Promise<void> {
    throw new Error("CheckoutWorkflow is a placeholder; the shop is not deployed yet");
  }
}
