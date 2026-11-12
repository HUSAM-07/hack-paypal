import type { Offer } from "@shop/commerce/contract";
import { formatMoney } from "@shop/genui";

const esc = (s: string) =>
  s.replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] ?? c,
  );

/** A "screenshot" of a merchant product page, drawn as SVG (what the agent's browser sees). */
export function pageScreenshot(offer: Offer, note = ""): string {
  const price = esc(formatMoney(offer.price));
  const title = esc(offer.title.length > 38 ? `${offer.title.slice(0, 37)}…` : offer.title);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1280 800" font-family="system-ui,-apple-system,sans-serif">
<rect width="1280" height="800" fill="#ffffff"/>
<rect width="1280" height="64" fill="#f6f6f7"/><circle cx="40" cy="32" r="12" fill="#1f2937"/>
<text x="64" y="39" font-size="20" font-weight="700" fill="#111827">${esc(offer.merchant.name)}</text>
<rect x="420" y="18" width="440" height="28" rx="14" fill="#ffffff" stroke="#e5e7eb"/>
<text x="440" y="37" font-size="14" fill="#9ca3af">Search products</text>
<rect x="64" y="112" width="560" height="560" rx="16" fill="#f3f4f6"/>
<image href="${offer.imageUrl ?? ""}" x="104" y="192" width="480" height="400"/>
<text x="680" y="150" font-size="24" font-weight="600" fill="#111827">${title}</text>
<text x="680" y="190" font-size="16" fill="#6b7280">${esc(offer.brand ?? "")} · In stock · Free shipping</text>
<text x="680" y="270" font-size="48" font-weight="700" fill="#111827">${price}</text>
${offer.listPrice ? `<text x="680" y="306" font-size="18" fill="#9ca3af" text-decoration="line-through">${esc(formatMoney(offer.listPrice))}</text>` : ""}
<rect x="680" y="350" width="300" height="56" rx="28" fill="#111827"/><text x="770" y="385" font-size="18" font-weight="600" fill="#ffffff">Add to cart</text>
<rect x="680" y="420" width="300" height="56" rx="28" fill="#ffc439"/><text x="760" y="455" font-size="18" font-weight="800" font-style="italic" fill="#003087">PayPal</text>
<rect x="680" y="520" width="520" height="12" rx="6" fill="#e5e7eb"/><rect x="680" y="548" width="460" height="12" rx="6" fill="#e5e7eb"/><rect x="680" y="576" width="490" height="12" rx="6" fill="#e5e7eb"/>
${note ? `<rect x="680" y="620" width="520" height="44" rx="10" fill="#eef2ff"/><text x="700" y="648" font-size="15" fill="#1447e6">${esc(note)}</text>` : ""}
</svg>`;
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

/** A tiny interactive page for "You're in control" (stands in for a Browser Run Live View). */
export function livePage(offer: Offer): string {
  const html = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width">
<style>body{margin:0;font:15px/1.5 system-ui,sans-serif;color:#111827;background:#fff}header{display:flex;gap:12px;align-items:center;padding:14px 20px;background:#f6f6f7;font-weight:700}
main{display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:28px;padding:28px}.img{aspect-ratio:1;border-radius:16px;background:#f3f4f6 center/70% no-repeat url("${offer.imageUrl ?? ""}")}
h1{font-size:24px;margin:0 0 6px}.price{font-size:36px;font-weight:700;margin:16px 0}button{display:block;width:100%;max-width:300px;height:48px;border-radius:24px;border:0;font:600 16px system-ui;margin-top:10px;cursor:pointer}
.cart{background:#111827;color:#fff}.pp{background:#ffc439;color:#003087;font-style:italic;font-weight:800}select{height:40px;border-radius:10px;padding:0 10px;margin-top:8px}</style></head>
<body><header>${esc(offer.merchant.name)}</header><main><div class="img"></div><div><h1>${esc(offer.title)}</h1>
<div>${esc(offer.brand ?? "")} · In stock</div><label>Colour <select><option>Black</option><option>Silver</option><option>Midnight blue</option></select></label>
<div class="price">${esc(formatMoney(offer.price))}</div><button class="cart" onclick="this.textContent='Added ✓'">Add to cart</button><button class="pp">PayPal</button></div></main></body></html>`;
  // A blob URL (same-origin, sandboxed by the pane) renders where data: frames are blocked.
  if (typeof URL.createObjectURL === "function") {
    return URL.createObjectURL(new Blob([html], { type: "text/html" }));
  }
  return `data:text/html;charset=utf-8,${encodeURIComponent(html)}`;
}
