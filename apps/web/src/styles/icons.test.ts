// @vitest-environment node
import { existsSync, readFileSync } from "node:fs";
import { faviconSvg, SITE_ICONS, webManifest } from "@pact/protocol";
import { describe, expect, it } from "vitest";

const pub = (p: string) => new URL(`../../public/${p}`, import.meta.url);

describe("icons and manifest (run scripts/gen-icons.ts after changing the mark or theme)", () => {
  it("favicon.svg matches the mark and theme", () => {
    expect(readFileSync(pub("favicon.svg"), "utf8")).toBe(faviconSvg());
  });
  it("site.webmanifest matches", () => {
    expect(readFileSync(pub("site.webmanifest"), "utf8")).toBe(webManifest());
  });
  it("every PNG icon exists", () => {
    for (const i of SITE_ICONS) expect(existsSync(pub(`icons/${i.file}`)), i.file).toBe(true);
  });
  it("every HTML entry gets the shared head", () => {
    for (const html of ["index.html", "proof.html", "studio.html", "app.html"]) {
      expect(readFileSync(new URL(`../../${html}`, import.meta.url), "utf8"), html).toContain(
        "<!--site-head-->",
      );
    }
  });
});
