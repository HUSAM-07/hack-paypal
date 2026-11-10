import { DEMO_SHOP_PRICES, toPayPalValue } from "@pact/protocol";
import { describe, expect, it } from "vitest";
import { createShopsApp, PRODUCTS, SHOP_IDS } from "../src/index";

const app = createShopsApp({ env: { PAYPAL_MODE: "simulated" } });
const html = async (path: string) => {
  const res = await app.request(path);
  expect(res.status).toBe(200);
  return res.text();
};
const usd = (amountMinor: number) => `$${toPayPalValue({ amountMinor, currency: "USD" })}`;

describe("storefront pages", () => {
  it("the hub links every store and shows each store's own prices", async () => {
    const page = await html("/");
    for (const id of SHOP_IDS) {
      expect(page).toContain(`href="/${id}"`);
      for (const minor of Object.values(DEMO_SHOP_PRICES[id])) expect(page).toContain(usd(minor));
    }
  });

  it("product pages show the shop's price and lead to checkout", async () => {
    for (const id of SHOP_IDS) {
      for (const p of PRODUCTS) {
        const page = await html(`/${id}/p/${p.slug}`);
        expect(page).toContain(
          usd((DEMO_SHOP_PRICES[id] as Record<string, number>)[p.upc] as number),
        );
        expect(page).toContain(`href="/${id}/checkout/${p.slug}"`);
        expect(page).toContain("<svg");
      }
    }
  });

  it("checkout renders the PayPal button wired to the shop's orders API", async () => {
    const page = await html("/lumen/checkout/winix-a230");
    expect(page).toContain('id="sim-pay"');
    expect(page).toContain("Pay with");
    expect(page).toContain('const base="/"+cfg.shop+"/api/orders"');
    expect(page).not.toContain("(simulated)");
  });

  it("404s unknown stores and products", async () => {
    expect((await app.request("/nowhere/checkout/winix-a230")).status).toBe(404);
    expect((await app.request("/lumen/checkout/nothing")).status).toBe(404);
  });
});
