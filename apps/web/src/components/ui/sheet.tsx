import { X } from "lucide-react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { Dialog } from "radix-ui";
import { type ReactNode, useEffect, useState } from "react";
import { EASE_DRAWER } from "@/lib/motion";
import { cn } from "@/lib/utils";

function useIsNarrow() {
  const [narrow, setNarrow] = useState(() =>
    typeof window === "undefined" ? false : window.matchMedia("(max-width: 639px)").matches,
  );
  useEffect(() => {
    const mq = window.matchMedia("(max-width: 639px)");
    const on = () => setNarrow(mq.matches);
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);
  return narrow;
}

/**
 * Modal surface: a bottom sheet with drag-to-dismiss on phones, a centered panel on
 * wider screens. Radix provides focus trap, escape and aria; Motion does the movement.
 */
export function Sheet({
  open,
  onOpenChange,
  title,
  description,
  children,
  className,
  dismissible = true,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string | undefined;
  children: ReactNode;
  className?: string;
  dismissible?: boolean;
}) {
  const narrow = useIsNarrow();
  const reduce = useReducedMotion();
  const panel = narrow
    ? { initial: { y: "100%" }, animate: { y: 0 }, exit: { y: "100%" } }
    : {
        initial: { opacity: 0, scale: 0.96, y: 8 },
        animate: { opacity: 1, scale: 1, y: 0 },
        exit: { opacity: 0, scale: 0.97, y: 4 },
      };
  return (
    <Dialog.Root open={open} onOpenChange={(o) => (dismissible || o ? onOpenChange(o) : undefined)}>
      <AnimatePresence>
        {open && (
          <Dialog.Portal forceMount>
            <Dialog.Overlay asChild forceMount>
              <motion.div
                className="fixed inset-0 z-50 bg-background/70 backdrop-blur-[2px]"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: reduce ? 0 : 0.2 }}
              />
            </Dialog.Overlay>
            <Dialog.Content
              asChild
              forceMount
              onInteractOutside={(e) => !dismissible && e.preventDefault()}
              onEscapeKeyDown={(e) => !dismissible && e.preventDefault()}
            >
              <motion.div
                {...panel}
                transition={reduce ? { duration: 0 } : { duration: 0.42, ease: EASE_DRAWER }}
                drag={narrow && dismissible ? "y" : false}
                dragConstraints={{ top: 0, bottom: 0 }}
                dragElastic={{ top: 0, bottom: 0.6 }}
                onDragEnd={(_, info) => {
                  if (info.offset.y > 120 || info.velocity.y > 600) onOpenChange(false);
                }}
                className={cn(
                  "fixed z-50 flex flex-col bg-background text-foreground shadow-pop outline-none",
                  narrow
                    ? "inset-x-0 bottom-0 max-h-[92dvh] rounded-t-2xl pb-[max(env(safe-area-inset-bottom),16px)]"
                    : "inset-0 m-auto h-fit max-h-[86dvh] w-[min(440px,calc(100vw-32px))] rounded-2xl",
                  className,
                )}
              >
                {narrow && (
                  <div
                    aria-hidden
                    className="mx-auto mt-2.5 h-1 w-10 rounded-full bg-fill-strong"
                  />
                )}
                <div className="flex items-start justify-between gap-4 px-6 pt-5">
                  <div>
                    <Dialog.Title className="display text-[26px]">{title}</Dialog.Title>
                    {description ? (
                      <Dialog.Description className="mt-1 text-sm text-muted-foreground">
                        {description}
                      </Dialog.Description>
                    ) : (
                      <Dialog.Description className="sr-only">{title}</Dialog.Description>
                    )}
                  </div>
                  {dismissible && (
                    <Dialog.Close
                      aria-label="Close"
                      className="group flex size-[30px] shrink-0 items-center justify-center rounded-lg bg-fill text-foreground transition-colors hover:bg-fill-strong active:scale-90"
                    >
                      <X className="size-4 transition-transform duration-300 group-hover:rotate-90" />
                    </Dialog.Close>
                  )}
                </div>
                <div className="scrollbar-thin overflow-y-auto px-6 pb-6 pt-4">{children}</div>
              </motion.div>
            </Dialog.Content>
          </Dialog.Portal>
        )}
      </AnimatePresence>
    </Dialog.Root>
  );
}
