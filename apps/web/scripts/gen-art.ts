/**
 * Generates the landing-page art (stills and image-to-video loops) with fal.ai.
 *
 *   npx tsx apps/web/scripts/gen-art.ts [--force] [--force-video] [--stills] [--only bg-dawn,v-send] [--jobs 4]
 *
 * Reads art/prompts.json and writes raw renders to art/raw/<name>.png. Assets with a `video`
 * block also get art/raw/<name>.mp4, animated from that still (start and end frame = the still,
 * so the clip comes back to where it started). Assets with `cutout` get art/raw/<name>-cut.png.
 * Existing files are skipped unless --force (stills and videos) or --force-video (videos only);
 * --stills skips video generation so the stills can be reviewed before paying for motion.
 * Every paid call is appended to art/raw/spend.jsonl with its estimated USD cost.
 * The FAL_API_KEY is read from the repo-root .env and never printed.
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const here = dirname(fileURLToPath(import.meta.url));
const webDir = resolve(here, "..");
const repoRoot = resolve(webDir, "../..");
const artDir = join(webDir, "art");
const rawDir = join(artDir, "raw");
const spendFile = join(rawDir, "spend.jsonl");
const requestsFile = join(rawDir, "requests.jsonl");

interface Asset {
  kind?: string;
  aspect: string;
  resolution?: string;
  cutout?: boolean;
  prompt: string;
  references?: string[];
  referenceInstruction?: string;
  video?: { prompt: string; duration?: number };
}

interface Prompts {
  model: string;
  editModel: string;
  fallbackModel: string;
  fallbackEditModel: string;
  cutoutModel: string;
  videoModel: string;
  resolution: string;
  styleReference: string;
  pricing: Record<string, number>;
  style: string;
  referenceInstruction: string;
  /** Extra model-specific input merged into every video request. */
  videoInput: Record<string, unknown>;
  /** Also pass the still as the end frame (only for models that accept start == end). */
  videoEndFrame: boolean;
  /** Some video schemas take duration as an enum string ("5") rather than a number. */
  videoDurationString?: boolean;
  /** Input field for the start frame; most models use start_image_url, Seedance uses image_url. */
  videoStartKey?: string;
  assets: Record<string, Asset>;
}

interface FalImage {
  url: string;
}

const args = process.argv.slice(2);
const force = args.includes("--force");
const forceVideo = force || args.includes("--force-video");
const stillsOnly = args.includes("--stills");
const flag = (name: string) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const only = flag("--only") ? new Set((flag("--only") ?? "").split(",")) : null;
const jobs = Math.max(1, Number(flag("--jobs") ?? 4));

let calls = 0;
let spent = 0;

