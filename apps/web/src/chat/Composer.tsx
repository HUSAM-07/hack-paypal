import { ArrowUp, CalendarClock, History, Plus, Search, Send, Square } from "lucide-react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import {
  type FormEvent,
  type KeyboardEvent,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { SPRING_LAYOUT, SPRING_PRESS } from "@/lib/motion";
import { cn } from "@/lib/utils";

const QUICK = [
  {
    icon: Search,
    label: "Find & split a purchase",
    text: "Find a PS6 and split it three ways when it drops under $450",
  },
  { icon: Send, label: "Send money", text: "Send Ari $20 for snacks" },
  { icon: CalendarClock, label: "Standing order", text: "Show the coffee standing order" },
  { icon: History, label: "Activity", text: "Show my activity" },
];

const LINE = 24;
const MAX_LINES = 8;

export function Composer({
  onSend,
  onStop,
  busy,
  disabled,
  status,
  draft,
  onDraftConsumed,
}: {
  onSend: (text: string) => Promise<void> | void;
  onStop?: () => void;
  busy: boolean;
  disabled?: boolean;
  status?: string | null;
  draft?: string | null;
  onDraftConsumed?: () => void;
}) {
  const reduce = useReducedMotion();
  const [text, setText] = useState("");
  const [multiline, setMultiline] = useState(false);
  const [menu, setMenu] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ref = useRef<HTMLTextAreaElement>(null);
  const switchLen = useRef(0);
  const empty = text.trim().length === 0;

  useEffect(() => {
    if (draft) {
      setText(draft);
      onDraftConsumed?.();
      requestAnimationFrame(() => ref.current?.focus());
    }
  }, [draft, onDraftConsumed]);

  // Autosize, and switch to the stacked layout once text wraps.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "0px";
    const h = Math.min(el.scrollHeight, LINE * MAX_LINES + 16);
    el.style.height = `${h}px`;
    // Hysteresis: the stacked layout is wider, so leave it only once the text has
    // clearly shrunk; otherwise the two layouts would flip-flop at the boundary.
    if (!text) {
      switchLen.current = 0;
      setMultiline(false);
    } else if (!multiline && (text.includes("\n") || el.scrollHeight > LINE + 20)) {
      switchLen.current = text.length;
      setMultiline(true);
    } else if (multiline && !text.includes("\n") && text.length < switchLen.current * 0.7) {
      setMultiline(false);
    }
  }, [text, multiline]);

  const submit = async (e?: FormEvent) => {
    e?.preventDefault();
    if (empty || disabled) return;
    const value = text;
    setText("");
    setError(null);
    try {
      await onSend(value);
    } catch (err) {
      setText(value);
      setError((err as Error).message);
    }
  };

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      void submit();
    }
    if (e.key === "Escape") setMenu(false);
  };

  const t = reduce ? { duration: 0 } : SPRING_LAYOUT;
  const showStop = busy && empty && onStop;

  return (
    <div className="mx-auto w-full max-w-[720px] px-3 pb-[max(env(safe-area-inset-bottom),12px)] sm:px-6 sm:pb-5">
      <AnimatePresence>
        {(status || error) && (
          <motion.p
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            role={error ? "alert" : "status"}
            className={cn("mb-2 px-3 text-xs", error ? "text-danger" : "text-muted-foreground")}
          >
            {error ?? status}
          </motion.p>
        )}
      </AnimatePresence>
      <div className="relative">
        <AnimatePresence>
          {menu && (
            <motion.div
              initial={{ opacity: 0, y: 6, scale: 0.97 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 4, scale: 0.98 }}
              transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
              style={{ transformOrigin: "bottom left" }}
              className="absolute bottom-full left-0 z-20 mb-2 w-64 rounded-lg bg-popover p-1.5 shadow-pop"
              role="menu"
            >
              {QUICK.map((q) => (
                <button
                  key={q.label}
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setText(q.text);
                    setMenu(false);
                    ref.current?.focus();
                  }}
                  className="flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-left text-sm transition-colors hover:bg-hover"
                >
                  <q.icon className="size-4 text-muted-foreground" />
                  {q.label}
                </button>
              ))}
            </motion.div>
          )}
        </AnimatePresence>
        <motion.form
          layout
          transition={t}
          onSubmit={submit}
          data-testid="composer"
          className={cn(
            "relative flex rounded-xl border border-dashed border-input bg-card transition-[border-color,box-shadow] focus-within:border-solid focus-within:border-primary focus-within:shadow-[0_0_0_3px_var(--primary-soft)]",
            multiline ? "flex-col gap-1 p-2.5" : "items-end gap-1 p-1.5",
          )}
        >
          {!multiline && (
            <motion.div layout="position" transition={t}>
              <PlusButton open={menu} onClick={() => setMenu((m) => !m)} />
            </motion.div>
          )}
          <motion.textarea
            layout="position"
            transition={t}
            ref={ref}
            rows={1}
            value={text}
            disabled={disabled}
            onChange={(e) => setText(e.target.value.slice(0, 8000))}
            onKeyDown={onKeyDown}
            onFocus={() => setMenu(false)}
            placeholder="Ask Pact to buy, split or send…"
            aria-label="Message Pact"
            className={cn(
              "scrollbar-thin min-h-[36px] flex-1 resize-none bg-transparent py-[6px] text-[15px] leading-6 outline-none placeholder:text-subtle-foreground disabled:opacity-50",
              multiline ? "px-2" : "px-1",
            )}
          />
          <motion.div
            layout="position"
            transition={t}
            className={cn("flex items-center gap-1", multiline && "justify-between")}
          >
            {multiline && <PlusButton open={menu} onClick={() => setMenu((m) => !m)} />}
            <motion.button
              type={showStop ? "button" : "submit"}
              {...(showStop ? { onClick: onStop } : {})}
              disabled={!showStop && (empty || disabled)}
              aria-label={showStop ? "Stop" : "Send"}
              {...(reduce ? {} : { whileTap: { scale: 0.9 } })}
              transition={SPRING_PRESS}
              data-testid="send"
              className={cn(
                "flex size-9 shrink-0 items-center justify-center rounded-lg transition-colors duration-200",
                showStop
                  ? "bg-fill-strong text-foreground"
                  : empty
                    ? "bg-fill text-muted-foreground"
                    : "bg-primary text-primary-foreground",
              )}
            >
              <AnimatePresence mode="popLayout" initial={false}>
                <motion.span
                  key={showStop ? "stop" : "send"}
                  initial={reduce ? false : { scale: 0.5, opacity: 0, rotate: -45 }}
                  animate={{ scale: 1, opacity: 1, rotate: 0 }}
                  exit={{ scale: 0.5, opacity: 0 }}
                  transition={SPRING_PRESS}
                  className="flex"
                >
                  {showStop ? (
                    <Square className="size-3.5 fill-current" />
                  ) : (
                    <ArrowUp className="size-[18px]" strokeWidth={2.4} />
                  )}
                </motion.span>
              </AnimatePresence>
            </motion.button>
          </motion.div>
        </motion.form>
      </div>
      <p className="mt-2 hidden text-center text-[11px] text-subtle-foreground sm:block">
        Pact can't move money without a mandate or your approval.
      </p>
    </div>
  );
}

function PlusButton({ open, onClick }: { open: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label="Quick actions"
      aria-expanded={open}
      className="flex size-9 items-center justify-center rounded-lg text-muted-foreground transition-[background-color,color,transform] hover:bg-hover hover:text-foreground active:scale-90"
    >
      <Plus className={cn("size-[18px] transition-transform duration-300", open && "rotate-45")} />
    </button>
  );
}
