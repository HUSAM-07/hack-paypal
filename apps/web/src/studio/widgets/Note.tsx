import type { ReactNode } from "react";

/** A card's explanation, folded under one line so the numbers lead and the prose waits. */
export function Note({ children }: { children: ReactNode }) {
  return (
    <details className="cw-note">
      <summary>How to read this</summary>
      <div className="cw-note-body">{children}</div>
    </details>
  );
}
