import { SITE_NAV, type SiteNavKey } from "@pact/protocol";

/** The top bar shared by the landing and /proof; the same links as every other CITED page. */
export function SiteHeader({ current }: { current?: SiteNavKey }) {
  return (
    <header className="top">
      <div className="wrap top-inner">
        <a className="wordmark" href="/">
          CITED
        </a>
        <nav aria-label="CITED" className="top-nav">
          {SITE_NAV.map((l) => (
            <a key={l.key} href={l.href} aria-current={l.key === current ? "page" : undefined}>
              {l.label}
            </a>
          ))}
        </nav>
      </div>
    </header>
  );
}
