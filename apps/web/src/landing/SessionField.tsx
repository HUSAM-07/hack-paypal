import type { ReactNode } from "react";

/**
 * Fig. 1 as three dotted rings: one dot per session of the price-matched study (147).
 * A solid dot bought the Winix, a faint one bought the Levoit. Counts are the
 * committed eval's; the centre carries each arm's Winix count.
 */

type Arm = {
  key: "test" | "placebo" | "none";
  label: string;
  note: string;
  n: number;
  winix: number;
};

const ARMS: Arm[] = [
  {
    key: "test",
    label: "Shown the test",
    note: "HouseFresh: Winix A230 vs Levoit Core 300",
    n: 57,
    winix: 57,
  },
  { key: "placebo", label: "Placebo", note: "another HouseFresh article", n: 54, winix: 3 },
  { key: "none", label: "Nothing", note: "test withheld, nothing added", n: 36, winix: 3 },
];

// Ring geometry in viewBox units: every arm uses the same dot size, so a smaller arm
// reads as a sparser ring rather than smaller dots.
const VIEW = 200;
const RING = 86;
const DOT = 3.4;

function dots(arm: Arm) {
  return Array.from({ length: arm.n }, (_, i) => {
    // Start at 12 o'clock and run clockwise, Winix buys first, so the buys read as an arc.
    const t = (i / arm.n) * 2 * Math.PI - Math.PI / 2;
    return {
      x: +(VIEW / 2 + RING * Math.cos(t)).toFixed(2),
      y: +(VIEW / 2 + RING * Math.sin(t)).toFixed(2),
      winix: i < arm.winix,
    };
  });
}

export function SessionField({ caption }: { caption: ReactNode }) {
  return (
    <figure className="field" aria-labelledby="field-cap">
      <div
        className="field-blocks"
        role="img"
        aria-label="Agents that bought the Winix: shown the test, 57 of 57; placebo, 3 of 54; nothing, 3 of 36."
      >
        {ARMS.map((a) => (
          <div key={a.key} className={`field-block fb-${a.key}`}>
            <div className="field-ring" aria-hidden="true">
              <svg viewBox={`0 0 ${VIEW} ${VIEW}`} aria-hidden="true">
                <circle className="ring-track" cx={VIEW / 2} cy={VIEW / 2} r={RING - 14} />
                {dots(a).map((d, i) => (
                  <circle
                    // biome-ignore lint/suspicious/noArrayIndexKey: fixed-length static ring
                    key={i}
                    className={d.winix ? "g g-w" : "g g-l"}
                    cx={d.x}
                    cy={d.y}
                    r={DOT}
                    style={{ animationDelay: `${i * 14}ms` }}
                  />
                ))}
              </svg>
              <div className="ring-center">
                <span className="ring-num num">{a.winix}</span>
                <span className="ring-of num">of {a.n}</span>
              </div>
            </div>
            <div className="field-label">
              <span className="field-name">{a.label}</span>
              <span className="field-note">{a.note}</span>
            </div>
          </div>
        ))}
      </div>
      <figcaption id="field-cap" className="caption field-cap">
        <span className="field-legend" aria-hidden="true">
          <span className="field-key fk-w" /> bought the Winix <span className="field-key fk-l" />{" "}
          bought the Levoit
        </span>
        {caption}
      </figcaption>
    </figure>
  );
}
