import { useState } from "react";

/**
 * "Export CSV" for a CITED table. Its accessible name says which table and how many rows, and the
 * visible words come first in it. After a click a polite status tells screen readers (and, in a
 * line beside the button, everyone) which file was saved.
 */
export function ExportButton(props: {
  /** What the table is, in words: "cross-store journeys". */
  label: string;
  count: number;
  /** Builds the file name and downloads the rows currently shown. Returns the file name. */
  onExport: () => string;
}) {
  const [saved, setSaved] = useState<string | null>(null);
  const rows = `${props.count} row${props.count === 1 ? "" : "s"}`;
  return (
    <div className="cw-export">
      <span className="cw-export-saved" role="status">
        {saved ? `Saved ${saved}` : ""}
      </span>
      <button
        type="button"
        className="cw-export-btn"
        aria-label={`Export CSV: ${props.label}, ${rows}`}
        disabled={props.count === 0}
        onClick={() => setSaved(props.onExport())}
      >
        <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true" focusable="false">
          <path
            d="M8 2v8m0 0L5 7m3 3 3-3M3 13h10"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
        Export CSV
      </button>
    </div>
  );
}
