import { StrictMode } from "react";
import { createRoot, hydrateRoot } from "react-dom/client";
import { Proof } from "./Proof";
import "../landing/landing.css";
import "./proof.css";

const root = document.getElementById("root");
if (!root) throw new Error("#root missing");
const tree = (
  <StrictMode>
    <Proof />
  </StrictMode>
);
// Production HTML is prerendered (scripts/prerender.ts); the dev server serves an empty root.
if (root.firstElementChild) hydrateRoot(root, tree);
else createRoot(root).render(tree);
