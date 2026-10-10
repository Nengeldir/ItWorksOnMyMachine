import { Game, type HudState } from "../game/Game";
import { dailySeed } from "../game/rng";
import type { RunSummary } from "../game/run/run";
import type { Upgrade, UpgradeId } from "../game/run/upgrades";
import { trackFile } from "../game/music";
import { BIOMES, type BiomeId, makeLevel, runLevel } from "../game/world/biomes";
import type { Settings } from "../storage";
import { Store } from "./store";

const COLOR = "#ff5d73";
const ORDER = Object.keys(BIOMES) as BiomeId[];

export interface ExploreState {
  hud: HudState | null;
  error: string | null;
  biome: BiomeId;
  mood: number;
  /** The music file this world should play, and the one actually playing */
  track: string;
  playing: string | null;
  speed: number;
  offers: Upgrade[];
  next: BiomeId | null;
  summary: RunSummary | null;
}

/**
 * Free flight through any biome: no clock, nothing saved. Handy for looking at
 * the land. Worlds and lighting moods can be switched on the spot (the debug
 * panel and keys), without reloading, to check looks and music together.
 */
export class ExploreSession {
  readonly seed: number;
  readonly store: Store<ExploreState>;
  private settings: Settings;
  private game: Game | null = null;
  private timer = 0;
  readonly testMode: boolean;

  constructor(biome: BiomeId, seed: number, settings: Settings, testMode = false) {
    this.testMode = testMode;
    this.seed = seed;
    this.settings = settings;
    this.store = new Store<ExploreState>({
      hud: null,
      error: null,
      biome,
      mood: runLevel(seed, 1, biome).key.mood,
      track: trackFile(biome),
      playing: null,
      speed: 1,
      offers: [],
      next: null,
      summary: null,
    });
  }

  mount(container: HTMLElement) {
    const { biome, mood } = this.store.get();
    try {
      this.game = new Game(container, {
        seed: this.seed,
        level: this.level(biome, mood),
        clock: () => performance.now(),
        controls: this.settings,
        color: COLOR,
        testMode: this.testMode,
        events: { hud: (hud) => this.store.set({ hud }), testSpeed: (speed) => this.store.set({ speed }) },
      });
      if (this.testMode) this.startTest(biome, mood);
    } catch (e) {
      console.error(e);
      this.store.set({ error: `The game couldn't start: ${(e as Error).message}` });
    }
    // The music loads and starts a moment after the first click: keep the panel honest
    this.timer = window.setInterval(() => {
      const playing = this.game?.musicTrack ?? null;
      if (playing !== this.store.get().playing) this.store.set({ playing });
    }, 400);
  }

  unmount() {
    window.clearInterval(this.timer);
    this.game?.dispose();
    this.game = null;
  }

  setSettings(settings: Settings) {
    this.settings = settings;
    this.game?.setControls(settings);
  }

  private level(biome: BiomeId, mood: number) {
    return makeLevel({ ...runLevel(this.seed, 1, biome).key, mood });
  }

  /** Switches to another world and restarts at its start; `mood` defaults to that world's own */
  show(biome: BiomeId, mood?: number) {
    const own = runLevel(this.seed, 1, biome).key.mood;
    const next = mood === undefined ? own : ((mood % BIOMES[biome].moods.length) + BIOMES[biome].moods.length) % BIOMES[biome].moods.length;
    if (this.testMode) this.startTest(biome, next);
    else this.game?.setLevel(this.level(biome, next));
    this.updateUrl(biome);
    this.store.set({ biome, mood: next, track: trackFile(biome) });
  }

  private updateUrl(biome: BiomeId) {
    const url = new URL(location.href);
    // Test mode may have been opened as ?explore=…&test or ?run=…&test: keep one spelling
    if (this.testMode) ["explore", "run"].forEach((name) => url.searchParams.delete(name));
    url.searchParams.set(this.testMode ? "test" : "explore", biome);
    url.searchParams.set("seed", String(this.seed));
    history.replaceState(null, "", url.pathname + url.search + url.hash);
  }

  private startTest(biome: BiomeId, mood: number) {
    this.store.set({ offers: [], next: null, summary: null });
    this.game?.startRun(this.seed, {
      offer: (offers, next) => this.store.set({ offers, next }),
      arrived: (_level, current) => {
        const mood = this.game!.world.level.key.mood;
        this.store.set({ biome: current, mood, track: trackFile(current) });
        this.updateUrl(current);
      },
      ended: (summary) => {
        // Test results never enter RunSession's local best scores or the server.
        this.store.set({ summary, offers: [], next: null });
        this.game?.victoryLap(dailySeed());
      },
    }, this.level(biome, mood));
  }

  pick(id: UpgradeId) {
    if (this.store.get().hud?.paused) return;
    this.game?.pickUpgrade(id);
    this.store.set({ offers: [], next: null });
  }

  again() {
    const { biome, mood } = this.store.get();
    this.show(biome, mood);
  }

  skip() {
    this.game?.skipFinale();
  }

  /** The next (or, with -1, previous) world in the list */
  step(direction: 1 | -1) {
    const i = ORDER.indexOf(this.store.get().biome);
    this.show(ORDER[(i + direction + ORDER.length) % ORDER.length]);
  }

  /** The next (or previous) lighting mood of the current world */
  stepMood(direction: 1 | -1) {
    const { biome, mood } = this.store.get();
    this.show(biome, mood + direction);
  }
}
