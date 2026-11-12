// CITED motion video: one paused root timeline. Times are absolute seconds and match each
// scene's data-start / data-duration in scenes.html.
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const S = (id) => document.getElementById(id);
const OUT = "expo.out";
const INOUT = "expo.inOut";

// Measure an element's centre in its scene's coordinates before any camera move.
function centre(el) {
  const scene = el.closest(".scene");
  const prev = [scene.style.display, scene.style.visibility];
  scene.style.display = "block";
  scene.style.visibility = "visible";
  const r = el.getBoundingClientRect();
  const s = scene.getBoundingClientRect();
  scene.style.display = prev[0];
  scene.style.visibility = prev[1];
  return { x: r.left - s.left + r.width / 2, y: r.top - s.top + r.height / 2 };
}
const byText = (root, sel, re) => $$(sel, root).find((e) => re.test(e.textContent.trim()));

const buyPick = byText(S("s7"), "button", /Buy with/i) || $("button", S("s7"));
const buyNow = byText(S("s9"), ".st-approval button", /^Buy for/);
const P7 = centre(buyPick);
const P9 = centre(buyNow);
const spark = $(".w-on .g-spark__line", S("s10"));
const sparkLen = spark ? spark.getTotalLength() : 0;

const tl = gsap.timeline({ paused: true, defaults: { ease: OUT } });

function title(id, t0, dur) {
  const ws = $$(".w", S(id));
  tl.from(ws, { opacity: 0, y: 34, filter: "blur(10px)", duration: 0.7, stagger: 0.09 }, t0 + 0.05);
  tl.to(
    ws,
    { opacity: 0, y: -24, filter: "blur(8px)", duration: 0.35, stagger: 0.03, ease: "power2.in" },
    t0 + dur - 0.45,
  );
}
function cursorTo(cur, p, t, dur = 1.1) {
  tl.to(cur, { x: p.x - 8, y: p.y - 6, duration: dur, ease: "power3.inOut" }, t);
}
function click(cur, target, t) {
  tl.to(
    cur,
    {
      scale: 0.82,
      duration: 0.09,
      yoyo: true,
      repeat: 1,
      ease: "power2.out",
      transformOrigin: "20% 15%",
    },
    t,
  );
  tl.to(target, { scale: 0.95, duration: 0.09, yoyo: true, repeat: 1, ease: "power2.out" }, t);
}

// 1. Mark: disc pops, the C and the dot cut in, then the camera dives into the disc.
{
  const s = S("s1");
  const [disc, arc, dot] = $$(".hero-mark svg > *", s);
  const len = 2 * Math.PI * 5.4 * 0.72;
  tl.from(
    disc,
    { scale: 0, transformOrigin: "50% 50%", duration: 0.9, ease: "back.out(1.6)" },
    0.15,
  );
  tl.fromTo(
    arc,
    { strokeDasharray: len, strokeDashoffset: len },
    { strokeDashoffset: 0, duration: 0.8, ease: "power3.inOut" },
    0.55,
  );
  tl.from(
    dot,
    { scale: 0, transformOrigin: "17.4px 12px", duration: 0.5, ease: "back.out(3)" },
    1.15,
  );
  tl.from($(".hero-mark", s), { rotate: -30, duration: 1.6, ease: "power3.out" }, 0.15);
  tl.to($(".cam", s), { scale: 26, x: 600, y: 300, duration: 1.4, ease: "expo.in" }, 2.0);
}

// 2. Notification card rises on the primary field, then the field drops away.
{
  const s = S("s2");
  const card = $(".frag", s);
  tl.from(card, { y: 260, opacity: 0, rotate: -3, duration: 1.0 }, 3.45);
  tl.from($$(".aui-awc__row", s), { x: -40, opacity: 0, duration: 0.6, stagger: 0.14 }, 3.9);
  tl.to($(".cam", s), { scale: 1.08, duration: 3.2, ease: "none" }, 3.4);
  tl.to(card, { y: -900, duration: 0.7, ease: "expo.in" }, 6.1);
}

