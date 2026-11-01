/** Pull refs, amounts and visible text out of transcripts for grading. */
import type { TurnRecord } from "./scenario";
import { textsOf, walk } from "./ui";

const REF = /^[a-z]+_[A-Za-z0-9]{4,40}$/;

/**
 * Ref ids a tool result hands out: ref-shaped values under `ref`, `id`, `*Ref`,
 * `*Refs` or `*Id` keys. Anything id-shaped the server returned counts as
 * produced by a tool; free text (descriptions) never does.
 */
export function refsIn(value: unknown, out = new Set<string>()): Set<string> {
  if (Array.isArray(value)) for (const v of value) refsIn(v, out);
  else if (value && typeof value === "object") {
    for (const [k, v] of Object.entries(value)) {
      const refKey =
        k === "ref" || k === "id" || k.endsWith("Ref") || k.endsWith("Refs") || k.endsWith("Id");
      if (refKey && typeof v === "string" && REF.test(v)) out.add(v);
      else if (refKey && Array.isArray(v)) {
        for (const x of v) if (typeof x === "string" && REF.test(x)) out.add(x);
      }
      refsIn(v, out);
    }
  }
  return out;
}

const DOLLARS = /(?:\$|\bUSD\s?)\s?(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d{1,2}))?(?!\d)/gi;
const BARE_NUMBER = /(?<![\w.])(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d{1,2}))?(?![\d%])/g;

function toMinor(whole: string, frac: string | undefined): number {
  return Number(whole.replaceAll(",", "")) * 100 + Number((frac ?? "").padEnd(2, "0"));
}

/** Dollar amounts written in text, in minor units. */
export function amountsInText(text: string): number[] {
  return [...text.matchAll(DOLLARS)].map((m) => toMinor(m[1] ?? "0", m[2]));
}

/** Every number a user typed, read as dollars: users may omit the "$". */
export function numbersInUserText(text: string): number[] {
  return [...text.matchAll(BARE_NUMBER)].map((m) => toMinor(m[1] ?? "0", m[2]));
}

/**
 * Server-sourced amounts in a tool result: Money objects, `*Minor` ints, formatted
 * strings. Keys prefixed `untrusted` (retailer copy) are skipped: a "$99 SALE!" in a
 * product description is not a price the agent may repeat.
 */
export function amountsInValue(value: unknown, out = new Set<number>()): Set<number> {
  if (typeof value === "string") for (const a of amountsInText(value)) out.add(a);
  else if (Array.isArray(value)) for (const v of value) amountsInValue(v, out);
  else if (value && typeof value === "object") {
    for (const [k, v] of Object.entries(value)) {
      if (k.startsWith("untrusted")) continue;
      if ((k === "amountMinor" || k.endsWith("Minor")) && typeof v === "number") out.add(v);
      else amountsInValue(v, out);
    }
  }
  return out;
}

/** What the user actually sees from one turn: prose and every string prop of every node. */
export function visibleTexts(turn: TurnRecord): string[] {
  return [...walk(turn.ui)].flatMap(textsOf);
}

/** Raw agent output, for leak checks that must not depend on parsing succeeding. */
export function rawAgentText(turn: TurnRecord): string {
  return turn.items
    .map((i) => (i.type === "agentMessage" ? `${i.text}\n${i.fallbackMarkdown ?? ""}` : ""))
    .join("\n");
}
