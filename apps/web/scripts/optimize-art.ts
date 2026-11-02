/**
 * Turns the raw fal renders into web-ready landing media.
 *
 *   npx tsx apps/web/scripts/optimize-art.ts [--only bg-dawn,v-send] [--skip-video]
 *
 * Stills (backdrops, cards, wide cards): cover-crop to the target aspect, then export AVIF at
 * every width plus one WebP fallback to public/art/<name>-<width>.<ext>. AVIF quality steps down
 * per file until it fits its byte budget (film grain hides the loss).
 * Videos: art/raw/<name>.mp4 becomes a seamless 1280x720 H.264 loop at public/video/<name>.mp4,
 * with CRF stepped up until it fits VIDEO_MAX_BYTES, plus a poster from its first frame.
 * The OG card is exported as a single 1200x630 mozjpeg.
 * Also writes src/landing/art.ts with the 1x intrinsic sizes for the page code.
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const here = dirname(fileURLToPath(import.meta.url));
const webDir = resolve(here, "..");
const rawDir = join(webDir, "art", "raw");
const outDir = join(webDir, "public", "art");
const videoDir = join(webDir, "public", "video");
const manifestFile = join(webDir, "src", "landing", "art.ts");

const FFMPEG = process.env.FFMPEG ?? "ffmpeg";
const FFPROBE = process.env.FFPROBE ?? "ffprobe";

interface Spec {
  /** Output aspect ratio, width / height. */
  aspect: number;
  /** Export widths, smallest first. */
  widths: number[];
  /** 1x display width written to the manifest. */
  display: number;
  /** Widths that also get a WebP fallback. */
  webp: number[];
  /** AVIF byte budget per width. */
  maxAvif: Record<number, number>;
}

const backdrop = (): Spec => ({
  aspect: 16 / 9,
  widths: [1280, 1920],
  display: 1920,
  webp: [1280],
  maxAvif: { 1280: 60_000, 1920: 110_000 },
});
const card = (): Spec => ({
  aspect: 4 / 3,
  widths: [480, 960],
  display: 480,
  webp: [480],
  maxAvif: { 480: 14_000, 960: 35_000 },
});
const poster = (): Spec => ({
  aspect: 16 / 9,
  widths: [1280],
  display: 1280,
  webp: [1280],
  maxAvif: { 1280: 60_000 },
});

const stills: Record<string, Spec> = {
  "bg-dawn": backdrop(),
  "bg-bloom": backdrop(),
  "bg-dusk": backdrop(),
  "bg-night": backdrop(),
  "c-search": card(),
  "c-edit": card(),
  "c-group": card(),
  "c-target": card(),
  "c-deadline": card(),
  "c-check": card(),
  "c-hold": card(),
  "c-quorum": card(),
  "c-weights": card(),
  "c-cap": card(),
  "c-end": card(),
  "c-revoke": card(),
  "c-request": card(),
  "c-payback": card(),
  "c-payout": card(),
  "c-rails": {
    aspect: 16 / 9,
    widths: [960, 1920],
    display: 960,
    webp: [960],
    maxAvif: { 960: 40_000, 1920: 110_000 },
  },
};

const videos = ["v-watch", "v-split", "v-schedule", "v-send", "v-approve"] as const;

const AVIF_START = 70;
const AVIF_FLOOR = 24;
const WEBP_QUALITY = 74;

const VIDEO_W = 1280;
const VIDEO_H = 720;
const VIDEO_FPS = 24;
const VIDEO_MAX_BYTES = 1_200_000;
const CRF_START = 18;
const CRF_CEIL = 34;
/** Crossfade length used to hide the seam when a clip does not return to its first frame. */
const XFADE = 0.4;
/** Mean per-channel difference (0-255) between last and first frame below which a clip already loops. */
const NATIVE_LOOP_DIFF = 6;
/** A frame step counts as a jump when it exceeds JUMP_MIN and JUMP_RATIO x the median step. */
const JUMP_MIN = 4;
const JUMP_RATIO = 8;
/** Dissolve length laid over a jump. */
const JUMP_XFADE = 0.25;

const args = process.argv.slice(2);
const onlyIdx = args.indexOf("--only");
const only = onlyIdx >= 0 ? new Set((args[onlyIdx + 1] ?? "").split(",")) : null;
const skipVideo = args.includes("--skip-video");
const wanted = (name: string) => !only || only.has(name);

/** AVIF at the highest quality (from AVIF_START down) that fits `max` bytes. */
async function fitAvif(img: Buffer, max: number): Promise<{ buf: Buffer; quality: number }> {
  let quality = AVIF_START;
  let buf = await sharp(img).avif({ quality, effort: 6 }).toBuffer();
  while (buf.length > max && quality > AVIF_FLOOR) {
    quality -= 3;
    buf = await sharp(img).avif({ quality, effort: 6 }).toBuffer();
  }
  return { buf, quality };
}

