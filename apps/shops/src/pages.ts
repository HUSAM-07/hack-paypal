import type { Money } from "@pact/protocol";
import { toPayPalValue } from "@pact/protocol";
import { PRODUCTS, type Product, SHOPS, type Shop, type ShopId } from "./catalogue";

export interface PageEnv {
  /** PayPal JS SDK client id. Absent in simulated mode: a stand-in button is rendered instead. */
  paypalClientId: string | undefined;
}

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

export const fmt = (m: Money) => `$${toPayPalValue(m)}`;

interface Theme {
  css: string;
  header(shop: Shop): string;
  footer(shop: Shop): string;
  home(shop: Shop, products: Product[]): string;
  product(shop: Shop, p: Product, buy: string): string;
}

const base = `*{box-sizing:border-box}body{margin:0}a{color:inherit}img,svg{max-width:100%}
.pp{min-height:48px}.status{margin-top:12px;font-size:.95rem}`;

// Northwind: Shopify-style. White, wide gutters, serif wordmark, black pill buttons.
const northwind: Theme = {
  css: `${base}
body{font:16px/1.5 Helvetica,Arial,sans-serif;color:#1a1a1a;background:#fff}
header{display:flex;justify-content:space-between;align-items:center;padding:20px 48px;border-bottom:1px solid #e8e8e8}
.logo{font:600 1.6rem Georgia,serif;letter-spacing:.02em;text-decoration:none}
nav a{margin-left:24px;text-decoration:none;font-size:.9rem}
.hero{padding:72px 48px 40px;max-width:1100px;margin:auto}
.hero h1{font:400 2.8rem/1.1 Georgia,serif;margin:0 0 12px}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(300px,1fr));gap:32px;padding:24px 48px 72px;max-width:1100px;margin:auto}
.tile{text-decoration:none}.tile .img{aspect-ratio:1;background:#f3f1ee;display:grid;place-items:center;font:italic 1.1rem Georgia,serif;color:#8a847c;margin-bottom:12px}
.price{font-weight:600}
.pdp{display:grid;grid-template-columns:1fr 1fr;gap:56px;padding:48px;max-width:1100px;margin:auto}
.pdp .img{aspect-ratio:1;background:#f3f1ee;display:grid;place-items:center;font:italic 1.3rem Georgia,serif;color:#8a847c}
.pdp h1{font:400 2.2rem Georgia,serif;margin:0 0 8px}
.btn{display:inline-block;background:#1a1a1a;color:#fff;border:0;border-radius:999px;padding:14px 28px;font:inherit;cursor:pointer}
footer{padding:32px 48px;border-top:1px solid #e8e8e8;color:#6b6b6b;font-size:.85rem}
@media(max-width:720px){.pdp{grid-template-columns:1fr}header,.hero,.grid,.pdp{padding-left:20px;padding-right:20px}}`,
  header: (s) =>
    `<header><a class="logo" href="/${s.id}">${esc(s.name)}</a><nav><a href="/${s.id}">Shop</a><a href="#">Journal</a><a href="#">Cart (0)</a></nav></header>`,
  footer: (s) => `<footer>${esc(s.name)} · ${esc(s.tagline)} · Demo shop, no goods ship.</footer>`,
  home: (s, ps) =>
    `<section class="hero"><h1>${esc(s.tagline)}</h1><p>Air purifiers, chosen with care.</p></section><div class="grid">${ps
      .map(
        (p) =>
          `<a class="tile" href="/${s.id}/p/${p.slug}"><div class="img">${esc(p.name)}</div><div>${esc(p.name)}</div><div class="price">${fmt(s.prices[p.upc] as Money)}</div></a>`,
      )
      .join("")}</div>`,
  product: (s, p, buy) =>
    `<div class="pdp"><div class="img">${esc(p.name)}</div><div><h1>${esc(p.name)}</h1><p class="price">${fmt(s.prices[p.upc] as Money)}</p><p>${esc(p.blurb)}</p>${buy}</div></div>`,
};

