// Checks a CITED deployment against the demo's locked numbers and fails loudly otherwise.
// Usage: node apps/worker/scripts/verify-cited.mjs https://pact-worker.vincent-wesley-liem.workers.dev
//
// The numbers (cited/spec/CITED-packet.md): 62 caused units over 69 exposed sales, Levoit 0;
// first payout $383.96 to HouseFresh; programme to date $468.43 in 3 batches; Winix invoiced
// $383.96 and marked paid, Levoit no charge; HouseFresh's $7.68 self-purchase held for review; Roborock and Bose each funded with lift > 0.
// Reads only: safe against production.
import { fileURLToPath } from "node:url";

export const LOCKED = {
  causedUnits: 62,
  exposedSales: 69,
  firstPayoutMinor: 38396,
  programmePaidMinor: 46843,
  batches: 3,
  heldMinor: 768,
};

async function getJson(origin, path) {
  const res = await fetch(`${origin}${path}`, { headers: { accept: "application/json" } });
  if (!res.ok) throw new Error(`GET ${path} answered ${res.status}`);
  return res.json();
}

async function getPage(origin, path) {
  const res = await fetch(`${origin}${path}`);
  if (!res.ok) throw new Error(`GET ${path} answered ${res.status}`);
  return res.text();
}

/** Pure: every way the read API can disagree with the locked numbers. */
export function checkCited({ lift, payouts, invoices, flags }) {
  const problems = [];
  const expect = (what, got, want) => {
    if (got !== want) problems.push(`${what}: got ${got}, want ${want}`);
  };
  const brand = (id) => lift.brands?.find((b) => b.brandId === id);
  expect("winix caused units", brand("winix")?.causedUnits, LOCKED.causedUnits);
  expect("winix exposed sales", brand("winix")?.exposedSales, LOCKED.exposedSales);
  expect("levoit caused units", brand("levoit")?.causedUnits, 0);
  // The demo's last beat funds Roborock and Bose and plays a small study in each category, so a
  // /try purchase of either can be credited: their programmes must have measured lift.
  for (const id of ["roborock", "bose"]) {
    const units = brand(id)?.causedUnits;
    if (!(units > 0)) problems.push(`${id} caused units: got ${units}, want more than 0`);
  }

  const batches = [...(payouts.batches ?? [])].sort((a, b) =>
    String(a.createdAt).localeCompare(String(b.createdAt)),
  );
  const total = (b) => b.items.reduce((s, i) => s + i.amountMinor, 0);
  expect("payout batches", batches.length, LOCKED.batches);
  expect("first payout", batches[0] && total(batches[0]), LOCKED.firstPayoutMinor);
  expect(
    "programme to date",
    batches.reduce((s, b) => s + total(b), 0),
    LOCKED.programmePaidMinor,
  );
  for (const b of batches) expect(`batch ${b.senderBatchId} status`, b.status, "SUCCESS");

  const stmt = (id) => invoices.statements?.find((s) => s.brandId === id);
  expect("winix invoice paid", stmt("winix")?.paidMinor, LOCKED.firstPayoutMinor);
  expect("winix invoice status", stmt("winix")?.status, "MARKED_AS_PAID");
  expect("levoit invoice status", stmt("levoit")?.status, "NO_CHARGE");

  const open = (flags.flags ?? []).filter((f) => f.status === "open");
  expect("open review flags", open.length, 1);
  expect("held self-purchase", open[0]?.credit?.amountMinor, LOCKED.heldMinor);
  return problems;
}

/** Text a reviewer must never see on a seeded site. */
const EMPTY_MARKERS = ["No agent runs", "No payout yet", "No statement yet", "Write run records"];

export async function verifyCited(origin, { log = console.error } = {}) {
  const api = "/api/cited/api";
  const [lift, payouts, invoices, flags] = await Promise.all([
    getJson(origin, `${api}/lift`),
    getJson(origin, `${api}/payouts`),
    getJson(origin, `${api}/invoices`),
    getJson(origin, `${api}/review-flags`),
  ]);
  const problems = checkCited({ lift, payouts, invoices, flags });
  for (const path of ["/console", "/console/payout", "/console/statement"]) {
    const html = await getPage(origin, path);
    for (const m of EMPTY_MARKERS) if (html.includes(m)) problems.push(`${path} shows "${m}"`);
  }
  if (problems.length)
    throw new Error(`CITED data check failed at ${origin}:\n  ${problems.join("\n  ")}`);
  log(`✔ ${origin}: 62 caused, first payout $383.96, programme to date $468.43 in 3 batches`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const origin = (process.argv[2] ?? "").replace(/\/$/, "");
  if (!origin) {
    console.error("usage: node verify-cited.mjs <origin>");
    process.exit(2);
  }
  verifyCited(origin).catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  });
}