function readKey(): string {
  const env = readFileSync(join(repoRoot, ".env"), "utf8");
  const match = env.match(/^FAL_API_KEY=(.*)$/m);
  const key = match?.[1]?.trim().replace(/^["']|["']$/g, "");
  if (!key) throw new Error("FAL_API_KEY missing from .env");
  return key;
}

const key = readKey();
const headers = { Authorization: `Key ${key}`, "Content-Type": "application/json" };

/** Records an estimated charge; the ledger is what the spend report is built from. */
function charge(name: string, endpoint: string, usd: number) {
  spent += usd;
  appendFileSync(
    spendFile,
    `${JSON.stringify({ at: new Date().toISOString(), name, endpoint, usd })}\n`,
  );
}

async function falRun<T>(
  endpoint: string,
  input: Record<string, unknown>,
  timeoutMs = 5 * 60_000,
): Promise<T> {
  calls++;
  const submit = await fetch(`https://queue.fal.run/${endpoint}`, {
    method: "POST",
    headers,
    body: JSON.stringify(input),
  });
  if (!submit.ok)
    throw new Error(`${endpoint} submit ${submit.status}: ${(await submit.text()).slice(0, 400)}`);
  const { request_id, status_url, response_url } = (await submit.json()) as {
    request_id: string;
    status_url: string;
    response_url: string;
  };
  // A timed-out job keeps running (and billing) on fal, so keep its id to fetch it later.
  appendFileSync(
    requestsFile,
    `${JSON.stringify({ at: new Date().toISOString(), endpoint, request_id, response_url })}\n`,
  );

  const deadline = Date.now() + timeoutMs;
  let lastStatus = "";
  for (;;) {
    if (Date.now() > deadline) throw new Error(`${endpoint} timed out`);
    await new Promise((r) => setTimeout(r, 3000));
    const res = await fetch(status_url, { headers });
    const status = (await res.json()) as { status: string };
    if (status.status !== lastStatus) {
      console.log(`  [${endpoint} ${request_id}] ${status.status}`);
      lastStatus = status.status;
    }
    if (status.status === "COMPLETED") break;
    if (status.status !== "IN_QUEUE" && status.status !== "IN_PROGRESS") {
      throw new Error(`${endpoint} status ${JSON.stringify(status)}`);
    }
  }

  const out = await fetch(response_url, { headers });
  if (!out.ok)
    throw new Error(`${endpoint} result ${out.status}: ${(await out.text()).slice(0, 400)}`);
  return (await out.json()) as T;
}

async function download(url: string): Promise<Buffer> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`download ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

/** Downscaled JPEG data URI: small enough to inline as a reference or start frame. */
async function dataUri(file: string, width = 1024, quality = 85): Promise<string> {
  const buf = await sharp(file)
    .resize({ width, withoutEnlargement: true })
    .jpeg({ quality })
    .toBuffer();
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
  const resolution = asset.resolution ?? cfg.resolution;
  const base = {
    prompt,
    aspect_ratio: asset.aspect,
    resolution,
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
    charge(name, primary, cfg.pricing[`${primary}@${resolution}`] ?? 0);
  } catch (err) {
    console.warn(`  ${primary} failed (${(err as Error).message}); trying ${fallback}`);
    result = await falRun(fallback, input);
    charge(name, fallback, cfg.pricing[fallback] ?? 0);
  }
  const url = result.images[0]?.url;
  if (!url) throw new Error(`${name}: no image returned`);
  return download(url);
}

async function animate(cfg: Prompts, name: string, asset: Asset): Promise<Buffer> {
  if (!asset.video) throw new Error(`${name}: no video prompt`);
  const duration = asset.video.duration ?? 5;
  const frame = await dataUri(join(rawDir, `${name}.png`), 1920, 92);
  // Model-specific knobs (resolution, audio, negative prompt…) live in prompts.json videoInput.
  const result = await falRun<{ video: { url: string } }>(
    cfg.videoModel,
    {
      ...cfg.videoInput,
      prompt: asset.video.prompt,
      [cfg.videoStartKey ?? "start_image_url"]: frame,
      ...(cfg.videoEndFrame ? { end_image_url: frame } : {}),
      duration: cfg.videoDurationString ? String(duration) : duration,
    },
    45 * 60_000,
  );
  charge(name, cfg.videoModel, (cfg.pricing[`${cfg.videoModel}@second`] ?? 0) * duration);
  return download(result.video.url);
}

async function cutout(cfg: Prompts, name: string, file: string): Promise<Buffer> {
  const buf = await sharp(file).png().toBuffer();
  const result = await falRun<{ image: FalImage }>(cfg.cutoutModel, {
    image_url: `data:image/png;base64,${buf.toString("base64")}`,
    model: "General Use (Heavy)",
    operating_resolution: "2048x2048",
    output_format: "png",
    refine_foreground: true,
  });
  charge(name, cfg.cutoutModel, cfg.pricing[cfg.cutoutModel] ?? 0);
  return download(result.image.url);
}

async function produce(cfg: Prompts, name: string, asset: Asset) {
  const rawFile = join(rawDir, `${name}.png`);
  const regenerate = force || !existsSync(rawFile);
  if (regenerate) {
    console.log(`generating ${name}…`);
    writeFileSync(rawFile, await generate(cfg, name, asset));
    console.log(`  ✓ ${name}.png`);
  } else {
    console.log(`skip ${name} (raw exists)`);
  }

  const cutFile = join(rawDir, `${name}-cut.png`);
  if (asset.cutout && (regenerate || !existsSync(cutFile))) {
    console.log(`  removing background ${name}…`);
    writeFileSync(cutFile, await cutout(cfg, name, rawFile));
  }

  const videoFile = join(rawDir, `${name}.mp4`);
  if (asset.video && !stillsOnly && (regenerate || forceVideo || !existsSync(videoFile))) {
    console.log(`  animating ${name}…`);
    writeFileSync(videoFile, await animate(cfg, name, asset));
    console.log(`  ✓ ${name}.mp4`);
  }
}

/** Runs `work` over `items` with at most `limit` in flight; failures are collected, not fatal. */
async function pool<T>(items: T[], limit: number, work: (item: T) => Promise<void>) {
  const failures: string[] = [];
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const item = items[next++] as T;
      try {
        await work(item);
      } catch (err) {
        failures.push(`${String(item)}: ${(err as Error).message}`);
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return failures;
}

async function main() {
  const cfg = JSON.parse(readFileSync(join(artDir, "prompts.json"), "utf8")) as Prompts;
  mkdirSync(rawDir, { recursive: true });

  const selected = Object.keys(cfg.assets).filter((n) => !only || only.has(n));
  // The style reference (and any explicit references) render first so the rest can be
  // conditioned on them; everything after that is independent and runs in parallel.
  const firsts = new Set([cfg.styleReference]);
  const first = selected.filter((n) => firsts.has(n));
  const rest = selected.filter((n) => !firsts.has(n));

  for (const name of first) await produce(cfg, name, cfg.assets[name] as Asset);
  const failures = await pool(rest, jobs, (name) => produce(cfg, name, cfg.assets[name] as Asset));

  console.log(`done: ${calls} fal call(s), ~$${spent.toFixed(3)} this run`);
  if (failures.length) {
    console.error(`failed:\n  ${failures.join("\n  ")}`);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  console.error(`fal calls made: ${calls}, ~$${spent.toFixed(3)}`);
  process.exit(1);
});
