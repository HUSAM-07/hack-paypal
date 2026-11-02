import { Pause, Play } from "lucide-react";
import { ArtImage } from "./ArtImage";
import type { Media } from "./chapters";
import { BrowserMock } from "./Mockups";
import { ApprovePhone, SplitPhone } from "./Phones";
import { SplitDemo } from "./SplitDemo";

/**
 * The large rounded media frame of a feature block. Videos never preload: motion.ts
 * plays them only while they're on screen and wires the play/pause pill.
 */
export function MediaFrame({ media, label }: { media: Media; label: string }) {
  if (media.kind === "split") {
    return (
      <div data-reveal className="mt-12">
        <SplitDemo />
      </div>
    );
  }
  return (
    <div
      data-reveal
      className="media-frame relative mt-12 aspect-[16/10] overflow-hidden rounded-[24px] bg-[#141216] sm:aspect-video"
    >
      {media.kind === "video" && (
        <>
          <video
            data-video
            className="absolute inset-0 size-full object-cover"
            data-poster={`/art/${media.name}-poster-1280.avif`}
            preload="none"
            muted
            loop
            playsInline
            aria-label={`${label} animation`}
          >
            <source src={`/video/${media.name}.mp4`} type="video/mp4" />
          </video>
          <div className="absolute inset-x-0 bottom-5 flex justify-center">
            <button
              type="button"
              data-video-toggle
              className="flex h-11 items-center gap-3 rounded-full bg-white pr-1.5 pl-5 text-[14px] font-medium text-[#090909] transition-transform duration-150 ease-snappy active:scale-[0.96]"
            >
              {label}
              <span className="flex size-8 items-center justify-center rounded-full bg-[#090909] text-white">
                <Play className="video-play size-3.5 fill-current" />
                <Pause className="video-pause hidden size-3.5 fill-current" />
              </span>
              <span className="sr-only">Play or pause</span>
            </button>
          </div>
        </>
      )}
      {media.kind === "still" && (
        <ArtImage
          name={media.art}
          sizes="(min-width: 1024px) 1300px, 100vw"
          className="absolute inset-0 size-full object-cover"
        />
      )}
      {media.kind === "browser" && (
        <div className="absolute inset-0 flex items-center justify-center p-4 sm:p-12">
          <div className="h-full w-full max-w-[980px] overflow-hidden rounded-[16px] shadow-pop">
            <BrowserMock />
          </div>
        </div>
      )}
      {media.kind === "phones" && (
        <div className="absolute inset-0 flex items-start justify-center gap-6 pt-10 sm:pt-14">
          <div className="hidden translate-y-10 md:block">
            <SplitPhone />
          </div>
          <ApprovePhone />
        </div>
      )}
    </div>
  );
}
