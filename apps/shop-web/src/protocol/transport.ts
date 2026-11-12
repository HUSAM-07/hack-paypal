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
      // 4401 is our "sign in first" close code; a refused upgrade never opens at all.
      h.onClose({
        unauthorized: e.code === 4401 || e.code === 4403,
        reason: e.reason || (opened ? undefined : "refused"),
      });
    });
    return {
      send: (frame) => {
        if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(frame));
      },
      close: () => ws.close(1000, "client closed"),
    };
  };
}
