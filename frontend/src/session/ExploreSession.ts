import { Game, type HudState } from "../game/Game";
import { BIOMES, type BiomeId, runLevel } from "../game/world/biomes";
import type { Settings } from "../storage";
import { Store } from "./store";

const COLOR = "#ff5d73";

export interface ExploreState {
  hud: HudState | null;
  error: string | null;
}

/** Free flight through any biome: no clock, nothing saved. Handy for looking at the land */
export class ExploreSession {
  readonly biome: BiomeId;
  readonly seed: number;
  readonly store = new Store<ExploreState>({ hud: null, error: null });
  private settings: Settings;
  private game: Game | null = null;

  constructor(biome: BiomeId, seed: number, settings: Settings) {
    this.biome = biome;
    this.seed = seed;
    this.settings = settings;
  }

  mount(container: HTMLElement) {
    try {
      this.game = new Game(container, {
        seed: this.seed,
        level: runLevel(this.seed, 1, this.biome),
        clock: () => performance.now(),
        controls: this.settings,
        color: COLOR,
        events: { hud: (hud) => this.store.set({ hud }) },
      });
    } catch (e) {
      console.error(e);
      this.store.set({ error: `The game couldn't start: ${(e as Error).message}` });
    }
  }

  unmount() {
    this.game?.dispose();
    this.game = null;
  }

  setSettings(settings: Settings) {
    this.settings = settings;
    this.game?.setControls(settings);
  }

  static valid(biome: string): biome is BiomeId {
    return biome in BIOMES;
  }
}
