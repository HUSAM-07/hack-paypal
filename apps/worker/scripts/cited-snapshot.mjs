// Builds the hosted CITED data offline, so production never shows a half-seeded ledger.
//
// 1. Starts pact-worker under `wrangler dev` on a throwaway local D1 (keyless, CITED_OPEN_API=1
//    locally only), the same worker the hosted site runs.
// 2. Replays the scripted demo against it (/api/cited and /catalogue, the hosted paths).
// 3. Checks the result against the locked numbers (verify-cited.mjs) before anything leaves.
// 4. Writes one SQL file: DELETE + INSERT for the CITED tables only. Pact's own tables (users,
//    threads, paypal refs, ...) are never named in it.
//
// Usage: node apps/worker/scripts/cited-snapshot.mjs [--out cited-snapshot.sql] [--port 8795]
// Then:  npx wrangler d1 execute pact --remote --file cited-snapshot.sql
//
// Remote `d1 execute --file` goes through D1's import endpoint, which applies the file as one
// atomic operation (restored via Time Travel on failure): readers see the old rows or the new
// ones, never an empty ledger. That is why the file holds no BEGIN/COMMIT (D1 rejects them).
import { spawn, spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { CITED_TABLES, snapshotSql } from "./cited-snapshot-sql.mjs";
import { verifyCited } from "./verify-cited.mjs";

const workerDir = fileURLToPath(new URL("..", import.meta.url));
const root = fileURLToPath(new URL("../../..", import.meta.url));

function wrangler(args, persist) {
  const r = spawnSync("npx", ["wrangler", ...args, "--persist-to", persist], {
    cwd: workerDir,
    encoding: "utf8",
    maxBuffer: 256 * 1024 * 1024,
  });
  if (r.status !== 0) throw new Error(`wrangler ${args.join(" ")} failed:\n${r.stderr}`);
  return r.stdout;
}

/** Reads a local table as JSON rows (wrangler prints progress lines before the JSON). */
function readTable(table, persist) {
  const out = wrangler(
    ["d1", "execute", "pact", "--local", "--json", "--command", `SELECT * FROM ${table}`],
    persist,
  );
  const json = JSON.parse(out.slice(out.indexOf("[")));
  return json[0].results;
}

async function waitHealthy(url, ms = 120_000) {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    try {
      if ((await fetch(url)).ok) return;
    } catch {
      // not up yet
    }
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error(`worker did not come up at ${url}`);
}

function runDemo(origin, runsFile) {
  return new Promise((resolve, reject) => {
    const env = { ...process.env, PAYPAL_MODE: "simulated", MODEL_PROVIDER: "fake" };
    // Never send the production token to the local stack.
    delete env.CITED_API_TOKEN;
    const c = spawn(
      "npm",
      [
        "run",
        "demo:cited",
        "--",
        "--use-running",
        "--engine-url",
        `${origin}/api/cited`,
        "--catalogue-url",
        `${origin}/catalogue`,
        "--out",
        runsFile,
      ],
      { cwd: root, env, stdio: "inherit" },
    );
    c.on("exit", (code) =>
      code === 0 ? resolve() : reject(new Error(`demo replay failed (exit ${code})`)),
    );
  });
}

async function main() {
  const { values } = parseArgs({
    options: {
      out: { type: "string", default: "cited-snapshot.sql" },
      port: { type: "string", default: "8795" },
      keep: { type: "boolean", default: false },
    },
  });
  const persist = mkdtempSync(join(tmpdir(), "cited-snapshot-"));
  const origin = `http://localhost:${values.port}`;
  const runsFile = join(persist, "runs.jsonl");
  let dev;
  const stop = () => {
    try {
      if (dev?.pid) process.kill(-dev.pid, "SIGTERM");
    } catch {
      // already gone
    }
  };
  try {
    wrangler(["d1", "migrations", "apply", "pact", "--local"], persist);
    dev = spawn(
      "npx",
      [
        "wrangler",
        "dev",
        "--port",
        values.port,
        "--persist-to",
        persist,
        "--var",
        "CITED_OPEN_API:1",
        "--var",
        "CITED_API_TOKEN:",
      ],
      { cwd: workerDir, stdio: ["ignore", "ignore", "inherit"], detached: true },
    );
    await waitHealthy(`${origin}/api/cited/health`);
    await runDemo(origin, runsFile);
    // The console reads run records from D1; load the replay's records the way the site has them.
    const runsSql = join(persist, "runs.sql");
    const toSql = spawnSync("node", [join(workerDir, "scripts/runs-to-sql.mjs"), runsFile], {
      encoding: "utf8",
      maxBuffer: 256 * 1024 * 1024,
    });
    if (toSql.status !== 0) throw new Error(`runs-to-sql failed:\n${toSql.stderr}`);
    writeFileSync(runsSql, toSql.stdout);
    wrangler(["d1", "execute", "pact", "--local", "--file", runsSql], persist);
    console.error("\nchecking the replayed ledger against the locked numbers…");
    await verifyCited(origin);
    stop();
    await new Promise((r) => setTimeout(r, 1500));

    const rows = {};
    for (const t of CITED_TABLES) rows[t] = readTable(t, persist);
    const sql = snapshotSql(rows);
    writeFileSync(values.out, sql);
    const counts = CITED_TABLES.map((t) => `${t}=${rows[t].length}`).join(" ");
    console.error(`wrote ${values.out} (${(sql.length / 1024).toFixed(0)} KiB): ${counts}`);
  } finally {
    stop();
    if (!values.keep) rmSync(persist, { recursive: true, force: true });
    else console.error(`kept local state in ${persist}`);
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  });
}
