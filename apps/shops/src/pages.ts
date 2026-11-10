import type { Money } from "@pact/protocol";
import { toPayPalValue } from "@pact/protocol";
import { productArt } from "./art";
import { PRODUCTS, type Product, SHOP_IDS, SHOPS, type Shop, type ShopId } from "./catalogue";

export interface PageEnv {
  /** PayPal JS SDK client id. Absent in simulated mode: a stand-in button is rendered instead. */
  paypalClientId: string | undefined;
}

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

export const fmt = (m: Money) => `$${toPayPalValue(m)}`;

const priceOf = (s: Shop, p: Product) => s.prices[p.upc] as Money;
const brandOf = (p: Product) => p.name.split(" ")[0] ?? p.name;
/** "Winix A230 Air Purifier" -> "Winix A230". */
const shortName = (p: Product) => p.name.replace(/ Air Purifier$/, "");

const productHref = (s: Shop, p: Product) => `/${s.id}/p/${p.slug}`;
const checkoutHref = (s: Shop, p: Product) => `/${s.id}/checkout/${p.slug}`;

interface Theme {
  css: string;
  header(shop: Shop): string;
  footer(shop: Shop): string;
  home(shop: Shop, products: Product[]): string;
  product(shop: Shop, p: Product): string;
  checkout(shop: Shop, p: Product, buy: string): string;
  /** Checkout pages get a stripped-down header, as real checkouts do. */
  checkoutHeader?(shop: Shop): string;
}

/** Shown when an agent arrives carrying a passport; filled in by `passportScript`. */
const via = `<p class="via" id="via" hidden><span class="via-dot" aria-hidden="true"></span><span data-via></span></p>`;

// Shared by every store: PayPal's own button look, the arrival note, the payment status.
const base = `*{box-sizing:border-box}html{-webkit-text-size-adjust:100%}body{margin:0;-webkit-font-smoothing:antialiased}
body{min-height:100vh;display:flex;flex-direction:column}body>main,body>.co{flex:1;width:100%}
a{color:inherit}svg{display:block;width:100%;height:auto}h1,h2,h3,p{margin:0}
.num,.price{font-variant-numeric:tabular-nums}
[hidden]{display:none!important}
:focus-visible{outline:2px solid currentColor;outline-offset:3px}
.via{display:inline-flex;align-items:center;gap:8px;font-size:13px;line-height:1.3;padding:6px 12px 6px 10px;border-radius:999px;background:#EAF4EE;color:#1F5C43;margin-bottom:16px}
.via-dot{width:7px;height:7px;border-radius:50%;background:#1F7A55;flex:none}
.pp{min-height:48px}
.ppbtn{display:flex;align-items:center;justify-content:center;gap:6px;width:100%;min-height:48px;border:0;border-radius:24px;background:#FFC439;color:#111;font:500 16px/1 -apple-system,"Helvetica Neue",Arial,sans-serif;cursor:pointer;transition:background-color .15s,transform .12s}
.ppbtn:hover{background:#F2B92F}.ppbtn:active{transform:scale(.96)}
.ppbtn:focus-visible{outline:2px solid #003087;outline-offset:3px}
.ppbtn:disabled{cursor:default;opacity:.55;transform:none}
.pp-word{font:italic 800 19px/1 Verdana,"Helvetica Neue",Arial,sans-serif;letter-spacing:-.03em}
.pp-a{color:#003087}.pp-b{color:#0070E0}
.pp-note{font-size:12px;line-height:1.4;margin-top:10px;text-align:center}
.status{margin-top:14px;padding:12px 14px;border-radius:8px;background:#E8F5EE;color:#14532D;font-size:14px;line-height:1.4}
.status:empty{display:none}.status.err{background:#FDECEC;color:#8A1C1C}
@media(prefers-reduced-motion:reduce){*{transition:none!important}}`;

// ── Northwind: Shopify-style. White, pine and sage, spaced-caps wordmark, black pill buttons. ──

