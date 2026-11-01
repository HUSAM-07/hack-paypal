/**
 * Scripted protocol client for a running worker (`npm run dev -w @pact/worker`).
 *
 *   node apps/worker/scripts/demo-client.ts [http://localhost:8790]
 *
 * Signs in with the DEV_AUTH test login, starts a thread, asks for headphones, then asks
 * to buy the cheapest one and approves the resulting approvalRequest.
 */
const base = process.argv[2] ?? "http://localhost:8790";

// biome-ignore lint/suspicious/noExplicitAny: a throwaway client reads loosely typed frames
type Loose = Record<string, any>;
type Frame = {
  id?: number;
  method?: string;
  seq?: number;
  params?: Loose;
  result?: Loose;
  error?: { code: number; message: string };
};

const login = await fetch(`${base}/api/auth/dev-login`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ username: `demo-${Date.now().toString(36)}`, displayName: "Demo" }),
});
if (!login.ok) throw new Error(`dev-login failed (${login.status}); is DEV_AUTH=1 in .dev.vars?`);
const cookie = (login.headers.getSetCookie()[0] ?? "").split(";")[0];

// Node's WebSocket (undici) accepts headers as a non-standard init option.
const ws = new WebSocket(`${base.replace(/^http/, "ws")}/ws?thread=new`, {
  headers: { Cookie: cookie },
} as never);
const frames: Frame[] = [];
const waiters: (() => void)[] = [];
ws.addEventListener("message", (ev) => {
  const f = JSON.parse(String(ev.data)) as Frame;
  frames.push(f);
  log(f);
  for (const w of waiters.splice(0)) w();
});
await new Promise((resolve, reject) => {
  ws.addEventListener("open", resolve);
  ws.addEventListener("error", reject);
});

let nextId = 1;
async function call(method: string, params: unknown): Promise<Loose> {
  const id = nextId++;
  ws.send(JSON.stringify({ id, method, params }));
  const f = await until((x) => x.id === id);
  if (f.error) throw new Error(`${method}: ${f.error.message}`);
  return f.result ?? {};
}

function until(pred: (f: Frame) => boolean, from = 0, timeoutMs = 120_000): Promise<Frame> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("timeout")), timeoutMs);
    const check = () => {
      const hit = frames.slice(from).find(pred);
      if (hit) {
        clearTimeout(timer);
        resolve(hit);
      } else waiters.push(check);
    };
    check();
  });
}

function log(f: Frame): void {
  if (f.method === "item/agentMessage/delta")
    return void process.stdout.write(f.params?.delta ?? "");
  if (f.method === "item/completed") {
    const i = f.params?.item ?? {};
    const extra =
      i.type === "agentMessage"
        ? ` refs=${Object.keys(i.refs ?? {}).join(",")} diagnostics=${JSON.stringify(i.diagnostics)}`
        : i.type === "toolCall"
          ? ` ${i.name} → ${i.status}${i.error ? ` (${i.error})` : ""}`
          : i.type === "approvalRequest"
            ? ` decision=${i.decision}`
            : i.type === "paymentEvent"
              ? ` ${i.kind} ${JSON.stringify(i.amount)} ${i.paypalRef}`
              : "";
    console.log(`\n[${f.seq}] item/completed ${i.type}${extra}`);
    return;
  }
  if (f.method)
    console.log(`\n[${f.seq ?? "-"}] ${f.method} ${JSON.stringify(f.params).slice(0, 160)}`);
}

await call("initialize", { clientInfo: { name: "demo-client", version: "0" }, protocolVersion: 1 });
const { thread } = await call("thread/start", { title: "Demo" });

const mark1 = frames.length;
await call("turn/start", {
  threadId: thread.id,
  text: "find me noise-cancelling headphones under $300",
});
await until((f) => f.method === "turn/completed", mark1);

const mark2 = frames.length;
await call("turn/start", { threadId: thread.id, text: "buy the cheapest one for me" });
const end = await until((f) => f.method === "turn/completed", mark2);
if (end.params?.status === "awaitingApproval") {
  const approval = frames
    .slice(mark2)
    .find((f) => f.method === "item/started" && f.params?.item?.type === "approvalRequest")
    ?.params?.item;
  console.log(`\n>>> approving ${approval.approvalId} (stepUp=${approval.stepUp})`);
  const mark3 = frames.length;
  await call("approval/respond", {
    threadId: thread.id,
    approvalId: approval.approvalId,
    decision: "approve",
  });
  await until((f) => f.method === "turn/completed", mark3);
}
console.log("\ndone");
ws.close();

export {};
