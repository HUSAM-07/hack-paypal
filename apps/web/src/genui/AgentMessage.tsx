import { Renderer } from "@openuidev/react-lang";
import { memo, useMemo } from "react";
import { library } from "./library";
import { Markdown } from "./Markdown";
import { RefsContext } from "./refs";

export type Segment =
  | { kind: "prose"; text: string }
  | { kind: "program"; code: string; closed: boolean };

const FENCE = /```openui-lang[^\S\n]*\n([\s\S]*?)(```|$)/g;

/**
 * Splits an agent message into markdown prose and fenced OpenUI programs (the worker's
 * inline mode). While streaming, a half-typed fence opener is hidden from the prose.
 */
export function splitSegments(text: string, streaming: boolean): Segment[] {
  const out: Segment[] = [];
  let last = 0;
  for (const m of text.matchAll(FENCE)) {
    const before = text.slice(last, m.index).trim();
    if (before) out.push({ kind: "prose", text: before });
    out.push({ kind: "program", code: m[1] ?? "", closed: m[2] === "```" });
    last = (m.index ?? 0) + m[0].length;
  }
  let tail = text.slice(last);
  if (streaming) tail = tail.replace(/`{1,3}[a-z-]*$/, "");
  tail = tail.trim();
  if (tail) out.push({ kind: "prose", text: tail });
  return out;
}

export const AgentMessageBody = memo(function AgentMessageBody({
  text,
  refs,
  streaming,
}: {
  text: string;
  refs: Record<string, unknown>;
  streaming: boolean;
}) {
  const segments = useMemo(() => splitSegments(text, streaming), [text, streaming]);
  return (
    <RefsContext.Provider value={refs}>
      <div className="flex flex-col gap-3">
        {segments.map((s, i) =>
          s.kind === "prose" ? (
            // biome-ignore lint/suspicious/noArrayIndexKey: segments are positional and append-only
            <Markdown key={i}>{s.text}</Markdown>
          ) : (
            // biome-ignore lint/suspicious/noArrayIndexKey: segments are positional and append-only
            <div key={i} className="min-w-0">
              <Renderer
                response={s.code}
                library={library}
                isStreaming={streaming && !s.closed}
                publishObservability={false}
                onError={(errs) => {
                  if (import.meta.env.DEV && errs.length) console.debug("[openui]", errs);
                }}
              />
            </div>
          ),
        )}
      </div>
    </RefsContext.Provider>
  );
});
