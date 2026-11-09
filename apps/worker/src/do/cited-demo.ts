import { DurableObject } from "cloudflare:workers";
import { type ExecCtx, serveStatefulDemo } from "../cited-apps";
import type { Env } from "../env";

/**
 * The single instance ("demo") that serves /shops and /catalogue. Their state lives in this
 * object's memory: simulated PayPal orders between create and capture, and the catalogue's
 * demo clock. It resets when the object is evicted after a few idle minutes; the money the
 * engine records lives in D1 and is unaffected.
 */
export class CitedDemoDO extends DurableObject<Env> {
  override fetch(req: Request): Promise<Response> {
    const ctx = {
      waitUntil: (p: Promise<unknown>) => this.ctx.waitUntil(p),
      passThroughOnException: () => {},
      props: {},
    } as unknown as ExecCtx;
    return serveStatefulDemo(req, this.env, ctx);
  }
}