// Lumen: WooCommerce-style. Breadcrumbs, sidebar widgets, sale badge, purple accent.
const lumen: Theme = {
  css: `${base}
body{font:15px/1.6 "Segoe UI",Tahoma,sans-serif;color:#3c3c3c;background:#f7f6fb}
.topbar{background:#7f54b3;color:#fff;text-align:center;padding:6px;font-size:.85rem}
header{background:#fff;padding:14px 32px;display:flex;justify-content:space-between;align-items:center;border-bottom:3px solid #7f54b3}
.logo{font-weight:800;font-size:1.5rem;color:#7f54b3;text-decoration:none}
.wrap{display:grid;grid-template-columns:220px 1fr;gap:28px;max-width:1100px;margin:24px auto;padding:0 20px}
aside{background:#fff;border:1px solid #e3def0;padding:16px;align-self:start}
aside h4{margin:0 0 8px;color:#7f54b3;text-transform:uppercase;font-size:.8rem}aside ul{margin:0 0 16px;padding-left:18px}
.crumbs{font-size:.85rem;color:#8b8499;margin-bottom:12px}
.products{display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:20px}
.card{background:#fff;border:1px solid #e3def0;padding:14px;text-align:center;position:relative}
.card .img{height:160px;background:#ece8f6;display:grid;place-items:center;color:#7f54b3;margin-bottom:10px}
.badge{position:absolute;top:8px;left:8px;background:#e2401c;color:#fff;font-size:.75rem;padding:2px 8px;border-radius:3px}
.price{color:#7f54b3;font-weight:700}.price s{color:#9a95a8;font-weight:400;margin-right:6px}
.btn{background:#7f54b3;color:#fff;border:0;border-radius:3px;padding:10px 18px;font:inherit;cursor:pointer;text-decoration:none;display:inline-block}
.single{background:#fff;border:1px solid #e3def0;padding:24px;display:grid;grid-template-columns:260px 1fr;gap:28px}
.single .img{height:260px;background:#ece8f6;display:grid;place-items:center;color:#7f54b3}
footer{background:#2b2438;color:#bdb6cc;padding:24px 32px;margin-top:32px;font-size:.85rem}
@media(max-width:720px){.wrap,.single{grid-template-columns:1fr}}`,
  header: (s) =>
    `<div class="topbar">Free shipping on orders over $75 (demo)</div><header><a class="logo" href="/${s.id}">${esc(s.name)}</a><span>🛒 0 items</span></header>`,
  footer: (s) =>
    `<footer>© ${esc(s.name)} · ${esc(s.tagline)} · Demo shop, no goods ship.</footer>`,
  home: (s, ps) =>
    `<div class="wrap"><aside><h4>Categories</h4><ul><li>Air purifiers</li><li>Humidifiers</li><li>Filters</li></ul><h4>Search</h4><input placeholder="Search products…"></aside><main><div class="crumbs">Home / Air purifiers</div><div class="products">${ps
      .map(
        (p) =>
          `<div class="card">${p.slug === "winix-a230" ? '<span class="badge">Sale</span>' : ""}<div class="img">${esc(p.name)}</div><h3>${esc(p.name)}</h3><div class="price">${fmt(s.prices[p.upc] as Money)}</div><p><a class="btn" href="/${s.id}/p/${p.slug}">Select options</a></p></div>`,
      )
      .join("")}</div></main></div>`,
  product: (s, p, buy) =>
    `<div class="wrap" style="grid-template-columns:1fr"><main><div class="crumbs">Home / Air purifiers / ${esc(p.name)}</div><div class="single"><div class="img">${esc(p.name)}</div><div><h1>${esc(p.name)}</h1><p class="price">${fmt(s.prices[p.upc] as Money)}</p><p>${esc(p.blurb)}</p>${buy}</div></div></main></div>`,
};

