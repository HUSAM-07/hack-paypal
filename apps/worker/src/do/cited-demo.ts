import { DurableObject } from "cloudflare:workers";
import { type ExecCtx, serveStatefulDemo } from "../cited-apps";
import type { Env } from "../env";

/**
 * The single instance ("demo") that serves /catalogue and, in simulated mode, /api/cited.
 * Their state lives in this object's memory: the simulated PayPal orders and captures the
 * agents' checkouts create, and the catalogue's demo clock. It resets when the object is evicted after a few idle minutes; the money the
 * engine records lives in D1 and is unaffected.
 */
export class CitedDemoDO extends DurableObject<Env> {
  /** Requests from the internet (forwarded by the worker): CITED writes need the token. */
  override fetch(req: Request): Promise<Response> {
    return serveStatefulDemo(req, this.env, this.execCtx(), "public");
  }

  /**
   * RPC for the worker's own server-side code (/try, Studio's approve). Only code holding the
   * CITED_DEMO binding can call it, so it needs no token and none ever leaves the worker.
   */
  internal(req: Request): Promise<Response> {
    return serveStatefulDemo(req, this.env, this.execCtx(), "internal");
  }

  private execCtx(): ExecCtx {
    return {
      waitUntil: (p: Promise<unknown>) => this.ctx.waitUntil(p),
      passThroughOnException: () => {},
      props: {},
    } as unknown as ExecCtx;
  }
}
