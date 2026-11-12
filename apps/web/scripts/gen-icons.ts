/**
 * Writes the favicon, the PNG app icons and the web manifest from @pact/protocol's mark and theme
 * tokens, so the icons always match the site's colours.
 *
 *   npx tsx apps/web/scripts/gen-icons.ts
 *
 * src/styles/icons.test.ts fails when the committed SVG or manifest drifts from the source.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { appIconSvg, faviconSvg, SITE_ICONS, webManifest } from "@pact/protocol";
import sharp from "sharp";

const pub = join(resolve(dirname(fileURLToPath(import.meta.url)), ".."), "public");
mkdirSync(join(pub, "icons"), { recursive: true });

writeFileSync(join(pub, "favicon.svg"), faviconSvg());
writeFileSync(join(pub, "site.webmanifest"), webManifest());
for (const icon of SITE_ICONS) {
  // Maskable icons get a larger safe zone and square corners (the platform applies its own mask).
  const svg =
    icon.purpose === "maskable" ? appIconSvg(icon.size, 0.26, false) : appIconSvg(icon.size);
  await sharp(Buffer.from(svg))
    .png({ compressionLevel: 9 })
    .toFile(join(pub, "icons", icon.file));
}
console.log("wrote favicon.svg, site.webmanifest and", SITE_ICONS.map((i) => i.file).join(", "));
