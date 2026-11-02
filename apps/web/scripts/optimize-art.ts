/**
 * Turns the raw fal renders into web-ready landing art.
 *
 *   npx tsx apps/web/scripts/optimize-art.ts
 *
 * Objects: trim transparent edges, pad to a centered square (or 16:9 for rails), then export
 * AVIF + WebP at two widths to public/art/<name>-<width>.<ext>. AVIF quality steps down until the
 * 2x file fits its byte budget. The OG card is exported as a single 1200x630 mozjpeg.
 * Also writes src/landing/art.ts with the intrinsic sizes for the page code.
 */
import { mkdirSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const here = dirname(fileURLToPath(import.meta.url));
const webDir = resolve(here, "..");
const rawDir = join(webDir, "art", "raw");
const outDir = join(webDir, "public", "art");
const manifestFile = join(webDir, "src", "landing", "art.ts");

interface Spec {
  /** Output aspect ratio, width / height. */
  aspect: number;
  /** [1x, 2x] widths. */
  widths: [number, number];
  /** Byte budget for the 2x AVIF. */
  maxAvifBytes: number;
}

const square = (): Spec => ({ aspect: 1, widths: [200, 400], maxAvifBytes: 25_000 });

const specs: Record<string, Spec> = {
  watch: square(),
  schedule: square(),
  split: square(),
  send: square(),
  rails: { aspect: 16 / 9, widths: [560, 1120], maxAvifBytes: 60_000 },
};

const AVIF_START = 55;
const AVIF_FLOOR = 30;
const WEBP_QUALITY = 78;
/** Breathing room around the trimmed object, as a fraction of its larger side. */
const MARGIN = 0.03;
/** Alpha at or below this is matting noise: cleared so it neither bloats files nor skews the trim. */
const ALPHA_NOISE = 8;

/** Trims to the opaque bounding box and pads to `aspect`, keeping the object centered. */
async function frame(file: string, aspect: number): Promise<sharp.Sharp> {
  const { data, info } = await sharp(file)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const { width, height } = info;

  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      if (data[i + 3] <= ALPHA_NOISE) {
        data[i] = data[i + 1] = data[i + 2] = data[i + 3] = 0;
        continue;
      }
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }
  if (maxX < 0) throw new Error(`${file} is fully transparent`);

  const w = maxX - minX + 1;
  const h = maxY - minY + 1;
  const pad = Math.round(Math.max(w, h) * MARGIN);
  let outW = w + pad * 2;
  let outH = h + pad * 2;
  if (outW / outH < aspect) outW = Math.round(outH * aspect);
  else outH = Math.round(outW / aspect);

  const left = Math.floor((outW - w) / 2);
  const top = Math.floor((outH - h) / 2);
  const cropped = await sharp(data, { raw: { width, height, channels: 4 } })
    .extract({ left: minX, top: minY, width: w, height: h })
    .png()
    .toBuffer();
  return sharp(cropped).extend({
    left,
    right: outW - w - left,
    top,
    bottom: outH - h - top,
    background: { r: 0, g: 0, b: 0, alpha: 0 },
  });
}

async function exportObject(name: string, spec: Spec) {
  const framed = await (await frame(join(rawDir, `${name}-cut.png`), spec.aspect)).png().toBuffer();
  const resized = await Promise.all(
    spec.widths.map((w) =>
      sharp(framed)
        .resize({ width: w, height: Math.round(w / spec.aspect), kernel: "lanczos3" })
        .png()
        .toBuffer(),
    ),
  );
  const big = resized[1];
  if (!big) throw new Error("missing 2x render");

  let quality = AVIF_START;
  let bigAvif = await sharp(big).avif({ quality, effort: 6 }).toBuffer();
  while (bigAvif.length > spec.maxAvifBytes && quality > AVIF_FLOOR) {
    quality -= 4;
    bigAvif = await sharp(big).avif({ quality, effort: 6 }).toBuffer();
  }

  for (const [i, w] of spec.widths.entries()) {
    const img = resized[i];
    if (!img) continue;
    const avif = i === 1 ? bigAvif : await sharp(img).avif({ quality, effort: 6 }).toBuffer();
    const webp = await sharp(img).webp({ quality: WEBP_QUALITY, effort: 6 }).toBuffer();
    writeFileSync(join(outDir, `${name}-${w}.avif`), avif);
    writeFileSync(join(outDir, `${name}-${w}.webp`), webp);
    console.log(
      `${name}-${w}: avif ${avif.length} B (q${quality}), webp ${webp.length} B` +
        (i === 1 && avif.length > spec.maxAvifBytes ? "  ⚠ over budget" : ""),
    );
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
  const lines = Object.entries(specs).map(([name, spec]) => {
    const [w] = spec.widths;
    const h = Math.round(w / spec.aspect);
    return `  ${name}: { w: ${w}, h: ${h}, widths: [${spec.widths.join(", ")}] },`;
  });
  const src = [
    "// Generated by scripts/optimize-art.ts. Do not edit by hand.",
    "// Files live at /art/<name>-<width>.avif and .webp; w/h are the 1x intrinsic size.",
    "export const art = {",
    ...lines,
    "} as const;",
    "",
    "export type ArtName = keyof typeof art;",
    "",
  ].join("\n");
  mkdirSync(dirname(manifestFile), { recursive: true });
  writeFileSync(manifestFile, src);
  console.log(`wrote ${manifestFile}`);
}

async function main() {
  mkdirSync(outDir, { recursive: true });
  for (const [name, spec] of Object.entries(specs)) await exportObject(name, spec);
  await exportOg();
  writeManifest();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