const nwFont = `"Avenir Next",Avenir,"Segoe UI",system-ui,sans-serif`;
const northwind: Theme = {
  css: `${base}
body{font:16px/1.6 ${nwFont};color:#1C211E;background:#fff}
.ann{background:#2F4A3F;color:#F1F4EF;text-align:center;font-size:13px;padding:9px 16px;letter-spacing:.02em}
.hd{display:grid;grid-template-columns:1fr auto 1fr;align-items:center;padding:22px 48px;border-bottom:1px solid #E3E5E0}
.hd nav{display:flex;gap:28px;font-size:14px;color:#3F4641}
.hd .icons{justify-self:end;display:flex;gap:24px;font-size:14px;color:#3F4641}
.mark{font:500 22px/1 ${nwFont};letter-spacing:.34em;text-transform:uppercase;text-decoration:none;padding-left:.34em}
.wrap{max-width:1200px;margin:0 auto;padding:0 48px}
.hero{display:grid;grid-template-columns:1fr 1.1fr;align-items:center;gap:56px;padding:56px 0 72px}
.eyebrow{font-size:12px;letter-spacing:.18em;text-transform:uppercase;color:#5E655F;margin-bottom:18px}
.hero h1{font:400 clamp(40px,5vw,64px)/1.04 ${nwFont};letter-spacing:-.02em;margin-bottom:20px}
.hero p{color:#5E655F;max-width:34ch;margin-bottom:32px;font-size:17px}
.art{background:#E9ECE5;border-radius:4px;overflow:hidden}
.btn{display:inline-flex;align-items:center;justify-content:center;min-height:50px;padding:0 32px;border-radius:999px;background:#1C211E;color:#fff;text-decoration:none;font-size:15px;letter-spacing:.02em;transition:transform .12s}
.btn:active{transform:scale(.96)}
.btn.ghost{background:transparent;color:#1C211E;box-shadow:inset 0 0 0 1px #1C211E}
.coll{padding:8px 0 96px}
.coll-hd{display:flex;justify-content:space-between;align-items:baseline;border-top:1px solid #E3E5E0;padding-top:28px;margin-bottom:28px}
.coll-hd h2{font:400 28px/1.2 ${nwFont};letter-spacing:-.01em}.coll-hd span{font-size:14px;color:#5E655F}
.grid{display:grid;grid-template-columns:repeat(2,1fr);gap:32px}
.tile{text-decoration:none;display:block}.tile .art{margin-bottom:16px;transition:opacity .2s}.tile:hover .art{opacity:.9}
.tile h3{font:400 17px/1.4 ${nwFont};margin-bottom:4px}.tile:hover h3{text-decoration:underline;text-underline-offset:3px}
.tile .price{font-size:15px;color:#3F4641}
.pdp{display:grid;grid-template-columns:1.15fr 1fr;gap:64px;padding:48px 0 96px;align-items:start}
.pdp .art{position:sticky;top:24px}
.vendor{font-size:12px;letter-spacing:.18em;text-transform:uppercase;color:#5E655F;margin-bottom:10px}
.pdp h1{font:400 40px/1.12 ${nwFont};letter-spacing:-.015em;margin-bottom:16px}
.pdp .price{font-size:20px;margin-bottom:4px}
.fine{font-size:13px;color:#5E655F;margin-bottom:28px}
.pdp .desc{color:#3F4641;margin:28px 0 32px;max-width:46ch}
.pdp .btn{width:100%}
.facts{margin:36px 0 0;border-top:1px solid #E3E5E0}
.facts div{display:flex;justify-content:space-between;padding:14px 0;border-bottom:1px solid #E3E5E0;font-size:14px}
.facts dt{color:#5E655F}.facts dd{margin:0}
.ft{border-top:1px solid #E3E5E0;padding:40px 48px;display:flex;justify-content:space-between;gap:24px;font-size:13px;color:#5E655F}
.ft .mark{font-size:15px;color:#1C211E}
.co-hd{padding:24px 48px;border-bottom:1px solid #E3E5E0;display:flex;justify-content:center}
.co{display:grid;grid-template-columns:1fr 1fr;min-height:calc(100vh - 71px)}
.co-main{padding:48px;display:flex;justify-content:flex-end}
.co-main>div{width:100%;max-width:500px}
.co-side{background:#F5F6F3;border-left:1px solid #E3E5E0;padding:48px}
.co-side>div{max-width:420px}
.express{font-size:14px;color:#5E655F;text-align:center;display:flex;align-items:center;gap:14px;margin-bottom:14px}
.express::before,.express::after{content:"";flex:1;height:1px;background:#E3E5E0}
.pp-note{color:#5E655F}
.co h2{font:500 20px/1.3 ${nwFont};margin:40px 0 10px}
.co-main p.fine{margin:0}
.line{display:grid;grid-template-columns:64px 1fr auto;gap:16px;align-items:center;margin-bottom:24px}
.thumb{position:relative;border:1px solid #DCDFD8;border-radius:8px;background:#fff}
.thumb svg{border-radius:7px}
.qty{position:absolute;top:-8px;right:-8px;min-width:21px;height:21px;border-radius:11px;background:#5E655F;color:#fff;font-size:12px;display:grid;place-items:center;padding:0 6px}
.line .name{font-size:14px}
.sum div{display:flex;justify-content:space-between;font-size:14px;padding:5px 0}
.sum .total{font-size:19px;font-weight:600;padding-top:14px}.sum .total small{font-size:12px;font-weight:400;color:#5E655F;margin-right:6px}
@media(max-width:860px){.hd{grid-template-columns:auto 1fr;padding:18px 20px}.hd nav{display:none}.wrap{padding:0 20px}
.hero,.pdp,.co{grid-template-columns:1fr}.hero{gap:32px;padding:32px 0 48px}.hero .art{order:-1}.pdp{gap:28px;padding:20px 0 64px}
.pdp .art{position:static}.pdp h1{font-size:30px}.grid{grid-template-columns:1fr}.ft{flex-direction:column;padding:32px 20px}
.co-hd{padding:20px}.co{align-content:start}.co-main,.co-side{padding:28px 20px}.co-side{order:-1;border-left:0;border-bottom:1px solid #E3E5E0}.co-main{justify-content:flex-start}}`,
  header: (s) =>
    `<div class="ann">Free standard delivery on every order. Demo store: nothing ships.</div>
<header class="hd"><nav aria-label="Main"><span>Shop all</span><span>Air</span><span>Journal</span></nav>
<a class="mark" href="/${s.id}">${esc(s.name)}</a><div class="icons"><span>Search</span><span>Cart</span></div></header>`,
  checkoutHeader: (s) =>
    `<header class="co-hd"><a class="mark" href="/${s.id}">${esc(s.name)}</a></header>`,
  footer: (s) =>
    `<footer class="ft"><div><span class="mark">${esc(s.name)}</span></div><div>${esc(s.tagline)}. © 2026 ${esc(s.name)}, a demo store.</div></footer>`,
  home: (s, ps) => {
    const hero = ps[1] ?? ps[0];
    return `<main class="wrap"><section class="hero"><div><p class="eyebrow">Air care</p>
<h1>Cleaner air, quietly.</h1><p>Two HEPA air purifiers for bedrooms and living rooms, priced the same.</p>
<a class="btn" href="#collection">Shop air purifiers</a></div>
<div class="art">${hero ? productArt(hero.slug, { uid: "nwh", label: hero.name }) : ""}</div></section>
<section class="coll" id="collection"><div class="coll-hd"><h2>Air purifiers</h2><span>${ps.length} products</span></div>
<div class="grid">${ps
      .map(
        (p) =>
          `<a class="tile" href="${productHref(s, p)}"><div class="art">${productArt(p.slug, { uid: `nw${p.slug}`, label: p.name })}</div><h3>${esc(p.name)}</h3><p class="price">${fmt(priceOf(s, p))}</p></a>`,
      )
      .join("")}</div></section></main>`;
  },
  product: (s, p) =>
    `<main class="wrap"><div class="pdp"><div class="art">${productArt(p.slug, { uid: "nwp", label: p.name })}</div>
<div>${via}<p class="vendor">${esc(brandOf(p))}</p><h1>${esc(p.name)}</h1>
<p class="price">${fmt(priceOf(s, p))} USD</p><p class="fine">Tax included. Shipping calculated at checkout.</p>
<a class="btn" href="${checkoutHref(s, p)}">Buy it now</a>
<p class="desc">${esc(p.blurb)}</p>
<dl class="facts"><div><dt>Brand</dt><dd>${esc(brandOf(p))}</dd></div><div><dt>UPC</dt><dd class="num">${esc(p.upc)}</dd></div><div><dt>Sold by</dt><dd>${esc(s.name)}</dd></div></dl></div></div></main>`,
  checkout: (s, p, buy) =>
    `<div class="co"><section class="co-main"><div>${via}<p class="express">Express checkout</p>${buy}
<h2>Contact and delivery</h2><p class="fine">PayPal shares your email and shipping address with ${esc(s.name)} when you pay.</p></div></section>
<aside class="co-side" aria-label="Order summary"><div><div class="line"><div class="thumb">${productArt(p.slug, { uid: "nwc", backdrop: "#F2F4EF", label: p.name })}<span class="qty">1</span></div>
<span class="name">${esc(p.name)}</span><span class="price">${fmt(priceOf(s, p))}</span></div>
<div class="sum"><div><span>Subtotal</span><span class="price">${fmt(priceOf(s, p))}</span></div><div><span>Shipping</span><span>Free</span></div>
<div class="total"><span>Total</span><span><small>USD</small><span class="price">${fmt(priceOf(s, p))}</span></span></div></div></div></aside></div>`,
};

