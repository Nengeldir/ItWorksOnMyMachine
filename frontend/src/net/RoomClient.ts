import { ApiError, type Joined, type RoomInfo, type Snapshot, request } from "../api";
import type { NetState } from "../game/Game";
import type { GhostData } from "../game/ghost";
import { ServerClock } from "./clock";

export type ConnectionStatus = "connecting" | "connected" | "reconnecting" | "failed";

export interface RoomHandlers {
  joined(id: string): void;
  room(info: RoomInfo): void;
  snapshot(snapshot: Snapshot): void;
  status(status: ConnectionStatus, message?: string): void;
}

export interface Identity {
  clientId: string;
  nickname: string;
  /** Creating the room: fly this map (picked in the map select); an existing room keeps its own */
  seed?: number;
}

/**
 * One player's connection to a race room, over plain HTTP:
 * an SSE stream brings room events and position snapshots down,
 * and small POSTs carry your own position up ~15 times a second.
 */
export class RoomClient {
  readonly code: string;
  readonly clock = new ServerClock();
  private readonly identity: Identity;
  private readonly handlers: RoomHandlers;
  private token = "";
  private source: EventSource | null = null;
  private sending = false;
  private closed = false;
  private rejoinTimer = 0;

  constructor(code: string, identity: Identity, handlers: RoomHandlers) {
    this.code = code;
    this.identity = identity;
    this.handlers = handlers;
  }

  private url(action: string): string {
    return `/api/rooms/${encodeURIComponent(this.code)}/${action}`;
  }

  async connect() {
    this.handlers.status("connecting");
    // Closing the tab or reloading: say goodbye, so you don't linger in the room
    window.addEventListener("pagehide", this.onPageHide);
    await this.clock.sync();
    await this.join();
  }

  private onPageHide = () => this.close();

  private async join() {
    if (this.closed) return;
    let joined: Joined;
    try {
      joined = await request<Joined>(this.url("join"), "POST", {
        client_id: this.identity.clientId,
        nickname: this.identity.nickname,
        seed: this.identity.seed,
      });
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) {
        this.handlers.status("failed", e.message); // room is full
      } else {
        this.handlers.status("reconnecting", "Can't reach the server, retrying…");
        this.scheduleRejoin(2000);
      }
      return;
    }
    if (this.closed) return;
    this.token = joined.token;
    try {
      this.handlers.joined(joined.id);
      this.handlers.room(joined.room);
    } catch (e) {
      // Not a network problem (e.g. no WebGL): rejoining wouldn't help
      console.error(e);
      this.handlers.status("failed", `The game couldn't start: ${(e as Error).message}`);
      this.close();
      return;
    }
    this.openStream();
  }

  private scheduleRejoin(delay: number) {
    if (this.closed || this.rejoinTimer) return;
    this.token = "";
    this.source?.close();
    this.rejoinTimer = window.setTimeout(() => {
      this.rejoinTimer = 0;
      void this.join();
    }, delay);
  }

  private openStream() {
    this.source?.close();
    const source = new EventSource(`${this.url("stream")}?token=${encodeURIComponent(this.token)}`);
    this.source = source;
    source.onopen = () => this.handlers.status("connected");
    source.onmessage = (event) => {
      const message = JSON.parse(event.data) as RoomInfo | Snapshot;
      if (message.type === "room") this.handlers.room(message);
      else if (message.type === "snap") this.handlers.snapshot(message);
    };
    source.onerror = () => {
      if (source !== this.source) return;
      this.handlers.status("reconnecting", "Connection lost, reconnecting…");
      // CLOSED means the server refused us (e.g. it restarted and forgot us): join again.
      // Otherwise the browser reconnects the stream by itself.
      if (source.readyState === EventSource.CLOSED) this.scheduleRejoin(1000);
    };
  }

  /** Fire and forget; skipped while the previous one is still on its way */
  sendState(state: NetState) {
    if (!this.token || this.sending || this.closed) return;
    this.sending = true;
    const token = this.token;
    fetch(this.url("state"), {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Flight-Rules": "speed-control-v3" },
      body: JSON.stringify({ token, t: Math.round(this.clock.now()), ...state }),
    })
      .then((response) => {
        // Only if we haven't rejoined since this was sent
        if (response.status === 404 && token === this.token) this.scheduleRejoin(500);
      })
      .catch(() => {})
      .finally(() => {
        this.sending = false;
      });
  }

  start(): Promise<void> {
    return request(this.url("start"), "POST", { token: this.token });
  }

  /** Host only: call the race off and put everyone back on the start line */
  restart(): Promise<void> {
    return request(this.url("restart"), "POST", { token: this.token });
  }

  /** Another map: the one picked in the map select, or (without a seed) a random one */
  newMap(seed?: number): Promise<void> {
    return request(this.url("map"), "POST", { token: this.token, seed });
  }

  /** `gates`: the course's gates, one XP each on the finisher's profile */
  finish(timeMs: number, ghost: GhostData, gates = 0): Promise<{ place: number; personal_best_ms: number; xp?: number }> {
    return request(this.url("finish"), "POST", { token: this.token, time_ms: timeMs, ghost, gates });
  }

  close() {
    if (this.closed) return;
    this.closed = true;
    window.removeEventListener("pagehide", this.onPageHide);
    window.clearTimeout(this.rejoinTimer);
    this.source?.close();
    if (this.token) {
      // keepalive lets the request finish even when the page is closing
      void fetch(this.url("leave"), {
        method: "POST",
        keepalive: true,
        headers: { "Content-Type": "application/json", "X-Flight-Rules": "speed-control-v3" },
        body: JSON.stringify({ token: this.token }),
      }).catch(() => {});
    }
  }
}
