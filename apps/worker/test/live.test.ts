/**
 * Opt-in smoke test against the real Anthropic API: `npm run test:live -w @pact/worker`.
 * Reads ANTHROPIC_API_KEY from the gitignored .dev.vars. Never runs in CI.
 */
import { describe, expect, it } from "vitest";
import { devLogin, TestClient } from "./helpers/client";

describe("live model", () => {
  it("searches products and renders them by ref", async () => {
    const { cookie } = await devLogin("live1", "Ada");
    const { client: c, threadId } = await TestClient.open(cookie);
    await c.call("turn/start", {
      threadId,
      text: "find me noise-cancelling headphones under $300",
    });
    const done = await c.turnCompleted(1, 110_000);
    expect(done.params?.status).toBe("completed");

    const tools = c.items("toolCall").map((i) => i.name);
    expect(tools).toContain("searchProducts");
    const final = c.items("agentMessage").at(-1) as {
      text: string;
      refs: Record<string, unknown>;
      diagnostics: { code: string }[];
    };
    expect(Object.keys(final.refs).some((r) => r.startsWith("product_"))).toBe(true);
    expect(final.text).toContain("```openui-lang");
    // Surface (don't fail on) catalog drift so prompt fixes are visible in the output.
    if (final.diagnostics.length) console.warn("diagnostics", final.diagnostics);
    c.close();
  });
});
