import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { Hono } from "hono";
import { createCatalogue, DEV_PASSPORT_KEY } from "./catalogue";
import { createMcpServer } from "./server";

export const PORT = 8801;

const paypalMode = () => process.env.PAYPAL_MODE ?? "simulated";

/** Dev key only in simulated mode; a live deployment must set the secret. */
function passportKey(): string {
  const key = process.env.PASSPORT_SIGNING_KEY;
  if (key) return key;
  if (paypalMode() === "simulated") return DEV_PASSPORT_KEY;
  throw new Error("PASSPORT_SIGNING_KEY is required outside simulated mode");
}

export const catalogue = createCatalogue({
  seed: process.env.CATALOGUE_SEED ?? "cited-demo",
  passportKey: passportKey(),
  allowSessionId: paypalMode() === "simulated",
});

export const app = new Hono();

app.get("/health", (c) =>
  c.json({
    ok: true,
    app: "catalogue-mcp",
    paypalMode: paypalMode(),
    modelProvider: process.env.MODEL_PROVIDER ?? "fake",
  }),
);

/** Streamable HTTP MCP endpoint. Stateless: the passport, not a transport session, carries state. */
app.all("/mcp", async (c) => {
  const transport = new WebStandardStreamableHTTPServerTransport({ enableJsonResponse: true });
  await createMcpServer(catalogue).connect(transport);
  return transport.handleRequest(c.req.raw);
});

/** Demo clock control, simulated mode only: jump forward to show the day-7 holdout switch. */
app.post("/demo/advance-days", async (c) => {
  if (paypalMode() !== "simulated") return c.json({ error: "not available" }, 404);
  const { days } = await c.req.json<{ days?: number }>();
  if (typeof days !== "number" || !Number.isFinite(days) || days < 0) {
    return c.json({ error: "days must be a non-negative number" }, 400);
  }
  catalogue.clock.advanceDays(days);
  return c.json({ now: catalogue.clock.now().toISOString() });
});
