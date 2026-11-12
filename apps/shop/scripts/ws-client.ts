/**
 * Talk to a running shop App Server over the WebSocket protocol:
 *   npm run dev -w @shop/server            (terminal 1)
 *   npm run client -w @shop/server -- [url] (terminal 2)
 * Runs a search turn, then a purchase that pauses on an approval which this client approves,
 * then reconnects and resumes the thread from seq 0 to show replay.
 */
import { createRpcPeer, type Item, type RpcPeer, type Turn } from "@shop/agent-protocol";

const url = process.argv[2] ?? "ws://localhost:8810/api/shop/ws";

async function connect(
  onFrame: (f: Record<string, unknown>) => void,
): Promise<{ peer: RpcPeer; ws: WebSocket }> {
  const ws = new WebSocket(url);
  await new Promise<void>((resolve, reject) => {
    ws.addEventListener("open", () => resolve(), { once: true });
    ws.addEventListener("error", () => reject(new Error(`cannot connect to ${url}`)), {
      once: true,
    });
  });
  const peer = createRpcPeer({
    send: (f) => ws.send(f),
    serverRequests: {
      "approval/request": ({ item }) => {
        console.log(`  ⏸  approval/request: ${item.title} (${item.kind}) → approving`);
        return { decision: "approve" };
      },
    },
  });
  ws.addEventListener("message", (e) => {
    const frame = JSON.parse(String(e.data)) as Record<string, unknown>;
    onFrame(frame);
    peer.receive(frame);
  });
  await peer.request("initialize", {
    clientInfo: { name: "shop_ws_client", version: "0.1.0" },
    protocolVersion: 1,
  });
  return { peer, ws };
}

function printer() {
  let streaming = false;
  return (f: Record<string, unknown>) => {
    const p = f.params as Record<string, unknown> | undefined;
    switch (f.method) {
      case "item/agentMessage/delta":
        if (!streaming) process.stdout.write("  🤖 ");
        streaming = true;
        process.stdout.write(String(p?.delta));
        return;
      case "item/started": {
        const item = p?.item as Item;
        if (item.type === "toolCall") console.log(`  🔧 ${item.name}: ${item.summary}`);
        return;
      }
      case "item/completed": {
        const item = p?.item as Item;
        if (item.type === "agentMessage" && streaming) {
          process.stdout.write("\n");
          streaming = false;
        }
        if (item.type === "toolCall")
          console.log(
            `  ✅ ${item.name} ${item.status}: ${JSON.stringify(item.result ?? item.error).slice(0, 140)}`,
          );
        if (item.type === "reasoning") console.log(`  💭 ${item.summary}`);
        return;
      }
      case "turn/updated":
      case "turn/completed":
        console.log(`  ${f.method} → ${(p?.turn as Turn | undefined)?.status} (seq ${f.seq})`);
        return;
      case "state/snapshot":
        console.log(`  state/snapshot v${p?.version}`);
        return;
      case "inbox/added":
        console.log(`  📥 ${p?.title}`);
        return;
    }
  };
}

async function runTurn(peer: RpcPeer, threadId: string, text: string) {
  console.log(`\n👤 ${text}`);
  const done = new Promise<Turn>((resolve) => {
    const off = peer.on("turn/completed", ({ turn }) => {
      off();
      resolve(turn);
    });
  });
  await peer.request("turn/start", { threadId, text });
  return done;
}

const first = await connect(printer());
const { thread } = await first.peer.request("thread/start", { title: "WS client demo" });
console.log(`thread ${thread.id}`);
const search = await runTurn(first.peer, thread.id, "find noise cancelling headphones");
const buy = await runTurn(first.peer, thread.id, "buy the Sony headphones");
first.ws.close();

let replayed = 0;
const second = await connect((f) => {
  if (typeof f.seq === "number") replayed++;
});
const resumed = await second.peer.request("thread/resume", { threadId: thread.id, afterSeq: 0 });
await new Promise((r) => setTimeout(r, 300));
second.ws.close();

console.log(`\nreconnected: replayed ${replayed} events, lastSeq ${resumed.lastSeq}`);
const ok = search.status === "completed" && buy.status === "completed" && replayed > 0;
console.log(ok ? "OK: search, approval and resume all worked" : "FAILED");
process.exit(ok ? 0 : 1);
