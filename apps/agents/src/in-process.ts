import type { Endpoints } from "./types";

/** Simulated catalogue and shops inside this process: no servers, no keys. */
export async function inProcessEndpoints(): Promise<Endpoints> {
  const [{ app: catalogue }, { createShopsApp }] = await Promise.all([
    import("@cited/catalogue-mcp"),
    import("@cited/shops"),
  ]);
  const shops = createShopsApp({ env: { PAYPAL_MODE: "simulated" } });
  return {
    catalogueUrl: "http://catalogue.local",
    catalogueFetch: (i, init) => Promise.resolve(catalogue.fetch(new Request(i, init))),
    shopsUrl: "http://shops.local",
    shopsFetch: (i, init) => Promise.resolve(shops.fetch(new Request(i, init))),
  };
}
