import type { Endpoints } from "./types";

/** The simulated catalogue (offers and PayPal checkout) inside this process: no servers, no keys. */
export async function inProcessEndpoints(): Promise<Endpoints> {
  const { createCatalogueApp } = await import("@cited/catalogue-mcp");
  const catalogue = createCatalogueApp({ env: { PAYPAL_MODE: "simulated" } });
  return {
    catalogueUrl: "http://catalogue.local",
    catalogueFetch: (i, init) => Promise.resolve(catalogue.fetch(new Request(i, init))),
  };
}
