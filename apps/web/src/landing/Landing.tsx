import { ArrowRight } from "lucide-react";
import type { CSSProperties } from "react";
import { ArtImage } from "./ArtImage";
import { ChapterPill, TopBar } from "./ChapterNav";
import { type Card, CHAPTERS, type Chapter, SCENES } from "./chapters";
import { MediaFrame } from "./Media";
import { Mark } from "./Mockups";
import { RingTitle } from "./RingTitle";

const d = (ms: number) => ({ "--d": ms }) as CSSProperties;
const sceneIndex = (c: Chapter) => SCENES.indexOf(c.scene);

/**
 * The fixed scene layer: photos that paint immediately (and stay as the fallback),
 * the WebGL canvas that takes over once ready, and a CSS grain for the static case.
 */
function SceneLayer() {
  return (
    <div
      className="scene-layer fixed inset-0 z-0 h-lvh overflow-hidden bg-[#090909]"
      data-scene="0"
    >
      {SCENES.map((s, i) => (
        <picture key={s}>
          <source
            type="image/avif"
            sizes="100vw"
            {...{
              [i === 0 ? "srcSet" : "data-srcset"]:
                `/art/bg-${s}-1280.avif 1280w, /art/bg-${s}-1920.avif 1920w`,
            }}
          />
          <img
            alt=""
            data-scene-img={i}
            {...{ [i === 0 ? "src" : "data-src"]: `/art/bg-${s}-1280.webp` }}
            decoding="async"
            className="scene-img absolute inset-0 size-full object-cover"
          />
        </picture>
      ))}
      <canvas className="scene-canvas absolute inset-0 size-full" />
      <div className="scene-grain absolute inset-0" />
      <div className="absolute inset-0 bg-[radial-gradient(120%_90%_at_40%_45%,rgb(9_9_9/0.25)_20%,rgb(9_9_9/0.75)_100%)]" />
    </div>
  );
}

function Hero() {
  return (
    <section id="top" data-transparent data-scene-index={0} className="relative h-[135svh]">
      <h1 className="sr-only">Pact: group money that moves together</h1>
      <div className="hero-ring pointer-events-none fixed inset-x-0 top-[30svh] z-[1] flex justify-center sm:top-[26svh]">
        <RingTitle word="Together" />
      </div>
      <div className="hero-exit fixed inset-x-0 bottom-0 z-20 flex flex-col gap-6 px-4 pb-6 sm:flex-row sm:items-end sm:justify-between sm:px-6 sm:pb-8">
        <p className="max-w-[17rem] text-[14px] leading-snug text-white/85">
          Watch prices, split the bill, pay on a schedule and settle up. On PayPal, with your
          approval.
        </p>
        <nav aria-label="Chapters" className="grid grid-cols-3 gap-x-8 gap-y-1">
          {CHAPTERS.map((c) => (
            <a
              key={c.id}
              href={`#${c.id}`}
              className="text-[14px] text-white/85 underline decoration-white/30 underline-offset-4 transition-colors hover:decoration-white"
            >
              {c.nav}
            </a>
          ))}
        </nav>
      </div>
    </section>
  );
}

function CardItem({ card, i }: { card: Card; i: number }) {
  return (
    <article data-reveal style={d((i % 3) * 90)} className="group">
      {card.art ? (
        <div className="overflow-hidden rounded-[16px] bg-[#141216]">
          <ArtImage
            name={card.art}
            sizes="(min-width: 1024px) 420px, (min-width: 640px) 45vw, 92vw"
            className="aspect-[4/3] h-auto w-full object-cover transition-transform duration-[1.2s] ease-swift group-hover:scale-[1.04]"
          />
        </div>
      ) : card.icon ? (
        <span className="flex size-11 items-center justify-center rounded-[12px] bg-white/[0.06] text-lav-200">
          <card.icon className="size-5" strokeWidth={1.6} />
        </span>
      ) : null}
      <h3
        className={
          card.art || card.icon
            ? "mt-4 text-[15px] text-white/90"
            : "border-t border-white/15 pt-4 text-[15px] text-white/90"
        }
      >
        {card.title}
      </h3>
      <p className="mt-1.5 max-w-[26rem] text-[14px] leading-relaxed text-white/55">{card.body}</p>
    </article>
  );
}

