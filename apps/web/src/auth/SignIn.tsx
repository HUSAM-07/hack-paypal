import { KeyRound, Loader2 } from "lucide-react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { type FormEvent, type ReactNode, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  AuthError,
  devSignIn,
  type Me,
  me,
  registerPasskey,
  signInWithPasskey,
  signOut,
} from "@/lib/auth";
import { BrandMark } from "@/shell/Sidebar";

const USERNAME = /^[a-z0-9_.-]{3,32}$/;

function explain(e: unknown): string {
  if (e instanceof AuthError) {
    if (e.message === "username_taken") return "That username is taken.";
    if (e.message === "invite_required") return "That invite code isn't valid.";
    if (e.message === "verification_failed") return "The passkey couldn't be verified.";
    if (e.status === 429) return "Too many attempts. Wait a minute and try again.";
    return e.message;
  }
  // WebAuthn rejects with NotAllowedError when the prompt is dismissed or times out.
  if (e instanceof Error && e.name === "NotAllowedError")
    return "The passkey prompt was dismissed.";
  return "Something went wrong. Try again.";
}

type Mode = "signin" | "create";

export function SignIn({ onSignedIn }: { onSignedIn: (m: Me) => void }) {
  const reduce = useReducedMotion();
  // An invite link (`/app?invite=…`) opens straight on sign-up with the code filled in.
  const [invite, setInvite] = useState(
    () => new URLSearchParams(window.location.search).get("invite") ?? "",
  );
  const [mode, setMode] = useState<Mode>(invite ? "create" : "signin");
  const [username, setUsername] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = async (fn: () => Promise<Me>) => {
    setBusy(true);
    setError(null);
    try {
      onSignedIn(await fn());
    } catch (e) {
      setError(explain(e));
      setBusy(false);
    }
  };

  const validName = USERNAME.test(username);
  const create = (e: FormEvent) => {
    e.preventDefault();
    if (validName)
      void run(() =>
        registerPasskey(username, displayName.trim() || undefined, invite.trim() || undefined),
      );
  };

  return (
    <div className="ui-dots flex min-h-dvh items-center justify-center bg-background px-4">
      <motion.div
        initial={reduce ? false : { opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.25, ease: [0.23, 1, 0.32, 1] }}
        className="w-full max-w-[400px] rounded-lg border border-dashed border-border bg-card p-8 sm:p-10"
      >
        <BrandMark className="mb-8" />
        <h1 className="display text-[40px]">
          {mode === "signin" ? "Sign in" : "Create your account"}
        </h1>
        <p className="mt-1.5 text-sm text-muted-foreground">
          Pact uses passkeys. No password, and every payment you approve is signed on this device.
        </p>

        <AnimatePresence mode="wait" initial={false}>
          {mode === "signin" ? (
            <motion.div
              key="signin"
              initial={reduce ? false : { opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={reduce ? {} : { opacity: 0 }}
              transition={{ duration: 0.15 }}
              className="mt-7 space-y-3"
            >
              <Button
                size="lg"
                variant="accent"
                className="w-full"
                disabled={busy}
                onClick={() => void run(signInWithPasskey)}
              >
                {busy ? <Loader2 className="animate-spin" /> : <KeyRound />}
                Sign in with a passkey
              </Button>
              <Button
                size="lg"
                variant="ghost"
                className="w-full"
                disabled={busy}
                onClick={() => {
                  setError(null);
                  setMode("create");
                }}
              >
                Create an account
              </Button>
            </motion.div>
          ) : (
            <motion.form
              key="create"
              onSubmit={create}
              initial={reduce ? false : { opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={reduce ? {} : { opacity: 0 }}
              transition={{ duration: 0.15 }}
              className="mt-7 space-y-3"
            >
              <Field label="Username" hint="3–32 characters: a–z, 0–9, . _ -">
                <input
                  value={username}
                  onChange={(e) => setUsername(e.target.value.toLowerCase())}
                  autoComplete="username webauthn"
                  autoCapitalize="none"
                  spellCheck={false}
                  // biome-ignore lint/a11y/noAutofocus: the only field on a dedicated step
                  autoFocus
                  className={INPUT}
                />
              </Field>
              <Field label="Name" hint="Shown to people in your pacts">
                <input
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  autoComplete="name"
                  maxLength={60}
                  className={INPUT}
                />
              </Field>
              <Field label="Invite code" hint="Pact is invite-only during the preview">
                <input
                  value={invite}
                  onChange={(e) => setInvite(e.target.value)}
                  autoComplete="off"
                  autoCapitalize="none"
                  spellCheck={false}
                  maxLength={128}
                  className={INPUT}
                />
              </Field>
              <Button
                type="submit"
                size="lg"
                variant="accent"
                className="w-full"
                disabled={busy || !validName}
              >
                {busy ? <Loader2 className="animate-spin" /> : <KeyRound />}
                Create passkey
              </Button>
              <Button
                size="lg"
                variant="ghost"
                className="w-full"
                disabled={busy}
                onClick={() => {
                  setError(null);
                  setMode("signin");
                }}
              >
                I already have an account
              </Button>
            </motion.form>
          )}
        </AnimatePresence>

        <p role="alert" aria-live="polite" className="mt-3 min-h-5 text-[13px] text-danger">
          {error}
        </p>

        {import.meta.env.DEV && <DevSignIn busy={busy} onRun={run} />}
      </motion.div>
    </div>
  );
}

const INPUT =
  "h-12 w-full rounded-lg bg-background px-3.5 text-[15px] outline-none ring-1 ring-input transition-shadow focus:ring-2 focus:ring-primary";

function Field({ label, hint, children }: { label: string; hint: string; children: ReactNode }) {
  return (
    // biome-ignore lint/a11y/noLabelWithoutControl: the control is passed as children
    <label className="block">
      <span className="mb-1.5 block text-[13px] font-medium">{label}</span>
      {children}
      <span className="mt-1 block text-xs text-subtle-foreground">{hint}</span>
    </label>
  );
}

/** Dev builds only: the worker's passwordless test login (`DEV_AUTH=1`). */
function DevSignIn({ busy, onRun }: { busy: boolean; onRun: (fn: () => Promise<Me>) => void }) {
  const [name, setName] = useState("alex");
  return (
    <form
      className="mt-8 flex items-center gap-2 border-t border-dashed border-border pt-4"
      onSubmit={(e) => {
        e.preventDefault();
        if (USERNAME.test(name)) onRun(() => devSignIn(name));
      }}
    >
      <span className="label">Dev</span>
      <input
        aria-label="Dev username"
        value={name}
        onChange={(e) => setName(e.target.value.toLowerCase())}
        className="h-8 min-w-0 flex-1 rounded-md bg-background px-2.5 text-[13px] outline-none ring-1 ring-input focus:ring-primary"
      />
      <Button type="submit" size="sm" variant="secondary" disabled={busy}>
        Dev sign-in
      </Button>
    </form>
  );
}

/**
 * Renders the app only with a session: the worker's sockets and REST routes all need
 * the HttpOnly session cookie, so nothing connects before sign-in.
 */
export function AuthGate({
  children,
}: {
  children: (session: { me: Me; signOut: () => void }) => ReactNode;
}) {
  const [session, setSession] = useState<Me | null | undefined>(undefined);
  const [offline, setOffline] = useState(false);
  useEffect(() => {
    me()
      .then(setSession)
      .catch(() => setOffline(true));
  }, []);

  if (offline) {
    return (
      <div className="flex min-h-dvh flex-col items-center justify-center gap-3 bg-background px-4 text-center">
        <BrandMark />
        <p className="text-sm text-muted-foreground">Pact is unreachable right now.</p>
        <Button variant="secondary" onClick={() => window.location.reload()}>
          Retry
        </Button>
      </div>
    );
  }
  if (session === undefined) return <div className="min-h-dvh bg-background" />;
  if (session === null) return <SignIn onSignedIn={setSession} />;
  return children({
    me: session,
    // A full reload drops every socket and all thread state from the previous account.
    signOut: () => void signOut().finally(() => window.location.assign("/app")),
  });
}
