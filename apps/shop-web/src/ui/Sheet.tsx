import { X } from "lucide-react";
import { type ReactNode, useEffect, useRef } from "react";

/**
 * Modal sheet on the native <dialog>: focus trap, Escape and inert background for free.
 * `side` picks where it slides from; on narrow screens every side becomes a bottom/left drawer.
 */
export function Sheet({
  open,
  onClose,
  title,
  side = "right",
  children,
  className,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  side?: "left" | "right" | "bottom";
  children: ReactNode;
  className?: string;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal?.();
    if (!open && d.open) d.close?.();
  }, [open]);
  return (
    <dialog
      ref={ref}
      className={`sheet ${className ?? ""}`}
      data-side={side}
      aria-label={title}
      onClose={onClose}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onClick={(e) => {
        // A click on the backdrop (the dialog box itself, outside its panel) closes it.
        if (e.target === ref.current) onClose();
      }}
      onKeyDown={() => {}}
    >
      <div className="sheet__panel">
        <header className="sheet__head">
          <h2 className="sheet__title">{title}</h2>
          <button type="button" className="icon-btn" aria-label="Close" onClick={onClose}>
            <X aria-hidden />
          </button>
        </header>
        <div className="sheet__body">{children}</div>
      </div>
    </dialog>
  );
}
