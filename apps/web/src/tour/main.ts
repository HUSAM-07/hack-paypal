import { mountTour } from "./tour";

// Loaded on every public page as /fx/tour.js. It does nothing unless the tour was started.
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", () => mountTour(), { once: true });
} else {
  mountTour();
}
