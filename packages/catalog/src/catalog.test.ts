import { describe, expect, it } from "vitest";
import { validateNode } from "./index";

const refs = new Set(["product_abcd1234", "pact_zz99yy88"]);

describe("validateNode", () => {
  it("accepts known components with known refs", () => {
    expect(validateNode("ProductCards", { productRefs: ["product_abcd1234"] }, refs)).toEqual([]);
  });

  it("flags refs the server never produced (model-invented data)", () => {
    const d = validateNode("PactCard", { pactRef: "pact_made0up1" }, refs);
    expect(d).toMatchObject([{ code: "unknown_ref" }]);
  });

  it("refuses host-only components so approvals can't be forged", () => {
    expect(validateNode("ApprovalSheet", {}, refs)).toMatchObject([{ code: "host_only" }]);
  });

  it("rejects unknown components and literal amounts", () => {
    expect(validateNode("PayButton", {}, refs)).toMatchObject([{ code: "unknown_component" }]);
    expect(validateNode("TransferFundsCard", { amount: "500.00" }, refs)).toMatchObject([
      { code: "invalid_props" },
    ]);
  });
});
