import { env } from "cloudflare:workers";
import { expect, it } from "vitest";
import type { Env } from "../src/env";
import { app } from "../src/index";

it("answers /health", async () => {
  const res = await app.request("/health", {}, env as unknown as Env);
  expect(res.status).toBe(200);
  expect(await res.json()).toMatchObject({ ok: true, app: "engine", paypalMode: "simulated" });
});
