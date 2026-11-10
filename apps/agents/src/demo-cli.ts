import { appendFileSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { parseArgs } from "node:util";
import { BEATS, type DemoEvent, runDemo } from "./demo";
import { DEFAULT_PORTS, type Stack, startStack } from "./stack";

const { values } = parseArgs({
  options: {
    seed: { type: "string", default: "cited-demo" },
    "real-models": { type: "boolean", default: false },
    refund: { type: "string", default: "before-payout" },
    events: { type: "string" },
    out: { type: "string" },
    serve: { type: "string" },
    pace: { type: "string", default: "0" },
    "approve-in-studio": { type: "boolean", default: false },
    "use-running": { type: "boolean", default: false },
    "engine-url": { type: "string", default: `http://localhost:${DEFAULT_PORTS.engine}` },
    "catalogue-url": { type: "string", default: `http://localhost:${DEFAULT_PORTS.catalogue}` },
    verbose: { type: "boolean", default: false },
    help: { type: "boolean", default: false },
  },
});

if (values.help) {
  console.log(`npm run demo:cited -- [flags]
  --seed S            seed for session ids and arms (default cited-demo)
  --real-models       use GPT/Gemini/Sonnet through the gateway (LLM_BASE_URL, LLM_API_KEY); numbers will differ from the card
  --refund WHEN       before-payout (default; the void changes the payout) or after-payout (paid credit is flagged)
  --events FILE|-     write the JSONL event stream to FILE; "-" prints only JSONL on stdout
  --out FILE          write every session's run record as JSONL (what the console reads)
  --serve PORT        also serve the stream as Server-Sent Events at http://localhost:PORT/events
  --pace MS           pause between beats, for a live screen
  --approve-in-studio wait at the Analyst beat for the top-up to be approved in AG Studio (/studio)
  --use-running       use an already running 'npm run dev:cited' stack (needs a fresh engine); else a private stack starts
  --verbose           show the apps' own logs`);
  process.exit(0);
}

const refund = values.refund as "before-payout" | "after-payout";
if (refund !== "before-payout" && refund !== "after-payout") {
  console.error("--refund must be before-payout or after-payout");
  process.exit(2);
}
const jsonlOnly = values.events === "-";
const history: string[] = [];
const subscribers = new Set<(line: string) => void>();

if (values.events && !jsonlOnly) writeFileSync(values.events, "");

function printHuman(e: DemoEvent) {
  const idx = e.beat ? BEATS.indexOf(e.beat) + 1 : 0;
  if (e.type === "run.start")
    console.log(`CITED demo · seed ${String(e.data?.seed)} · ${String(e.data?.provider)} agents\n`);
  else if (e.type === "beat.start") console.log(`\n── Beat ${idx}/${BEATS.length}: ${e.text}`);
  else if (e.type === "line") console.log(`  ${e.text}`);
  else if (e.type === "session" && e.data) {
    const d = e.data as Record<string, unknown>;
    if (values.verbose) console.log(`    · ${d.model} ${d.arm} → ${d.product}, paid ${d.seller}`);
  } else if (e.type === "run.end") console.log(`\n${e.text === "ok" ? "✔ done" : "✘ failed"}`);
}

async function emit(e: DemoEvent) {
  const line = JSON.stringify(e);
  history.push(line);
  if (values.events === "-") console.log(line);
  else if (values.events) appendFileSync(values.events, `${line}\n`);
  for (const s of subscribers) s(line);
  if (!jsonlOnly) printHuman(e);
}

if (values.serve) {
  const port = Number(values.serve);
  createServer((req, res) => {
    const cors = { "access-control-allow-origin": "*" };
    if (req.url === "/events.jsonl") {
      res.writeHead(200, { ...cors, "content-type": "application/x-ndjson" });
      res.end(history.length ? `${history.join("\n")}\n` : "");
    } else if (req.url === "/events") {
      res.writeHead(200, {
        ...cors,
        "content-type": "text/event-stream",
        "cache-control": "no-cache",
        connection: "keep-alive",
      });
      const send = (line: string) => res.write(`data: ${line}\n\n`);
      for (const l of history) send(l); // late joiners replay from seq 1
      subscribers.add(send);
      req.on("close", () => subscribers.delete(send));
    } else {
      res.writeHead(404, cors);
      res.end();
    }
  }).listen(port, () =>
    console.error(`events: http://localhost:${port}/events (SSE), /events.jsonl`),
  );
}

let stack: Stack | undefined;
let code = 0;
try {
  if (!values["use-running"]) {
    stack = await startStack({
      seed: values.seed as string,
      ...(values.verbose ? { log: (l: string) => console.error(l) } : {}),
    });
  }
  const urls = stack ?? {
    engineUrl: values["engine-url"] as string,
    catalogueUrl: values["catalogue-url"] as string,
  };
  if (!jsonlOnly)
    console.error("stack up (engine, catalogue with PayPal checkout; simulated PayPal)");
  const result = await runDemo({
    ...urls,
    seed: values.seed as string,
    provider: values["real-models"] ? "openai-compatible" : "fake",
    refund,
    emit,
    pace: Number(values.pace),
    ...(values["approve-in-studio"] ? { approveInStudioMs: 15 * 60_000 } : {}),
  });
  if (values.out)
    writeFileSync(
      values.out,
      result.records
        .map(
          (r) => `${JSON.stringify(r)}
`,
        )
        .join(""),
    );
  if (result.checks.some((c) => !c.ok)) code = 1;
  if (!values["real-models"] && !result.matchesCard) code = 1;
} catch (e) {
  console.error(e instanceof Error ? e.message : e);
  code = 1;
} finally {
  await stack?.stop();
}
if (values.serve && code === 0) {
  console.error("serving events until Ctrl-C");
  await new Promise(() => {});
}
process.exit(code);
