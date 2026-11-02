import { ChevronDown } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { CHAPTERS } from "./chapters";
import { cx } from "./cx";
import { Mark } from "./Mockups";

const num = (i: number) => String(i + 1).padStart(2, "0");

function useOutsideClose(open: boolean, close: () => void) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) close();
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && close();
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open, close]);
  return ref;
}

function ChapterList({ onPick, columns }: { onPick: () => void; columns?: boolean }) {
  return (
    <ul className={cx("grid gap-0.5", columns && "sm:grid-cols-2")}>
      {CHAPTERS.map((c, i) => (
        <li key={c.id}>
          <a
            href={`#${c.id}`}
            onClick={onPick}
            className="flex items-center justify-between gap-6 rounded-[10px] px-3 py-2 text-[14px] text-white/85 transition-colors hover:bg-white/10"
          >
            {c.nav}
            <span className="font-mono text-[12px] text-white/40">{num(i)}</span>
          </a>
        </li>
      ))}
    </ul>
  );
}

export function TopBar() {
  const [open, setOpen] = useState(false);
  const ref = useOutsideClose(open, () => setOpen(false));
  return (
    <header className="topbar fixed inset-x-0 top-0 z-50 h-[50px]">
      <div className="flex h-full items-center justify-between px-4 sm:px-6">
        <div className="flex items-center gap-6">
          <a href="/" className="flex items-center gap-2">
            <Mark />
            <span className="text-[14px] text-white/50">Preview ’26</span>
          </a>
          <div ref={ref} className="relative hidden sm:block">
            <button
              type="button"
              aria-expanded={open}
              onClick={() => setOpen((o) => !o)}
              className="flex items-center gap-1 text-[14px] text-white/85 hover:text-white"
            >
              Chapters <ChevronDown className="size-3.5" />
            </button>
            <div
              data-open={open || undefined}
              className="popover absolute top-9 left-0 w-[380px] rounded-[16px] bg-[#1a181d]/95 p-2 shadow-pop backdrop-blur-xl"
            >
              <ChapterList onPick={() => setOpen(false)} columns />
            </div>
          </div>
        </div>
        <a
          href="/app"
          className="flex h-8 items-center rounded-full bg-white px-4 text-[14px] font-medium text-[#090909] transition-transform duration-150 ease-snappy active:scale-[0.96]"
        >
          Open Pact
        </a>
      </div>
    </header>
  );
}

/** The fixed pill that names the chapter you're in and jumps between chapters. */
export function ChapterPill() {
  const [current, setCurrent] = useState(-1);
  const [open, setOpen] = useState(false);
  const ref = useOutsideClose(open, () => setOpen(false));

  useEffect(() => {
    const sections = [...document.querySelectorAll<HTMLElement>("[data-chapter]")];
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) setCurrent(Number((e.target as HTMLElement).dataset.chapter));
          else if (e.target === sections[0] && e.boundingClientRect.top > 0) setCurrent(-1);
        }
      },
      { rootMargin: "-50% 0px -50% 0px" },
    );
    for (const s of sections) io.observe(s);
    return () => io.disconnect();
  }, []);

  const c = CHAPTERS[current];
  return (
    <div
      ref={ref}
      data-shown={c ? "" : undefined}
      className="chapter-pill fixed bottom-4 left-1/2 z-50 -translate-x-1/2"
    >
      <div
        data-open={open || undefined}
        className="popover absolute bottom-14 left-1/2 w-[260px] -translate-x-1/2 rounded-[16px] bg-[#1a181d]/95 p-2 shadow-pop backdrop-blur-xl"
      >
        <ChapterList onPick={() => setOpen(false)} />
      </div>
      <button
        type="button"
        aria-expanded={open}
        aria-label="Jump to a chapter"
        onClick={() => setOpen((o) => !o)}
        className="flex h-11 w-[230px] items-center justify-between rounded-full bg-white pr-2 pl-5 text-[14px] font-medium text-[#090909] shadow-[0_8px_32px_-8px_rgb(0_0_0/0.6)] transition-transform duration-150 ease-snappy active:scale-[0.97]"
      >
        <span className="truncate">{c?.nav ?? ""}</span>
        <span className="flex h-7 min-w-9 items-center justify-center rounded-full bg-[#090909]/[0.07] px-2 font-mono text-[12px]">
          {c ? num(current) : ""}
        </span>
      </button>
    </div>
  );
}
