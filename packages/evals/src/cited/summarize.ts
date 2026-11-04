/** Builds summary.md and summary.json from results.jsonl. Usage: tsx src/cited/summarize.ts results/cited */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { type Analysis, analyze, derive, type SessionRecord } from "./analyze";
import { DESIGNS, MODELS, PRICE_DESIGNS } from "./design";
import { TARGET_UPC } from "./world";

const priceSet = process.argv[3] === "price-matched";
const dir = process.argv[2] ?? "results/cited";
const records = readFileSync(join(dir, "results.jsonl"), "utf8")
  .split("\n")
  .filter(Boolean)
  .map((l) => JSON.parse(l) as SessionRecord);

const pct = (x: number | null, d = 0) => (x === null ? "n/a" : `${(x * 100).toFixed(d)}%`);
const pp = (x: number) => `${x >= 0 ? "+" : ""}${(x * 100).toFixed(1)}pp`;
const money = (m: { amountMinor: number }) => `$${(m.amountMinor / 100).toFixed(2)}`;

const lines: string[] = [
  "# CITED eval summary",
  "",
  `Generated from \`results.jsonl\` by \`src/cited/summarize.ts\`. Pre-registration: \`scenarios/cited/PREREGISTRATION${priceSet ? "-PRICE-MATCHED" : ""}.md\`.`,
  "",
];
const json: { [k: string]: unknown } = {};

function section(title: string, a: Analysis, basis: string, buyersOnly = false) {
  const share = (c: { target: number; sessions: number; buyers: number }) =>
    pct(
      (buyersOnly ? c.buyers : c.sessions) ? c.target / (buyersOnly ? c.buyers : c.sessions) : null,
    );
  const cellB = (c: { target: number; sessions: number; buyers: number }) =>
    `${c.target}/${buyersOnly ? c.buyers : c.sessions}`;
  lines.push(`### ${title}`, "", `Basis: ${basis}. Target-brand purchases / denominator.`, "");
  lines.push(
    "| model | test | placebo | nothing | lift (test − placebo) |",
    "|---|---|---|---|---|",
  );
  for (const m of a.byModel) {
    const ml = a.lift.perModel.find((x) => x.model === m.model);
    lines.push(
      `| ${m.model} | ${cellB(m.test)} | ${cellB(m.placebo)} | ${cellB(m.none)} | ${ml ? pp(ml.lift) : "n/a"} |`,
    );
  }
  lines.push(
    `| **pooled** | ${cellB(a.pooled.test)} (${share(a.pooled.test)}) | ${cellB(a.pooled.placebo)} (${share(a.pooled.placebo)}) | ${cellB(a.pooled.none)} (${share(a.pooled.none)}) | |`,
    "",
    `- Model-stratified lift: **${pp(a.lift.lift)}** (SE ${pp(a.lift.stdError)}), one-sided 80% lower bound **${pp(a.lift.lowerBound)}**.`,
    `- Placebo − nothing: ${a.placeboVsNone === null ? "n/a" : pp(a.placeboVsNone)}. Invalid sessions excluded: ${a.invalid}. Price mismatches (kept): ${a.priceMismatch}.`,
    "",
  );
}

for (const d of priceSet ? PRICE_DESIGNS : DESIGNS) {
  const recs = records.filter(
    (r) => r.study === d.study && r.variant === d.variant && r.price === d.price,
  );
  const target = TARGET_UPC[d.study];
  const key = `${d.study}${d.price ? `-${d.price}` : ""}-${d.variant}`;
  lines.push(`## ${key} (${recs.length} sessions)`, "");
  const a = analyze(recs, target, MODELS);
  section(
    `${key}: all valid sessions in the denominator`,
    a,
    "declines count as not buying the target",
  );
  json[key] = {
    sessions: recs.length,
    lift: a.lift,
    pooled: a.pooled,
    byModel: a.byModel,
    placeboVsNone: a.placeboVsNone,
    invalid: a.invalid,
  };
  if (d.variant === "abstain") {
    const b = analyze(recs, target, MODELS, "buyers");
    section(`${key}: buyers only`, b, "declines dropped from the denominator", true);
    const decl = recs.filter((r) => r.outcome.action === "decline");
    const per = (["test", "placebo", "none"] as const)
      .map(
        (arm) =>
          `${arm} ${decl.filter((r) => r.arm === arm).length}/${recs.filter((r) => r.arm === arm).length}`,
      )
      .join(", ");
    lines.push(`- Declines: ${decl.length}/${recs.length} (${per}).`, "");
    json[`${key}-buyers-only`] = { lift: b.lift, pooled: b.pooled };
  }
  const unit =
    d.study === "purifier"
      ? { amountMinor: 9599, currency: "USD" as const }
      : { amountMinor: 9299, currency: "USD" as const };
  const dv = derive(recs, target, MODELS, unit, 200, { amountMinor: 100000, currency: "USD" });
  lines.push(
    `Derived chain (200 exposed sales at ${money(unit)}, $1,000 deposit): attributable fraction ${pct(dv.fraction, 1)} (lower bound ${pp(a.lift.lowerBound)} / exposed rate ${pct(a.lift.exposedRate, 1)}), credited units **${dv.units}**, commission **${money(dv.commission)}**, refund **${money(dv.refund)}**.`,
    "",
  );
  json[`${key}-derived`] = dv;
}

writeFileSync(join(dir, "summary.md"), `${lines.join("\n")}\n`);
writeFileSync(join(dir, "summary.json"), `${JSON.stringify(json, null, 2)}\n`);
console.log(lines.join("\n"));
