/**
 * Landing motion, framework-free so it never blocks hydration: scroll reveals, the
 * hero ring/exit fade, scene switching for the backdrop, and in-view video playback.
 * Everything animates opacity/transform only and calms down for reduced motion.
 */
import { SCENES } from "./chapters";

const reduce = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const root = document.documentElement;

function reveals() {
  const els = document.querySelectorAll<HTMLElement>("[data-reveal]");
  // What's already on screen stays put: hiding it now would flash the prerendered page.
  for (const el of els) if (el.getBoundingClientRect().top < window.innerHeight) el.dataset.in = "";
  root.classList.add("reveal-ready");
  if (reduce()) {
    for (const el of els) el.dataset.in = "";
    return;
  }
  const io = new IntersectionObserver(
    (entries) => {
      for (const e of entries) {
        if (!e.isIntersecting) continue;
        (e.target as HTMLElement).dataset.in = "";
        io.unobserve(e.target);
      }
    },
    { rootMargin: "0px 0px -10% 0px" },
  );
  for (const el of els) if (!("in" in el.dataset)) io.observe(el);
}

/** Hero fade and ring spin share one rAF-throttled, passive scroll listener. */
function heroScroll() {
  let queued = false;
  const update = () => {
    queued = false;
    const p = Math.min(1.5, window.scrollY / window.innerHeight);
    root.style.setProperty("--hero", p.toFixed(3));
    if (!reduce())
      root.style.setProperty("--ring-scroll", `${(-window.scrollY * 0.06).toFixed(1)}deg`);
    root.toggleAttribute("data-hero-gone", p > 0.7);
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

/** Picks the scene for whichever transparent section owns the middle of the viewport. */
async function scenes() {
  const layer = document.querySelector<HTMLElement>(".scene-layer");
  const canvas = document.querySelector<HTMLCanvasElement>(".scene-canvas");
  if (!layer || !canvas) return;

  const showImage = (i: number) => {
    const img = layer.querySelector<HTMLImageElement>(`[data-scene-img="${i}"]`);
    if (img?.dataset.src) {
      for (const s of img.parentElement?.querySelectorAll("source") ?? []) {
        if (s.dataset.srcset) s.srcset = s.dataset.srcset;
      }
      img.src = img.dataset.src;
      delete img.dataset.src;
    }
    layer.dataset.scene = String(i);
  };

  // Same choice the <picture> srcset makes, so the hero photo is reused, not refetched.
  const wide = window.innerWidth * Math.min(window.devicePixelRatio, 2) > 1280;
  const gl =
    !reduce() && !new URLSearchParams(window.location.search).has("nogl")
      ? (await import("./Backdrop")).startBackdrop(
          canvas,
          SCENES.map((s) => `/art/bg-${s}-${wide ? 1920 : 1280}.avif`),
        )
      : null;

  const transparent = [...document.querySelectorAll<HTMLElement>("[data-transparent]")];
  const onScreen = new Set<Element>();
  const io = new IntersectionObserver((entries) => {
    for (const e of entries) {
      if (e.isIntersecting) onScreen.add(e.target);
      else onScreen.delete(e.target);
    }
    gl?.setVisible(onScreen.size > 0);
  });
  const centre = new IntersectionObserver(
    (entries) => {
      for (const e of entries) {
        if (!e.isIntersecting) continue;
        const i = Number((e.target as HTMLElement).dataset.sceneIndex ?? 0);
        showImage(i);
        gl?.setScene(i);
      }
    },
    { rootMargin: "-45% 0px -45% 0px" },
  );
  for (const el of transparent) {
    io.observe(el);
    centre.observe(el);
  }
}

/** Videos load and play only while on screen; the pill toggles play/pause. */
function videos() {
  const auto = !reduce();
  // `poster` downloads eagerly, so it's attached only as the frame approaches.
  const near = new IntersectionObserver(
    (entries) => {
      for (const e of entries) {
        if (!e.isIntersecting) continue;
        const v = e.target as HTMLVideoElement;
        if (v.dataset.poster) v.poster = v.dataset.poster;
        near.unobserve(v);
      }
    },
    { rootMargin: "800px 0px" },
  );
  const io = new IntersectionObserver(
    (entries) => {
      for (const e of entries) {
        const v = e.target as HTMLVideoElement;
        if (e.isIntersecting && auto && v.dataset.paused !== "user") void v.play().catch(() => {});
        else v.pause();
      }
    },
    { threshold: 0.35 },
  );
  for (const v of document.querySelectorAll<HTMLVideoElement>("video[data-video]")) {
    const frame = v.closest<HTMLElement>(".media-frame");
    v.addEventListener("play", () => frame?.setAttribute("data-playing", ""));
    v.addEventListener("pause", () => frame?.removeAttribute("data-playing"));
    frame?.querySelector("[data-video-toggle]")?.addEventListener("click", () => {
      if (v.paused) {
        delete v.dataset.paused;
        void v.play().catch(() => {});
      } else {
        v.dataset.paused = "user";
        v.pause();
      }
    });
    io.observe(v);
    near.observe(v);
  }
}

export function startMotion() {
  reveals();
  heroScroll();
  videos();
  // The WebGL scene is decoration: start it once the page has loaded and gone idle,
  // so shader compiles and texture decodes never compete with first paint.
  const idle = window.requestIdleCallback ?? ((cb: () => void) => setTimeout(cb, 200));
  const later = () => idle(() => void scenes());
  if (document.readyState === "complete") later();
  else window.addEventListener("load", later, { once: true });
}
