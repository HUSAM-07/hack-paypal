import type { ReactNode } from "react";

/**
 * Fig. 1 as a field of glyphs: one cell per session of the price-matched study (147).
 * `$` bought the Winix, `/` bought the Levoit. Counts are the committed eval's, the
 * scatter of the few Winix buys in the placebo and nothing arms is a fixed seed, so
 * the server and the client render the same field.
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

const ROWS = 4;

function rng(seed: number) {
  let s = seed;
  return () => {
    s = (s * 1103515245 + 12345) % 2147483648;
    return s / 2147483648;
  };
}

function cells(arm: Arm, seed: number): boolean[] {
  const out = Array.from({ length: arm.n }, (_, i) => i < arm.winix);
  const r = rng(seed);
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(r() * (i + 1));
    [out[i], out[j]] = [out[j] as boolean, out[i] as boolean];
  }
  return out;
}

export function SessionField({ caption }: { caption: ReactNode }) {
  const delay = rng(7);
  return (
    <figure className="field" aria-labelledby="field-cap">
      <div
        className="field-blocks"
        role="img"
        aria-label="Agents that bought the Winix: shown the test, 57 of 57; placebo, 3 of 54; nothing, 3 of 36."
      >
        {ARMS.map((a, k) => {
          const cols = Math.ceil(a.n / ROWS);
          return (
            <div key={a.key} className={`field-block fb-${a.key}`} style={{ flexGrow: cols }}>
              <div
                className="field-grid"
                aria-hidden="true"
                style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}
              >
                {cells(a, 11 + k * 31).map((w, i) => (
                  <span
                    // biome-ignore lint/suspicious/noArrayIndexKey: fixed-length static field
                    key={i}
                    className={w ? "g g-w" : "g g-l"}
                    style={{ animationDelay: `${Math.round(delay() * 1400)}ms` }}
                  >
                    {w ? "$" : "/"}
                  </span>
                ))}
              </div>
              <div className="field-label">
                <span className="field-name">{a.label}</span>
                <span className="field-count num">
                  {a.winix} / {a.n}
                </span>
                <span className="field-note">{a.note}</span>
              </div>
            </div>
          );
        })}
      </div>
      <figcaption id="field-cap" className="caption field-cap">
        <span className="field-legend" aria-hidden="true">
          <span className="g g-w">$</span> bought the Winix <span className="g g-l">/</span> bought
          the Levoit
        </span>
        {caption}
      </figcaption>
    </figure>
  );
}