// ── Lumen: WooCommerce-style. Bright cobalt and sunflower, rounded type, sidebar widgets. ──

const luFont = `ui-rounded,"SF Pro Rounded","Nunito","Segoe UI",system-ui,sans-serif`;
const lumen: Theme = {
  css: `${base}
body{font:15px/1.6 ${luFont};color:#1F2937;background:#F5F7FB}
.top{background:#FFF3D1;color:#5C4400;text-align:center;font-size:13px;padding:7px 16px}
.hd{background:#fff;border-bottom:1px solid #E2E7EF}
.hd-in{max-width:1180px;margin:0 auto;padding:18px 24px;display:flex;align-items:center;gap:28px}
.mark{font:800 30px/1 ${luFont};color:#1F5FD6;text-decoration:none;letter-spacing:-.03em;display:inline-flex;align-items:center;gap:3px}
.mark i{width:11px;height:11px;border-radius:50%;background:#FFB81C;margin-top:10px;box-shadow:0 0 0 3px #FFE7A8}
.search{flex:1;max-width:460px;border:2px solid #E2E7EF;border-radius:999px;padding:9px 18px;color:#6B7383;font-size:14px}
.cartlink{margin-left:auto;font-size:14px;color:#3B4352;white-space:nowrap}.cartlink b{color:#1F5FD6}
.nav{background:#1F5FD6;color:#fff}.nav-in{max-width:1180px;margin:0 auto;padding:0 24px;display:flex;gap:26px;font-size:14px;font-weight:600}
.nav span{padding:11px 0}.nav span:first-child{box-shadow:inset 0 -3px 0 #FFB81C}
.page{max-width:1180px;margin:0 auto;padding:22px 24px 56px}
.crumbs{font-size:13px;color:#6B7383;margin-bottom:14px}.crumbs a{text-decoration:none;color:#1F5FD6}
.cols{display:grid;grid-template-columns:240px 1fr;gap:28px;align-items:start}
.widget{background:#fff;border:1px solid #E2E7EF;border-radius:12px;padding:18px 20px;margin-bottom:18px}
.widget h4{margin:0 0 10px;font-size:13px;text-transform:uppercase;letter-spacing:.06em;color:#1F5FD6}
.widget ul{list-style:none;margin:0;padding:0}.widget li{display:flex;justify-content:space-between;padding:5px 0;font-size:14px;color:#3B4352}
.widget li span:last-child{color:#6B7383}.widget p{font-size:14px;color:#3B4352}
.res{display:flex;justify-content:space-between;align-items:center;margin:4px 0 16px;font-size:14px;color:#5B6474}
h1.t{font:800 30px/1.2 ${luFont};letter-spacing:-.02em;margin-bottom:6px}
.sort{border:1px solid #E2E7EF;background:#fff;border-radius:8px;padding:6px 12px}
.products{display:grid;grid-template-columns:repeat(auto-fill,minmax(250px,1fr));gap:20px}
.card{background:#fff;border:1px solid #E2E7EF;border-radius:14px;padding:14px 14px 18px;position:relative;display:flex;flex-direction:column}
.card .img{background:#EEF3FB;border-radius:10px;margin-bottom:14px;overflow:hidden}
.stock{position:absolute;top:24px;left:24px;background:#E3F6EA;color:#17663A;font-size:12px;font-weight:700;padding:3px 10px;border-radius:999px}
.card h3{font:700 16px/1.35 ${luFont};margin-bottom:4px}.card h3 a{text-decoration:none}.card h3 a:hover{color:#1F5FD6}
.stars{font-size:13px;color:#6B7383;margin-bottom:8px}
.card .price{font-size:20px;font-weight:800;color:#1F5FD6;margin-bottom:14px}
.btn{display:inline-flex;align-items:center;justify-content:center;min-height:44px;padding:0 22px;border-radius:10px;background:#1F5FD6;color:#fff;font:700 15px/1 ${luFont};text-decoration:none;transition:background-color .15s,transform .12s}
.btn:hover{background:#174CB0}.btn:active{transform:scale(.96)}
.card .btn{margin-top:auto}
.single{background:#fff;border:1px solid #E2E7EF;border-radius:16px;padding:28px;display:grid;grid-template-columns:1fr 1fr;gap:40px}
.single .img{background:#EEF3FB;border-radius:12px;overflow:hidden}
.single h1{font:800 32px/1.2 ${luFont};letter-spacing:-.02em;margin-bottom:6px}
.single .price{font-size:30px;font-weight:800;color:#1F5FD6;margin:12px 0}
.single .short{color:#3B4352;margin-bottom:16px}
.instock{color:#17663A;font-weight:700;font-size:14px;margin-bottom:18px}
.buyrow{display:flex;gap:12px;align-items:center;margin-bottom:22px}
.qtybox{width:64px;min-height:44px;border:2px solid #E2E7EF;border-radius:10px;display:grid;place-items:center;font-weight:700}
.meta{border-top:1px solid #E2E7EF;padding-top:14px;font-size:13px;color:#5B6474}.meta b{color:#1F2937}
.tabs{margin-top:28px;background:#fff;border:1px solid #E2E7EF;border-radius:16px;overflow:hidden}
.tabs-h{display:flex;gap:4px;border-bottom:1px solid #E2E7EF;padding:0 16px;font-size:14px;font-weight:700;color:#6B7383}
.tabs-h span{padding:14px 12px}.tabs-h span:first-child{color:#1F5FD6;box-shadow:inset 0 -3px 0 #1F5FD6}
.tabs-b{padding:20px 28px;color:#3B4352}
.chk{display:grid;grid-template-columns:1fr 1.1fr;gap:28px;align-items:start}
.panel{background:#fff;border:1px solid #E2E7EF;border-radius:16px;padding:24px 26px}
.panel h2{font:800 20px/1.3 ${luFont};margin-bottom:12px}.panel p{color:#3B4352;font-size:14px}
table{width:100%;border-collapse:collapse;font-size:14px;margin-bottom:20px}
th{text-align:left;font-size:12px;text-transform:uppercase;letter-spacing:.06em;color:#6B7383;padding:0 0 10px;border-bottom:2px solid #E2E7EF}
th:last-child,td:last-child{text-align:right}
td{padding:12px 0;border-bottom:1px solid #E2E7EF}
tr.total td{font-weight:800;font-size:17px;color:#1F5FD6;border-bottom:0}
.method{background:#F5F7FB;border:1px solid #E2E7EF;border-radius:12px;padding:16px}
.radio{display:flex;align-items:center;gap:10px;font-weight:700;margin-bottom:6px}
.radio i{width:16px;height:16px;border-radius:50%;border:5px solid #1F5FD6;background:#fff}
.method>p{font-size:13px;color:#5B6474;margin-bottom:14px}
.pp-note{color:#5B6474}
.ft{background:#16233F;color:#C4CCDB;font-size:13px}.ft-in{max-width:1180px;margin:0 auto;padding:28px 24px;display:flex;justify-content:space-between;gap:16px}
.ft .mark{font-size:22px;color:#fff}
@media(max-width:860px){.hd-in{flex-wrap:wrap;gap:14px;padding:14px 16px}.search{order:3;max-width:none;flex-basis:100%}
.nav-in{overflow-x:auto;gap:20px;padding:0 16px}.nav span{white-space:nowrap}.page{padding:16px 16px 40px}
.cols,.single,.chk{grid-template-columns:1fr}.cols aside{display:none}.single{padding:18px;gap:20px}.single h1{font-size:26px}
.ft-in{flex-direction:column;padding:24px 16px}}`,
  header: (s) =>
    `<div class="top">Free shipping on orders over $75. Demo store: nothing ships.</div>
<header class="hd"><div class="hd-in"><a class="mark" href="/${s.id}">${esc(s.name.toLowerCase())}<i aria-hidden="true"></i></a>
<div class="search" aria-hidden="true">Search products…</div><span class="cartlink"><b class="num">$0.00</b> · 0 items</span></div></header>
<nav class="nav" aria-label="Departments"><div class="nav-in"><span>Air purifiers</span><span>Humidifiers</span><span>Filters</span><span>Fans</span><span>Smart home</span></div></nav>`,
  footer: (s) =>
    `<footer class="ft"><div class="ft-in"><span class="mark">${esc(s.name.toLowerCase())}</span><span>${esc(s.tagline)}. © 2026 ${esc(s.name)}, a demo store.</span></div></footer>`,
  home: (s, ps) =>
    `<main class="page"><p class="crumbs"><a href="/${s.id}">Home</a> › Air purifiers</p>
<div class="cols"><aside><div class="widget"><h4>Product categories</h4><ul><li><span>Air purifiers</span><span class="num">(${ps.length})</span></li><li><span>Humidifiers</span><span class="num">(0)</span></li><li><span>Filters</span><span class="num">(0)</span></li></ul></div>
<div class="widget"><h4>Need a hand?</h4><p>Both purifiers use True HEPA filters. Pick by room size: see each product's description.</p></div></aside>
<div><h1 class="t">Air purifiers</h1><div class="res"><span>Showing all ${ps.length} results</span><span class="sort">Default sorting</span></div>
<div class="products">${ps
      .map(
        (p) =>
          `<div class="card"><span class="stock">In stock</span><div class="img">${productArt(p.slug, { uid: `lu${p.slug}`, label: p.name })}</div><h3><a href="${productHref(s, p)}">${esc(p.name)}</a></h3><p class="stars">No reviews yet</p><p class="price">${fmt(priceOf(s, p))}</p><a class="btn" href="${productHref(s, p)}">View product</a></div>`,
      )
      .join("")}</div></div></div></main>`,
  product: (s, p) =>
    `<main class="page"><p class="crumbs"><a href="/${s.id}">Home</a> › <a href="/${s.id}">Air purifiers</a> › ${esc(shortName(p))}</p>
<div class="single"><div class="img">${productArt(p.slug, { uid: "lup", label: p.name })}</div>
<div>${via}<h1>${esc(p.name)}</h1><p class="stars">No reviews yet</p><p class="price">${fmt(priceOf(s, p))}</p>
<p class="short">${esc(p.blurb)}</p><p class="instock">In stock</p>
<div class="buyrow"><span class="qtybox" aria-label="Quantity 1">1</span><a class="btn" href="${checkoutHref(s, p)}">Add to cart and check out</a></div>
<p class="meta"><b>UPC:</b> <span class="num">${esc(p.upc)}</span> &nbsp; <b>Category:</b> Air purifiers &nbsp; <b>Brand:</b> ${esc(brandOf(p))}</p></div></div>
<div class="tabs"><div class="tabs-h"><span>Description</span><span>Additional information</span><span>Reviews (0)</span></div><div class="tabs-b">${esc(p.blurb)}</div></div></main>`,
  checkout: (s, p, buy) =>
    `<main class="page"><p class="crumbs"><a href="/${s.id}">Home</a> › <a href="${productHref(s, p)}">${esc(shortName(p))}</a> › Checkout</p>
<h1 class="t">Checkout</h1><div class="chk" style="margin-top:16px"><section class="panel"><h2>Billing details</h2>${via}
<p>PayPal shares your name, email and shipping address with ${esc(s.name)} when you pay. No account needed here.</p></section>
<section class="panel"><h2>Your order</h2><table><thead><tr><th>Product</th><th>Subtotal</th></tr></thead><tbody>
<tr><td>${esc(p.name)} <span class="num">× 1</span></td><td class="price">${fmt(priceOf(s, p))}</td></tr>
<tr><td>Shipping</td><td>Free shipping</td></tr>
<tr class="total"><td>Total</td><td class="price">${fmt(priceOf(s, p))}</td></tr></tbody></table>
<div class="method"><p class="radio"><i aria-hidden="true"></i>PayPal</p><p>Pay with your PayPal account or a card through PayPal.</p>${buy}</div></section></div></main>`,
};

