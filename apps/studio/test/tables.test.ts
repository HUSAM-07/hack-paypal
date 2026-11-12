import { describe, expect, it } from "vitest";

describe("agent label", () => {
  it("names seeded stand-in agents plainly and keeps real model ids", async () => {
    const { agentLabel } = await import("../src/tables");
    expect(agentLabel("fake-gpt")).toBe("Seeded demo agent");
    expect(agentLabel("scripted-gpt")).toBe("Seeded demo agent");
    expect(agentLabel("claude-sonnet-5-5")).toBe("claude-sonnet-5-5");
  });
});
