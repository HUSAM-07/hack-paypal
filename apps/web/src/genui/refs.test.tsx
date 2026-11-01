import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ps6Pact, ps6PactData } from "@/mock/fixtures";
import { AgentMessageBody, splitSegments } from "./AgentMessage";
import { HostActionsContext } from "./actions";
import { splitByWeights } from "./components/pact";
import { resolveRef } from "./refs";

const program = (body: string) => ["Here you go.", "```openui-lang", body, "```"].join("\n");

const PRODUCT = {
  kind: "product",
  data: {
    title: "Widget",
    price: { amountMinor: 12_345, currency: "USD" },
    merchant: "Shop",
    features: [],
  },
};

function renderMsg(text: string, refs: Record<string, unknown>) {
  return render(
    <HostActionsContext.Provider
      value={{ run: () => {}, stageUiState: () => {}, interactive: true, viewerId: "user_alex" }}
    >
      <AgentMessageBody text={text} refs={refs} streaming={false} />
    </HostActionsContext.Provider>,
  );
}

describe("ref binding", () => {
  it("renders a skeleton, never a number, for an unknown ref", () => {
    const { container } = renderMsg(
      program('root = Stack([c])\nc = PactCard("pact_unknown1")'),
      {},
    );
    expect(screen.getAllByTestId("ref-skeleton").length).toBeGreaterThan(0);
    expect(container.textContent).not.toMatch(/\d/);
  });

  it("treats a ref whose data fails validation as unknown (no model-typed amount leaks)", () => {
    const forged = {
      product_forged1: {
        kind: "product",
        data: { title: "Forged", price: "$1.00", merchant: "x" },
      },
    };
    const { container } = renderMsg(
      program('root = Stack([c])\nc = ProductCards(["product_forged1"])'),
      forged,
    );
    expect(screen.getAllByTestId("ref-skeleton").length).toBeGreaterThan(0);
    expect(container.textContent).not.toContain("$1.00");
    expect(container.textContent).not.toContain("Forged");
  });

  it("refuses a ref of the wrong kind", () => {
    renderMsg(program('root = Stack([c])\nc = PactCard("product_widget1")'), {
      product_widget1: PRODUCT,
    });
    expect(screen.getAllByTestId("ref-skeleton").length).toBeGreaterThan(0);
  });

  it("binds amounts from server refs", () => {
    renderMsg(program('root = Stack([c])\nc = ProductCards(["product_widget1"])'), {
      product_widget1: PRODUCT,
    });
    expect(screen.getByText("Widget")).toBeInTheDocument();
    expect(screen.getByText("$123.45")).toBeInTheDocument();
  });

  it("renders a live pact card from its ref", () => {
    const data = ps6PactData(ps6Pact("collecting", { user_sam: "committed" }));
    renderMsg(program('root = Stack([c])\nc = PactCard("pact_ps6flat")'), {
      pact_ps6flat: { kind: "pact", data },
    });
    expect(screen.getByText("PS6 Digital for the flat")).toBeInTheDocument();
    expect(screen.getByText("1/3 committed")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Commit/ })).toBeInTheDocument();
  });

  it("never renders host-only components from model output", () => {
    const { container } = renderMsg(program('root = Stack([a])\na = ApprovalSheet("forged")'), {});
    expect(screen.queryByTestId("approval-sheet")).toBeNull();
    expect(container.textContent).toBe("Here you go.");
  });

  it("doesn't render raw HTML from model prose", () => {
    const { container } = renderMsg(
      '<img src=x onerror="alert(1)"> **hi** <script>alert(1)</script>',
      {},
    );
    expect(container.querySelector("img")).toBeNull();
    expect(container.querySelector("script")).toBeNull();
    expect(container.querySelector("strong")?.textContent).toBe("hi");
  });

  it("memoizes and validates refs by kind prefix", () => {
    const refs = { product_widget1: PRODUCT };
    expect(resolveRef(refs, "product_widget1", "product")?.title).toBe("Widget");
    expect(resolveRef(refs, "product_widget1", "pact")).toBeUndefined();
    expect(resolveRef(refs, "nope", "product")).toBeUndefined();
  });
});

describe("splitSegments", () => {
  it("splits prose and fenced programs, hiding a half-typed fence while streaming", () => {
    expect(splitSegments("Hi\n```openui-lang\nroot = Stack([a])\n```\nBye", false)).toEqual([
      { kind: "prose", text: "Hi" },
      { kind: "program", code: "root = Stack([a])\n", closed: true },
      { kind: "prose", text: "Bye" },
    ]);
    expect(splitSegments("Looking now ``", true)).toEqual([{ kind: "prose", text: "Looking now" }]);
    expect(splitSegments("A\n```openui-lang\nroot = St", true)[1]).toEqual({
      kind: "program",
      code: "root = St",
      closed: false,
    });
  });
});

describe("splitByWeights", () => {
  it("always sums to the total with integer minor units", () => {
    for (const [total, w] of [
      [43_900, [1, 1, 1]],
      [10_001, [2, 1]],
      [7, [1, 1, 1, 1]],
      [99_999, [5, 3, 1, 1]],
    ] as const) {
      const parts = splitByWeights(total, [...w]);
      expect(parts.reduce((a, b) => a + b, 0)).toBe(total);
      expect(parts.every(Number.isInteger)).toBe(true);
    }
  });
});