// ── MegaMart: big-box marketplace. Red header, dense rows, yellow deal flags, split-cents prices. ──

const mmFont = `"Helvetica Neue",Helvetica,Arial,sans-serif`;
const mmCond = `"Arial Narrow","Helvetica Neue Condensed","Roboto Condensed",${mmFont}`;
/** "$102.99" -> big dollars, small superscript cents, as big-box shelves print them. */
const shelfPrice = (m: Money) => {
  const [d, c] = toPayPalValue(m).split(".");
  return `<span class="sp num" aria-label="${fmt(m)}"><span aria-hidden="true"><sup>$</sup>${d}<sup>${c}</sup></span></span>`;
};
const searchIcon = `<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="10.5" cy="10.5" r="6.5"/><path d="M15.5 15.5 21 21" stroke-linecap="round"/></svg>`;
const lockIcon = `<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2"><rect x="5" y="10.5" width="14" height="10" rx="2"/><path d="M8 10.5V7.5a4 4 0 0 1 8 0v3"/></svg>`;
const megamart: Theme = {
  css: `${base}
body{font:14px/1.45 ${mmFont};color:#1A1A1A;background:#F2F2F2}
.hd{background:#D0011B;color:#fff}
.hd-in{max-width:1280px;margin:0 auto;padding:12px 20px;display:flex;align-items:center;gap:22px}
.mark{font:italic 900 28px/1 ${mmCond};text-transform:uppercase;letter-spacing:-.02em;text-decoration:none;color:#fff;white-space:nowrap}
.mark b{color:#FFD23F}
.search{flex:1;display:flex;background:#fff;border-radius:999px;overflow:hidden;min-height:42px}
.search span{flex:1;padding:11px 20px;color:#6E6E6E}.search i{width:52px;display:grid;place-items:center;background:#FFD23F;color:#1A1A1A;margin:4px;border-radius:999px}
.search i svg,.secure svg{width:20px;height:20px}.secure svg{width:16px;height:16px}
.acct{display:flex;gap:20px;font-size:13px;font-weight:700;white-space:nowrap}
.sub{background:#A00016;color:#fff}.sub-in{max-width:1280px;margin:0 auto;padding:0 20px;display:flex;gap:22px;font-size:13px;font-weight:700}
.sub span{padding:9px 0;white-space:nowrap}
.deal{background:#FFD23F;color:#1A1A1A;text-align:center;font:700 14px/1 ${mmCond};padding:9px 16px;text-transform:uppercase;letter-spacing:.02em}
.page{max-width:1280px;margin:0 auto;padding:14px 20px 40px}
.crumbs{font-size:12px;color:#5A5A5A;margin-bottom:10px}.crumbs a{color:#0654BA;text-decoration:none}
.lay{display:grid;grid-template-columns:220px 1fr;gap:20px;align-items:start}
.filters{background:#fff;border:1px solid #DADADA;font-size:13px}
.filters section{padding:12px 14px;border-bottom:1px solid #E8E8E8}.filters section:last-child{border-bottom:0}
.filters h4{margin:0 0 8px;font-size:13px}
.chk{display:flex;align-items:center;gap:8px;padding:3px 0}.chk i{width:15px;height:15px;border:1.5px solid #8A8A8A;border-radius:3px;flex:none}
.res{display:flex;justify-content:space-between;align-items:baseline;background:#fff;border:1px solid #DADADA;padding:10px 14px;margin-bottom:12px}
.res h1{font:700 18px/1.2 ${mmFont}}.res h1 small{font-weight:400;color:#5A5A5A;font-size:13px}
.res .sort{font-size:13px;color:#3A3A3A}
.items{display:grid;grid-template-columns:repeat(auto-fill,minmax(230px,1fr));gap:12px}
.item{background:#fff;border:1px solid #DADADA;padding:12px;display:flex;flex-direction:column}
.item .img{margin-bottom:8px}
.flags{display:flex;gap:6px;margin-bottom:6px;min-height:20px}
.flag{background:#FFD23F;color:#1A1A1A;font:800 11px/1 ${mmCond};text-transform:uppercase;padding:4px 7px;letter-spacing:.03em}
.flag.o{background:#fff;box-shadow:inset 0 0 0 1px #1A1A1A}
.sp{font:800 30px/1 ${mmFont};letter-spacing:-.02em;color:#1A1A1A}.sp sup{font-size:.48em;vertical-align:.95em;margin:0 1px}
.item .sp{color:#D0011B;margin:2px 0 6px}
.item h3{font:400 14px/1.35 ${mmFont};margin-bottom:6px}.item h3 a{text-decoration:none}.item h3 a:hover{text-decoration:underline}
.ship{font-size:12px;color:#0A7F3F;font-weight:700;margin-bottom:2px}
.ship+p{font-size:12px;color:#5A5A5A;margin-bottom:10px}
.btn{display:inline-flex;align-items:center;justify-content:center;min-height:40px;padding:0 18px;border-radius:999px;background:#0654BA;color:#fff;font:700 14px/1 ${mmFont};text-decoration:none;transition:background-color .15s,transform .12s}
.btn:hover{background:#04428F}.btn:active{transform:scale(.96)}
.item .btn{margin-top:auto;align-self:flex-start}
.btn.y{background:#FFD23F;color:#1A1A1A;min-height:48px;font-size:16px;width:100%}.btn.y:hover{background:#F5C518}
.pd{display:grid;grid-template-columns:minmax(0,1.1fr) minmax(0,1fr) 300px;gap:20px;align-items:start}
.pd .img{background:#fff;border:1px solid #DADADA}
.pd h1{font:400 22px/1.3 ${mmFont};margin:6px 0 8px}
.brand{color:#0654BA;font-size:13px;font-weight:700}
.upc{font-size:12px;color:#5A5A5A;margin-bottom:14px}
.pd ul{margin:0 0 16px;padding-left:18px;color:#3A3A3A}
.box{background:#fff;border:1px solid #DADADA;padding:18px}
.box .sp{font-size:36px;display:block;margin-bottom:12px}
.box p{font-size:13px;margin-bottom:6px}.box .ship{font-size:13px}
.box hr{border:0;border-top:1px solid #E8E8E8;margin:14px 0}
.co-hd{background:#D0011B;color:#fff}.co-hd .hd-in{justify-content:space-between}
.secure{display:flex;align-items:center;gap:6px;font-size:13px;font-weight:700}
.steps{display:flex;gap:0;margin:6px 0 16px;background:#fff;border:1px solid #DADADA;font-size:13px;font-weight:700}
.steps span{flex:1;padding:11px 14px;color:#8A8A8A;border-right:1px solid #E8E8E8}.steps span:last-child{border-right:0}
.steps .done{color:#0A7F3F}.steps .now{color:#1A1A1A;box-shadow:inset 0 -3px 0 #D0011B}
.co{display:grid;grid-template-columns:1fr 340px;gap:20px;align-items:start}
.co h2{font:700 18px/1.2 ${mmFont};margin-bottom:12px}
.lineitem{display:grid;grid-template-columns:72px 1fr;gap:12px;align-items:center;margin-bottom:12px;font-size:13px}
.lineitem .img{border:1px solid #E8E8E8}
.rows div{display:flex;justify-content:space-between;padding:4px 0;font-size:13px}
.rows .total{font-size:17px;font-weight:800;border-top:1px solid #E8E8E8;margin-top:8px;padding-top:12px}
.pp-note{color:#5A5A5A}
.ft{background:#1A1A1A;color:#BDBDBD;font-size:12px}.ft-in{max-width:1280px;margin:0 auto;padding:22px 20px;display:flex;gap:24px;flex-wrap:wrap}
@media(max-width:1000px){.pd{grid-template-columns:1fr 1fr}.pd .box{grid-column:1/-1}}
@media(max-width:760px){.hd-in{flex-wrap:wrap;gap:10px 16px;padding:10px 14px}.search{order:3;flex-basis:100%}.acct{margin-left:auto}
.sub-in{overflow-x:auto;padding:0 14px}.page{padding:10px 10px 32px}.lay,.pd,.co{grid-template-columns:1fr}.filters{display:none}
.items{grid-template-columns:1fr 1fr;gap:8px}.sp{font-size:24px}.item{padding:10px}.co-hd .hd-in{flex-wrap:nowrap}}`,
  header: (s) =>
    `<header class="hd"><div class="hd-in"><a class="mark" href="/${s.id}">Mega<b>Mart</b></a>
<div class="search" aria-hidden="true"><span>Search everything at ${esc(s.name)}</span><i>${searchIcon}</i></div>
<div class="acct"><span>Sign in</span><span>Cart <span class="num">0</span></span></div></div></header>
<nav class="sub" aria-label="Departments"><div class="sub-in"><span>Departments</span><span>Deals</span><span>Home</span><span>Appliances</span><span>Pickup &amp; delivery</span></div></nav>
<div class="deal">Deals on home air care · Free pickup today</div>`,
  checkoutHeader: (s) =>
    `<header class="hd co-hd"><div class="hd-in"><a class="mark" href="/${s.id}">Mega<b>Mart</b></a><span class="secure">${lockIcon}Secure checkout</span></div></header>`,
  footer: (s) =>
    `<footer class="ft"><div class="ft-in"><span>© 2026 ${esc(s.name)}, a demo store</span><span>${esc(s.tagline)}</span><span>Nothing ships from this store.</span></div></footer>`,
  home: (s, ps) =>
    `<main class="page"><p class="crumbs"><a href="/${s.id}">Home</a> › Appliances › Air purifiers</p>
<div class="lay"><aside class="filters" aria-label="Filters"><section><h4>Brand</h4>${ps.map((p) => `<p class="chk"><i></i>${esc(brandOf(p))}</p>`).join("")}</section>
<section><h4>Availability</h4><p class="chk"><i></i>Pickup today</p><p class="chk"><i></i>Shipping</p></section>
<section><h4>Filter type</h4><p class="chk"><i></i>True HEPA</p></section></aside>
<div><div class="res"><h1>Air purifiers <small class="num">(${ps.length} results)</small></h1><span class="sort">Sort by: Best match</span></div>
<div class="items">${ps
      .map(
        (p, i) =>
          `<div class="item"><a class="img" href="${productHref(s, p)}" tabindex="-1">${productArt(p.slug, { uid: `mm${p.slug}`, backdrop: "#fff", label: p.name })}</a>
<div class="flags"><span class="flag">Deal</span>${i === 0 ? '<span class="flag o">Online only</span>' : ""}</div>
${shelfPrice(priceOf(s, p))}<h3><a href="${productHref(s, p)}">${esc(p.name)}</a></h3>
<p class="ship">Free pickup today</p><p>Free shipping, arrives in 2 days</p><a class="btn" href="${productHref(s, p)}">View item</a></div>`,
      )
      .join("")}</div></div></div></main>`,
  product: (s, p) =>
    `<main class="page"><p class="crumbs"><a href="/${s.id}">Home</a> › Appliances › <a href="/${s.id}">Air purifiers</a></p>
<div class="pd"><div class="img">${productArt(p.slug, { uid: "mmp", backdrop: "#fff", label: p.name })}</div>
<div>${via}<div class="flags"><span class="flag">Deal</span></div><span class="brand">${esc(brandOf(p))}</span><h1>${esc(p.name)}</h1>
<p class="upc">UPC <span class="num">${esc(p.upc)}</span> · Sold and shipped by ${esc(s.name)}</p>
<ul><li>${esc(p.blurb)}</li><li>True HEPA filter</li></ul></div>
<div class="box">${shelfPrice(priceOf(s, p))}<p class="ship">Free pickup today</p><p>Free shipping, arrives in 2 days</p><hr>
<a class="btn y" href="${checkoutHref(s, p)}">Add to cart</a></div></div></main>`,
  checkout: (s, p, buy) =>
    `<main class="page"><div class="steps"><span class="done">✓ Cart</span><span class="now">Payment</span><span>Review</span></div>
<div class="co"><section class="box">${via}<h2>Payment method</h2>${buy}</section>
<aside class="box" aria-label="Order summary"><h2>Order summary</h2><div class="lineitem"><div class="img">${productArt(p.slug, { uid: "mmc", backdrop: "#fff", label: p.name })}</div><span>${esc(p.name)}<br><span class="num">Qty 1</span></span></div>
<div class="rows"><div><span>Subtotal <span class="num">(1 item)</span></span><span class="price">${fmt(priceOf(s, p))}</span></div><div><span>Shipping</span><span>Free</span></div>
<div class="total"><span>Total</span><span class="price">${fmt(priceOf(s, p))}</span></div></div></aside></div></main>`,
};

