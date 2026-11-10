import { productArt } from "./art";
import { PRODUCTS, SHOP_IDS, SHOPS, type ShopId } from "./catalogue";
import { fmt } from "./pages";

/**
 * /shops: the three demo stores, introduced in CITED's own look. Each card is a miniature of
 * the store it links to, drawn in that store's colours and type, so the difference is visible
 * before anyone clicks.
 */

interface Mini {
  look: string;
  /** Wordmark HTML inside the mini header. */
  mark: string;
}

const MINI: Record<ShopId, Mini> = {
  northwind: {
    look: "Calm, premium home goods",
    mark: `<span class="m-nw">Northwind</span>`,
  },
  lumen: {
    look: "Bright, practical essentials",
    mark: `<span class="m-lu">lumen<i></i></span>`,
  },
  megamart: {
    look: "Big-box marketplace",
    mark: `<span class="m-mm">Mega<b>Mart</b></span>`,
  },
};

const serif = `"Iowan Old Style","Palatino Linotype",Palatino,"Book Antiqua",Georgia,serif`;
const sans = `-apple-system,BlinkMacSystemFont,"Segoe UI",system-ui,sans-serif`;

const css = `*{box-sizing:border-box}html{-webkit-text-size-adjust:100%}
body{margin:0;background:#FAF8F4;color:#16181D;font:16px/1.6 ${sans};-webkit-font-smoothing:antialiased}
a{color:inherit}h1,h2,h3,p{margin:0}svg{display:block;width:100%;height:auto}
.num,td,.prices{font-variant-numeric:tabular-nums lining-nums}
:focus-visible{outline:2px solid #1F7A55;outline-offset:3px}
.wrap{max-width:1120px;margin:0 auto;padding:0 40px}
.top{display:flex;justify-content:space-between;align-items:center;padding:24px 0;border-bottom:1px solid #E6E2DA;font-size:14px}
.brand{font:600 20px/1 ${serif};letter-spacing:.14em;text-decoration:none}
.brand span{font:400 14px/1 ${sans};letter-spacing:0;color:#5B5F68;margin-left:12px}
.top a.back{color:#5B5F68;text-decoration:none}.top a.back:hover{color:#16181D}
.intro{padding:72px 0 48px;display:grid;grid-template-columns:1.25fr 1fr;gap:56px;align-items:end}
h1{font:400 clamp(38px,5.2vw,60px)/1.06 ${serif};letter-spacing:-.015em;text-wrap:balance}
.lede{color:#5B5F68;font-size:17px;max-width:44ch}
code{font:500 .92em ui-monospace,"SF Mono",Menlo,monospace;color:#16181D;background:#EFEBE3;padding:1px 5px;border-radius:4px}
.stores{display:grid;grid-template-columns:repeat(3,1fr);gap:24px;padding-bottom:72px}
.store{display:flex;flex-direction:column;text-decoration:none;background:#fff;border:1px solid #E6E2DA;border-radius:10px;overflow:hidden;transition:border-color .2s,transform .2s}
.store:hover{border-color:#B9B3A7}.store:active{transform:scale(.99)}
.mini-hd{height:46px;display:flex;align-items:center;padding:0 16px}
.mini-art{aspect-ratio:16/10;overflow:hidden;display:flex;align-items:center;justify-content:center;gap:0}
.mini-art svg{width:50%;max-width:180px}
.m-nw{font:500 13px/1 "Avenir Next",Avenir,${sans};letter-spacing:.34em;text-transform:uppercase;color:#1C211E}
.m-lu{font:800 21px/1 ui-rounded,"SF Pro Rounded",${sans};letter-spacing:-.03em;color:#1F5FD6;display:inline-flex;align-items:center;gap:2px}
.m-lu i{width:7px;height:7px;border-radius:50%;background:#FFB81C;margin-top:6px}
.m-mm{font:italic 900 20px/1 "Arial Narrow","Helvetica Neue",Arial,sans-serif;text-transform:uppercase;color:#fff;letter-spacing:-.02em}.m-mm b{color:#FFD23F}
.s-northwind .mini-hd{background:#fff;border-bottom:1px solid #E3E5E0;justify-content:center}.s-northwind .mini-art{background:#E9ECE5}
.s-lumen .mini-hd{background:#fff;border-bottom:3px solid #1F5FD6}.s-lumen .mini-art{background:#EEF3FB}
.s-megamart .mini-hd{background:#D0011B}.s-megamart .mini-art{background:#fff}
.body{padding:20px 22px 22px;border-top:1px solid #E6E2DA;display:flex;flex-direction:column;flex:1}
.store h2{font:400 26px/1.15 ${serif};margin-bottom:2px}
.look{color:#5B5F68;font-size:14px;margin-bottom:18px}
.prices{list-style:none;margin:0 0 20px;padding:0;font-size:14px}
.prices li{display:flex;justify-content:space-between;padding:7px 0;border-top:1px solid #EFEBE3}
.prices li span:first-child{color:#5B5F68}
.visit{margin-top:auto;font-weight:600;font-size:14px;color:#1F7A55}
.store:hover .visit{text-decoration:underline;text-underline-offset:3px}
.how{border-top:1px solid #E6E2DA;padding:56px 0 72px;display:grid;grid-template-columns:1fr 1.6fr;gap:56px}
.how h2{font:400 30px/1.15 ${serif}}
.how p.sub{color:#5B5F68;margin-top:12px;font-size:15px}
ol{list-style:none;margin:0;padding:0;counter-reset:s}
ol li{counter-increment:s;display:grid;grid-template-columns:36px 1fr;padding:16px 0;border-top:1px solid #E6E2DA}
ol li:last-child{border-bottom:1px solid #E6E2DA}
ol li::before{content:counter(s);font:400 20px/1.3 ${serif};color:#B7791F}
table{width:100%;border-collapse:collapse;font-size:15px;margin-top:32px}
caption{text-align:left;font-size:13px;color:#5B5F68;padding-bottom:10px}
th{font-weight:600;text-align:right;padding:10px 0;border-bottom:1px solid #16181D;font-size:14px}
th:first-child,td:first-child{text-align:left}
td{padding:12px 0;border-bottom:1px solid #E6E2DA;text-align:right}
td.low{color:#1F7A55;font-weight:600}
.ft{border-top:1px solid #E6E2DA;padding:28px 0 40px;color:#5B5F68;font-size:13px}
@media(max-width:900px){.wrap{padding:0 20px}.intro,.how{grid-template-columns:1fr;gap:20px}.intro{padding:40px 0 32px}
.stores{grid-template-columns:1fr;gap:16px;padding-bottom:48px}.how{padding:40px 0 48px}.brand span{display:none}}
@media(prefers-reduced-motion:reduce){*{transition:none!important}}`;

