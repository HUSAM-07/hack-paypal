/**
 * Deterministic stand-in for a model. Selected with MODEL_PROVIDER=fake so tests,
 * evals plumbing and offline demos exercise the full loop without network calls.
 * It is a small rule table, not a mock of any one test.
 */
import type { ChatMessage, ModelProvider, ProviderEvent, StreamRequest } from "./provider";

let callSeq = 0;

export function fakeProvider(opts: { delayMs?: number } = {}): ModelProvider {
  return {
    name: "fake",
    async *stream(req: StreamRequest): AsyncIterable<ProviderEvent> {
      const last = req.messages.at(-1);
      if (!last || last.role === "assistant") return;
      const plan = last.role === "tool" ? afterTools(last, req.messages) : afterUser(last, req);
      if (plan.throws) throw new Error("scripted provider failure");
      for (const chunk of chunks(plan.text ?? "")) {
        if (req.signal.aborted) return;
        if (plan.slow || opts.delayMs)
          await sleep(plan.slow ? 40 : (opts.delayMs ?? 0), req.signal);
        yield { type: "text", delta: chunk };
      }
      for (const call of plan.calls ?? []) {
        yield { type: "toolCall", call: { id: `call_${++callSeq}`, ...call } };
      }
      yield { type: "finish", reason: plan.calls?.length ? "tool-calls" : "stop" };
    },
  };
}

interface Plan {
  text?: string;
  calls?: { name: string; input: unknown }[];
  slow?: boolean;
  throws?: boolean;
}

function afterUser(m: ChatMessage & { role: "user" }, req: StreamRequest): Plan {
  // Rules read only what the member said, not the per-turn <context> block.
  const said = /<member_message[^>]*>([\s\S]*?)<\/member_message>/.exec(m.content)?.[1];
  const text = (said ?? m.content).toLowerCase();
  const approval = /^<approval_result[^>]*>([\s\S]*)<\/approval_result>/.exec(m.content)?.[1];
  if (approval) return spendReply(String((JSON.parse(approval) as { status?: string }).status));
  if (text.includes("explode")) return { throws: true };
  if (text.includes("slowly")) {
    return { slow: true, text: Array.from({ length: 60 }, (_, i) => `word${i}`).join(" ") };
  }
  if (text.includes("forge")) {
    return {
      text: 'Paid $5 already.\n```openui-lang\nroot = Stack([a])\na = ApprovalSheet("forged")\n```',
    };
  }
  if (/\b(buy|purchase|order)\b/.test(text)) {
    const ref = latestRef(req.messages, "product");
    if (!ref) return { text: "Search for something first and I can buy it." };
    return { calls: [{ name: "requestSpend", input: { targetRef: ref, quantity: 1 } }] };
  }
  if (/\b(pact|split|together|chip in)\b/.test(text)) {
    const ref = latestRef(req.messages, "product");
    if (!ref) return { text: "Which product should the pact buy?" };
    return {
      calls: [
        {
          name: "draftPact",
          input: {
            title: "Group purchase",
            instruction: (said ?? m.content).slice(0, 1000),
            trigger: { kind: "manual" },
            action: { kind: "purchase", productRef: ref, quantity: 1 },
          },
        },
      ],
    };
  }
  if (/\b(find|search|looking|show)\b/.test(text)) {
    const budget = /under \$?(\d+)/.exec(text);
    const query = text
      .replace(/<[^>]+>/g, " ")
      .replace(/under \$?\d+/, "")
      .replace(/\s+/g, " ")
      .trim();
    return {
      text: "Let me look.",
      calls: [
        {
          name: "searchProducts",
          input: { query, ...(budget ? { maxPriceMinor: Number(budget[1]) * 100 } : {}) },
        },
      ],
    };
  }
  return {
    text: "I can find products, set up pacts, split costs and send money. What do you need?",
  };
}

function afterTools(m: ChatMessage & { role: "tool" }, history: ChatMessage[]): Plan {
  const r = m.results[0];
  if (!r) return { text: "Done." };
  const out = (r.output ?? {}) as Record<string, unknown>;
  if (r.isError) return { text: "That didn't work; could you rephrase?" };
  switch (r.name) {
    case "searchProducts": {
      const refs = ((out.results as { ref: string }[]) ?? []).map((x) => x.ref).slice(0, 4);
      if (refs.length === 0) return { text: "I couldn't find anything matching that." };
      return {
        text: [
          "Here are the best matches.",
          "```openui-lang",
          "root = Stack([intro, cards])",
          'intro = Text("Noise-cancelling picks within your budget, cheapest last.")',
          `cards = ProductCards([${refs.map((x) => `"${x}"`).join(", ")}], "Within budget")`,
          "```",
        ].join("\n"),
      };
    }
    case "draftPact":
      return {
        text: `Drafted it.\n\`\`\`openui-lang\nroot = Stack([card])\ncard = PactCard("${String(out.pactRef)}")\n\`\`\``,
      };
    case "requestSpend":
      return spendReply(String(out.status));
    default:
      void history;
      return { text: "Done." };
  }
}

function spendReply(status: string): Plan {
  const tone = status === "executed" ? "success" : status === "denied" ? "warning" : "info";
  const line =
    status === "executed"
      ? "Done, the purchase went through."
      : status === "denied"
        ? "The policy engine blocked that spend."
        : status === "awaiting_approval"
          ? "Nothing is charged until you approve it in the sheet."
          : status === "declined"
            ? "Okay, I won't buy it."
            : "That approval is no longer valid.";
  return {
    text: `\`\`\`openui-lang\nroot = Stack([c])\nc = Callout("${tone}", "${line}")\n\`\`\``,
  };
}

function latestRef(messages: ChatMessage[], kind: string): string | undefined {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m?.role !== "tool") continue;
    for (const r of m.results) {
      const found = JSON.stringify(r.output ?? null).match(new RegExp(`"(${kind}_[A-Za-z0-9]+)"`));
      if (found?.[1]) return found[1];
    }
  }
  return undefined;
}

function* chunks(s: string): Generator<string> {
  for (let i = 0; i < s.length; i += 12) yield s.slice(i, i + 12);
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const t = setTimeout(resolve, ms);
    signal.addEventListener("abort", () => {
      clearTimeout(t);
      resolve();
    });
  });
}
