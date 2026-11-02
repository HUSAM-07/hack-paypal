import { renderToString } from "react-dom/server";
import { Landing } from "./Landing";

/** Used by scripts/prerender.ts at build time; never shipped to the browser. */
export function render(): string {
  return renderToString(<Landing />);
}
