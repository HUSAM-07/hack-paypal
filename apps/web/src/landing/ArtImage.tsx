import { art } from "./art";

export type ArtName = Exclude<keyof typeof art, "og">;

/** Generated 3D art as AVIF with a WebP fallback; fixed dimensions so nothing shifts. */
export function Art({
  name,
  sizes,
  className,
}: {
  name: ArtName;
  sizes: string;
  className?: string;
}) {
  const a = art[name];
  const set = (ext: string) => a.widths.map((w) => `/art/${name}-${w}.${ext} ${w}w`).join(", ");
  return (
    <picture>
      <source type="image/avif" srcSet={set("avif")} sizes={sizes} />
      <source type="image/webp" srcSet={set("webp")} sizes={sizes} />
      <img
        src={`/art/${name}-${a.widths[0]}.webp`}
        width={a.w}
        height={a.h}
        alt=""
        loading="lazy"
        decoding="async"
        className={className}
      />
    </picture>
  );
}