async function exportStill(name: string, spec: Spec, source = join(rawDir, `${name}.png`)) {
  for (const w of spec.widths) {
    const h = Math.round(w / spec.aspect);
    const img = await sharp(source)
      .resize({ width: w, height: h, fit: "cover", position: "centre", kernel: "lanczos3" })
      .png()
      .toBuffer();
    const max = spec.maxAvif[w] ?? Number.POSITIVE_INFINITY;
    const { buf, quality } = await fitAvif(img, max);
    writeFileSync(join(outDir, `${name}-${w}.avif`), buf);
    let line = `${name}-${w}: avif ${buf.length} B (q${quality})`;
    if (buf.length > max) line += "  ⚠ over budget";
    if (spec.webp.includes(w)) {
      const webp = await sharp(img).webp({ quality: WEBP_QUALITY, effort: 6 }).toBuffer();
      writeFileSync(join(outDir, `${name}-${w}.webp`), webp);
      line += `, webp ${webp.length} B`;
    }
    console.log(line);
  }
}

function ff(args: string[]) {
  execFileSync(FFMPEG, ["-hide_banner", "-loglevel", "error", "-y", ...args], {
    stdio: "inherit",
  });
}

function duration(file: string): number {
  const out = execFileSync(FFPROBE, [
    "-v",
    "error",
    "-show_entries",
    "format=duration",
    "-of",
    "csv=p=0",
    file,
  ]);
  return Number(out.toString().trim());
}

/** Mean absolute per-channel difference between two frames, on a small downscale. */
async function frameDiff(a: string, b: string): Promise<number> {
  const load = (f: string) =>
    sharp(f).resize(160, 90, { fit: "fill" }).removeAlpha().raw().toBuffer();
  const [x, y] = await Promise.all([load(a), load(b)]);
  let sum = 0;
  for (let i = 0; i < x.length; i++) sum += Math.abs((x[i] ?? 0) - (y[i] ?? 0));
  return sum / x.length;
}

/** Re-encodes to a lossless H.264 intermediate (`-vf` or `-filter_complex` given in `filter`). */
function lossless(input: string, filter: string[], out: string) {
  ff(["-i", input, "-an", ...filter, "-c:v", "libx264", "-qp", "0", "-preset", "ultrafast", out]);
}

/** Mean absolute per-channel difference between consecutive frames, on a 160x90 downscale. */
function adjacentDiffs(file: string): number[] {
  const [w, h] = [160, 90];
  const raw = execFileSync(
    FFMPEG,
    [
      "-loglevel",
      "error",
      "-i",
      file,
      "-vf",
      `scale=${w}:${h}`,
      "-f",
      "rawvideo",
      "-pix_fmt",
      "rgb24",
      "-",
    ],
    { maxBuffer: 256 * 1024 * 1024 },
  );
  const size = w * h * 3;
  const diffs: number[] = [];
  for (let off = size; off + size <= raw.length; off += size) {
    let sum = 0;
    for (let i = 0; i < size; i++)
      sum += Math.abs((raw[off + i] ?? 0) - (raw[off - size + i] ?? 0));
    diffs.push(sum / size);
  }
  return diffs;
}

/**
 * Frame indices where the model cut or jumped (e.g. a sudden camera reposition while steering
 * toward the end frame): a single step far larger than the clip's typical motion.
 */
function findJumps(diffs: number[]): number[] {
  const sorted = [...diffs].sort((a, b) => a - b);
  const median = sorted[sorted.length >> 1] ?? 0;
  return diffs
    .map((d, i) => ({ d, frame: i + 1 }))
    .filter(({ d }) => d > JUMP_MIN && d > median * JUMP_RATIO)
    .map(({ frame }) => frame);
}

/**
 * Normalises the raw clip to 1280x720@24 (lossless intermediate), dissolves across any sudden
 * jumps, then makes it loop: if the last frame already matches the first, the duplicate final
 * frame is dropped; otherwise the tail crossfades into the head (the output starts XFADE in).
 */
