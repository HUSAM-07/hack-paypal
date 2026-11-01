import "./boot";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { TooltipProvider } from "@/components/ui/tooltip";
import { App } from "./app/App";
import { createRuntime, RuntimeProvider } from "./app/runtime";
import "./styles/globals.css";

// The landing page is out of scope for now; everything routes into the app.
if (!window.location.pathname.startsWith("/app")) window.history.replaceState(null, "", "/app");

const speed = Number(new URLSearchParams(window.location.search).get("speed")) || 1;
const runtime = createRuntime({ speed });

const root = document.getElementById("root");
if (!root) throw new Error("#root missing");
createRoot(root).render(
  <StrictMode>
    <RuntimeProvider runtime={runtime}>
      <TooltipProvider delayDuration={300}>
        <App />
      </TooltipProvider>
    </RuntimeProvider>
  </StrictMode>,
);
