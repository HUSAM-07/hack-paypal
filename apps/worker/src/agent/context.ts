/**
 * Per-turn context and the member message wrapper. The context changes every turn
 * (clock, pacts), so it rides in the user message, not the cached system prompt.
 */
import type { Pact } from "@pact/protocol";
import type { ChatMessage } from "./provider";
import { weekday } from "./time";
import type { Contact, Member } from "./tools";

export interface TurnContext {
  now: Date;
  timeZone: string;
  members: Member[];
  contacts?: Contact[];
  /** Pacts the server can resolve as refs (rule: list only what `getRef` finds). */
  pacts: Pact[];
  speakerId: string;
}

export function contextBlock(c: TurnContext): string {
  const speaker = c.members.find((m) => m.userId === c.speakerId);
  const lines = [
    `Now: ${c.now.toISOString()} (${weekday(c.now, c.timeZone)} in ${c.timeZone}).`,
    `Thread members: ${c.members.map((m) => `${clean(m.displayName)} (${m.userId})`).join(", ")}.`,
    c.contacts?.length
      ? `Contacts outside the thread: ${c.contacts.map((m) => `${clean(m.displayName)} (${m.userId}${m.email ? `, ${clean(m.email)}` : ""})`).join(", ")}.`
      : "",
    c.pacts.length
      ? `Pacts in this thread: ${c.pacts.map((p) => `${p.id} "${clean(p.title)}" (${p.state})`).join("; ")}.`
      : "",
    `Speaking now: ${clean(speaker?.displayName ?? "member")} (${c.speakerId}).`,
  ];
  return `<context>\n${lines.filter(Boolean).join("\n")}\n</context>`;
}

/** Member text is untrusted: wrap it so the model can tell data from instructions. */
export function memberMessage(
  author: Member | undefined,
  authorId: string,
  text: string,
  uiState?: Record<string, unknown>,
): string {
  const safe = (s: string) => s.replaceAll("</member_message", "<\\/member_message");
  let out = `<member_message author="${safe(clean(author?.displayName ?? "member"))}" user_id="${authorId}">\n${safe(text)}\n</member_message>`;
  if (uiState) out += `\n<ui_state>${safe(JSON.stringify(uiState)).slice(0, 4000)}</ui_state>`;
  return out;
}

/** Names and titles are member-controlled; keep them on one line and out of the tags. */
function clean(s: string): string {
  return s.replace(/[\s<>"]+/g, " ").slice(0, 120);
}

const DOLLARS = /(?:\$|\bUSD\s?)\s?(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d{1,2}))?(?!\d)/gi;
const BARE_NUMBER = /(?<![\w.])(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d{1,2}))?(?![\d%])/g;

const toMinor = (whole: string, frac: string | undefined) =>
  Number(whole.replaceAll(",", "")) * 100 + Number((frac ?? "").padEnd(2, "0"));

/** Dollar amounts written in text, in minor units. */
export function amountsInText(text: string): number[] {
  return [...text.matchAll(DOLLARS)].map((m) => toMinor(m[1] ?? "0", m[2]));
}

/**
 * Amounts the agent may repeat in prose: figures a member typed (with or without a
 * "$") and figures a tool returned (Money, `*Minor`, `*Display`). Retailer copy under
 * `untrusted*` keys never counts, so a "$99 SALE" in a listing can't be echoed.
 */
export function knownAmounts(messages: readonly ChatMessage[]): Set<number> {
  const out = new Set<number>();
  const visit = (v: unknown): void => {
    if (typeof v === "string") for (const a of amountsInText(v)) out.add(a);
    else if (Array.isArray(v)) for (const x of v) visit(x);
    else if (v && typeof v === "object") {
      for (const [k, x] of Object.entries(v)) {
        if (k.startsWith("untrusted")) continue;
        if (k.endsWith("Minor") && typeof x === "number") out.add(x);
        else visit(x);
      }
    }
  };
  for (const m of messages) {
    if (m.role === "user") {
      const said = [...m.content.matchAll(/<member_message[^>]*>([\s\S]*?)<\/member_message>/g)]
        .map((x) => x[1] ?? "")
        .join("\n");
      for (const n of said.matchAll(BARE_NUMBER)) out.add(toMinor(n[1] ?? "0", n[2]));
    } else if (m.role === "tool") {
      for (const r of m.results) visit(r.output);
    }
  }
  return out;
}
