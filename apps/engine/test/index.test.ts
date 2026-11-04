import { expect, it } from "vitest";
import { app } from "../src/index";

it("answers /health", async () => {
  const env = { PAYPAL_MODE: "simulated", MODEL_PROVIDER: "fake" };
  const res = await app.request("/health", {}, env);
  expect(res.status).toBe(200);
  expect(await res.json()).toMatchObject({ ok: true, app: "engine", paypalMode: "simulated" });
});
