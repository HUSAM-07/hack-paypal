/**
 * Creator-written text is untrusted: it is stored from a public form and later handed to other
 * people's AI agents. One sanitiser is used where it is written (/creators) and again where it is
 * served (the public catalogue), so rows stored before a rule existed are cleaned too.
 */

/** Longest text a creator can publish, per field. */
export const CREATOR_TEXT_LIMITS = {
  name: 80,
  summary: 1200,
  disclosure: 400,
  topic: 40,
  placeboSummary: 1200,
} as const;

/** Used when a creator's own disclosure does not say they may earn a commission. */
export const DEFAULT_CREATOR_DISCLOSURE =
  "I may earn a commission from CITED when an AI agent buys after reading this test. The commission never affects my verdict.";

// Control characters (C0, DEL, C1) and invisible format characters (zero-width, bidi overrides).
const INVISIBLE = /[\p{Cc}\p{Cf}\u2028\u2029]/gu;

/**
 * Plain text only: markup, links, code fences and control characters out, whitespace tidied,
 * capped at `max` characters. `multiline` keeps paragraph breaks (the summaries); everything
 * else becomes one line.
 */
export function cleanCreatorText(raw: unknown, max: number, multiline = false): string {
  if (typeof raw !== "string") return "";
  let s = raw.replace(/\r\n?|\u2028|\u2029/g, "\n");
  s = s.replace(INVISIBLE, (ch) => (ch === "\n" ? ch : " "));
  s = s
    .replace(/<[^>]*>/g, " ") // HTML tags, comments, anything tag-shaped
    .replace(/[<>]/g, "") // stray angle brackets
    .replace(/&(?:#\d+|#x[0-9a-f]+|[a-z]{2,8});/gi, " ") // HTML entities
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1") // markdown links and images keep their words only
    .replace(/\b(?:https?|ftp|data|javascript):[^\s]*/gi, "") // bare links
    .replace(/\bwww\.[^\s]+/gi, "")
    .replace(/[`]+/g, "") // code spans and fences
    .replace(/^\s{0,3}#{1,6}\s+/gm, ""); // markdown headings
  s = multiline
    ? s
        .replace(/[^\S\n]+/g, " ")
        .replace(/ ?\n ?/g, "\n")
        .replace(/\n{3,}/g, "\n\n")
    : s.replace(/\s+/g, " ");
  const chars = Array.from(s.trim());
  return chars.length > max ? chars.slice(0, max).join("").trim() : chars.join("");
}
