// Reconnecting admin WebSocket. Subscribes once per session, redispatches
// inbound events to anyone who registered a listener via `onWsEvent(event, fn)`.
//
// The protocol: we connect to `${WS_URL}/admin?token=<jwt>`. The backend
// resolves the user from the token and then publishes envelope objects of the
// shape `{ event: "anomaly_detected", ...payload }` to that user's channels.

type Listener = (payload: Record<string, unknown>) => void;

class AdminWS {
  private url: string | null = null;
  private socket: WebSocket | null = null;
  private listeners = new Map<string, Set<Listener>>();
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private currentToken: string | null = null;
  private explicitlyClosed = false;

  connect(token: string) {
    if (this.socket && this.currentToken === token) return;
    this.disconnect();
    this.currentToken = token;
    this.explicitlyClosed = false;

    const base = (import.meta.env.VITE_WS_URL as string) || "/ws";
    // VITE_WS_URL might be relative ("/ws"); resolve against the page origin.
    const resolved = base.startsWith("ws") ? base : `${location.origin.replace(/^http/, "ws")}${base}`;
    this.url = `${resolved}/admin?token=${encodeURIComponent(token)}`;
    this._open();
  }

  private _open() {
    if (!this.url) return;
    try {
      this.socket = new WebSocket(this.url);
    } catch {
      this._scheduleReconnect();
      return;
    }
    this.socket.onmessage = (e) => this._onMessage(e.data);
    this.socket.onclose = () => {
      this.socket = null;
      if (!this.explicitlyClosed) this._scheduleReconnect();
    };
    this.socket.onerror = () => {
      // The 'close' handler will pick this up.
    };
  }

  private _onMessage(raw: unknown) {
    try {
      const msg = typeof raw === "string" ? JSON.parse(raw) : null;
      if (!msg || typeof msg !== "object") return;
      const event = (msg as { event?: string }).event;
      if (!event) return;
      const subscribers = this.listeners.get(event);
      if (subscribers) {
        for (const fn of subscribers) fn(msg as Record<string, unknown>);
      }
      const wildcards = this.listeners.get("*");
      if (wildcards) for (const fn of wildcards) fn(msg as Record<string, unknown>);
    } catch {
      // Ignore malformed frames; the server should never send them but if it
      // does, dropping is the right move for a UI client.
    }
  }

  private _scheduleReconnect() {
    if (this.reconnectTimer) return;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this._open();
    }, 3000);
  }

  on(event: string, fn: Listener): () => void {
    let set = this.listeners.get(event);
    if (!set) {
      set = new Set();
      this.listeners.set(event, set);
    }
    set.add(fn);
    return () => set?.delete(fn);
  }

  disconnect() {
    this.explicitlyClosed = true;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.socket) {
      try {
        this.socket.close();
      } catch {
        // The socket may already be closing — nothing to do.
      }
      this.socket = null;
    }
    this.currentToken = null;
  }
}

export const adminWS = new AdminWS();
