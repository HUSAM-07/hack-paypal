/**
 * A stand-in domain so the App Server runs end to end before `@shop/commerce` lands: one search
 * tool and one purchase tool that needs approval, both on canned data. Shapes follow the
 * product contract, so widgets built against it render these results.
 */
import { Money } from "@shop/agent-protocol";
import { type ShopState, ShopState as ShopStateSchema } from "@shop/commerce/contract";
import { defineTool } from "@shop/harness";
import { z } from "zod";
import { defineAction, defineShopDomain } from "./domain";

const DEMO_OFFERS = [
  {
    id: "demo_xm6",
    title: "Sony WH-1000XM6 headphones",
    price: { amountMinor: 32900, currency: "USD" },
  },
  {
    id: "demo_qc",
    title: "Bose QuietComfort Ultra headphones",
    price: { amountMinor: 29900, currency: "USD" },
  },
  {
    id: "demo_s9",
    title: "Roborock S9 robot vacuum",
    price: { amountMinor: 79900, currency: "USD" },
  },
] as const;

const DemoOffer = z.object({ id: z.string(), title: z.string(), price: Money });

export const initialShopState = (): ShopState => ({
  watches: [],
  orders: [],
  wallet: { connected: false },
  coolingOffMinutes: 10,
  stepUpAbove: { amountMinor: 50000, currency: "USD" },
});

export const stubDomain = defineShopDomain<ShopState>((ctx) => {
  const demoSearch = defineTool({
    name: "demo_search",
    description: "Search the demo catalogue. Takes a query and an objective.",
    args: z.object({ query: z.string().min(1).max(300), objective: z.string().min(1).max(600) }),
    result: z.object({ offers: z.array(DemoOffer) }),
    summarize: (a) => `Searching the demo catalogue for “${a.query}”`,
    run: (a, tc) => {
      tc.progress("Searching the demo catalogue", 0.5);
      const words = a.query.toLowerCase().split(/\s+/).filter(Boolean);
      const offers = DEMO_OFFERS.filter((o) =>
        words.some((w) => o.title.toLowerCase().includes(w)),
      );
      return { offers: offers.length > 0 ? [...offers] : [...DEMO_OFFERS] };
    },
  });

  const demoBuy = defineTool({
    name: "demo_buy",
    description: "Buy a demo offer by id. Always asks the user to approve first.",
    args: z.object({ offerId: z.string().min(1).max(64) }),
    result: z.object({ orderId: z.string(), offerId: z.string(), total: Money }),
    needsApproval: (a) => {
      const offer = DEMO_OFFERS.find((o) => o.id === a.offerId);
      if (!offer) return false;
      return {
        kind: "purchase",
        title: `Buy ${offer.title}`,
        summary: "Demo purchase: no money moves.",
        amount: offer.price,
        details: { offer },
        stepUp: offer.price.amountMinor > ctx.getState().stepUpAbove.amountMinor,
      };
    },
    summarize: (a) => `Buying ${a.offerId}`,
    run: (a, tc) => {
      const offer = DEMO_OFFERS.find((o) => o.id === a.offerId);
      if (!offer) throw new Error(`No demo offer ${a.offerId}.`);
      if (!tc.approval) throw new Error("A purchase needs the user's approval.");
      ctx.notify({
        threadId: tc.threadId,
        level: "success",
        title: `Demo order placed: ${offer.title}`,
      });
      return { orderId: `demo_order_${tc.toolCallId}`, offerId: offer.id, total: offer.price };
    },
  });

  return {
    initialState: initialShopState(),
    stateSchema: ShopStateSchema,
    tools: [demoSearch, demoBuy],
    actions: {
      "settings.update": defineAction({
        args: z.object({ coolingOffMinutes: z.number().int().min(0).max(1440).optional() }),
        run: (a) =>
          ctx.updateState((s) => ({
            ...s,
            ...(a.coolingOffMinutes === undefined
              ? {}
              : { coolingOffMinutes: a.coolingOffMinutes }),
          })),
      }),
    },
    systemPrompt:
      "## Demo mode\nThis deployment runs a demo catalogue. Use demo_search to find products and demo_buy to buy one; purchases are simulated.",
    fakeRules: [
      {
        match: /\bbuy\b/i,
        tool: "demo_buy",
        input: { offerId: "demo_xm6" },
        reasoning: "The user wants to buy the headphones.",
      },
      {
        match: /\b(find|search|look|show|headphones?|vacuum)\b/i,
        tool: "demo_search",
        input: (text: string) => ({
          query: text.slice(0, 300),
          objective: "Products the user can buy now.",
        }),
        reasoning: "Searching the catalogue first.",
      },
    ],
    capabilities: ["demo"],
  };
});
