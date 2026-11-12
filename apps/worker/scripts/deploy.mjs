#!/usr/bin/env node
// Deploys pact-worker to one target: D1 migrations, then the Worker.
//
//   node scripts/deploy.mjs [target] [--dry-run | --rollback | --print-config]
//
// --print-config writes the target's wrangler config and prints its file name (relative to
// apps/worker), for other wrangler commands against that target: `--config "$(...)"`.
//
// A target is wrangler.jsonc plus a few overrides, so a binding added to wrangler.jsonc
// reaches every target. Wrangler `env` blocks don't inherit bindings or vars, so each
// one would need every binding copied in and kept in sync by hand. Every target also gets
// DEPLOY_ONLY, the bindings local dev and tests must not have.
// Expects apps/web/dist to be built already (`npm run build:web`).
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// Optional per target: `kv` / `r2` pin a binding to an existing namespace id / bucket name.
// Without them wrangler provisions SHOP_CACHE and SHOP_FILES in the target's account on its
// first deploy and keeps them linked (wrangler.jsonc leaves their ids out on purpose).
const TARGETS = {
  // The team account on workers.dev; wrangler.jsonc as committed.
  "workers-dev": {},
  // Husam's account on the custom domain. Passkeys are bound to RP_ID, so this target
  // has its own users (and its own D1) separate from workers-dev.
  shipwith: {
    account_id: "22d85cc3a000928da154b1f41ead366e",
    workers_dev: false,
    routes: [{ pattern: "caaash.shipwith.si", custom_domain: true }],
    d1: { DB: "e1003458-8946-4f7b-ba51-775092dd7243" },
    vars: {
      RP_ID: "caaash.shipwith.si",
      ORIGINS: "https://caaash.shipwith.si",
      CF_ACCOUNT_ID: "22d85cc3a000928da154b1f41ead366e",
    },
  },
};

// Workers AI always runs remotely: in wrangler.jsonc it would make `wrangler dev` and the
// vitest pool open a remote session that needs Cloudflare credentials (CI tests have none).
const DEPLOY_ONLY = { ai: { binding: "AI" } };

const workerDir = join(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const target = args.find((a) => !a.startsWith("--")) ?? "workers-dev";
const mode = args.includes("--dry-run")
  ? "dry-run"
  : args.includes("--rollback")
    ? "rollback"
    : args.includes("--print-config")
      ? "print-config"
      : "deploy";

if (!(target in TARGETS)) {
  fail(`Unknown target "${target}". Targets: ${Object.keys(TARGETS).join(", ")}`);
}
const config = configFor(target);
const wrangler = (...a) =>
  execFileSync("npx", ["--no", "wrangler", ...a, "--config", config], {
    cwd: workerDir,
    stdio: "inherit",
  });

if (mode === "print-config") {
  console.log(config);
  process.exit(0);
}
console.log(`▸ ${mode} pact-worker → ${target}`);
if (mode === "dry-run") {
  wrangler("deploy", "--dry-run", "--outdir", mkdtempSync(join(tmpdir(), "pact-worker-")));
} else if (mode === "rollback") {
  wrangler("rollback", "--yes", "--message", `Smoke test failed for ${commit()}`.slice(0, 100));
} else {
  wrangler("d1", "migrations", "apply", "pact", "--remote");
  wrangler("deploy", "--message", commit().slice(0, 100));
}

function configFor(name) {
  const o = TARGETS[name];

  // A token scoped to another account fails later with a vague auth error; say it plainly.
  const envAccount = process.env.CLOUDFLARE_ACCOUNT_ID;
  if (mode !== "dry-run" && o.account_id && envAccount && envAccount !== o.account_id) {
    fail(
      `CLOUDFLARE_ACCOUNT_ID is not the ${name} account. Set CLOUDFLARE_ACCOUNT_ID and ` +
        `CLOUDFLARE_API_TOKEN on the "${name}" GitHub environment.`,
    );
  }

  const base = parseJsonc(readFileSync(join(workerDir, "wrangler.jsonc"), "utf8"));
  const out = {
    ...base,
    ...DEPLOY_ONLY,
    ...("account_id" in o && { account_id: o.account_id }),
    ...("workers_dev" in o && { workers_dev: o.workers_dev }),
    ...("routes" in o && { routes: o.routes }),
    vars: { ...base.vars, ...o.vars },
    d1_databases: base.d1_databases.map((db) =>
      o.d1?.[db.binding] ? { ...db, database_id: o.d1[db.binding] } : db,
    ),
    kv_namespaces: (base.kv_namespaces ?? []).map((kv) =>
      o.kv?.[kv.binding] ? { ...kv, id: o.kv[kv.binding] } : kv,
    ),
    r2_buckets: (base.r2_buckets ?? []).map((r2) =>
      o.r2?.[r2.binding] ? { ...r2, bucket_name: o.r2[r2.binding] } : r2,
    ),
  };
  // Written next to wrangler.jsonc so its relative paths (main, assets, migrations) resolve.
  const file = `wrangler.${name}.generated.jsonc`;
  writeFileSync(join(workerDir, file), `${JSON.stringify(out, null, 2)}\n`);
  return file;
}

function commit() {
  const sha = process.env.GITHUB_SHA?.slice(0, 7);
  try {
    const line = execFileSync("git", ["log", "-1", "--format=%h %s"], { encoding: "utf8" }).trim();
    return sha && !line.startsWith(sha) ? `${sha} ${line}` : line;
  } catch {
    return sha ?? "local deploy";
  }
}

/** JSON with comments and trailing commas, as wrangler.jsonc allows. `//` inside strings (URLs) survives. */
function parseJsonc(text) {
  let out = "";
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '"') {
      const start = i;
      for (i++; text[i] !== '"'; i++) if (text[i] === "\\") i++;
      out += text.slice(start, i + 1);
    } else if (c === "/" && text[i + 1] === "/") {
      while (i < text.length && text[i] !== "\n") i++;
      out += "\n";
    } else if (c === "/" && text[i + 1] === "*") {
      i = text.indexOf("*/", i + 2) + 1;
    } else {
      out += c;
    }
  }
  return JSON.parse(out.replace(/,(\s*[}\]])/g, "$1"));
}

function fail(message) {
  console.error(`✖ ${message}`);
  process.exit(1);
}
