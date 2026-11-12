/**
 * A message pipe for JSON-RPC lite frames. The client owns reconnects; a transport is one
 * connection attempt. `close` reports whether the server refused us (sign-in needed).
 */
export type TransportHandlers = {
  onOpen: () => void;
  onMessage: (frame: unknown) => void;
  onClose: (info: { unauthorized: boolean; reason?: string | undefined }) => void;
};

export type Transport = {
  send: (frame: unknown) => void;
  close: () => void;
};

export type Connect = (handlers: TransportHandlers) => Transport;

/** True only when the page's origin says there is no session (`/api/session`). */
async function signedOut(socketUrl: URL): Promise<boolean> {
  const origin = `${socketUrl.protocol === "wss:" ? "https:" : "http:"}//${socketUrl.host}`;
  const res = await fetch(`${origin}/api/session`, { credentials: "same-origin" });
  if (!res.ok) return false;
  const body = (await res.json()) as { signedIn?: boolean };
  return body.signedIn === false;
}

/** WebSocket transport. Relative URLs ("/api/shop/ws") resolve against the page origin. */
export function webSocketTransport(url: string): Connect {
  return (h) => {
    const abs = new URL(url, window.location.href);
    if (abs.protocol === "http:") abs.protocol = "ws:";
    if (abs.protocol === "https:") abs.protocol = "wss:";
    const ws = new WebSocket(abs.toString());
    let opened = false;
    ws.addEventListener("open", () => {
      opened = true;
      h.onOpen();
    });
    ws.addEventListener("message", (e) => {
      if (typeof e.data !== "string") return;
      try {
        h.onMessage(JSON.parse(e.data));
      } catch {
        // A frame that isn't JSON is dropped; the protocol has no way to answer it.
      }
    });
    ws.addEventListener("close", (e) => {
      // 4401 is our "sign in first" close code. A refused upgrade (the server answers a
      // signed-out visitor with a plain 401) never opens and only reports 1006, so ask the
      // session endpoint whether that was the reason before showing "offline".
      const reason = e.reason || (opened ? undefined : "refused");
      if (e.code === 4401 || e.code === 4403) return h.onClose({ unauthorized: true, reason });
      if (opened) return h.onClose({ unauthorized: false, reason });
      signedOut(abs).then(
        (out) => h.onClose({ unauthorized: out, reason }),
        () => h.onClose({ unauthorized: false, reason }),
      );
    });
    return {
      send: (frame) => {
        if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(frame));
      },
      close: () => ws.close(1000, "client closed"),
    };
  };
}
