import { Game, type HudState } from "../game/Game";
import type { InputObserver } from "../game/input";
import { type Level, zenLevel } from "../game/world/biomes";
import type { Settings } from "../storage";
import { Store } from "./store";

const COLOR = "#ff5d73";

export interface ZenState {
  hud: HudState | null;
  error: string | null; // the game couldn't start (no WebGL)
}

/**
 * Zen: one map flown for ever, as an open world: no line, no gates, land every way (made a cell at
 * a time around you, see `world/open.ts`). There's no clock and no score, nothing is saved, and a
 * crash puts you back in the air near where you tumbled.
 */
export class ZenSession {
  readonly level: Level;
  readonly store = new Store<ZenState>({ hud: null, error: null });
  private settings: Settings;
  private game: Game | null = null;

  constructor(seed: number, settings: Settings) {
    this.level = zenLevel(seed);
    this.settings = settings;
  }

  mount(container: HTMLElement) {
    try {
      this.game = new Game(container, {
        seed: this.level.seed,
        level: this.level,
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

  observeInput = (observer: InputObserver): (() => void) => this.game?.observeInput(observer) ?? (() => {});
}
