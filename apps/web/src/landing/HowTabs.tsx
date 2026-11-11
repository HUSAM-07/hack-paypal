import { type KeyboardEvent, type ReactNode, useRef, useState } from "react";

export type HowStep = { tab: string; title: string; body: ReactNode; visual: ReactNode };

/** "How it works" as numbered tabs (WAI-ARIA tabs pattern; arrow keys move between tabs). */
export function HowTabs({ steps }: { steps: HowStep[] }) {
  const [active, setActive] = useState(0);
  const refs = useRef<(HTMLButtonElement | null)[]>([]);

  const onKey = (e: KeyboardEvent) => {
    const d = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0;
    const to =
      e.key === "Home"
        ? 0
        : e.key === "End"
          ? steps.length - 1
          : (active + d + steps.length) % steps.length;
    if (!d && e.key !== "Home" && e.key !== "End") return;
    e.preventDefault();
    setActive(to);
    refs.current[to]?.focus();
  };

  return (
    <div className="how">
      <div className="how-tabs" role="tablist" aria-label="How it works" onKeyDown={onKey}>
        {steps.map((s, i) => (
          <button
            key={s.tab}
            ref={(el) => {
              refs.current[i] = el;
            }}
            type="button"
            role="tab"
            id={`how-tab-${i}`}
            aria-controls={`how-panel-${i}`}
            aria-selected={i === active}
            tabIndex={i === active ? 0 : -1}
            className="how-tab"
            onClick={() => setActive(i)}
          >
            <span className="how-no num">{String(i + 1).padStart(2, "0")}</span>
            <span className="how-name">{s.tab}</span>
          </button>
        ))}
      </div>
      {steps.map((s, i) => (
        <div
          key={s.tab}
          role="tabpanel"
          id={`how-panel-${i}`}
          aria-labelledby={`how-tab-${i}`}
          hidden={i !== active}
          className="how-panel"
        >
          <div className="how-copy">
            <h3 className="h3">{s.title}</h3>
            <p className="how-body">{s.body}</p>
          </div>
          <div className="how-visual">{s.visual}</div>
        </div>
      ))}
    </div>
  );
}
