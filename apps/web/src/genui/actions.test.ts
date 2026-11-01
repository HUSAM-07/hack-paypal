import { describe, expect, it, vi } from "vitest";
import { createHostActions } from "./actions";

describe("host actions", () => {
  it("only forwards catalog actions with valid payloads", () => {
    const h = {
      issueTurn: vi.fn(),
      openProduct: vi.fn(),
      openCommit: vi.fn(),
      copy: vi.fn(),
      stageUiState: vi.fn(),
    };
    const a = createHostActions(h, { interactive: true, viewerId: "u" });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    a.run("openCommit", { pactRef: "pact_ps6flat" });
    a.run("openCommit", { pactRef: "javascript:alert(1)" });
    a.run("issueTurn", { text: "" });
    // biome-ignore lint/suspicious/noExplicitAny: deliberately calling an action outside the catalog
    (a.run as any)("transferMoney", { amount: 1 });
    expect(h.openCommit).toHaveBeenCalledTimes(1);
    expect(h.issueTurn).not.toHaveBeenCalled();
    warn.mockRestore();
  });
});