function ChapterSection({ chapter, index }: { chapter: Chapter; index: number }) {
  return (
    <section
      id={chapter.id}
      data-chapter={index}
      aria-labelledby={`${chapter.id}-title`}
      className="relative"
    >
      <header
        data-transparent
        data-scene-index={sceneIndex(chapter)}
        className="relative z-10 flex min-h-[100svh] items-center px-4 sm:px-6"
      >
        <div className="max-w-[1400px]">
          <p className="mb-4 font-mono text-[13px] text-white/50" data-reveal>
            {String(index + 1).padStart(2, "0")}
          </p>
          <h2 id={`${chapter.id}-title`} className="chapter-title" data-reveal style={d(60)}>
            {chapter.title}
          </h2>
          <p
            className="mt-5 max-w-[34rem] text-[18px] text-white/85 sm:text-[22px]"
            data-reveal
            style={d(140)}
          >
            {chapter.subtitle}
          </p>
        </div>
      </header>
      <div className="relative z-10 bg-[#090909] px-4 pt-24 pb-36 sm:px-6 sm:pt-32">
        <div className="mx-auto max-w-[1400px]">
          {chapter.features.map((f, i) => (
            <div key={f.title} className={i > 0 ? "mt-32" : undefined}>
              <div className="grid gap-6 lg:grid-cols-12 lg:items-end">
                <h3 data-reveal className="feature-title lg:col-span-7">
                  {f.title}
                </h3>
                <div data-reveal style={d(100)} className="lg:col-span-4 lg:col-start-9">
                  <p className="text-[16px] leading-relaxed text-white/65">{f.body}</p>
                  {f.link && (
                    <a
                      href={f.link.href}
                      className="mt-4 inline-flex items-center gap-1.5 text-[14px] text-white underline decoration-white/30 underline-offset-4 hover:decoration-white"
                    >
                      {f.link.label} <ArrowRight className="size-3.5" />
                    </a>
                  )}
                </div>
              </div>
              <MediaFrame media={f.media} label={chapter.nav} />
            </div>
          ))}
          {chapter.cards.length > 0 && (
            <div
              className={
                chapter.features.length
                  ? "mt-20 grid gap-x-6 gap-y-14 sm:grid-cols-2 lg:grid-cols-3"
                  : "grid gap-x-6 gap-y-14 sm:grid-cols-2 lg:grid-cols-3"
              }
            >
              {chapter.cards.map((card, i) => (
                <CardItem key={card.title} card={card} i={i} />
              ))}
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

function Closing() {
  return (
    <section
      data-transparent
      data-scene-index={0}
      className="relative z-10 flex min-h-[90svh] flex-col items-start justify-center px-4 sm:px-6"
    >
      <h2 className="chapter-title max-w-[12ch]" data-reveal>
        Start a pact
      </h2>
      <p className="mt-5 max-w-[30rem] text-[18px] text-white/85 sm:text-[22px]" data-reveal>
        Pact is invite-only during the preview. Sign in with a passkey in seconds.
      </p>
      <a
        href="/app"
        data-reveal
        className="mt-8 inline-flex h-12 items-center gap-2 rounded-full bg-white px-6 text-[16px] font-medium text-[#090909] transition-transform duration-150 ease-snappy active:scale-[0.96]"
      >
        Open Pact <ArrowRight className="size-4" />
      </a>
    </section>
  );
}

function Footer() {
  return (
    <footer className="relative z-10 bg-[#090909] px-4 pt-16 pb-28 sm:px-6">
      <div className="mx-auto flex max-w-[1400px] flex-col gap-10 border-t border-white/10 pt-10 sm:flex-row sm:justify-between">
        <div>
          <Mark />
          <p className="mt-3 max-w-[22rem] text-[14px] text-white/50">
            Group money agents in chat. Built for the PayPal AI Hackathon.
          </p>
        </div>
        <nav aria-label="Footer" className="grid grid-cols-2 gap-x-12 gap-y-2 sm:grid-cols-3">
          {CHAPTERS.map((c) => (
            <a key={c.id} href={`#${c.id}`} className="text-[14px] text-white/60 hover:text-white">
              {c.nav}
            </a>
          ))}
        </nav>
      </div>
      <p className="mx-auto mt-12 max-w-[1400px] text-[12px] leading-relaxed text-white/55">
        Pact is a hackathon preview. Payments in the preview use test money. PayPal is a trademark
        of PayPal, Inc.
      </p>
    </footer>
  );
}

export function Landing() {
  return (
    <>
      <SceneLayer />
      <TopBar />
      <main className="relative">
        <Hero />
        {CHAPTERS.map((c, i) => (
          <ChapterSection key={c.id} chapter={c} index={i} />
        ))}
        <Closing />
      </main>
      <Footer />
      <ChapterPill />
    </>
  );
}
