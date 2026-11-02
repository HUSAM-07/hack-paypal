import type { CSSProperties } from "react";

/**
 * A word laid around a 3D cylinder: two copies half a turn apart, so the far one
 * shows through mirrored. Pure CSS transforms; `--ring-scroll` (set by motion.ts)
 * adds scroll-driven rotation on top of the idle spin.
 */
export function RingTitle({ word }: { word: string }) {
  const gap = 3;
  const slots = [...word, ...Array(gap).fill(""), ...word, ...Array(gap).fill("")];
  const step = 360 / slots.length;
  return (
    <div className="ring-stage" aria-hidden>
      <div className="ring-tilt">
        <div className="ring-spin" style={{ "--slots": slots.length } as CSSProperties}>
          {slots.map((ch, i) =>
            ch ? (
              <span
                // biome-ignore lint/suspicious/noArrayIndexKey: fixed layout, never reordered
                key={i}
                className="ring-char"
                style={{ "--a": `${i * step}deg` } as CSSProperties}
              >
                {ch}
              </span>
            ) : null,
          )}
        </div>
      </div>
    </div>
  );
}
