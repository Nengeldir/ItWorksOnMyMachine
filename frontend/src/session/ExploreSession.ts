import { Game, type HudState } from "../game/Game";
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
}

/**
 * Free flight through any biome: no clock, nothing saved. Handy for looking at
 * the land. Worlds and lighting moods can be switched on the spot (the debug
 * panel and keys), without reloading, to check looks and music together.
 * (Test mode is the real adventure with tools on top: `RunSession` with `test`.)
 */
export class ExploreSession {
  readonly seed: number;
  readonly store: Store<ExploreState>;
  private settings: Settings;
  private game: Game | null = null;
  private timer = 0;

  constructor(biome: BiomeId, seed: number, settings: Settings) {
    this.seed = seed;
    this.settings = settings;
    this.store = new Store<ExploreState>({
      hud: null,
      error: null,
      biome,
      mood: runLevel(seed, 1, biome).key.mood,
      track: trackFile(biome),
      playing: null,
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
        events: { hud: (hud) => this.store.set({ hud }) },
      });
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
    this.game?.setLevel(this.level(biome, next));
    const url = new URL(location.href);
    url.searchParams.set("explore", biome);
    url.searchParams.set("seed", String(this.seed));
    history.replaceState(null, "", url.pathname + url.search + url.hash);
    this.store.set({ biome, mood: next, track: trackFile(biome) });
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