// 3. Introducing CITED: words land, stickers pop round it like new teammates.
{
  const s = S("s3");
  tl.from($(".intro-w", s), { opacity: 0, y: 30, filter: "blur(10px)", duration: 0.7 }, 6.8);
  tl.from(
    $(".intro-mark", s),
    { scale: 0, rotate: -120, duration: 0.8, ease: "back.out(1.8)" },
    7.3,
  );
  tl.from($(".intro-name", s), { opacity: 0, x: -30, filter: "blur(8px)", duration: 0.6 }, 7.45);
  tl.from($(".intro-chip", s), { scale: 0, opacity: 0, duration: 0.6, ease: "back.out(2)" }, 7.9);
  $$(".o", s).forEach((o, i) => {
    tl.from(
      o,
      { scale: 0, rotate: i % 2 ? 40 : -40, duration: 0.7, ease: "back.out(2.2)" },
      8.1 + i * 0.12,
    );
    tl.to(
      o,
      { y: i % 2 ? -18 : 18, rotate: i % 2 ? 6 : -6, duration: 2.2, ease: "sine.inOut" },
      8.8 + i * 0.05,
    );
  });
  tl.to($(".cam", s), { scale: 1.06, duration: 4.2, ease: "none" }, 6.6);
  tl.to(
    $(".intro", s),
    { opacity: 0, filter: "blur(10px)", duration: 0.4, ease: "power2.in" },
    10.35,
  );
  tl.to($$(".o", s), { scale: 0, duration: 0.35, stagger: 0.03, ease: "power2.in" }, 10.3);
}

title("s4", 10.8, 2.2);

// 5. The ask is typed into the real composer.
{
  const s = S("s5");
  const input = $(".composer__input", s);
  const shell = document.createElement("div");
  shell.className = input.className;
  shell.innerHTML = '<span class="typed"></span><span class="caret"></span>';
  input.replaceWith(shell);
  const typed = $(".typed", shell);
  const text = "Find the best noise-cancelling headphones under $350";
  const p = { n: 0 };
  tl.from($(".frag", s), { y: 120, opacity: 0, scale: 0.9, duration: 0.9 }, 13.05);
  tl.set(typed, { textContent: "" }, 13);
  tl.to(
    p,
    {
      n: text.length,
      duration: 1.9,
      ease: "none",
      onUpdate: () => {
        typed.textContent = text.slice(0, Math.round(p.n));
      },
    },
    13.6,
  );
  const send = $(".composer__send", s);
  if (send) tl.to(send, { scale: 0.85, duration: 0.1, yoyo: true, repeat: 1 }, 15.75);
  tl.to($(".cam", s), { scale: 1.35, duration: 3.6, ease: "power2.inOut" }, 13.2);
}

// 5b. Kinetic whip across the request.
{
  const s = S("s5b");
  const span = $(".whip span", s);
  tl.fromTo(span, { x: 900 }, { x: -3800, duration: 1.4, ease: "power2.inOut" }, 16.6);
}

// 6. Product cards from the search tool call.
{
  const s = S("s6");
  tl.from($(".thread__item", s), { y: 40, opacity: 0, duration: 0.6 }, 17.85);
  tl.from($(".g-cardhead", s), { y: 30, opacity: 0, duration: 0.6 }, 18.2);
  tl.from(
    $$(".g-carousel__item", s),
    { y: 140, opacity: 0, rotate: 2, duration: 0.9, stagger: 0.12 },
    18.35,
  );
  tl.from(
    $$(".g-sources, .g-source", s),
    { opacity: 0, y: 12, duration: 0.4, stagger: 0.05 },
    19.4,
  );
  tl.fromTo(
    $(".cam", s),
    { scale: 1.12, y: 40 },
    { scale: 1, y: 0, duration: 4.8, ease: "power2.out" },
    17.8,
  );
  tl.to($(".cam", s), { x: -260, duration: 1.8, ease: "power2.inOut" }, 20.6);
}

