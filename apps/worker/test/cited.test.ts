import { SELF } from "cloudflare:test";
import { describe, expect, it } from "vitest";

describe("CITED engine mounted at /api/cited", () => {
  it("answers health with its own PayPal mode", async () => {
    const res = await SELF.fetch("https://example.com/api/cited/health");
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, app: "engine", paypalMode: "simulated" });
  });

  it("reaches the engine's tables in the shared database", async () => {
    const res = await SELF.fetch("https://example.com/api/cited/api/clock");
    expect(res.status).toBe(200);
    expect(await res.json()).toHaveProperty("now");
  });

  it("leaves Pact's routes alone", async () => {
    const res = await SELF.fetch("https://example.com/api/health");
    expect(await res.json()).toEqual({ ok: true });
  });
});
