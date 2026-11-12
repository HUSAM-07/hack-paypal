import {
  SITE_CTA_KEY,
  SITE_HEADER_CSS,
  SITE_MARK_SVG,
  SITE_NAV,
  type SiteNavKey,
} from "@pact/protocol";

/**
 * The CITED top bar, the same markup and CSS (from @pact/protocol) as the server-rendered pages,
 * so the landing, /proof and Studio sit in the same frame as the console, /try and /creators.
 */
export function SiteHeader({ current, skip }: { current?: SiteNavKey; skip?: boolean }) {
  const cta = SITE_NAV.find((l) => l.key === SITE_CTA_KEY);
  return (
    <>
      {/* biome-ignore lint/security/noDangerouslySetInnerHtml: a constant from our own package */}
      <style dangerouslySetInnerHTML={{ __html: SITE_HEADER_CSS }} />
      {skip ? (
        <a className="site-skip" href="#main">
          Skip to content
        </a>
      ) : null}
      <header className="site-top">
        <div className="site-bar">
          <a className="site-mark" href="/">
            <span
              style={{ display: "contents" }}
              // biome-ignore lint/security/noDangerouslySetInnerHtml: a constant from our own package
              dangerouslySetInnerHTML={{ __html: SITE_MARK_SVG }}
            />
            CITED
          </a>
          <nav aria-label="CITED" className="site-nav">
            {SITE_NAV.filter((l) => l.key !== SITE_CTA_KEY).map((l) => (
              <a key={l.key} href={l.href} aria-current={l.key === current ? "page" : undefined}>
                {l.label}
              </a>
            ))}
          </nav>
          {cta && (
            <a
              className="site-cta"
              href={cta.href}
              aria-current={current === SITE_CTA_KEY ? "page" : undefined}
            >
              {cta.label}
            </a>
          )}
        </div>
      </header>
    </>
  );
}
