import { renderToString } from "react-dom/server";
import { Proof } from "./Proof";

/** Used by scripts/prerender.ts at build time; never shipped to the browser. */
export function render(): string {
  return renderToString(<Proof />);
}
