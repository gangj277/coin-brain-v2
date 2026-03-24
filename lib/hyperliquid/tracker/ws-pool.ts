import WebSocket from "ws";
import type { ClearinghouseState } from "../types";
import type { TrackerConfig } from "./types";
import { PositionStore } from "./store";
import { TrackerEventBus } from "./events";

const WS_URL = "wss://api.hyperliquid.xyz/ws";

interface WsConnection {
  id: number;
  ws: WebSocket | null;
  addresses: string[];
  connected: boolean;
  reconnectAttempts: number;
  reconnectTimer: ReturnType<typeof setTimeout> | null;
}

export class WebSocketPool {
  private connections: WsConnection[] = [];
  private store: PositionStore;
  private events: TrackerEventBus;
  private config: TrackerConfig;
  private running = false;

  constructor(store: PositionStore, events: TrackerEventBus, config: TrackerConfig) {
    this.store = store;
    this.events = events;
    this.config = config;
  }

  start(addresses: string[]) {
    this.running = true;

    // Distribute addresses across connections
    const perConn = this.config.wsSubscriptionsPerConn;
    const connCount = Math.ceil(addresses.length / perConn);

    for (let i = 0; i < connCount; i++) {
      const batch = addresses.slice(i * perConn, (i + 1) * perConn);
      const conn: WsConnection = {
        id: i,
        ws: null,
        addresses: batch,
        connected: false,
        reconnectAttempts: 0,
        reconnectTimer: null,
      };
      this.connections.push(conn);
      this.connect(conn);
    }

    console.log(
      `[WS Pool] Started ${connCount} connections for ${addresses.length} traders`
    );
  }

  stop() {
    this.running = false;
    for (const conn of this.connections) {
      if (conn.reconnectTimer) clearTimeout(conn.reconnectTimer);
      if (conn.ws) {
        conn.ws.removeAllListeners();
        conn.ws.close();
      }
    }
    this.connections = [];
  }

  getConnectedCount(): number {
    return this.connections.filter((c) => c.connected).length;
  }

  getTotalCount(): number {
    return this.connections.length;
  }

  // ─── Connection Lifecycle ──────────────────────────

  private connect(conn: WsConnection) {
    if (!this.running) return;

    const ws = new WebSocket(WS_URL);
    conn.ws = ws;

    ws.on("open", () => {
      conn.connected = true;
      conn.reconnectAttempts = 0;
      this.events.emit("ws:connected", conn.id);

      // Subscribe to clearinghouseState for each address
      for (const addr of conn.addresses) {
        ws.send(
          JSON.stringify({
            method: "subscribe",
            subscription: { type: "clearinghouseState", user: addr },
          })
        );
      }

      console.log(
        `[WS ${conn.id}] Connected, subscribed to ${conn.addresses.length} traders`
      );
    });

    ws.on("message", (raw: Buffer) => {
      try {
        const msg = JSON.parse(raw.toString());
        this.handleMessage(conn, msg);
      } catch {
        // ignore malformed messages
      }
    });

    ws.on("close", () => {
      conn.connected = false;
      this.events.emit("ws:disconnected", conn.id);
      console.log(`[WS ${conn.id}] Disconnected`);
      this.scheduleReconnect(conn);
    });

    ws.on("error", (err: Error) => {
      console.error(`[WS ${conn.id}] Error: ${err.message}`);
      // close handler will trigger reconnect
    });
  }

  private handleMessage(
    conn: WsConnection,
    msg: { channel?: string; data?: Record<string, unknown> }
  ) {
    if (msg.channel !== "clearinghouseState") return;

    const data = msg.data as {
      user?: string;
      clearinghouseState?: ClearinghouseState;
    } | undefined;
    if (!data?.user || !data?.clearinghouseState) return;

    const address = data.user.toLowerCase();
    const state = data.clearinghouseState;

    const changes = this.store.updateState(address, state);
    for (const change of changes) {
      this.events.emit("position:change", change);
      if (change.type === "position_opened") {
        this.events.emit("position:opened", change);
      } else if (change.type === "position_closed") {
        this.events.emit("position:closed", change);
      }
    }
  }

  private scheduleReconnect(conn: WsConnection) {
    if (!this.running) return;
    if (conn.reconnectAttempts >= this.config.wsMaxReconnectAttempts) {
      console.error(
        `[WS ${conn.id}] Max reconnect attempts reached. Giving up.`
      );
      this.events.emit(
        "tracker:error",
        new Error(`WS connection ${conn.id} failed permanently`)
      );
      return;
    }

    const delay =
      this.config.wsReconnectDelayMs *
      Math.min(Math.pow(2, conn.reconnectAttempts), 60); // exp backoff, max 60x

    conn.reconnectAttempts++;
    console.log(
      `[WS ${conn.id}] Reconnecting in ${(delay / 1000).toFixed(1)}s (attempt ${conn.reconnectAttempts})`
    );

    conn.reconnectTimer = setTimeout(() => {
      if (conn.ws) {
        conn.ws.removeAllListeners();
        conn.ws.terminate();
      }
      this.connect(conn);
    }, delay);
  }
}
