import type { Mandate, Money, Pact, PactMember, Thread } from "@pact/protocol";
import type { ActivityEntry, MandateData, PactData, ProductData, TransferData } from "@/genui/refs";

export const usd = (amountMinor: number): Money => ({ amountMinor, currency: "USD" });

export const ME = "user_alex";
export const USERS: Record<string, { name: string; email: string }> = {
  user_alex: { name: "Alex Morgan", email: "alex@pact.test" },
  user_sam: { name: "Sam Rivera", email: "sam@pact.test" },
  user_ari: { name: "Ari Chen", email: "ari@pact.test" },
  user_jo: { name: "Jo Park", email: "jo@pact.test" },
};

export function nameOf(userId: string): string {
  return USERS[userId]?.name ?? userId;
}

const DAY = 86_400_000;
export const iso = (offsetMs = 0) => new Date(Date.now() + offsetMs).toISOString();

export const THREADS: Thread[] = [
  {
    id: "thread_ps6flat",
    title: "PS6 for the flat",
    kind: "group",
    memberIds: ["user_alex", "user_sam", "user_ari"],
    createdAt: iso(-2 * DAY),
    archived: false,
  },
  {
    id: "thread_coffee",
    title: "Coffee fund",
    kind: "group",
    memberIds: ["user_alex", "user_sam", "user_jo"],
    createdAt: iso(-9 * DAY),
    archived: false,
  },
  {
    id: "thread_personal",
    title: "Personal",
    kind: "solo",
    memberIds: ["user_alex"],
    createdAt: iso(-20 * DAY),
    archived: false,
  },
];

export const PRODUCTS: Record<string, ProductData> = {
  product_ps6digi: {
    title: "PlayStation 6 Digital Edition, 2TB",
    brand: "Sony",
    price: usd(49_999),
    listPrice: usd(54_999),
    merchant: "Pact Sandbox Store",
    category: "consoles",
    imageUrl: "/products/console-digital.svg",
    rating: 4.8,
    features: ["2TB SSD", "No disc drive", "DualSense 2", "8K output"],
    specs: { Storage: "2TB SSD", "Disc drive": "No", Controllers: "1" },
  },
  product_ps6disc: {
    title: "PlayStation 6 Standard Edition with Disc Drive",
    brand: "Sony",
    price: usd(59_999),
    merchant: "Pact Sandbox Store",
    category: "consoles",
    imageUrl: "/products/console-disc.svg",
    rating: 4.7,
    features: ["2TB SSD", "Disc drive", "DualSense 2", "8K output"],
    specs: { Storage: "2TB SSD", "Disc drive": "Yes", Controllers: "1" },
  },
  product_ps6probn: {
    title: "PlayStation 6 Pro Bundle + 2 Controllers",
    brand: "Sony",
    price: usd(79_999),
    listPrice: usd(84_999),
    merchant: "Northwind Games",
    category: "consoles",
    imageUrl: "/products/console-pro.svg",
    rating: 4.9,
    features: ["4TB SSD", "Disc drive", "2× DualSense 2", "Pro GPU"],
    specs: { Storage: "4TB SSD", "Disc drive": "Yes", Controllers: "2" },
  },
};

function member(
  userId: string,
  cap: number,
  status: PactMember["status"],
  role: PactMember["role"] = "member",
): PactMember {
  return { userId, displayName: nameOf(userId), role, cap: usd(cap), status };
}

export function ps6Pact(
  state: Pact["state"],
  statuses: Record<string, PactMember["status"]>,
): Pact {
  return {
    id: "pact_ps6flat",
    threadId: "thread_ps6flat",
    title: "PS6 Digital for the flat",
    instruction: "Split a PS6 Digital with Sam and Ari when it drops under $450",
    organizerId: ME,
    members: [
      member("user_alex", 16_000, statuses.user_alex ?? "invited", "organizer"),
      member("user_sam", 16_000, statuses.user_sam ?? "invited"),
      member("user_ari", 16_000, statuses.user_ari ?? "invited"),
    ],
    trigger: {
      kind: "price",
      productRef: "product_ps6digi",
      maxPrice: usd(45_000),
      deadline: iso(3 * DAY),
    },
    action: { kind: "purchase", productRef: "product_ps6digi", quantity: 1 },
    split: { kind: "equal" },
    state,
    createdAt: iso(-60_000),
    updatedAt: iso(),
  };
}

const HISTORY = [52_999, 51_999, 51_999, 49_999, 50_999, 49_999, 49_999];