// MegaMart: big-box. Red/yellow bar, dense listing rows, price flags.
const megamart: Theme = {
  css: `${base}
body{font:14px/1.45 Arial,sans-serif;color:#222;background:#eee}
header{background:#c8102e;color:#fff;padding:10px 24px;display:flex;gap:24px;align-items:center}
.logo{font:900 1.7rem Arial Black,Arial;color:#ffd100;text-decoration:none;text-transform:uppercase}
header input{flex:1;padding:8px;border:0}
.strip{background:#ffd100;padding:6px 24px;font-weight:700}
.page{max-width:1100px;margin:16px auto;padding:0 12px}
.row{display:grid;grid-template-columns:120px 1fr 180px;gap:16px;background:#fff;border:1px solid #ccc;padding:12px;margin-bottom:10px;align-items:center}
.row .img{height:100px;background:#ddd;display:grid;place-items:center;font-size:.8rem;text-align:center}
.flag{display:inline-block;background:#c8102e;color:#fff;font:800 1.6rem Arial;padding:4px 12px}
.btn{background:#ffd100;color:#222;border:2px solid #222;padding:10px 16px;font:700 14px Arial;cursor:pointer;text-decoration:none;display:inline-block;text-transform:uppercase}
.detail{background:#fff;border:1px solid #ccc;padding:20px;display:grid;grid-template-columns:240px 1fr;gap:24px}
.detail .img{height:240px;background:#ddd;display:grid;place-items:center}
footer{background:#222;color:#ccc;padding:20px 24px;margin-top:24px;font-size:.8rem}
@media(max-width:720px){.row,.detail{grid-template-columns:1fr}}`,
  header: (s) =>
    `<header><a class="logo" href="/${s.id}">${esc(s.name)}</a><input placeholder="Search everything"><span>Cart (0)</span></header><div class="strip">${esc(s.tagline)}</div>`,
  footer: (s) =>
    `<footer>${esc(s.name)} · Store locator · Help · Demo shop, no goods ship.</footer>`,
  home: (s, ps) =>
    `<div class="page"><h2>Air purifiers</h2>${ps
      .map(
        (p) =>
          `<div class="row"><div class="img">${esc(p.name)}</div><div><strong>${esc(p.name)}</strong><br>${esc(p.blurb)}</div><div><span class="flag">${fmt(s.prices[p.upc] as Money)}</span><p><a class="btn" href="/${s.id}/p/${p.slug}">View item</a></p></div></div>`,
      )
      .join("")}</div>`,
  product: (s, p, buy) =>
    `<div class="page"><div class="detail"><div class="img">${esc(p.name)}</div><div><h1>${esc(p.name)}</h1><p>${esc(p.blurb)}</p><span class="flag">${fmt(s.prices[p.upc] as Money)}</span><div style="margin-top:16px">${buy}</div></div></div></div>`,
};

const THEMES: Record<ShopId, Theme> = { northwind, lumen, megamart };

/** The checkout block: PayPal buttons when a client id is set, a stand-in button in simulated mode. */
function buyBlock(shop: Shop, p: Product, env: PageEnv): string {
  const cfg = JSON.stringify({ shop: shop.id, upc: p.upc, live: Boolean(env.paypalClientId) });
  const sdk = env.paypalClientId
    ? `<script src="https://www.paypal.com/sdk/js?client-id=${encodeURIComponent(env.paypalClientId)}&currency=USD&intent=capture"></script>`
    : "";
  const standIn = env.paypalClientId
    ? ""
    : `<button class="btn" id="sim-pay" type="button">Pay with PayPal (simulated)</button>`;
  return `<div id="paypal-buttons" class="pp">${standIn}</div><div class="status" id="status" role="status"></div>${sdk}<script>
const cfg=${cfg.replace(/</g, "\\u003c")};
const q=new URLSearchParams(location.search);
const passport=q.get("passport")||sessionStorage.getItem("cited_passport")||undefined;
if(passport)sessionStorage.setItem("cited_passport",passport);
let ref=sessionStorage.getItem("cited_cart");
if(!ref){ref=Math.random().toString(36).slice(2,12);sessionStorage.setItem("cited_cart",ref)}
const base="/"+cfg.shop+"/api/orders";
const say=t=>{document.getElementById("status").textContent=t};
async function createOrder(){
  const r=await fetch(base,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({upc:cfg.upc,passport,clientRef:ref})});
  const d=await r.json();if(!r.ok)throw new Error(d.error?.message||"order failed");return d.orderId}
async function capture(id){
  const r=await fetch(base+"/"+id+"/capture",{method:"POST"});
  const d=await r.json();if(!r.ok)throw new Error(d.error?.message||"capture failed");
  say("Paid. Order "+d.orderId+" "+d.status.toLowerCase()+".")}
if(cfg.live&&window.paypal){paypal.Buttons({createOrder,onApprove:d=>capture(d.orderID),onError:e=>say(String(e))}).render("#paypal-buttons")}
else{document.getElementById("sim-pay")?.addEventListener("click",async()=>{try{await capture(await createOrder())}catch(e){say(e.message)}})}
</script>`;
}

function layout(shop: Shop, title: string, body: string): string {
  const t = THEMES[shop.id];
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)}</title><style>${t.css}</style></head><body>${t.header(shop)}${body}${t.footer(shop)}</body></html>`;
}

export function homePage(shop: Shop): string {
  return layout(shop, `${shop.name}: ${shop.tagline}`, THEMES[shop.id].home(shop, PRODUCTS));
}

export function productPage(shop: Shop, p: Product, env: PageEnv): string {
  return layout(
    shop,
    `${p.name} · ${shop.name}`,
    THEMES[shop.id].product(shop, p, buyBlock(shop, p, env)),
  );
}

export const allShops = () => Object.values(SHOPS);
