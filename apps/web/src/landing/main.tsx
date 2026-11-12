import { StrictMode } from "react";
import { createRoot, hydrateRoot } from "react-dom/client";
import { Landing } from "./Landing";
import "../styles/site-theme.css";
import "./landing.css";

const root = document.getElementById("root");
if (!root) throw new Error("#root missing");
const tree = (
  <StrictMode>
    <Landing />
  </StrictMode>
);
// Production HTML is prerendered (scripts/prerender.ts); the dev server serves an empty root.
if (root.firstElementChild) hydrateRoot(root, tree);
else createRoot(root).render(tree);
