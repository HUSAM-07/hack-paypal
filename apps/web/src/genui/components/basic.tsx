import type { ComponentRenderProps } from "@openuidev/react-lang";
import type { PropsOf } from "@pact/catalog";
import {
  ArrowUp,
  Check,
  CheckCircle2,
  ChevronDown,
  CircleDashed,
  Info,
  ListTodo,
  MessagesSquare,
  TriangleAlert,
} from "lucide-react";
import { AnimatePresence, LayoutGroup, motion, useReducedMotion } from "motion/react";
import { type KeyboardEvent, useId, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { blockEnter, EASE_OUT, SPRING_LAYOUT } from "@/lib/motion";
import { cn } from "@/lib/utils";
import { useHostActions } from "../actions";
import { Markdown } from "../Markdown";
import { GenCard, Well } from "../primitives";

type R<P> = ComponentRenderProps<P>;

export function StackView({ props, renderNode }: R<PropsOf<"Stack">>) {
  return (
    <div className="flex w-full flex-col gap-3">
      {props.children.map((child, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: children are positional in the program
        <div key={i} className="min-w-0">
          {renderNode(child)}
        </div>
      ))}
    </div>
  );
}

export function TextView({ props }: R<PropsOf<"Text">>) {
  return <Markdown>{props.markdown}</Markdown>;
}

const CALLOUT = {
  info: { icon: Info, cls: "bg-primary-soft text-primary" },
  success: { icon: CheckCircle2, cls: "bg-success-soft text-success" },
  warning: { icon: TriangleAlert, cls: "bg-warning-soft text-warning" },
} as const;

export function CalloutView({ props }: R<PropsOf<"Callout">>) {
  const c = CALLOUT[props.tone];
  const reduce = useReducedMotion();
  return (
    <motion.div
      {...(reduce ? {} : blockEnter)}
      role={props.tone === "warning" ? "alert" : "status"}
      className={cn("flex items-start gap-2.5 rounded-md px-3.5 py-3 text-sm leading-5", c.cls)}
    >
      <c.icon className="mt-px size-4 shrink-0" strokeWidth={2.2} />
      <span className="text-foreground/90">{props.text}</span>
    </motion.div>
  );
}

export function PlanCardView({ props }: R<PropsOf<"PlanCard">>) {
  const [open, setOpen] = useState(false);
  const reduce = useReducedMotion();
  const visible = open ? props.steps : props.steps.slice(0, 3);
  const hidden = props.steps.length - visible.length;
  return (
    <GenCard icon={ListTodo} title={props.title} label={`Plan: ${props.title}`}>
      <Well className="px-3.5 py-3">
        <div className="mb-2 flex items-center justify-between text-[13px] text-muted-foreground">
          <span className="flex items-center gap-1.5">
            <ListTodo className="size-3.5" /> Steps
          </span>
          <span className="tabular">{props.steps.length}</span>
        </div>
        <ol className="space-y-0.5">
          <AnimatePresence initial={false}>
            {visible.map((step, i) => (
              <motion.li
                key={step}
                initial={reduce ? false : { opacity: 0, x: -4 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.3, ease: EASE_OUT, delay: reduce ? 0 : i * 0.05 }}
                className="flex items-start gap-2.5 py-1 text-sm leading-5"
              >
                <CircleDashed className="mt-0.5 size-3.5 shrink-0 text-subtle-foreground" />
                <span className="text-foreground/90">{step}</span>
              </motion.li>
            ))}
          </AnimatePresence>
        </ol>
        {hidden > 0 && (
          <button
            type="button"
            onClick={() => setOpen(true)}
            className="mt-1 flex items-center gap-1.5 py-1 text-[13px] text-muted-foreground transition-colors hover:text-foreground"
          >
            <ChevronDown className="size-3.5" /> {hidden} more
          </button>
        )}
      </Well>
      <p className="mt-3 flex items-center gap-1.5 text-xs text-muted-foreground">
        <span className="size-1.5 rounded-full bg-success" />
        Nothing moves without a mandate or your approval.
      </p>
    </GenCard>
  );
}

const LETTERS = "ABCDEFGH";

export function QuestionCardView({ props }: R<PropsOf<"QuestionCard">>) {
  const { run, interactive } = useHostActions();
  const [selected, setSelected] = useState<number | null>(null);
  const [custom, setCustom] = useState("");
  const [answered, setAnswered] = useState<string | null>(null);
  const listId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const customIndex = props.allowCustom ? props.options.length : -1;
  const total = props.options.length + (props.allowCustom ? 1 : 0);
  const locked = !interactive || answered !== null;

  const answer = () => {
    if (locked || selected === null) return;
    const text = selected === customIndex ? custom.trim() : props.options[selected];
    if (!text) return;
    setAnswered(text);
    run("issueTurn", { text });
  };

  const onKey = (e: KeyboardEvent) => {
    if (locked) return;
    if (
      e.target instanceof HTMLInputElement &&
      e.key !== "Enter" &&
      e.key !== "ArrowUp" &&
      e.key !== "ArrowDown"
    )
      return;
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      const d = e.key === "ArrowDown" ? 1 : -1;
      const next = selected === null ? 0 : (selected + d + total) % total;
      setSelected(next);
      if (next === customIndex) inputRef.current?.focus();
    } else if (e.key === "Enter") {
      e.preventDefault();
      answer();
    } else {
      const idx = LETTERS.indexOf(e.key.toUpperCase());
      if (idx >= 0 && idx < total) {
        setSelected(idx);
        if (idx === customIndex) requestAnimationFrame(() => inputRef.current?.focus());
      }
    }
  };

  return (
    <GenCard
      icon={MessagesSquare}
      title="Question"
      label={props.question}
      aside={
        answered ? (
          <span className="flex items-center gap-1 text-xs text-success">
            <Check className="size-3.5" /> Answered
          </span>
        ) : null
      }
    >
      {/* biome-ignore lint/a11y/noStaticElementInteractions: keyboard shortcuts for the radio group */}
      <div onKeyDown={onKey}>
        <p id={listId} className="text-[15px] font-medium leading-6">
          {props.question}
        </p>
        <LayoutGroup id={listId}>
          <div role="radiogroup" aria-labelledby={listId} className="mt-2.5 -mx-1.5 space-y-0.5">
            {props.options.map((opt, i) => (
              <Option
                key={opt}
                letter={LETTERS[i]!}
                active={selected === i}
                chosen={answered === opt}
                dim={answered !== null && answered !== opt}
                disabled={locked}
                onSelect={() => setSelected(i)}
                onConfirm={() => {
                  setSelected(i);
                  if (!locked) {
                    setAnswered(opt);
                    run("issueTurn", { text: opt });
                  }
                }}
              >
                {opt}
              </Option>
            ))}
            {props.allowCustom && (
              <Option
                letter={LETTERS[customIndex]!}
                active={selected === customIndex}
                chosen={answered !== null && answered === custom.trim()}
                dim={answered !== null && answered !== custom.trim()}
                disabled={locked}
                onSelect={() => {
                  setSelected(customIndex);
                  inputRef.current?.focus();
                }}
              >
                <input
                  ref={inputRef}
                  value={custom}
                  disabled={locked}
                  onFocus={() => setSelected(customIndex)}
                  onChange={(e) => setCustom(e.target.value.slice(0, 200))}
                  placeholder="Something else…"
                  aria-label="Your own answer"
                  className="w-full bg-transparent text-sm outline-none placeholder:text-subtle-foreground"
                />
              </Option>
            )}
          </div>
        </LayoutGroup>
        <div className="mt-3 flex items-center justify-end gap-2">
          <Button
            size="sm"
            variant={selected === null ? "secondary" : "default"}
            disabled={locked || selected === null || (selected === customIndex && !custom.trim())}
            onClick={answer}
            className="gap-2 pr-1.5"
          >
            {answered ? "Sent" : "Next"}
            <kbd className="flex h-5 items-center gap-0.5 rounded-sm bg-current/15 px-1.5 font-mono text-[11px]">
              <ArrowUp className="size-3 rotate-90" />
            </kbd>
          </Button>
        </div>
      </div>
    </GenCard>
  );
}

