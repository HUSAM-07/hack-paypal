/**
 * Plays the console's film: two agent transcripts the server has already rendered, rows
 * aligned like a diff.
 *   1. Without the review: the held-out agent's rows type in, one at a time.
 *   2. With the review: the same for the agent shown the creator's review.
 *   3. Spot the difference: = or ≠ lands beside each row, the changed rows light up.
 * Without this script the page shows both transcripts in full; with reduced motion or the
 * console's live refresh it opens on the finished comparison.
 */

const TYPE = 0.55; // typing dots before a row lands
const GAP = 1.15; // between rows
const PAUSE = 1.2; // between chapters

type Cue = { t: number; el: Element; cls: string };

function main() {
  const film = document.querySelector<HTMLElement>(".film");
  if (!film) return;
  const still =
    document.querySelector('meta[http-equiv="refresh"]') !== null ||
    matchMedia("(prefers-reduced-motion: reduce)").matches;

  const rowsA = [...film.querySelectorAll(".fa.row")];
  const rowsB = [...film.querySelectorAll(".fb.row")];
  const eqs = [...film.querySelectorAll(".eq[data-row]")];
  const sum = film.querySelector(".film-sum");
  const headA = film.querySelector(".fa.fh");
  const headB = film.querySelector(".fb.fh");

  const cues: Cue[] = [];
  const chapters: number[] = [0];
  let t = 0.4;
  const playRows = (rows: Element[]) => {
    for (const el of rows) {
      cues.push({ t, el, cls: "typing" });
      cues.push({ t: t + TYPE, el, cls: "shown" });
      t += GAP;
    }
  };
  playRows(rowsA);
  t += PAUSE;
  chapters.push(t - 0.4);
  playRows(rowsB);
  t += PAUSE;
  chapters.push(t - 0.4);
  const diffAt = t;
  for (const el of eqs) {
    cues.push({ t, el, cls: "shown" });
    t += 0.3;
  }
  if (sum) cues.push({ t: t + 0.3, el: sum, cls: "shown" });
  const end = t + 1.2;

  film.classList.add("film-on");
  const chapterEls = [...film.querySelectorAll<HTMLButtonElement>(".film-ch")];
  const playEl = film.querySelector<HTMLButtonElement>(".film-play");
  const replayEl = film.querySelector<HTMLButtonElement>(".film-replay");

  let now = still ? end : 0;
  let playing = !still;
  let last = performance.now();
  const setPlaying = (p: boolean) => {
    playing = p;
    if (playEl) playEl.textContent = p ? "Pause" : now >= end ? "Play again" : "Play";
  };
  chapterEls.forEach((b, i) => {
    b.addEventListener("click", () => {
      now = chapters[i] as number;
      setPlaying(true);
    });
  });
  playEl?.addEventListener("click", () => {
    if (now >= end) now = 0;
    setPlaying(!playing);
  });
  replayEl?.addEventListener("click", () => {
    now = 0;
    setPlaying(true);
  });
  setPlaying(playing);

  // State is a pure function of the clock, so jumping back to a chapter just works.
  const all = [...new Set(cues.map((c) => c.el))];
  function render() {
    const state = new Map<Element, string>();
    for (const c of cues) if (now >= c.t) state.set(c.el, c.cls);
    for (const el of all) {
      const s = state.get(el);
      el.classList.toggle("typing", s === "typing");
      el.classList.toggle("shown", s === "shown");
    }
    const chapter = now >= (chapters[2] as number) ? 2 : now >= (chapters[1] as number) ? 1 : 0;
    headA?.classList.toggle("playing", chapter === 0);
    headB?.classList.toggle("playing", chapter === 1);
    for (const el of rowsA) el.classList.toggle("playing", chapter === 0);
    for (const el of rowsB) el.classList.toggle("playing", chapter === 1);
    film?.classList.toggle("diff", now >= diffAt);
    chapterEls.forEach((b, i) => {
      b.setAttribute("aria-current", i === chapter ? "step" : "false");
      const s = chapters[i] as number;
      const e = (chapters[i + 1] as number | undefined) ?? end;
      b.style.setProperty("--p", String(Math.min(1, Math.max(0, (now - s) / (e - s)))));
    });
  }

  function frame(ts: number) {
    const dt = Math.min(0.1, (ts - last) / 1000);
    last = ts;
    if (playing) {
      now += dt;
      if (now >= end) {
        now = end;
        setPlaying(false);
      }
    }
    render();
    requestAnimationFrame(frame);
  }
  render();
  requestAnimationFrame(frame);
}

main();