export function hubPage(): string {
  const shops = SHOP_IDS.map((id) => SHOPS[id]);
  const [winix, levoit] = PRODUCTS;
  const lowest = (upc: string) => Math.min(...shops.map((s) => s.prices[upc]?.amountMinor ?? 0));

  const cards = shops
    .map((s) => {
      const m = MINI[s.id];
      const bg = s.id === "megamart" ? "#fff" : "none";
      return `<a class="store s-${s.id}" href="/${s.id}"><div class="mini-hd">${m.mark}</div>
<div class="mini-art">${PRODUCTS.map((p) => productArt(p.slug, { uid: `hub${s.id}${p.slug}`, backdrop: bg, label: p.name })).join("")}</div>
<div class="body"><h2>${s.name}</h2><p class="look">${m.look}</p>
<ul class="prices">${PRODUCTS.map((p) => `<li><span>${p.name.replace(/ Air Purifier$/, "")}</span><span>${fmt(s.prices[p.upc] ?? { amountMinor: 0, currency: "USD" })}</span></li>`).join("")}</ul>
<span class="visit">Visit ${s.name} →</span></div></a>`;
    })
    .join("");

  const rows = PRODUCTS.map((p) => {
    const low = lowest(p.upc);
    const cells = shops
      .map((s) => {
        const m = s.prices[p.upc];
        return `<td${m?.amountMinor === low ? ' class="low"' : ""}>${m ? fmt(m) : "–"}</td>`;
      })
      .join("");
    return `<tr><td>${p.name.replace(/ Air Purifier$/, "")}</td>${cells}</tr>`;
  }).join("");

  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>CITED · Demo storefronts</title><style>${css}</style></head><body><div class="wrap">
<header class="top"><a class="brand" href="../">CITED<span>Demo storefronts</span></a><a class="back" href="../">Back to CITED</a></header>
<section class="intro"><h1>Three independent stores an AI shopping agent can buy from.</h1>
<p class="lede">Each sells the same two air purifiers, ${winix ? winix.name.replace(/ Air Purifier$/, "") : ""} and ${levoit ? levoit.name.replace(/ Air Purifier$/, "") : ""}, at its own price. A sale that started with a creator's test is credited back to that test, whichever store it lands at.</p></section>
<section class="stores" aria-label="Stores">${cards}</section>
<section class="how"><div><h2>How a sale finds its way back</h2><p class="sub">No cookies, no affiliate links. The store only has to pass one field through to PayPal.</p></div>
<div><ol><li><span>An agent reads a creator's test in PayPal's catalogue and receives a signed passport.</span></li>
<li><span>It buys at whichever store it likes. The store puts the passport in the order's <code>custom_id</code>.</span></li>
<li><span>When PayPal captures the payment, CITED verifies the passport and credits the test, if the test caused the sale.</span></li></ol>
<table><caption>Prices today. Each store charges the same for both purifiers, so price never tips the choice between them.</caption>
<thead><tr><th scope="col">Product</th>${shops.map((s) => `<th scope="col">${s.name}</th>`).join("")}</tr></thead><tbody>${rows}</tbody></table></div></section>
<footer class="ft">Sandbox demo. No goods ship and no real money moves.</footer></div></body></html>`;
}
