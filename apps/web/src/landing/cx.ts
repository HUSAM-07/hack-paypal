/** Class joiner for the landing; keeps tailwind-merge out of its bundle. */
export const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(" ");
