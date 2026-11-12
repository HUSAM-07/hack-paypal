import type { Thread } from "@pact/protocol";
import { LogOut, Moon, Plus, Sun, User, Users } from "lucide-react";
import { motion, useReducedMotion } from "motion/react";
import { Avatar } from "@/genui/primitives";
import { SPRING_LAYOUT } from "@/lib/motion";
import { cn } from "@/lib/utils";
import type { ConnectionState } from "@/protocol/client";

export function BrandMark({ className }: { className?: string }) {
  return (
    <span className={cn("flex items-center gap-2", className)}>
      <span className="flex size-7 items-center justify-center rounded-md bg-foreground text-background">
        <svg viewBox="0 0 32 32" className="size-[18px]" aria-hidden>
          <path
            d="M10 22V10h7a4 4 0 0 1 0 8h-7"
            fill="none"
            stroke="currentColor"
            strokeWidth="3"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <circle cx="22.5" cy="22.5" r="2.5" fill="var(--primary)" />
        </svg>
      </span>
      <span className="display text-[22px]">Pact</span>
    </span>
  );
}

const CONN: Record<ConnectionState, { label: string; cls: string }> = {
  idle: { label: "Offline", cls: "bg-subtle-foreground" },
  connecting: { label: "Connecting", cls: "bg-warning animate-pulse" },
  open: { label: "Connected", cls: "bg-success" },
  reconnecting: { label: "Reconnecting", cls: "bg-warning animate-pulse" },
  closed: { label: "Offline", cls: "bg-danger" },
};

export function Sidebar({
  threads,
  activeId,
  onSelect,
  onNew,
  theme,
  onToggleTheme,
  onSignOut,
  connection,
  me,
  mock,
}: {
  threads: Thread[];
  activeId: string | null;
  onSelect: (id: string) => void;
  onNew: () => void;
  theme: "dark" | "light";
  onToggleTheme: () => void;
  onSignOut?: () => void;
  connection: ConnectionState;
  me: { name: string; email: string };
  mock: boolean;
}) {
  const reduce = useReducedMotion();
  const conn = CONN[connection];
  return (
    <nav aria-label="Threads" className="flex h-full flex-col">
      <div className="flex h-14 shrink-0 items-center justify-between border-b border-dashed border-border px-4">
        <BrandMark />
        <button
          type="button"
          onClick={onToggleTheme}
          aria-label={theme === "dark" ? "Switch to light theme" : "Switch to dark theme"}
          className="flex size-8 items-center justify-center rounded-lg text-muted-foreground transition-[background-color,color,transform] hover:bg-hover hover:text-foreground active:scale-90"
        >
          <motion.span
            key={theme}
            initial={reduce ? false : { rotate: -60, opacity: 0 }}
            animate={{ rotate: 0, opacity: 1 }}
            className="flex"
          >
            {theme === "dark" ? <Sun className="size-4" /> : <Moon className="size-4" />}
          </motion.span>
        </button>
      </div>
      <div className="px-3 pb-2 pt-3">
        <button
          type="button"
          onClick={onNew}
          className="flex h-9 w-full items-center gap-2 rounded-lg border border-dashed border-input bg-background px-3 text-sm font-medium transition-[background-color,transform] hover:bg-hover active:scale-[0.98]"
        >
          <Plus className="size-4" /> New pact
        </button>
      </div>
      <div className="label px-4 pb-1.5 pt-3">Threads</div>
      <ul className="scrollbar-thin min-h-0 flex-1 space-y-0.5 overflow-y-auto px-2">
        {threads.map((t) => {
          const active = t.id === activeId;
          return (
            <li key={t.id}>
              <button
                type="button"
                onClick={() => onSelect(t.id)}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "relative flex h-11 w-full items-center gap-2.5 rounded-md px-2.5 text-left text-sm transition-colors",
                  active
                    ? "text-foreground"
                    : "text-muted-foreground hover:bg-hover hover:text-foreground",
                )}
              >
                {active && (
                  <motion.span
                    {...(reduce ? {} : { layoutId: "thread-active" })}
                    transition={SPRING_LAYOUT}
                    className="absolute inset-0 rounded-md bg-muted"
                  />
                )}
                <span
                  className={cn(
                    "relative flex size-7 items-center justify-center rounded-md",
                    active ? "bg-background text-foreground" : "bg-fill text-muted-foreground",
                  )}
                >
                  {t.kind === "group" ? (
                    <Users className="size-3.5" />
                  ) : (
                    <User className="size-3.5" />
                  )}
                </span>
                <span className="relative min-w-0 flex-1">
                  <span className="block truncate font-medium">{t.title}</span>
                  <span className="block truncate text-xs text-subtle-foreground">
                    {t.kind === "group" ? `${t.memberIds.length} members` : "Just you"}
                  </span>
                </span>
              </button>
            </li>
          );
        })}
      </ul>
      <div className="flex items-center gap-2.5 border-t border-dashed border-border p-3">
        <Avatar name={me.name} id="me" size={32} />
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-medium">{me.name}</div>
          <div
            className="flex items-center gap-1.5 text-xs text-muted-foreground"
            data-testid="connection"
            data-state={connection}
          >
            <span className={cn("size-1.5 rounded-full", conn.cls)} />
            {conn.label}
            {mock ? " · demo" : ""}
          </div>
        </div>
        {onSignOut && (
          <button
            type="button"
            onClick={onSignOut}
            aria-label="Sign out"
            className="flex size-8 items-center justify-center rounded-lg text-muted-foreground transition-[background-color,color,transform] hover:bg-hover hover:text-foreground active:scale-90"
          >
            <LogOut className="size-4" />
          </button>
        )}
      </div>
    </nav>
  );
}
