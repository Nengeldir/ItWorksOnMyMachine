import { Game, type HudState } from "../game/Game";
import { dailySeed } from "../game/rng";
import { runOrder, type RunSummary } from "../game/run/run";
import type { Upgrade, UpgradeId } from "../game/run/upgrades";
import { type BiomeId, runLevel } from "../game/world/biomes";
import type { Settings } from "../storage";
import type { InputObserver } from "../game/input";
import { Store } from "./store";
import { profileClient } from "../profile/client";

const COLOR = "#ff5d73";
const BEST_KEY = "windrider.runs";

export interface RunState {
  hud: HudState | null;
  stage: "intro" | "flying" | "pick" | "summary";
  offers: Upgrade[];
  next: BiomeId | null;
  /** A new biome just began: its title card */
  arrived: { level: number; biome: BiomeId; at: number } | null;
  summary: RunSummary | null;
  best: number | null;
  error: string | null;
}

function loadBests(): Record<string, number> {
  try {
    return JSON.parse(localStorage.getItem(BEST_KEY) ?? "{}");
  } catch {
    return {};
  }
}

/** Best score on a run seed, in this browser (runs aren't on the server's leaderboards) */
export function bestRun(seed: number): number | null {
  return loadBests()[seed] ?? null;
}

/** A roguelike run: biomes linked by portals, an upgrade at every portal */
export class RunSession {
  readonly seed: number;
  readonly store: Store<RunState>;
  private settings: Settings;
  private container: HTMLElement | null = null;
  private game: Game | null = null;
  private generation = 0;

  constructor(seed: number, settings: Settings) {
    this.seed = seed;
    this.settings = settings;
    this.store = new Store<RunState>({
      hud: null,
      stage: "intro",
      offers: [],
      next: null,
      arrived: null,
      summary: null,
      best: bestRun(seed),
      error: null,
    });
  }

  mount(container: HTMLElement) {
    this.container = container;
    void this.create();
  }

  private async create() {
    if (!this.container) return;
    const generation = ++this.generation;
    try {
      // Persistent rewards need the server; without it the adventure still flies, collecting nothing
      // (the profile pill says the profile is unavailable)
      const adventure = await profileClient.start(this.seed).catch((error: unknown) => {
        console.warn("Adventure rewards unavailable:", error);
        return null;
      });
      if (generation !== this.generation || !this.container) return;
      this.game = new Game(this.container, {
        seed: this.seed,
        level: runLevel(this.seed, 1, runOrder(this.seed)[0]),
        clock: () => performance.now(),
        controls: this.settings,
        color: COLOR,
        // Steering during the opening autopilot takes the controls where the pilot is
        events: { hud: (hud) => this.store.set({ hud }), takeOver: () => this.begin(false) },
      });
      this.game.startRun(this.seed, {
        rewards: adventure?.rewards,
        collected: reward => { if (adventure) profileClient.collect(adventure.token, reward.id); },
        offer: (offers, next) => this.store.set({ stage: "pick", offers, next }),
        arrived: (level, biome) => this.store.set({ arrived: { level, biome, at: performance.now() } }),
        ended: (summary) => this.ended(summary),
      });
      // The opening autopilot glides the level until the player steers or takes off
      if (this.store.get().stage === "intro") this.game.holdRun(true);
    } catch (e) {
      if (generation !== this.generation) return;
      console.error(e);
      this.store.set({ error: `The game couldn't start: ${(e as Error).message}` });
    }
  }

  unmount() {
    this.generation++;
    this.game?.dispose();
    this.game = null;
    this.container = null;
  }

  setSettings(settings: Settings) {
    this.settings = settings;
    this.game?.setControls(settings);
  }

  observeInput = (observer: InputObserver): (() => void) => this.game?.observeInput(observer) ?? (() => {});

  engage() {
    this.game?.engage();
  }

  /** Off the intro panel: the controls are yours. `engage`: lock the mouse (needs a click or key event) */
  begin(engage = true) {
    if (this.store.get().stage !== "intro" || !this.game) return;
    this.store.set({ stage: "flying" });
    this.game?.holdRun(false);
    if (engage) this.game?.engage();
  }

  /** Enter during the finale: skip to the white light */
  skip() {
    this.game?.skipFinale();
  }

  pick(id: UpgradeId) {
    if (this.store.get().stage !== "pick") return;
    this.store.set({ stage: "flying", offers: [] });
    this.game?.pickUpgrade(id);
  }

  /** The same run from the start */
  again() {
    this.game?.dispose();
    this.game = null;
    this.store.set({ stage: "flying", summary: null, offers: [], arrived: null, hud: null, error: null, best: bestRun(this.seed) });
    void this.create();
  }

  retry() {
    if (this.game) return;
    this.store.set({ error: null });
    void this.create();
  }

  private ended(summary: RunSummary) {
    const bests = loadBests();
    const previous = bests[summary.seed] ?? null;
    if (previous === null || summary.score > previous) {
      bests[summary.seed] = summary.score;
      try {
        localStorage.setItem(BEST_KEY, JSON.stringify(bests));
      } catch {
        // Not saved, the run still counts on screen
      }
    }
    this.store.set({ stage: "summary", summary, best: previous });
    // Back to the default sky map, flown by itself, behind the finish screen
    this.game?.victoryLap(dailySeed());
  }
}
