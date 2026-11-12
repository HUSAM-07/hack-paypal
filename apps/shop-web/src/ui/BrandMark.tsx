import { SITE_MARK_SVG } from "@pact/protocol";

/** The CITED mark: Shop is CITED's second vertical, so it carries the same logo as every page. */
export function BrandMark() {
  return (
    <span
      className="brand-mark"
      aria-hidden
      // biome-ignore lint/security/noDangerouslySetInnerHtml: a constant from our own package
      dangerouslySetInnerHTML={{ __html: SITE_MARK_SVG }}
    />
  );
}
