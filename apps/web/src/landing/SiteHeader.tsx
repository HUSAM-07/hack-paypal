import { SITE_HEADER_CSS, SITE_NAV, type SiteNavKey } from "@pact/protocol";

/**
 * The CITED top bar, the same markup and CSS (from @pact/protocol) as the server-rendered pages,
 * so the landing, /proof and Studio sit in the same frame as the console, /try and /creators.
 */
export function SiteHeader({ current }: { current?: SiteNavKey }) {
  return (
    <>
      {/* biome-ignore lint/security/noDangerouslySetInnerHtml: a constant from our own package */}
      <style dangerouslySetInnerHTML={{ __html: SITE_HEADER_CSS }} />
      <header className="site-top">
        <div className="site-bar">
          <a className="site-mark" href="/">
            CITED
          </a>
          <nav aria-label="CITED" className="site-nav">
            {SITE_NAV.map((l) => (
              <a key={l.key} href={l.href} aria-current={l.key === current ? "page" : undefined}>
                {l.label}
              </a>
            ))}
          </nav>
        </div>
      </header>
    </>
  );
}
