/**
 * Landing motion, framework-free so it costs a few hundred bytes and never blocks
 * hydration. Everything animates opacity/transform only and stops for reduced motion.
 */
const reduce = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/** Fade-and-rise for `[data-reveal]`; `data-count` numbers count up as they appear. */
function reveals() {
  const els = document.querySelectorAll<HTMLElement>("[data-reveal]");
  // Whatever is already on screen stays put: hiding it now would flash the prerendered page.
  for (const el of els) if (el.getBoundingClientRect().top < window.innerHeight) el.dataset.in = "";
  document.documentElement.classList.add("reveal-ready");
  if (reduce()) {
    for (const el of els) el.dataset.in = "";
    return;
  }
  const io = new IntersectionObserver(
    (entries) => {
      for (const e of entries) {
        if (!e.isIntersecting) continue;
        const el = e.target as HTMLElement;
        el.dataset.in = "";
        for (const n of el.querySelectorAll<HTMLElement>("[data-count]")) countUp(n);
        io.unobserve(el);
      }
    },
    { rootMargin: "0px 0px -12% 0px" },
  );
  for (const el of els) if (!("in" in el.dataset)) io.observe(el);
}

function countUp(el: HTMLElement) {
  const target = Number(el.dataset.count);
  if (!Number.isFinite(target) || target === 0) return;
  const start = performance.now();
  const dur = 1400;
  const tick = (now: number) => {
    const t = Math.min(1, (now - start) / dur);
    // Expo-out, matching the swift ease of the reveals.
    const v = Math.round(target * (t === 1 ? 1 : 1 - 2 ** (-10 * t)));
    el.textContent = String(v);
    if (t < 1) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

/** Nav background on scroll and gentle phone parallax, sharing one rAF-throttled listener. */
function scrollEffects() {
  const nav = document.querySelector<HTMLElement>("[data-nav]");
  const layers = reduce() ? [] : [...document.querySelectorAll<HTMLElement>("[data-parallax]")];
  let queued = false;
  const update = () => {
    queued = false;
    const y = window.scrollY;
    if (nav) nav.toggleAttribute("data-scrolled", y > 8);
    if (y > window.innerHeight * 1.5) return;
    for (const el of layers) {
      el.style.transform = `translate3d(0, ${(-y * Number(el.dataset.parallax)).toFixed(1)}px, 0)`;
    }
  };
  window.addEventListener(
    "scroll",
    () => {
      if (queued) return;
      queued = true;
      requestAnimationFrame(update);
    },
    { passive: true },
  );
  update();
}

export function startMotion() {
  reveals();
  scrollEffects();
}
