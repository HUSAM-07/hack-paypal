import { type ChildProcess, spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

export interface StackUrls {
  engineUrl: string;
  catalogueUrl: string;
}

export const DEFAULT_PORTS = { engine: 8800, catalogue: 8801 };

export interface Stack extends StackUrls {
  /** Where the throwaway engine database lives (for debugging). */
  stateDir: string;
  stop(): Promise<void>;
}

const root = fileURLToPath(new URL("../../../", import.meta.url));

async function waitHealthy(url: string, what: string, ms = 90_000): Promise<void> {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    try {
      if ((await fetch(`${url}/health`)).ok) return;
    } catch {
      // not up yet
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`${what} did not come up at ${url}`);
}

function run(cmd: string, args: string[], cwd: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const c = spawn(cmd, args, { cwd, stdio: ["ignore", "ignore", "pipe"] });
    let err = "";
    c.stderr?.on("data", (d) => {
      err += d;
    });
    c.on("exit", (code) =>
      code === 0 ? resolve() : reject(new Error(`${cmd} ${args.join(" ")} failed: ${err}`)),
    );
  });
}

/**
 * Starts the engine (wrangler dev on a throwaway D1) and the catalogue (offers and the agents'
 * PayPal checkout), wired together and keyless (PAYPAL_MODE=simulated). A fresh database every time, so a run is reproducible.
 */
export async function startStack(
  o: {
    ports?: Partial<typeof DEFAULT_PORTS>;
    seed?: string;
    log?: (line: string) => void;
    /**
     * "standalone" runs apps/engine on its own; "worker" runs it inside pact-worker at
     * /api/cited, the way it is deployed. Default: env CITED_ENGINE, else standalone.
     */
    engine?: "standalone" | "worker";
  } = {},
): Promise<Stack> {
  const ports = { ...DEFAULT_PORTS, ...o.ports };
  const inWorker = (o.engine ?? process.env.CITED_ENGINE) === "worker";
  const urls: StackUrls = {
    engineUrl: `http://localhost:${ports.engine}${inWorker ? "/api/cited" : ""}`,
    catalogueUrl: `http://localhost:${ports.catalogue}`,
  };
  const state = mkdtempSync(join(tmpdir(), "cited-demo-"));
  const env = {
    ...process.env,
    PAYPAL_MODE: "simulated",
    MODEL_PROVIDER: "fake",
    ENGINE_URL: urls.engineUrl,
    CATALOGUE_SEED: o.seed ?? "cited-demo",
    NO_COLOR: "1",
  };
  const children: ChildProcess[] = [];
  const start = (name: string, cmd: string, args: string[], cwd: string, extra = {}) => {
    const c = spawn(cmd, args, {
      cwd,
      env: { ...env, ...extra },
      stdio: ["ignore", "pipe", "pipe"],
      detached: true,
    });
    for (const s of [c.stdout, c.stderr]) s?.on("data", (d) => o.log?.(`[${name}] ${d}`.trimEnd()));
    children.push(c);
  };
  const stop = async () => {
    for (const c of children) {
      try {
        if (c.pid) process.kill(-c.pid, "SIGTERM");
      } catch {
        // already gone
      }
    }
    await new Promise((r) => setTimeout(r, 300));
    rmSync(state, { recursive: true, force: true });
  };

  try {
    const engineDir = join(root, inWorker ? "apps/worker" : "apps/engine");
    const db = inWorker ? "pact" : "cited";
    // The worker serves the web build as assets; an empty folder is enough for the API.
    if (inWorker) mkdirSync(join(root, "apps/web/dist"), { recursive: true });
    const wrangler = (...a: string[]) => ["wrangler", ...a, "--persist-to", state];
    await run("npx", wrangler("d1", "migrations", "apply", db, "--local"), engineDir);
    // Local and keyless on purpose: the explicit opt-in that a deployed worker never has.
    const open = inWorker ? "CITED_OPEN_API:1" : "ENGINE_OPEN_API:1";
    start(
      "engine",
      "npx",
      wrangler("dev", "--port", String(ports.engine), "--var", open),
      engineDir,
    );
    start("catalogue", "npx", ["tsx", "src/dev.ts"], join(root, "apps/catalogue-mcp"), {
      PORT: String(ports.catalogue),
    });
    await Promise.all([
      waitHealthy(urls.engineUrl, "engine"),
      waitHealthy(urls.catalogueUrl, "catalogue"),
    ]);
  } catch (e) {
    await stop();
    throw e;
  }
  return { ...urls, stateDir: state, stop };
}