export function ps6PactData(pact: Pact, current = 49_999): PactData {
  // Budget at the target until the trigger fires: the order only happens at or below it.
  const target = pact.trigger.kind === "price" ? pact.trigger.maxPrice.amountMinor : current;
  const totalMinor = Math.min(current, target);
  return {
    pact,
    total: usd(totalMinor),
    shares: splitEqual(
      totalMinor,
      pact.members.map((m) => m.userId),
    ),
    watch: {
      current: usd(current),
      history: [...HISTORY, current].map((p, i, a) => ({
        at: iso(-(a.length - 1 - i) * DAY),
        price: usd(p),
      })),
      checkedAt: iso(),
    },
    product: PRODUCTS.product_ps6digi,
  };
}

/** Largest-remainder equal split; the organizer (first) absorbs leftover cents. */
export function splitEqual(totalMinor: number, userIds: string[]) {
  const base = Math.floor(totalMinor / userIds.length);
  const rem = totalMinor - base * userIds.length;
  return userIds.map((userId, i) => ({ userId, share: usd(base + (i < rem ? 1 : 0)) }));
}

export function mandateFor(pactId: string, id = "mandate_alexps6"): Mandate {
  return {
    id,
    userId: ME,
    pactId,
    maxPerCharge: usd(16_000),
    maxTotal: usd(16_000),
    period: "none",
    validFrom: iso(),
    validUntil: iso(3 * DAY),
    maxCharges: 1,
    stepUpAbove: usd(10_000),
    fundingRef: "fund_paypalalex",
    status: "active",
    createdAt: iso(),
  };
}

export const COFFEE_MANDATE: MandateData = {
  label: "Coffee fund · standing order",
  spent: usd(5_000),
  mandate: {
    id: "mandate_alexcoffee",
    userId: ME,
    pactId: "pact_coffeefd",
    maxPerCharge: usd(2_500),
    maxTotal: usd(30_000),
    period: "month",
    categories: ["groceries"],
    merchantAllow: ["Blue Bottle"],
    validFrom: iso(-9 * DAY),
    validUntil: iso(180 * DAY),
    stepUpAbove: usd(5_000),
    fundingRef: "fund_paypalalex",
    status: "active",
    createdAt: iso(-9 * DAY),
  },
};

export function coffeePact(): Pact {
  return {
    id: "pact_coffeefd",
    threadId: "thread_coffee",
    title: "Office coffee beans",
    instruction: "Every two weeks, put $25 each toward Blue Bottle beans",
    organizerId: ME,
    members: [
      member("user_alex", 2_500, "committed", "organizer"),
      member("user_sam", 2_500, "committed"),
      member("user_jo", 2_500, "committed"),
    ],
    trigger: { kind: "schedule", everyDays: 14, startAt: iso(-9 * DAY), maxRuns: 12 },
    action: { kind: "collect", total: usd(7_500) },
    split: { kind: "equal" },
    state: "armed",
    createdAt: iso(-9 * DAY),
    updatedAt: iso(-2 * DAY),
  };
}

export function coffeePactData(): PactData {
  return {
    pact: coffeePact(),
    total: usd(7_500),
    shares: splitEqual(7_500, ["user_alex", "user_sam", "user_jo"]),
    nextRuns: [5, 19, 33, 47].map((d) => iso(d * DAY)),
  };
}

export function transferDraft(to: string, amountMinor: number, note: string): TransferData {
  return {
    direction: "send",
    fromUserId: ME,
    fromName: nameOf(ME),
    counterpartyUserId: to,
    counterpartyName: nameOf(to),
    counterpartyEmail: USERS[to]?.email,
    amount: usd(amountMinor),
    fee: usd(0),
    note,
    status: "draft",
    createdAt: iso(),
    eta: "Instant to PayPal balance",
  };
}

export const SEED_ACTIVITY: ActivityEntry[] = [
  {
    id: "act_c2",
    at: iso(-2 * DAY),
    title: "Coffee fund",
    subtitle: "Standing order · run 1 of 12",
    kind: "charged",
    amount: usd(2_500),
    direction: "out",
  },
  {
    id: "act_c1",
    at: iso(-4 * DAY),
    title: "Jo Park",
    subtitle: "Paid you back · Pizza night",
    kind: "received",
    amount: usd(1_850),
    direction: "in",
  },
  {
    id: "act_c0",
    at: iso(-9 * DAY),
    title: "Coffee fund created",
    subtitle: "3 members committed",
    kind: "pact",
    direction: "none",
  },
];
