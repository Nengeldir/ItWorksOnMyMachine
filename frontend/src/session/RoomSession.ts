import { Quaternion, Vector3 } from "three";
import type { RoomInfo, Snapshot } from "../api";
import { type FinishResult, Game, type HudState } from "../game/Game";
import { type ConnectionStatus, type Identity, RoomClient } from "../net/RoomClient";
import type { Settings } from "../storage";
import type { InputObserver } from "../game/input";
import { Store } from "./store";

const SEND_INTERVAL_MS = 66; // ~15 Hz up, matching the server's snapshot rate

export interface RoomState {
  hud: HudState | null;
  connection: ConnectionStatus;
  message: string | null;
  room: RoomInfo | null;
  selfId: string;
  lastPlace: number | null;
}

/** A live race room: everyone flies the same seeded map, the server relays positions */
export class RoomSession {
  readonly code: string;
  readonly store = new Store<RoomState>({
    hud: null,
    connection: "connecting",
    message: null,
    room: null,
    selfId: "",
    lastPlace: null,
  });
  private readonly identity: Identity;
  private settings: Settings;
  private container: HTMLElement | null = null;
  private client: RoomClient | null = null;
  private game: Game | null = null;
  private sendTimer = 0;
  private messageTimer = 0;
  // The race we were put on the start line for, by its start time: unlike race ids,
  // start times stay unique when the backend restarts and the room starts over
  private raceStart: number | null = null;
  private inRace = false;

  constructor(code: string, identity: Identity, settings: Settings) {
    this.code = code;
    this.identity = identity;
    this.settings = settings;
  }

  mount(container: HTMLElement) {
    this.container = container;
    const client = new RoomClient(this.code, this.identity, {
      joined: (id) => this.store.set({ selfId: id }),
      room: (info) => this.onRoom(info),
      snapshot: (snapshot) => this.onSnapshot(snapshot),
      status: (connection, message) => this.store.set({ connection, message: message ?? null }),
    });
    this.client = client;
    this.sendTimer = window.setInterval(() => {
      if (this.game) client.sendState(this.game.netState());
    }, SEND_INTERVAL_MS);
    void client.connect();
  }

  unmount() {
    window.clearInterval(this.sendTimer);
    window.clearTimeout(this.messageTimer);
    this.client?.close();
    this.client = null;
    this.game?.dispose();
    this.game = null;
    this.container = null;
    this.raceStart = null;
    this.inRace = false;
  }

  setSettings(settings: Settings) {
    this.settings = settings;
    this.game?.setControls(settings);
  }

  observeInput = (observer: InputObserver): (() => void) => this.game?.observeInput(observer) ?? (() => {});

  engage() {
    this.game?.engage();
  }

  private onRoom(info: RoomInfo) {
    if (!this.client || !this.container) return;
    const { selfId } = this.store.get();
    const me = info.players.find((p) => p.id === selfId);

    let game = this.game;
    if (!game) {
      game = new Game(this.container, {
        seed: info.seed,
        clock: this.client.clock.now,
        controls: this.settings,
        color: me?.color ?? "#ffffff",
        events: {
          hud: (hud) => this.store.set({ hud }),
          finished: (result) => void this.finished(result),
        },
      });
      this.game = game;
    }
    game.setSeed(info.seed);
    if (me) game.setSelf(me.id, me.color);
    game.syncPilots(info.players);
    game.setParticipants(
      info.players
        .filter((p) => p.racing)
        .map((p) => ({ id: p.id, name: p.name, color: p.color, finishMs: p.finish_ms })),
    );

    const raceOn = info.phase === "countdown" || info.phase === "racing";
    if (raceOn && me?.racing && info.start_at !== null && this.raceStart !== info.start_at) {
      this.raceStart = info.start_at;
      this.inRace = true;
      const slot = info.players.filter((p) => p.racing).findIndex((p) => p.id === selfId);
      game.startCountdown(info.start_at, Math.max(0, slot));
      this.store.set({ lastPlace: null });
    } else if (!raceOn && this.inRace) {
      // Race over (everyone finished or time ran out): back to free flight where you are
      this.inRace = false;
      game.freeFlight(false);
    }
    this.store.set({ room: info });
  }

  private onSnapshot(snapshot: Snapshot) {
    const game = this.game;
    if (!game) return;
    const { selfId } = this.store.get();
    for (const [id, x, y, z, qx, qy, qz, qw, v, cp, t, boost = 0, brake = 0, dodge = 0] of snapshot.players) {
      if (id === selfId) continue;
      game.pushSample(id, { t, p: new Vector3(x, y, z), q: new Quaternion(qx, qy, qz, qw), v, cp, boost, brake, dodge });
    }
  }

  private async finished({ timeMs, ghost }: FinishResult) {
    try {
      const result = await this.client?.finish(timeMs, ghost);
      if (result) this.store.set({ lastPlace: result.place });
    } catch (e) {
      this.flash(`Finish not counted: ${(e as Error).message}`);
    }
  }

  /** Shows a message for a few seconds */
  private flash(message: string) {
    this.store.set({ message });
    window.clearTimeout(this.messageTimer);
    this.messageTimer = window.setTimeout(() => {
      if (this.store.get().message === message) this.store.set({ message: null });
    }, 4000);
  }

  resume() {
    if (this.store.get().hud?.paused) this.game?.togglePause();
  }

  start() {
    this.client?.start().catch((e: Error) => this.flash(e.message));
  }

  newMap(seed?: number) {
    this.client?.newMap(seed).catch((e: Error) => this.flash(e.message));
  }
}
