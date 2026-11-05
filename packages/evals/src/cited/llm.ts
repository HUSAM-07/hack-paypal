/** Minimal OpenAI-compatible chat call. Reads LLM_BASE_URL and LLM_API_KEY; never logs them. */
export interface ToolCall {
  name: string;
  args: Record<string, unknown>;
}

export interface ChatOutcome {
  call?: ToolCall;
  text?: string;
  error?: string;
}

export async function chatWithTools(opts: {
  model: string;
  system: string;
  user: string;
  tools: unknown[];
  temperature: number;
}): Promise<ChatOutcome> {
  const base = process.env.LLM_BASE_URL?.replace(/\/$/, "");
  const key = process.env.LLM_API_KEY;
  if (!base || !key) throw new Error("LLM_BASE_URL and LLM_API_KEY must be set");
  try {
    const res = await fetch(`${base}/v1/chat/completions`, {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: opts.model,
        messages: [
          { role: "system", content: opts.system },
          { role: "user", content: opts.user },
        ],
        temperature: opts.temperature,
        max_tokens: 4000,
        tools: opts.tools,
        tool_choice: "auto",
      }),
      signal: AbortSignal.timeout(300_000),
    });
    if (!res.ok) return { error: `http ${res.status}` };
    const json = (await res.json()) as {
      choices?: Array<{
        message?: {
          content?: string | null;
          tool_calls?: Array<{ function: { name: string; arguments: string } }>;
        };
      }>;
    };
    const msg = json.choices?.[0]?.message;
    const tc = msg?.tool_calls?.[0];
    if (tc) {
      try {
        return { call: { name: tc.function.name, args: JSON.parse(tc.function.arguments) } };
      } catch {
        return { error: "bad tool arguments" };
      }
    }
    return { text: (msg?.content ?? "").slice(0, 300) };
  } catch (e) {
    return { error: e instanceof Error ? e.message.slice(0, 120) : "request failed" };
  }
}
