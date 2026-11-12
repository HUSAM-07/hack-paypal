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

/** The sandbox app's own business account: every seller's payee on the shipwith target. */
const SANDBOX_PAYEE = "M5R4D5A6BC3QC"; // sb-iicfz53660186@business.example.com

// Optional per target: `kv` pins SHOP_CACHE (SHOP_EXTRAS=1 only) to an existing namespace id;
// without it wrangler provisions one in the target's account on its first deploy.
const TARGETS = {
  // The one deploy target: Husam's Cloudflare account on the custom domain. Passkeys are bound
  // to RP_ID, so its users are its own. (The old team workers.dev target is retired.)
  shipwith: {
    account_id: "22d85cc3a000928da154b1f41ead366e",
    workers_dev: false,
    routes: [{ pattern: "caaash.shipwith.si", custom_domain: true }],
    d1: { DB: "e1003458-8946-4f7b-ba51-775092dd7243" },
    vars: {
      RP_ID: "caaash.shipwith.si",
      ORIGINS: "https://caaash.shipwith.si",
      // CITED runs against the real PayPal sandbox here (the legacy Pact app stays simulated).
      // Needs the worker secrets PAYPAL_CLIENT_ID, PAYPAL_CLIENT_SECRET, CITED_BUYER_VAULT_ID
      // and CITED_PASSPORT_SECRET. Local dev, tests and the demo keep wrangler.jsonc's simulated.
      CITED_PAYPAL_MODE: "sandbox",
      // A wallet vaulted by the app can only pay the app's own business account, so every
      // seller's payee is that account (separate sellers need PayPal multiparty access).
      CITED_SELLER_NORTHWIND_PAYEE: SANDBOX_PAYEE,
      CITED_SELLER_LUMEN_PAYEE: SANDBOX_PAYEE,
      CITED_SELLER_MEGAMART_PAYEE: SANDBOX_PAYEE,
      // The shop vertical (shop/spec/SHOP-SPEC.md). Needs the worker secrets OPENROUTER_API_KEY,
      // EXA_API_KEY, GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET; its PayPal stays simulated.
      SHOP_ENABLED: "true",
      CF_ACCOUNT_ID: "22d85cc3a000928da154b1f41ead366e",
      SHOP_PUBLIC_ORIGIN: "https://caaash.shipwith.si",
    },
  },
};

// Shop extras, opt-in with SHOP_EXTRAS=1: the SHOP_CACHE KV namespace is provisioned in the
// target account on first deploy, so it is off by default (a plain deploy of the worker must
// never fail or create resources because of the shop). The shop treats it as optional. Browser
// Run is reached over its REST API (CF_BROWSER_RUN_TOKEN secret), so it needs no binding.
const DEPLOY_ONLY =
  process.env.SHOP_EXTRAS === "1" ? { kv_namespaces: [{ binding: "SHOP_CACHE" }] } : {};

const workerDir = join(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const target = args.find((a) => !a.startsWith("--")) ?? "shipwith";
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
    ...(DEPLOY_ONLY.kv_namespaces && {
      kv_namespaces: DEPLOY_ONLY.kv_namespaces.map((kv) =>
        o.kv?.[kv.binding] ? { ...kv, id: o.kv[kv.binding] } : kv,
      ),
    }),
  };
  if (mode === "deploy") {
    const todo = Object.entries(out.vars).filter(([, v]) => String(v).startsWith("TODO_"));
    if (todo.length)
      fail(`Set ${todo.map(([k]) => k).join(", ")} in deploy.mjs before deploying ${name}.`);
  }
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
