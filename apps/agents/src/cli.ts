import { appendFileSync, writeFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { inProcessEndpoints } from "./in-process";
import { DEFAULT_REQUEST, runMany } from "./run";
import { type Endpoints, MODEL_FAMILIES, type ModelFamily } from "./types";

const { values } = parseArgs({
  options: {
    n: { type: "string", default: "10" },
    seed: { type: "string", default: "cited-demo" },
    family: { type: "string", default: "mix" },
    request: { type: "string", default: DEFAULT_REQUEST },
    out: { type: "string" },
    "catalogue-url": { type: "string", default: "http://localhost:8801" },
    "shops-url": { type: "string", default: "http://localhost:8802" },
    "in-process": { type: "boolean", default: false },
  },
});

const family = values.family as ModelFamily | "mix";
if (family !== "mix" && !MODEL_FAMILIES.includes(family)) {
  console.error(`--family must be one of mix, ${MODEL_FAMILIES.join(", ")}`);
  process.exit(2);
}

async function endpoints(): Promise<Endpoints> {
  if (values["in-process"]) return inProcessEndpoints();
  return {
    catalogueUrl: values["catalogue-url"] as string,
    shopsUrl: values["shops-url"] as string,
  };
}

const out = values.out;
if (out) writeFileSync(out, "");
const records = await runMany(
  {
    endpoints: await endpoints(),
    seed: values.seed as string,
    family,
    request: values.request as string,
    n: Number(values.n),
  },
  (r) => {
    const line = JSON.stringify(r);
    console.log(line);
    if (out) appendFileSync(out, `${line}\n`);
  },
);

const by = (k: string) =>
  records.reduce<Record<string, number>>((m, r) => {
    const v = String((r as unknown as Record<string, unknown>)[k]);
    m[v] = (m[v] ?? 0) + 1;
    return m;
  }, {});
console.error(
  `done: ${records.length} sessions; status ${JSON.stringify(by("status"))}; arm ${JSON.stringify(by("arm"))}; shop ${JSON.stringify(by("shop"))}`,
);
