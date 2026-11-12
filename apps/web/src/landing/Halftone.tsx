import { useEffect, useRef } from "react";

/**
 * A sticker redrawn as a halftone: a grid of dots turned 45°, each sized by the brightness
 * under it, in the theme's foreground colour. A slow diagonal swell runs through the dots;
 * it holds still under reduced motion. Decorative: an empty canvas is skipped by screen readers.
 */

type Props = {
  src: string;
  className?: string;
  /** Grid pitch in CSS pixels. */
  pitch?: number;
};

const ANGLE = Math.PI / 4;
const FPS = 24;

export function Halftone({ src, className, pitch = 6 }: Props) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;

    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)");
    const img = new Image();
    img.decoding = "async";
    let lum: Float32Array | null = null;
    let w = 0;
    let h = 0;
    let colour = "";
    let frame = 0;
    let last = 0;

    // Brightness × alpha per CSS pixel, from the image drawn at the canvas's layout size.
    const sample = () => {
      w = canvas.clientWidth;
      h = canvas.clientHeight;
      if (!w || !h || !img.naturalWidth) return;
      const dpr = window.devicePixelRatio || 1;
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const off = document.createElement("canvas");
      off.width = w;
      off.height = h;
      const o = off.getContext("2d", { willReadFrequently: true });
      if (!o) return;
      const s = Math.min(w / img.naturalWidth, h / img.naturalHeight);
      const dw = img.naturalWidth * s;
      const dh = img.naturalHeight * s;
      o.drawImage(img, (w - dw) / 2, (h - dh) / 2, dw, dh);
      const px = o.getImageData(0, 0, w, h).data;
      lum = new Float32Array(w * h);
      for (let i = 0; i < w * h; i++) {
        const r = px[i * 4] ?? 0;
        const g = px[i * 4 + 1] ?? 0;
        const b = px[i * 4 + 2] ?? 0;
        const a = px[i * 4 + 3] ?? 0;
        lum[i] = ((0.2126 * r + 0.7152 * g + 0.0722 * b) / 255) * (a / 255);
      }
    };

    const readColour = () => {
      colour = getComputedStyle(canvas).color;
    };

    const draw = (t: number) => {
      if (!lum) return;
      ctx.clearRect(0, 0, w, h);
      ctx.fillStyle = colour;
      const cos = Math.cos(ANGLE);
      const sin = Math.sin(ANGLE);
      const cx = w / 2;
      const cy = h / 2;
      const reach = Math.ceil(Math.hypot(w, h) / 2 / pitch) + 1;
      ctx.beginPath();
      for (let j = -reach; j <= reach; j++) {
        for (let i = -reach; i <= reach; i++) {
          const x = cx + (i * cos - j * sin) * pitch;
          const y = cy + (i * sin + j * cos) * pitch;
          if (x < 0 || y < 0 || x >= w || y >= h) continue;
          const v = lum[Math.floor(y) * w + Math.floor(x)] ?? 0;
          if (v < 0.12) continue;
          const swell = 0.82 + 0.18 * Math.sin(t * 0.0009 - (x + y) * 0.012);
          // Stretch the mid-tones so the figure keeps its features instead of reading as a blob.
          const tone = Math.min(1, Math.max(0, (v - 0.12) / 0.7));
          const r = 0.56 * pitch * tone ** 1.15 * swell;
          if (r < 0.35) continue;
          ctx.moveTo(x + r, y);
          ctx.arc(x, y, r, 0, Math.PI * 2);
        }
      }
      ctx.fill();
    };

    const tick = (now: number) => {
      frame = requestAnimationFrame(tick);
      if (now - last < 1000 / FPS) return;
      last = now;
      draw(now);
    };

    const sync = () => {
      cancelAnimationFrame(frame);
      frame = 0;
      if (reduced.matches || document.hidden) draw(0);
      else frame = requestAnimationFrame(tick);
    };

    const refresh = () => {
      readColour();
      sample();
      draw(performance.now());
    };

    img.onload = () => {
      refresh();
      sync();
    };
    img.src = src;

    const resize = new ResizeObserver(refresh);
    resize.observe(canvas);
    // The theme toggle flips a class on <html>; the OS theme flips the media query.
    const theme = new MutationObserver(refresh);
    theme.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
    const dark = window.matchMedia("(prefers-color-scheme: dark)");
    dark.addEventListener("change", refresh);
    reduced.addEventListener("change", sync);
    document.addEventListener("visibilitychange", sync);

    return () => {
      cancelAnimationFrame(frame);
      img.onload = null;
      resize.disconnect();
      theme.disconnect();
      dark.removeEventListener("change", refresh);
      reduced.removeEventListener("change", sync);
      document.removeEventListener("visibilitychange", sync);
    };
  }, [src, pitch]);

  return <canvas ref={ref} className={className} />;
}
