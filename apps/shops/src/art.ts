/**
 * Original SVG drawings of the two demo purifiers. No logos, no product photos: just a boxy
 * tower (Winix-like) and a drum (Levoit-like). Inline SVG, so the strict CSP and the /shops
 * link prefixing never touch them. `uid` keeps gradient ids unique when a page draws twice.
 */

export interface ArtOptions {
  uid: string;
  /** Backdrop behind the device; "none" for a transparent tile. */
  backdrop?: string;
  /** Floor shadow colour. */
  shadow?: string;
  label?: string;
}

const svgOpen = (label: string) =>
  `<svg viewBox="0 0 400 400" role="img" aria-label="${label}" xmlns="http://www.w3.org/2000/svg">`;

function backdrop(o: ArtOptions): string {
  return o.backdrop && o.backdrop !== "none"
    ? `<rect width="400" height="400" fill="${o.backdrop}"/>`
    : "";
}

/** Boxy tower: front grille of horizontal slats, control strip on top, recessed base. */
function tower(o: ArtOptions): string {
  const u = o.uid;
  const slats = Array.from({ length: 13 }, (_, i) => {
    const y = 150 + i * 12;
    return `<rect x="150" y="${y}" width="100" height="5" rx="2.5" fill="#C9CDD2"/>`;
  }).join("");
  return `${svgOpen(o.label ?? "Boxy tower air purifier")}${backdrop(o)}
<defs>
<linearGradient id="tb${u}" x1="0" x2="1"><stop offset="0" stop-color="#F7F8F9"/><stop offset=".55" stop-color="#ECEEF0"/><stop offset="1" stop-color="#D9DDE1"/></linearGradient>
<linearGradient id="ts${u}" x1="0" x2="1"><stop offset="0" stop-color="#D3D7DB"/><stop offset="1" stop-color="#B9BEC4"/></linearGradient>
<linearGradient id="tt${u}" y1="0" y2="1"><stop offset="0" stop-color="#FFFFFF"/><stop offset="1" stop-color="#E9EBED"/></linearGradient>
</defs>
<ellipse cx="206" cy="343" rx="104" ry="11" fill="${o.shadow ?? "#000"}" opacity=".13"/>
<path d="M270 98 L292 110 V330 L270 338 Z" fill="url(#ts${u})"/>
<rect x="128" y="90" width="144" height="250" rx="14" fill="url(#tb${u})"/>
<path d="M142 90 H258 a14 14 0 0 1 14 8 L292 110 H150 Z" fill="url(#tt${u})"/>
<rect x="128" y="90" width="144" height="250" rx="14" fill="none" stroke="#C3C8CD" stroke-width="1.5"/>
<rect x="144" y="104" width="112" height="28" rx="6" fill="#2A2F35"/>
<circle cx="162" cy="118" r="4" fill="#5FD1A0"/>
<rect x="176" y="115" width="18" height="6" rx="3" fill="#59616A"/>
<rect x="200" y="115" width="18" height="6" rx="3" fill="#59616A"/>
<rect x="224" y="115" width="18" height="6" rx="3" fill="#59616A"/>
<rect x="142" y="142" width="116" height="170" rx="8" fill="#E1E4E7"/>
${slats}
<rect x="138" y="320" width="124" height="12" rx="4" fill="#D0D4D8"/>
</svg>`;
}

/** Drum: a short cylinder, perforated lower band, vented top ring. */
function drum(o: ArtOptions): string {
  const u = o.uid;
  const holes: string[] = [];
  for (let row = 0; row < 7; row++) {
    for (let col = 0; col < 15; col++) {
      // Fewer, narrower holes towards the edges read as a curved surface.
      const t = (col + 0.5) / 15;
      const x = 128 + 144 * (0.5 - Math.cos(t * Math.PI) / 2);
      const w = 3.2 * Math.sin(t * Math.PI) + 0.6;
      const y = 214 + row * 13 + (col % 2 ? 6 : 0);
      if (y < 300)
        holes.push(
          `<ellipse cx="${x.toFixed(1)}" cy="${y}" rx="${w.toFixed(2)}" ry="3.2" fill="#9AA1A8"/>`,
        );
    }
  }
  return `${svgOpen(o.label ?? "Cylindrical air purifier")}${backdrop(o)}
<defs>
<linearGradient id="db${u}" x1="0" x2="1"><stop offset="0" stop-color="#DADDE0"/><stop offset=".3" stop-color="#FAFBFB"/><stop offset=".65" stop-color="#F0F2F3"/><stop offset="1" stop-color="#C9CDD1"/></linearGradient>
<linearGradient id="dt${u}" y1="0" y2="1"><stop offset="0" stop-color="#FFFFFF"/><stop offset="1" stop-color="#E4E7E9"/></linearGradient>
<radialGradient id="dv${u}"><stop offset="0" stop-color="#3A4047"/><stop offset="1" stop-color="#22262B"/></radialGradient>
</defs>
<ellipse cx="200" cy="334" rx="96" ry="12" fill="${o.shadow ?? "#000"}" opacity=".13"/>
<path d="M128 120 V312 a72 18 0 0 0 144 0 V120 Z" fill="url(#db${u})"/>
<path d="M128 200 V312 a72 18 0 0 0 144 0 V200 a72 18 0 0 1 -144 0 Z" fill="#E6E9EB"/>
${holes.join("")}
<path d="M128 200 a72 18 0 0 0 144 0" fill="none" stroke="#C5CACE" stroke-width="1.5"/>
<ellipse cx="200" cy="120" rx="72" ry="18" fill="url(#dt${u})" stroke="#CDD1D5" stroke-width="1.5"/>
<ellipse cx="200" cy="119" rx="52" ry="12" fill="url(#dv${u})"/>
<ellipse cx="200" cy="119" rx="40" ry="9" fill="none" stroke="#4A525A" stroke-width="2"/>
<ellipse cx="200" cy="119" rx="27" ry="6" fill="none" stroke="#4A525A" stroke-width="2"/>
<ellipse cx="200" cy="119" rx="12" ry="3" fill="#59616A"/>
<rect x="186" y="150" width="28" height="6" rx="3" fill="#B7BDC3"/>
<circle cx="200" cy="168" r="3.5" fill="#5FD1A0"/>
<path d="M128 312 a72 18 0 0 0 144 0" fill="none" stroke="#BCC2C7" stroke-width="1.5"/>
</svg>`;
}

/** The drawing for a product slug. Unknown slugs fall back to the tower. */
export function productArt(slug: string, o: ArtOptions): string {
  return slug.startsWith("levoit") ? drum(o) : tower(o);
}
