import {
  SITE_CTA_KEY,
  SITE_HEADER_CSS,
  SITE_MARK_SVG,
  SITE_NAV,
  SITE_REPO_URL,
  type SiteNavKey,
} from "@pact/protocol";


/** The light/dark toggle; public/theme.js handles the click on every page. */
function ThemeToggle() {
  return (
    <button type="button" className="site-icon" data-theme-toggle aria-label="Toggle dark mode">
      <svg className="theme-moon" viewBox="0 0 16 16" aria-hidden="true">
        <path d="M13.5 9.6A5.75 5.75 0 0 1 6.4 2.5a5.75 5.75 0 1 0 7.1 7.1Z" />
      </svg>
      <svg className="theme-sun" viewBox="0 0 16 16" aria-hidden="true">
        <circle cx="8" cy="8" r="3" />
        <path d="M8 1.5v1.2M8 13.3v1.2M1.5 8h1.2M13.3 8h1.2M3.4 3.4l.85.85M11.75 11.75l.85.85M3.4 12.6l.85-.85M11.75 4.25l.85-.85" />
      </svg>
    </button>
  );
}

/**
 * The CITED top bar, the same markup and CSS (from @pact/protocol) as the server-rendered pages,
 * so the landing, /proof and Studio sit in the same frame as the console, /try and /creators.
 * `column` narrows the bar to the page column and continues its side rules; `links` picks a subset.
 */
export function SiteHeader({
  current,
  skip,
  column,
  links,
  theme = true,
}: {
  current?: SiteNavKey;
  skip?: boolean;
  column?: boolean;
  links?: SiteNavKey[];
  /** Show the light/dark toggle; off for pages without a dark theme. */
  theme?: boolean;
}) {
  const cta = SITE_NAV.find((l) => l.key === SITE_CTA_KEY);
  const nav = SITE_NAV.filter((l) => l.key !== SITE_CTA_KEY && (!links || links.includes(l.key)));
  return (
    <>
      {/* biome-ignore lint/security/noDangerouslySetInnerHtml: a constant from our own package */}
      <style dangerouslySetInnerHTML={{ __html: SITE_HEADER_CSS }} />
      {skip ? (
        <a className="site-skip" href="#main">
          Skip to content
        </a>
      ) : null}
      <header className={column ? "site-top site-col" : "site-top"}>
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
            {nav.map((l) => (
              <a key={l.key} href={l.href} aria-current={l.key === current ? "page" : undefined}>
                {l.label}
              </a>
            ))}
          </nav>
          <div className="site-tools">
            <a className="site-icon" href={SITE_REPO_URL}>
              <span className="site-sr">Source on GitHub</span>
              <svg viewBox="0 0 16 16" aria-hidden="true">
                <path d="M6 13.2c-2.6.8-2.6-1.3-3.6-1.6m7.2 3v-2.2c0-.7.1-1-.3-1.4 1.9-.2 3.6-.9 3.6-4a3.1 3.1 0 0 0-.8-2.1 2.9 2.9 0 0 0-.1-2.1s-.7-.2-2.2.8a7.6 7.6 0 0 0-4 0C4.3 2.6 3.6 2.8 3.6 2.8a2.9 2.9 0 0 0-.1 2.1 3.1 3.1 0 0 0-.8 2.1c0 3.1 1.7 3.8 3.6 4-.4.4-.4.8-.3 1.4v2.2" />
              </svg>
            </a>
            {theme ? <ThemeToggle /> : null}
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
        </div>
      </header>
    </>
  );
}
