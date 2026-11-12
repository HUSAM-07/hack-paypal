import { ArrowUp, CornerDownLeft, Square } from "lucide-react";
import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
  useState,
} from "react";

export type ComposerHandle = { focus: () => void; fill: (text: string) => void };

/**
 * Message box. While a turn runs it steers it (Codex-style: input lands at the agent's next
 * step) and shows Stop; Esc on an empty box interrupts. Enter sends, Shift+Enter breaks a line.
 */
export const Composer = forwardRef<
  ComposerHandle,
  {
    running: boolean;
    disabled: boolean;
    onSend: (text: string) => Promise<void> | void;
    onInterrupt: () => void;
  }
>(function Composer({ running, disabled, onSend, onInterrupt }, ref) {
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const area = useRef<HTMLTextAreaElement>(null);

  useImperativeHandle(ref, () => ({
    focus: () => area.current?.focus(),
    fill: (t) => {
      setText(t);
      requestAnimationFrame(() => area.current?.focus());
    },
  }));

  // Grow with the text up to a cap; re-measure when the width changes (fonts, pane, rotation).
  const fit = useCallback(() => {
    const el = area.current;
    if (!el) return;
    el.style.height = "0px";
    el.style.height = `${Math.min(el.scrollHeight, 200)}px`;
  }, []);
  // biome-ignore lint/correctness/useExhaustiveDependencies: re-fit whenever the text changes
  useLayoutEffect(fit, [text, fit]);
  useEffect(() => {
    const el = area.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    let w = el.clientWidth;
    const ro = new ResizeObserver(() => {
      if (el.clientWidth !== w) {
        w = el.clientWidth;
        fit();
      }
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [fit]);

  const submit = async () => {
    const t = text.trim();
    if (!t || disabled || sending) return;
    setSending(true);
    try {
      await onSend(t);
      setText("");
    } finally {
      setSending(false);
    }
  };

  return (
    <form
      className="composer"
      data-running={running ? "" : undefined}
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      <label htmlFor="composer-input" className="sr-only">
        {running ? "Add to the running task" : "Message"}
      </label>
      <textarea
        id="composer-input"
        ref={area}
        className="composer__input"
        rows={1}
        value={text}
        placeholder={
          running
            ? "Steer: add a detail or change course…"
            : "Ask for a product, a comparison or a price watch…"
        }
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
            e.preventDefault();
            void submit();
          } else if (e.key === "Escape" && running && !text) {
            e.preventDefault();
            onInterrupt();
          }
        }}
        aria-describedby="composer-hint"
      />
      <div className="composer__bar">
        <span id="composer-hint" className="composer__hint">
          {running ? (
            <>
              <span className="live-dot" aria-hidden /> Working. Messages steer it ·{" "}
              <kbd className="kbd">Esc</kbd> stops
            </>
          ) : (
            <>
              <kbd className="kbd">
                <CornerDownLeft aria-hidden />
              </kbd>{" "}
              send · Shift{" "}
              <kbd className="kbd">
                <CornerDownLeft aria-hidden />
              </kbd>{" "}
              new line
            </>
          )}
        </span>
        <span className="composer__actions">
          {running && (
            <button
              type="button"
              className="composer__stop"
              onClick={onInterrupt}
              aria-label="Stop the agent"
            >
              <Square aria-hidden />
            </button>
          )}
          <button
            type="submit"
            className="composer__send"
            disabled={!text.trim() || disabled || sending}
            aria-label={running ? "Send to the running task" : "Send"}
          >
            <ArrowUp aria-hidden />
          </button>
        </span>
      </div>
    </form>
  );
});