const THEMES: Record<ShopId, Theme> = { northwind, lumen, megamart };

/**
 * Remembers the passport an agent arrived with (it rides every later request through
 * sessionStorage) and, if there is one, shows where the visit came from.
 */
const passportScript = `<script>(()=>{const q=new URLSearchParams(location.search).get("passport");if(q)sessionStorage.setItem("cited_passport",q);
const v=sessionStorage.getItem("cited_passport"),el=document.getElementById("via");if(!v||!el)return;
const f=v.split("|"),N={housefresh:"HouseFresh",airlab:"AirLab"},who=(f[3]||"").split(",").filter(Boolean).map(i=>N[i]||i).join(" & ");
el.querySelector("[data-via]").textContent=f[2]==="test"&&who?"Arrived via "+who+"\\u2019s test":who?"Arrived via "+who:"Arrived via an AI shopping agent";el.hidden=false})()</script>`;

/** The checkout block: PayPal buttons when a client id is set, a stand-in button in simulated mode. */
function buyBlock(shop: Shop, p: Product, env: PageEnv): string {
  const cfg = JSON.stringify({ shop: shop.id, upc: p.upc, live: Boolean(env.paypalClientId) });
  const sdk = env.paypalClientId
    ? `<script src="https://www.paypal.com/sdk/js?client-id=${encodeURIComponent(env.paypalClientId)}&currency=USD&intent=capture"></script>`
    : "";
  const standIn = env.paypalClientId
    ? ""
    : `<button class="ppbtn" id="sim-pay" type="button" aria-label="Pay with PayPal"><span>Pay with</span><span class="pp-word"><span class="pp-a">Pay</span><span class="pp-b">Pal</span></span></button>`;
  return `<div id="paypal-buttons" class="pp">${standIn}</div><p class="pp-note">PayPal sandbox demo. No real money moves.</p><div class="status" id="status" role="status"></div>${sdk}<script>
const cfg=${cfg.replace(/</g, "\\u003c")};
const q=new URLSearchParams(location.search);
const passport=q.get("passport")||sessionStorage.getItem("cited_passport")||undefined;
if(passport)sessionStorage.setItem("cited_passport",passport);
let ref=sessionStorage.getItem("cited_cart");
if(!ref){ref=Math.random().toString(36).slice(2,12);sessionStorage.setItem("cited_cart",ref)}
const base="/"+cfg.shop+"/api/orders";
const say=(t,err)=>{const el=document.getElementById("status");el.textContent=t;el.classList.toggle("err",Boolean(err))};
async function createOrder(){
  const r=await fetch(base,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({upc:cfg.upc,passport,clientRef:ref})});
  const d=await r.json();if(!r.ok)throw new Error(d.error?.message||"order failed");return d.orderId}
async function capture(id){
  const r=await fetch(base+"/"+id+"/capture",{method:"POST"});
  const d=await r.json();if(!r.ok)throw new Error(d.error?.message||"capture failed");
  say("Payment complete. Order "+d.orderId+" is "+d.status.toLowerCase()+".")}
if(cfg.live&&window.paypal){paypal.Buttons({createOrder,onApprove:d=>capture(d.orderID),onError:e=>say(String(e),true)}).render("#paypal-buttons")}
else{const b=document.getElementById("sim-pay");b?.addEventListener("click",async()=>{b.disabled=true;try{await capture(await createOrder())}catch(e){b.disabled=false;say(e.message,true)}})}
</script>`;
}

function layout(shop: Shop, title: string, body: string, checkout = false): string {
  const t = THEMES[shop.id];
  const header = checkout && t.checkoutHeader ? t.checkoutHeader(shop) : t.header(shop);
  const footer = checkout && t.checkoutHeader ? "" : t.footer(shop);
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)}</title><style>${t.css}</style></head><body>${header}${body}${footer}${passportScript}</body></html>`;
}

export function homePage(shop: Shop): string {
  return layout(shop, `${shop.name}: ${shop.tagline}`, THEMES[shop.id].home(shop, PRODUCTS));
}

export function productPage(shop: Shop, p: Product): string {
  return layout(shop, `${p.name} · ${shop.name}`, THEMES[shop.id].product(shop, p));
}

export function checkoutPage(shop: Shop, p: Product, env: PageEnv): string {
  return layout(
    shop,
    `Checkout · ${shop.name}`,
    THEMES[shop.id].checkout(shop, p, buyBlock(shop, p, env)),
    true,
  );
}

export const allShops = () => SHOP_IDS.map((id) => SHOPS[id]);