// 7. Comparison table, cursor goes for the pick.
{
  const s = S("s7");
  const cam = $(".cam", s);
  const cur = $(".cursor", s);
  tl.from($(".frag", s), { y: 160, opacity: 0, duration: 0.9 }, 22.65);
  tl.from($$("tr", s), { opacity: 0, x: -30, duration: 0.45, stagger: 0.06 }, 23.1);
  tl.set(cur, { x: 1700, y: 1000 }, 22.6);
  cursorTo(cur, P7, 24.4, 1.3);
  click(cur, buyPick, 25.85);
  tl.set(cam, { transformOrigin: `${P7.x}px ${P7.y}px` }, 22.6);
  tl.to(cam, { scale: 1.55, duration: 1.8, ease: INOUT }, 24.6);
  tl.to(cam, { scale: 1, opacity: 0, duration: 0.5, ease: "power2.in" }, 27.5);
}

title("s8", 28, 2.2);

// 9. Approve: the card flips to "authorized, not charged yet" and the undo timer runs.
{
  const s = S("s9");
  const cam = $(".cam", s);
  const cur = $(".cursor", s);
  const a = $(".st-approval", s);
  const o = $(".st-order", s);
  tl.from(a, { y: 180, opacity: 0, duration: 0.9 }, 30.25);
  tl.set(o, { opacity: 0 }, 30.2);
  tl.set(cur, { x: 1750, y: 980 }, 30.2);
  cursorTo(cur, P9, 31.3, 1.2);
  click(cur, buyNow, 32.6);
  tl.to(a, { opacity: 0, scale: 0.96, filter: "blur(6px)", duration: 0.35 }, 32.85);
  tl.fromTo(o, { opacity: 0, y: 40 }, { opacity: 1, y: 0, duration: 0.6 }, 33.0);
  tl.to(cur, { x: 1800, y: 1100, duration: 0.8, ease: "power2.in" }, 33.1);
  const label = $(".g-ring__label .g-tnum", o);
  const bar = $(".g-ring__bar", o);
  const dash = bar ? Number(bar.getAttribute("stroke-dasharray")) : 0;
  const t = { s: 600 };
  const fmt = (v) => `${Math.floor(v / 60)}:${String(Math.floor(v % 60)).padStart(2, "0")}`;
  const paint = () => {
    if (label) label.textContent = fmt(t.s);
    if (bar) bar.setAttribute("stroke-dashoffset", String(dash * (1 - t.s / 600)));
  };
  tl.set(t, { s: 600, onUpdate: paint }, 33.0);
  tl.to(t, { s: 593, duration: 4, ease: "none", onUpdate: paint }, 33.2);
  const ring = $(".g-ring", o);
  tl.set(cam, { transformOrigin: "50% 50%" }, 30.2);
  if (ring) {
    const rc = centre(ring);
    tl.set(cam, { transformOrigin: `${rc.x}px ${rc.y}px` }, 33.6);
    tl.to(cam, { scale: 1.7, duration: 2.2, ease: INOUT }, 33.8);
  }
}

// 10. "Light or dark." then a circle wipe into the dark theme; the watch hits target and buys.
{
  const s = S("s10");
  const ws = $$(".title .w", s);
  tl.from(ws, { opacity: 0, y: 34, filter: "blur(10px)", duration: 0.7, stagger: 0.09 }, 37.05);
  tl.to(
    $(".wipe", s),
    { clipPath: "circle(150% at 86% 12%)", duration: 1.1, ease: "power3.inOut" },
    38.4,
  );
  const pair = $(".pair", s);
  tl.from(pair, { y: 120, opacity: 0, duration: 0.9 }, 39.0);
  tl.set($(".auto-order", s), { opacity: 0 }, 37);
  if (spark) {
    tl.fromTo(
      spark,
      { strokeDasharray: sparkLen, strokeDashoffset: sparkLen },
      { strokeDashoffset: 0, duration: 2.2, ease: "power1.inOut" },
      39.4,
    );
  }
  const now = $(".w-on .g-watch__figures .g-price", s);
  const pr = { v: 299.99 };
  tl.to(
    pr,
    {
      v: 279,
      duration: 2.2,
      ease: "power1.inOut",
      onUpdate: () => {
        if (now) now.textContent = `$${pr.v.toFixed(2)}`;
      },
    },
    39.4,
  );
  tl.set($(".w-done", s), { opacity: 0 }, 37);
  tl.to($(".w-on", s), { opacity: 0, duration: 0.3 }, 41.8);
  tl.to($(".w-done", s), { opacity: 1, duration: 0.3 }, 41.8);
  tl.fromTo($(".auto-order", s), { opacity: 0, x: 80 }, { opacity: 1, x: 0, duration: 0.8 }, 42.0);
  tl.to($(".cam", s), { scale: 1.08, duration: 6, ease: "none" }, 39);
}

