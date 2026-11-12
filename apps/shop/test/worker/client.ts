import { env } from "cloudflare:workers";
import { createRpcPeer, type RpcPeer, type ServerRequestHandlers } from "@shop/agent-protocol";
import { getAgentByName } from "agents";
import type { ShopEnv } from "../../src/agent";

export type Frame = {
  id?: unknown;
  method?: string;
  seq?: number;
  params?: unknown;
  result?: unknown;
  error?: { code: number; message: string };
};

const shopEnv = env as unknown as ShopEnv;

/** A protocol client over a real WebSocket into the user's ShopperAgent. */
export class TestClient {
  readonly frames: Frame[] = [];
  readonly peer: RpcPeer;
  private waiters: { pred: (f: Frame) => boolean; resolve: (f: Frame) => void }[] = [];

  private constructor(
    private readonly ws: WebSocket,
    serverRequests: ServerRequestHandlers,
  ) {
    this.peer = createRpcPeer({ send: (f) => ws.send(f), serverRequests, timeoutMs: 10_000 });
    ws.addEventListener("message", (e) => {
      const frame = JSON.parse(String(e.data)) as Frame;
      this.frames.push(frame);
      this.peer.receive(frame);
      this.waiters = this.waiters.filter((w) => {
        if (!w.pred(frame)) return true;
        w.resolve(frame);
        return false;
      });
    });
  }

  static async connect(
    userId: string,
    serverRequests: ServerRequestHandlers = {},
  ): Promise<TestClient> {
    const agent = await getAgentByName(shopEnv.SHOPPER_AGENT, userId);
    const res = await agent.fetch("https://shop.test/api/shop/ws", {
      headers: { Upgrade: "websocket" },
    });
    if (!res.webSocket) throw new Error(`upgrade failed: ${res.status}`);
    res.webSocket.accept();
    return new TestClient(res.webSocket, serverRequests);
  }

  static async open(userId: string, serverRequests: ServerRequestHandlers = {}) {
    const c = await TestClient.connect(userId, serverRequests);
    await c.peer.request("initialize", {
      clientInfo: { name: "test", version: "0" },
      protocolVersion: 1,
    });
    return c;
  }

  sendRaw(frame: unknown) {
    this.ws.send(typeof frame === "string" ? frame : JSON.stringify(frame));
  }

  /** Resolves with the first frame (already received or future) matching `pred`. */
  waitFor(pred: (f: Frame) => boolean, timeoutMs = 8000): Promise<Frame> {
    const seen = this.frames.find(pred);
    if (seen) return Promise.resolve(seen);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("timed out waiting for frame")), timeoutMs);
      this.waiters.push({
        pred,
        resolve: (f) => {
          clearTimeout(timer);
          resolve(f);
        },
      });
    });
  }

  turnCompleted(turnId: string) {
    return this.waitFor(
      (f) =>
        f.method === "turn/completed" && (f.params as { turn: { id: string } }).turn.id === turnId,
    );
  }

  close() {
    this.peer.dispose("closed");
    this.ws.close();
  }
}
