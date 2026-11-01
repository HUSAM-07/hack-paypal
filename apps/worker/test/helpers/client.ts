import { SELF } from "cloudflare:test";

export const BASE = "http://localhost:8787";

export interface Frame {
  id?: string | number | null;
  method?: string;
  seq?: number;
  params?: Record<string, unknown> & { item?: Record<string, unknown> };
  result?: Record<string, unknown>;
  error?: { code: number; message: string };
}

export async function api(
  path: string,
  init: RequestInit & { cookie?: string } = {},
): Promise<Response> {
  const headers = new Headers(init.headers);
  if (init.cookie) headers.set("Cookie", init.cookie);
  if (init.body && !headers.has("content-type")) headers.set("content-type", "application/json");
  return SELF.fetch(`${BASE}${path}`, { ...init, headers });
}

export function cookieFrom(res: Response, name: string): string {
  for (const c of res.headers.getSetCookie()) {
    if (c.startsWith(`${name}=`)) return c.split(";")[0] as string;
  }
  throw new Error(`no ${name} cookie`);
}

export async function devLogin(
  username: string,
  displayName?: string,
): Promise<{ cookie: string; userId: string }> {
  const res = await api("/api/auth/dev-login", {
    method: "POST",
    body: JSON.stringify({ username, ...(displayName ? { displayName } : {}) }),
  });
  if (!res.ok) throw new Error(`dev-login failed: ${res.status}`);
  const { userId } = (await res.json()) as { userId: string };
  return { cookie: cookieFrom(res, "pact_session"), userId };
}

/** A scripted protocol client over a real WebSocket into the worker. */
export class TestClient {
  readonly frames: Frame[] = [];
  private nextId = 1;
  private listeners = new Set<() => void>();

  private constructor(readonly ws: WebSocket) {
    ws.addEventListener("message", (ev) => {
      this.frames.push(JSON.parse(ev.data as string) as Frame);
      for (const l of this.listeners) l();
    });
  }

  static async connect(cookie: string, thread = "new"): Promise<TestClient> {
    const res = await SELF.fetch(`${BASE}/ws?thread=${thread}`, {
      headers: { Upgrade: "websocket", Cookie: cookie },
    });
    if (!res.webSocket) throw new Error(`upgrade failed: ${res.status}`);
    res.webSocket.accept();
    return new TestClient(res.webSocket);
  }

  /** Initialize, then start a thread (default) or resume one. */
  static async open(cookie: string, opts: { memberIds?: string[]; title?: string } = {}) {
    const c = await TestClient.connect(cookie);
    await c.call("initialize", { clientInfo: { name: "test", version: "0" }, protocolVersion: 1 });
    const res = await c.call("thread/start", {
      title: opts.title ?? "test",
      memberIds: opts.memberIds ?? [],
    });
    return { client: c, threadId: (res.thread as { id: string }).id };
  }

  send(raw: string): void {
    this.ws.send(raw);
  }

  async request(method: string, params?: unknown): Promise<Frame> {
    const id = this.nextId++;
    this.ws.send(JSON.stringify({ id, method, ...(params === undefined ? {} : { params }) }));
    return this.waitFor((f) => f.id === id);
  }

  /** Request that must succeed; returns the result. */
  async call(method: string, params?: unknown): Promise<Record<string, unknown>> {
    const f = await this.request(method, params);
    if (f.error) throw new Error(`${method} failed: ${f.error.code} ${f.error.message}`);
    return f.result as Record<string, unknown>;
  }

  waitFor(pred: (f: Frame) => boolean, timeoutMs = 5000, from = 0): Promise<Frame> {
    return new Promise((resolve, reject) => {
      const check = () => {
        const hit = this.frames.slice(from).find(pred);
        if (hit) {
          this.listeners.delete(check);
          clearTimeout(timer);
          resolve(hit);
        }
      };
      const timer = setTimeout(() => {
        this.listeners.delete(check);
        reject(new Error(`timed out; last frames: ${JSON.stringify(this.frames.slice(-5))}`));
      }, timeoutMs);
      this.listeners.add(check);
      check();
    });
  }

  /** Wait for the n-th turn/completed (1-based) observed on this socket. */
  async turnCompleted(n = 1, timeoutMs = 5000): Promise<Frame> {
    await this.waitFor(() => this.notifications("turn/completed").length >= n, timeoutMs);
    return this.notifications("turn/completed")[n - 1] as Frame;
  }

  notifications(method?: string): Frame[] {
    return this.frames.filter(
      (f) => f.method !== undefined && (method === undefined || f.method === method),
    );
  }

  items(type?: string, method = "item/completed"): Record<string, unknown>[] {
    return this.notifications(method)
      .map((f) => f.params?.item as Record<string, unknown>)
      .filter((i) => type === undefined || i.type === type);
  }

  close(): void {
    this.ws.close(1000, "done");
  }
}