title("s11", 45, 2.4);

// 12. The three arms count up.
{
  const s = S("s12");
  tl.from($(".kicker", s), { opacity: 0, y: 30, filter: "blur(8px)", duration: 0.7 }, 47.45);
  tl.from($$(".field-block", s), { opacity: 0, y: 80, duration: 0.8, stagger: 0.15 }, 47.8);
  $$(".ring-num", s).forEach((n, i) => {
    const end = Number(n.textContent) || 0;
    const c = { v: 0 };
    tl.to(
      c,
      {
        v: end,
        duration: 1.4,
        ease: "power2.out",
        onUpdate: () => {
          n.textContent = String(Math.round(c.v));
        },
      },
      48.3 + i * 0.15,
    );
  });
  tl.fromTo($(".cam", s), { scale: 1 }, { scale: 1.1, duration: 5, ease: "none" }, 47.4);
}

// 13. Session squares fill in; the camera travels down the groups.
{
  const s = S("s13");
  tl.from($(".frag", s), { opacity: 0, y: 60, duration: 0.7 }, 52.25);
  tl.from(
    $$(".sq", s),
    { scale: 0, opacity: 0, duration: 0.3, stagger: 0.012, ease: "back.out(2)" },
    52.6,
  );
  tl.to($(".cam", s), { y: -520, duration: 3.6, ease: "power2.inOut" }, 53.4);
}

// 14. API trail rows, then a push onto the creator payout.
{
  const s = S("s14");
  const rows = $$("tbody tr", s);
  tl.from($(".frag", s), { opacity: 0, y: 60, duration: 0.7 }, 57.25);
  tl.from(rows, { opacity: 0, x: -40, duration: 0.45, stagger: 0.08 }, 57.5);
  const payout = rows.find((r) => /paid \$/i.test(r.textContent)) || rows[rows.length - 2];
  if (payout) {
    const p = centre(payout);
    tl.set($(".cam", s), { transformOrigin: `${p.x}px ${p.y}px` }, 57.2);
    tl.to($(".cam", s), { scale: 1.8, duration: 1.8, ease: INOUT }, 59.4);
    tl.to(payout, { backgroundColor: "var(--primary-soft)", duration: 0.4 }, 59.6);
  }
}

// 15. Outro: the lineup folds into the mark, the name slides out.
{
  const s = S("s15");
  const ls = $$(".l", s);
  tl.from(
    ls,
    { scale: 0, rotate: -30, duration: 0.6, stagger: 0.08, ease: "back.out(2.2)" },
    62.05,
  );
  tl.to(
    ls,
    { x: (i) => (2 - i) * 210, scale: 0, duration: 0.6, stagger: 0.04, ease: "back.in(1.6)" },
    63.3,
  );
  tl.from($(".end-mark", s), { scale: 0, rotate: -90, duration: 0.8, ease: "back.out(1.8)" }, 63.8);
  tl.from($(".end-name", s), { opacity: 0, x: -60, filter: "blur(10px)", duration: 0.7 }, 64.2);
  tl.from($(".end-tag", s), { opacity: 0, y: 20, duration: 0.6 }, 64.7);
  tl.from($(".end-by", s), { opacity: 0, y: 12, duration: 0.5 }, 65.0);
}

window.__timelines = window.__timelines || {};
window.__timelines.main = tl;
tl.seek(0);