function Option({
  letter,
  active,
  chosen,
  dim,
  disabled,
  onSelect,
  onConfirm,
  children,
}: {
  letter: string;
  active: boolean;
  chosen: boolean;
  dim: boolean;
  disabled: boolean;
  onSelect: () => void;
  onConfirm?: () => void;
  children: React.ReactNode;
}) {
  const reduce = useReducedMotion();
  return (
    // biome-ignore lint/a11y/useSemanticElements: custom radio row with a nested input
    <div
      role="radio"
      aria-checked={active}
      aria-disabled={disabled}
      tabIndex={disabled ? -1 : active ? 0 : -1}
      onClick={disabled ? undefined : onSelect}
      onDoubleClick={disabled ? undefined : onConfirm}
      onKeyDown={(e) => {
        if (e.key === " ") {
          e.preventDefault();
          onSelect();
        }
      }}
      className={cn(
        "relative flex min-h-10 cursor-pointer items-center gap-3 rounded-md px-1.5 py-1.5 text-sm transition-opacity",
        disabled && "cursor-default",
        dim && "opacity-40",
      )}
    >
      {(active || chosen) && (
        <motion.span
          {...(reduce ? {} : { layoutId: "q-active" })}
          transition={SPRING_LAYOUT}
          className="absolute inset-0 rounded-md bg-muted"
        />
      )}
      <span
        className={cn(
          "relative flex size-6 shrink-0 items-center justify-center rounded-md font-mono text-[11px] transition-colors duration-150",
          active || chosen ? "bg-foreground text-background" : "bg-fill text-muted-foreground",
        )}
      >
        {chosen ? <Check className="size-3.5" /> : letter}
      </span>
      <span className="relative min-w-0 flex-1 text-foreground/90">{children}</span>
    </div>
  );
}
