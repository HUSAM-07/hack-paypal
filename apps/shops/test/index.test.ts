import { expect, it } from "vitest";
import { app } from "../src/index";

it("answers /health", async () => {
  const res = await app.request("/health");
  expect(res.status).toBe(200);
  expect(await res.json()).toMatchObject({ ok: true, app: "shops" });
});