async function loopClip(name: string, work: string): Promise<{ file: string; mode: string }> {
  const src = join(rawDir, `${name}.mp4`);
  let clip = join(work, "norm.mkv");
  lossless(
    src,
    [
      "-vf",
      `scale=${VIDEO_W}:${VIDEO_H}:force_original_aspect_ratio=increase:flags=lanczos,crop=${VIDEO_W}:${VIDEO_H},fps=${VIDEO_FPS},format=yuv420p`,
    ],
    clip,
  );

  // Later jumps first, so the earlier indices stay valid as each dissolve shortens the clip.
  const jumps = findJumps(adjacentDiffs(clip)).sort((a, b) => b - a);
  for (const [i, frame] of jumps.entries()) {
    const t = frame / VIDEO_FPS;
    const next = join(work, `smooth-${i}.mkv`);
    lossless(
      clip,
      [
        "-filter_complex",
        [
          `[0:v]trim=end=${t.toFixed(4)},setpts=PTS-STARTPTS[a]`,
          `[0:v]trim=start=${t.toFixed(4)},setpts=PTS-STARTPTS[b]`,
          `[a][b]xfade=transition=fade:duration=${JUMP_XFADE}:offset=${(t - JUMP_XFADE).toFixed(4)},format=yuv420p`,
        ].join(";"),
      ],
      next,
    );
    clip = next;
  }
  const smoothed = jumps.length ? `, dissolved jump(s) at frame ${jumps.join(", ")}` : "";

  const d = duration(clip);
  const first = join(work, "first.png");
  const last = join(work, "last.png");
  ff(["-i", clip, "-frames:v", "1", first]);
  ff(["-sseof", "-0.1", "-i", clip, "-update", "1", last]);
  const diff = await frameDiff(first, last);

  const out = join(work, "loop.mkv");
  if (diff <= NATIVE_LOOP_DIFF) {
    const frames = Math.round(d * VIDEO_FPS) - 1;
    lossless(clip, ["-frames:v", String(frames)], out);
    return { file: out, mode: `native (end≈start, diff ${diff.toFixed(1)})${smoothed}` };
  }
  lossless(
    clip,
    [
      "-filter_complex",
      [
        `[0:v]trim=start=${XFADE},setpts=PTS-STARTPTS[body]`,
        `[0:v]trim=end=${XFADE},setpts=PTS-STARTPTS[head]`,
        `[body][head]xfade=transition=fade:duration=${XFADE}:offset=${(d - 2 * XFADE).toFixed(3)},format=yuv420p`,
      ].join(";"),
    ],
    out,
  );
  return { file: out, mode: `crossfade ${XFADE}s (end↔start diff ${diff.toFixed(1)})${smoothed}` };
}

async function exportVideo(name: string) {
  const src = join(rawDir, `${name}.mp4`);
  if (!existsSync(src)) {
    console.warn(`${name}: no raw video, skipped`);
    return;
  }
  const work = mkdtempSync(join(tmpdir(), `pact-${name}-`));
  try {
    const { file: loop, mode } = await loopClip(name, work);
    const out = join(videoDir, `${name}.mp4`);
    let crf = CRF_START;
    for (;;) {
      ff([
        "-i",
        loop,
        "-an",
        "-c:v",
        "libx264",
        "-preset",
        "slow",
        "-profile:v",
        "high",
        "-pix_fmt",
        "yuv420p",
        "-crf",
        String(crf),
        "-g",
        String(VIDEO_FPS * 2),
        "-movflags",
        "+faststart",
        out,
      ]);
      if (statSync(out).size <= VIDEO_MAX_BYTES || crf >= CRF_CEIL) break;
      crf += 1;
    }
    const size = statSync(out).size;
    console.log(
      `${name}.mp4: ${size} B (crf ${crf}), loop ${mode}` +
        (size > VIDEO_MAX_BYTES ? "  ⚠ over budget" : ""),
    );

    const frame = join(work, "poster.png");
    ff(["-i", out, "-frames:v", "1", frame]);
    await exportStill(`${name}-poster`, poster(), frame);
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

async function exportOg() {
  const file = join(outDir, "og.jpg");
  await sharp(join(rawDir, "og.png"))
    .resize(1200, 630, { fit: "cover", position: "centre", kernel: "lanczos3" })
    .jpeg({ quality: 80, mozjpeg: true })
    .toFile(file);
  console.log(`og.jpg: ${statSync(file).size} B`);
}

function writeManifest() {
  const entry = (name: string, spec: Spec) => {
    const w = spec.display;
    const h = Math.round(w / spec.aspect);
    return `  "${name}": { w: ${w}, h: ${h}, widths: [${spec.widths.join(", ")}] },`;
  };
  const lines = [
    ...Object.entries(stills).map(([name, spec]) => entry(name, spec)),
    ...videos.map((v) => entry(`${v}-poster`, poster())),
  ];
  const src = [
    "// Generated by scripts/optimize-art.ts. Do not edit by hand.",
    "// Images live at /art/<name>-<width>.avif (every width) and .webp (smallest width);",
    "// w/h are the 1x display size. Videos live at /video/<name>.mp4 with /art/<name>-poster-*.",
    "export const art = {",
    ...lines,
    "} as const;",
    "",
    "export type ArtName = keyof typeof art;",
    "",
    `export const videos = [${videos.map((v) => `"${v}"`).join(", ")}] as const;`,
    "",
  ].join("\n");
  mkdirSync(dirname(manifestFile), { recursive: true });
  writeFileSync(manifestFile, src);
  console.log(`wrote ${manifestFile}`);
}

async function main() {
  mkdirSync(outDir, { recursive: true });
  mkdirSync(videoDir, { recursive: true });
  for (const [name, spec] of Object.entries(stills)) {
    if (wanted(name)) await exportStill(name, spec);
  }
  if (!skipVideo) {
    for (const name of videos) if (wanted(name)) await exportVideo(name);
  }
  if (wanted("og")) await exportOg();
  writeManifest();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
