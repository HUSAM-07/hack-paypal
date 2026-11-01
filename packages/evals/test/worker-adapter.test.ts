import type { ChatMessage, ModelProvider, ProviderEvent } from "@pact/worker/agent";
import { describe, expect, it } from "vitest";
import { jsonUiToOpenUi, workerAdapter } from "../src/adapters/worker";
import { grade } from "../src/graders/grade";
import { fixtureFor, loadScenarios, runScenario } from "../src/harness";

const scenario = (id: string) => {
  const s = loadScenarios().find((x) => x.id === id);
  if (!s) throw new Error(`no scenario ${id}`);
  return s;
};

/** One scripted model step per entry: optional text, optional tool calls. */
function scripted(
  steps: ((messages: ChatMessage[]) => {
    text?: string;
    calls?: { name: string; input: unknown }[];
  })[],
): ModelProvider & { seen: ChatMessage[][] } {
  let i = 0;
  const seen: ChatMessage[][] = [];
  return {
    name: "scripted",
    seen,
    async *stream(req): AsyncIterable<ProviderEvent> {
      seen.push(structuredClone(req.messages));
      const step = steps[i++]?.(req.messages) ?? { text: "Done." };
      if (step.text) yield { type: "text", delta: step.text };
      for (const [n, c] of (step.calls ?? []).entries()) {
        yield { type: "toolCall", call: { id: `call_${i}_${n}`, ...c } };
      }
      yield { type: "finish", reason: "stop" };
    },
  };
}

const lang = (...lines: string[]) => `\`\`\`openui-lang\n${lines.join("\n")}\n\`\`\``;

describe("workerAdapter", () => {
  it("runs the worker tools and passes a correct transfer", async () => {
    const s = scenario("fidelity-cents-transfer");
    const provider = scripted([
      () => ({
        calls: [
          {
            name: "draftTransfer",
            input: { direction: "send", counterpartyUserId: "user_alice", amountMinor: 1250 },
          },
        ],
      }),
      (m) => {
        const out = (m.at(-1) as { results: { output: { transferRef: string } }[] }).results[0];
        return {
          text: `Here's the $12.50 send.\n${lang("root = Stack([t])", `t = TransferFundsCard("${out?.output.transferRef}")`)}`,
        };
      },
    ]);
    const t = await runScenario(workerAdapter({ provider }), s);
    const g = grade(s, t, fixtureFor(s));
    expect(g.checks.filter((c) => !c.pass)).toEqual([]);
    // The worker's per-turn context reached the model.
    const first = provider.seen[0]?.at(-1) as { content: string };
    expect(first.content).toContain(
      "Now: 2026-11-04T18:00:00.000Z (Wednesday in America/Los_Angeles)",
    );
    expect(first.content).toContain('<member_message author="Bob" user_id="user_bob">');
  });

  it("retries invalid UI once and only ships the fixed message", async () => {
    const s = scenario("fidelity-product-price");
    const provider = scripted([
      () => ({ calls: [{ name: "searchProducts", input: { query: "ninja air fryer" } }] }),
      () => ({ text: lang("root = Stack([c])", 'c = Callout("danger", "Cheap!")') }),
      (m) => {
        expect((m.at(-1) as { content: string }).content).toContain("<ui_diagnostics>");
        return {
          text: `It's $129.00 right now.\n${lang("root = Stack([p])", 'p = ProductCards(["product_airfry01"])')}`,
        };
      },
    ]);
    const t = await runScenario(workerAdapter({ provider }), s);
    const turn = t.turns.at(-1);
    const messages = turn?.items.filter((i) => i.type === "agentMessage") ?? [];
    expect(messages.map((m) => m.status)).toEqual(["failed", "completed"]);
    expect(grade(s, t, fixtureFor(s)).checks.filter((c) => !c.pass)).toEqual([]);
  });

  it("records spends in the reference arg shape and narrates pending approval", async () => {
    const s = scenario("tools-spend-after-confirm");
    const provider = scripted([
      () => ({ calls: [{ name: "requestSpend", input: { targetRef: "product_airfry01" } }] }),
      (m) => {
        const out = (m.at(-1) as { results: { output: { status: string } }[] }).results[0];
        return {
          text: `Status: ${out?.output.status}. ${lang("root = Stack([c])", 'c = Callout("info", "Approve it in the sheet.")')}`,
        };
      },
    ]);
    const t = await runScenario(workerAdapter({ provider }), s);
    const call = t.turns.at(-1)?.toolCalls[0];
    expect(call?.args).toMatchObject({ productRef: "product_airfry01", quantity: 1 });
    expect(call?.result).toMatchObject({ amountDisplay: "$129.00" });
  });

  it("converts reference JSON UI in seeded history to OpenUI Lang", () => {
    const out = jsonUiToOpenUi(
      'Plan:\n```ui\n{"component":"Stack","props":{"children":[{"component":"PlanCard","props":{"title":"Buy","steps":["a","b"]}},{"component":"ProductCards","props":{"productRefs":["product_ps6std01"]}}]}}\n```',
    );
    expect(out).toBe(
      'Plan:\n```openui-lang\nroot = Stack([n1, n2])\nn1 = PlanCard("Buy", ["a", "b"])\nn2 = ProductCards(["product_ps6std01"])\n```',
    );
  });
});
