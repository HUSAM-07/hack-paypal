import "./boot";
import { type ReactNode, StrictMode, useState } from "react";
import { createRoot } from "react-dom/client";
import { AuthGate } from "@/auth/SignIn";
import { TooltipProvider } from "@/components/ui/tooltip";
import { useMock } from "@/lib/env";
import { App } from "./app/App";
import { createRuntime, RuntimeProvider } from "./app/runtime";
import "./styles/globals.css";

// After a deploy, an open tab may ask for chunks that no longer exist. Reload once to
// pick up the new build; the session flag stops a loop if the chunk is really missing.
window.addEventListener("vite:preloadError", (e) => {
  if (sessionStorage.getItem("pact-reloaded")) return;
  e.preventDefault();
  sessionStorage.setItem("pact-reloaded", "1");
  window.location.reload();
});
window.addEventListener("load", () => sessionStorage.removeItem("pact-reloaded"), { once: true });

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
