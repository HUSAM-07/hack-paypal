/**
 * Demo and test data that satisfies the shop contract: offers, a watch with history, orders.
 * Merchants are fictional (`.example` domains). Product art is inline SVG so nothing loads from
 * a third party. Used by genui tests and the shop-web MockHarness.
 */
import type { Money } from "@shop/agent-protocol";
import type { Offer, Order, ShopState, Source, Watch } from "@shop/commerce/contract";

export const usd = (amountMinor: number): Money => ({ amountMinor, currency: "USD" });

const svg = (body: string) =>
  `data:image/svg+xml;utf8,${encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 90" fill="none" stroke-linecap="round" stroke-linejoin="round"><rect width="120" height="90" fill="#f5f5f6"/>${body}</svg>`,
  )}`;

/** Simple product drawings on a light studio backdrop, like merchant photos (readable in dark mode). */
export const ART = {
  headphones: svg(
    `<path d="M34 56V46a26 26 0 0 1 52 0v10" stroke="#5b5f66" stroke-width="5"/><rect x="26" y="50" width="16" height="26" rx="7" fill="#2b2e33"/><rect x="78" y="50" width="16" height="26" rx="7" fill="#2b2e33"/><rect x="30" y="55" width="8" height="16" rx="4" fill="#4a4e55"/><rect x="82" y="55" width="8" height="16" rx="4" fill="#4a4e55"/>`,
  ),
  headphonesSilver: svg(
    `<path d="M34 56V46a26 26 0 0 1 52 0v10" stroke="#9aa0a8" stroke-width="5"/><rect x="26" y="50" width="16" height="26" rx="7" fill="#c9cdd2"/><rect x="78" y="50" width="16" height="26" rx="7" fill="#c9cdd2"/><rect x="30" y="55" width="8" height="16" rx="4" fill="#e3e6e9"/><rect x="82" y="55" width="8" height="16" rx="4" fill="#e3e6e9"/>`,
  ),
  headphonesSand: svg(
    `<path d="M34 56V46a26 26 0 0 1 52 0v10" stroke="#8c7f6e" stroke-width="5"/><rect x="26" y="50" width="16" height="26" rx="7" fill="#cbbba5"/><rect x="78" y="50" width="16" height="26" rx="7" fill="#cbbba5"/><rect x="30" y="55" width="8" height="16" rx="4" fill="#a8977f"/><rect x="82" y="55" width="8" height="16" rx="4" fill="#a8977f"/>`,
  ),
  headphonesBlue: svg(
    `<path d="M34 56V46a26 26 0 0 1 52 0v10" stroke="#3d4f6e" stroke-width="5"/><rect x="26" y="50" width="16" height="26" rx="7" fill="#7f93b8"/><rect x="78" y="50" width="16" height="26" rx="7" fill="#7f93b8"/><rect x="30" y="55" width="8" height="16" rx="4" fill="#5a6d91"/><rect x="82" y="55" width="8" height="16" rx="4" fill="#5a6d91"/>`,
  ),
  earbuds: svg(
    `<rect x="36" y="38" width="48" height="30" rx="14" fill="#e6e8eb" stroke="#9aa0a8" stroke-width="2"/><path d="M36 50h48" stroke="#b9bec5" stroke-width="2"/><circle cx="52" cy="30" r="7" fill="#f2f3f5" stroke="#9aa0a8" stroke-width="2"/><circle cx="70" cy="30" r="7" fill="#f2f3f5" stroke="#9aa0a8" stroke-width="2"/>`,
  ),
} as const;

const T0 = Date.parse("2026-11-12T09:00:00.000Z");
const iso = (ms: number) => new Date(ms).toISOString();

function merchant(name: string, domain: string, paypalSellerId?: string) {
  return { name, domain, ...(paypalSellerId ? { paypalSellerId } : {}) };
}

export function makeOffers(now = T0): Offer[] {
  const seenAt = iso(now);
  return [
    {
      id: "off_xm6_northwind",
      title: "Sony WH-1000XM6 Wireless Noise Cancelling Headphones, Black",
      brand: "Sony",
      imageUrl: ART.headphones,
      url: "https://northwind-audio.example/p/sony-wh-1000xm6-black",
      merchant: merchant("Northwind Audio", "northwind-audio.example", "NWAUDIO"),
      price: usd(29999),
      listPrice: usd(39999),
      shipping: usd(0),
      inStock: true,
      rating: { value: 4.7, count: 2381 },
      highlights: [
        "Twelve microphones and a new processor for the strongest noise cancelling in the line.",
        "Up to 30 hours per charge; three minutes of charging gives three hours of play.",
        "Folds flat into the included case and pairs with two devices at once.",
      ],
      buyable: true,
      source: "paypalSeller",
      seenAt,
    },
    {
      id: "off_xm6_bluebird",
      title: "Sony WH-1000XM6 Noise Cancelling Headphones (Black)",
      brand: "Sony",
      imageUrl: ART.headphones,
      url: "https://bluebird-electronics.example/sony-wh1000xm6",
      merchant: merchant("Bluebird Electronics", "bluebird-electronics.example"),
      price: usd(31999),
      shipping: usd(0),
      inStock: true,
      rating: { value: 4.6, count: 912 },
      highlights: ["Ships in 1–2 business days. 30-day returns."],
      buyable: false,
      source: "exa",
      seenAt,
    },
    {
      id: "off_qcu_harbor",
      title: "Bose QuietComfort Ultra Headphones, Sandstone",
      brand: "Bose",
      imageUrl: ART.headphonesSand,
      url: "https://harbor-sound.example/bose-qc-ultra-sandstone",
      merchant: merchant("Harbor Sound", "harbor-sound.example", "HARBOR"),
      price: usd(32900),
      listPrice: usd(42900),
      shipping: usd(0),
      inStock: true,
      rating: { value: 4.5, count: 1460 },
      highlights: ["Immersive spatial audio mode; 24 hours of battery."],
      buyable: true,
      source: "paypalSeller",
      seenAt,
    },
    {
      id: "off_m4_northwind",
      title: "Sennheiser Momentum 4 Wireless Headphones, Denim",
      brand: "Sennheiser",
      imageUrl: ART.headphonesBlue,
      url: "https://northwind-audio.example/p/sennheiser-momentum-4-denim",
      merchant: merchant("Northwind Audio", "northwind-audio.example", "NWAUDIO"),
      price: usd(24995),
      listPrice: usd(34995),
      shipping: usd(599),
      inStock: true,
      rating: { value: 4.4, count: 734 },
      highlights: ["60-hour battery, the longest in its class."],
      buyable: true,
      source: "paypalSeller",
      seenAt,
    },
    {
      id: "off_apm_corner",
      title: "Apple AirPods Max, Silver",
      brand: "Apple",
      imageUrl: ART.headphonesSilver,
      url: "https://corner-tech.example/airpods-max-silver",
      merchant: merchant("Corner Tech", "corner-tech.example"),
      price: usd(47900),
      shipping: usd(0),
      inStock: false,
      rating: { value: 4.5, count: 5120 },
      highlights: [],
      buyable: false,
      source: "web",
      seenAt,
    },
  ];
}

export function makeSources(): Source[] {
  return [
    {
      n: 1,
      url: "https://northwind-audio.example/p/sony-wh-1000xm6-black",
      title: "Sony WH-1000XM6 at Northwind Audio",
    },
    {
      n: 2,
      url: "https://bluebird-electronics.example/sony-wh1000xm6",
      title: "Sony WH-1000XM6 at Bluebird Electronics",
    },
    {
      n: 3,
      url: "https://soundlab-reviews.example/xm6-vs-qc-ultra",
      title: "XM6 vs QC Ultra: a month with both",
    },
  ];
}

/** A slow, noisy decline from `from` to `to` over `n` points, one per `stepMs`. */
export function priceHistory(
  from: number,
  to: number,
  n: number,
  endMs: number,
  stepMs = 3_600_000,
) {
  return Array.from({ length: n }, (_, i) => {
    const t = i / (n - 1);
    const wobble = Math.round(Math.sin(i * 1.7) * 600);
    const amount = Math.round(from + (to - from) * t) + (i === 0 || i === n - 1 ? 0 : wobble);
    return { at: iso(endMs - (n - 1 - i) * stepMs), amountMinor: Math.max(0, amount) };
  });
}

export function makeWatch(now = T0, overrides: Partial<Watch> = {}): Watch {
  const offer = makeOffers(now)[0] as Offer;
  return {
    id: "wat_xm6",
    offer,
    targetPrice: usd(27999),
    autoBuy: {
      maxUnitPrice: usd(26999),
      maxTotal: usd(28999),
      quantity: 1,
      expiresAt: iso(now + 30 * 86_400_000),
      mandateId: "mdt_xm6",
    },
    status: "active",
    everyMinutes: 60,
    lastCheck: {
      offerId: offer.id,
      url: offer.url,
      price: offer.price,
      inStock: true,
      method: "jsonLd",
      checkedAt: iso(now - 12 * 60_000),
    },
    nextCheckAt: iso(now + 48 * 60_000),
    history: priceHistory(34999, 29999, 18, now),
    threadId: "thr_demo",
    createdAt: iso(now - 18 * 3_600_000),
    ...overrides,
  };
}

export function makeOrder(now = T0, overrides: Partial<Order> = {}): Order {
  const offer = makeOffers(now)[0] as Offer;
  return {
    id: "ord_xm6",
    offer: { ...offer, price: usd(26900) },
    quantity: 1,
    total: usd(26900),
    status: "coolingOff",
    coolingOffEndsAt: iso(now + 10 * 60_000),
    paypal: { orderId: "5O190127TN364715T", authorizationId: "0VF52814937998046" },
    watchId: "wat_xm6",
    createdAt: iso(now),
    updatedAt: iso(now),
    ...overrides,
  };
}

export function makeShopState(overrides: Partial<ShopState> = {}): ShopState {
  return {
    watches: [],
    orders: [],
    wallet: { connected: false },
    coolingOffMinutes: 10,
    stepUpAbove: usd(50000),
    ...overrides,
  };
}
