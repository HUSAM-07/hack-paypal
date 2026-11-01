import "./boot";
import { type ReactNode, StrictMode, useState } from "react";
import { createRoot } from "react-dom/client";
import { AuthGate } from "@/auth/SignIn";
import { TooltipProvider } from "@/components/ui/tooltip";
import { useMock } from "@/lib/env";
import { App } from "./app/App";
import { createRuntime, RuntimeProvider } from "./app/runtime";
import "./styles/globals.css";

// The landing page is out of scope for now; everything routes into the app.
if (!window.location.pathname.startsWith("/app")) window.history.replaceState(null, "", "/app");

const speed = Number(new URLSearchParams(window.location.search).get("speed")) || 1;

const root = document.getElementById("root");
if (!root) throw new Error("#root missing");
createRoot(root).render(
  <StrictMode>
    <TooltipProvider delayDuration={300}>
      {useMock ? (
        <RuntimeProvider runtime={createRuntime({ speed })}>
          <App />
        </RuntimeProvider>
      ) : (
        <AuthGate>
          {({ me, signOut }) => (
            <LiveRuntime>
              <App me={{ name: me.displayName, email: `@${me.username}` }} onSignOut={signOut} />
            </LiveRuntime>
          )}
        </AuthGate>
      )}
    </TooltipProvider>
  </StrictMode>,
);

/** One runtime per signed-in session, created only once the cookie exists. */
function LiveRuntime({ children }: { children: ReactNode }) {
  const [runtime] = useState(() => createRuntime());
  return <RuntimeProvider runtime={runtime}>{children}</RuntimeProvider>;
}
