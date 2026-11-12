import { Money } from "@shop/agent-protocol";
import { z } from "zod";
import {
  type ApprovalItem,
  createHarness,
  defineTool,
  type FakeProviderOptions,
  fakeProvider,
  type HarnessDeps,
  MemoryThreadStore,
  type Notification,
  type ToolContext,
} from "../src";

export const searchTool = defineTool({
  name: "demo_search",
  description: "Search demo products.",
  args: z.object({ query: z.string().min(1), objective: z.string().min(1) }),
  result: z.object({
    offers: z.array(z.object({ id: z.string(), title: z.string(), price: Money })),
  }),
  summarize: (a) => `Searching for ${a.query}`,
  run: async (a, ctx) => {
    ctx.progress("Searching", 0.5);
    return {
      offers: [
        { id: "o1", title: `${a.query} deluxe`, price: { amountMinor: 1999, currency: "USD" } },
      ],
    };
  },
});

export const buyCalls: ToolContext[] = [];
export const buyTool = defineTool({
  name: "demo_buy",
  description: "Buy a demo offer (needs approval).",
  args: z.object({ offerId: z.string() }),
  result: z.object({ orderId: z.string() }),
  needsApproval: (a) => ({
    kind: "purchase",
    title: "Buy demo offer",
    summary: `Buy ${a.offerId}`,
    amount: { amountMinor: 1999, currency: "USD" },
  }),
  summarize: (a) => `Buying ${a.offerId}`,
  run: async (a, ctx) => {
    buyCalls.push(ctx);
    return { orderId: `ord_${a.offerId}` };
  },
});

export const rules: NonNullable<FakeProviderOptions["rules"]> = [
  { match: /\bbuy\b/i, tool: "demo_buy", input: { offerId: "o1" } },
  {
    match: /\bsearch|find\b/i,
    tool: "demo_search",
    input: (t: string) => ({ query: t.replace(/^(search|find)\s+/i, ""), objective: "demo" }),
  },
];

export function setup(over: Partial<HarnessDeps> & { fake?: FakeProviderOptions } = {}) {
  const store = new MemoryThreadStore();
  const published: Notification[] = [];
  const approvals: ApprovalItem[] = [];
  let clock = new Date("2026-11-13T10:00:00.000Z").getTime();
  let n = 0;
  const harness = createHarness({
    userId: "u1",
    store,
    model: fakeProvider({ rules, ...over.fake }),
    tools: [searchTool, buyTool],
    systemPrompt: () => "test",
    publish: (x) => published.push(x),
    requestApproval: (a) => approvals.push(a),
    now: () => new Date(clock),
    newId: (p) => `${p}_${++n}`,
    ...over,
  });
  return {
    store,
    harness,
    published,
    approvals,
    advance: (ms: number) => {
      clock += ms;
    },
    methods: () => published.map((p) => p.method),
  };
}
