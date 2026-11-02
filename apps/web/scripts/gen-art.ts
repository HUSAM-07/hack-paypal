/**
 * Generates the landing-page 3D art with fal.ai.
 *
 *   npx tsx apps/web/scripts/gen-art.ts [--force] [--only watch,send]
 *
 * Reads art/prompts.json, writes raw renders to art/raw/<name>.png and background-removed
 * cutouts to art/raw/<name>-cut.png. Existing files are skipped unless --force is passed.
 * The FAL_API_KEY is read from the repo-root .env and never printed.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const here = dirname(fileURLToPath(import.meta.url));
const webDir = resolve(here, "..");
const repoRoot = resolve(webDir, "../..");
const artDir = join(webDir, "art");
const rawDir = join(artDir, "raw");

interface Asset {
  aspect: string;
  cutout: boolean;
  prompt: string;
  references?: string[];
  referenceInstruction?: string;
}

interface Prompts {
  model: string;
  editModel: string;
  fallbackModel: string;
  fallbackEditModel: string;
  cutoutModel: string;
  resolution: string;
  styleReference: string;
  style: string;
  referenceInstruction: string;
  assets: Record<string, Asset>;
}

interface FalImage {
  url: string;
}

const args = process.argv.slice(2);
const force = args.includes("--force");
const onlyIdx = args.indexOf("--only");
const only = onlyIdx >= 0 ? new Set((args[onlyIdx + 1] ?? "").split(",")) : null;

let calls = 0;

function readKey(): string {
  const env = readFileSync(join(repoRoot, ".env"), "utf8");
  const match = env.match(/^FAL_API_KEY=(.*)$/m);
  const key = match?.[1]?.trim().replace(/^["']|["']$/g, "");
  if (!key) throw new Error("FAL_API_KEY missing from .env");
  return key;
}

const key = readKey();
const headers = { Authorization: `Key ${key}`, "Content-Type": "application/json" };

async function falRun<T>(endpoint: string, input: Record<string, unknown>): Promise<T> {
  calls++;
  const submit = await fetch(`https://queue.fal.run/${endpoint}`, {
    method: "POST",
    headers,
    body: JSON.stringify(input),
  });
  if (!submit.ok) throw new Error(`${endpoint} submit ${submit.status}: ${await submit.text()}`);
  const { status_url, response_url } = (await submit.json()) as {
    status_url: string;
    response_url: string;
  };

  const deadline = Date.now() + 5 * 60_000;
  for (;;) {
    if (Date.now() > deadline) throw new Error(`${endpoint} timed out`);
    await new Promise((r) => setTimeout(r, 2000));
    const res = await fetch(status_url, { headers });
    const status = (await res.json()) as { status: string };
    if (status.status === "COMPLETED") break;
    if (status.status !== "IN_QUEUE" && status.status !== "IN_PROGRESS") {
      throw new Error(`${endpoint} status ${JSON.stringify(status)}`);
    }
  }

  const out = await fetch(response_url, { headers });
  if (!out.ok) throw new Error(`${endpoint} result ${out.status}: ${await out.text()}`);
  return (await out.json()) as T;
}

async function download(url: string): Promise<Buffer> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`download ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

/** Downscaled JPEG data URI: small enough to inline as a reference image. */
async function dataUri(file: string, width = 1024): Promise<string> {
  const buf = await sharp(file).resize({ width, withoutEnlargement: true }).jpeg().toBuffer();
  return `data:image/jpeg;base64,${buf.toString("base64")}`;
}

async function generate(cfg: Prompts, name: string, asset: Asset): Promise<Buffer> {
  const refs = asset.references ?? (name === cfg.styleReference ? [] : [cfg.styleReference]);
  const refFiles = refs.map((r) => join(rawDir, `${r}.png`));
  const missing = refFiles.filter((f) => !existsSync(f));
  if (missing.length) throw new Error(`${name}: reference renders missing: ${missing.join(", ")}`);

  const prompt = refs.length
    ? `${asset.referenceInstruction ?? cfg.referenceInstruction}\n\n${asset.prompt}\n\nStyle: ${cfg.style}`
    : `${asset.prompt}\n\nStyle: ${cfg.style}`;
  const base = {
    prompt,
    aspect_ratio: asset.aspect,
    resolution: cfg.resolution,
    output_format: "png",
    num_images: 1,
  };
  const input = refs.length
    ? { ...base, image_urls: await Promise.all(refFiles.map((f) => dataUri(f))) }
    : base;
  const [primary, fallback] = refs.length
    ? [cfg.editModel, cfg.fallbackEditModel]
    : [cfg.model, cfg.fallbackModel];

  let result: { images: FalImage[] };
  try {
    result = await falRun(primary, input);
  } catch (err) {
    console.warn(`  ${primary} failed (${(err as Error).message}); trying ${fallback}`);
    result = await falRun(fallback, input);
  }
  const url = result.images[0]?.url;
  if (!url) throw new Error(`${name}: no image returned`);
  return download(url);
}

async function cutout(cfg: Prompts, file: string): Promise<Buffer> {
  const buf = await sharp(file).png().toBuffer();
  const result = await falRun<{ image: FalImage }>(cfg.cutoutModel, {
    image_url: `data:image/png;base64,${buf.toString("base64")}`,
    model: "General Use (Heavy)",
    operating_resolution: "2048x2048",
    output_format: "png",
    refine_foreground: true,
  });
  return download(result.image.url);
}

async function main() {
  const cfg = JSON.parse(readFileSync(join(artDir, "prompts.json"), "utf8")) as Prompts;
  mkdirSync(rawDir, { recursive: true });

  // The style reference renders first so the others can be conditioned on it.
  const names = Object.keys(cfg.assets).sort((a, b) =>
    a === cfg.styleReference ? -1 : b === cfg.styleReference ? 1 : 0,
  );

  for (const name of names) {
    if (only && !only.has(name)) continue;
    const asset = cfg.assets[name];
    if (!asset) continue;
    const rawFile = join(rawDir, `${name}.png`);
    const cutFile = join(rawDir, `${name}-cut.png`);
    const regenerate = force || !existsSync(rawFile);

    if (regenerate) {
      console.log(`generating ${name}…`);
      writeFileSync(rawFile, await generate(cfg, name, asset));
    } else {
      console.log(`skip ${name} (raw exists)`);
    }

    if (asset.cutout && (regenerate || !existsSync(cutFile))) {
      console.log(`  removing background ${name}…`);
      writeFileSync(cutFile, await cutout(cfg, rawFile));
    }
  }
  console.log(`done: ${calls} fal call(s)`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  console.error(`fal calls made: ${calls}`);
  process.exit(1);
});
