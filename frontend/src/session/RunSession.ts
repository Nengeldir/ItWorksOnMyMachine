import { Game, type HudState } from "../game/Game";
import { runOrder, type RunSummary } from "../game/run/run";
import type { Upgrade, UpgradeId } from "../game/run/upgrades";
import { type BiomeId, runLevel } from "../game/world/biomes";
import type { Settings } from "../storage";
import { Store } from "./store";

const COLOR = "#ff5d73";
const BEST_KEY = "wingrace.runs";

export interface RunState {
  hud: HudState | null;
  stage: "intro" | "flying" | "pick" | "summary";
  offers: Upgrade[];
  secret: boolean;
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

  constructor(seed: number, settings: Settings) {
    this.seed = seed;
    this.settings = settings;
    this.store = new Store<RunState>({
      hud: null,
      stage: "intro",
      offers: [],
      secret: false,
      next: null,
      arrived: null,
      summary: null,
      best: bestRun(seed),
      error: null,
    });
  }

  mount(container: HTMLElement) {
    this.container = container;
    this.create();
  }

  private create() {
    if (!this.container) return;
    try {
      this.game = new Game(this.container, {
        seed: this.seed,
        level: runLevel(this.seed, 1, runOrder(this.seed)[0]),
        clock: () => performance.now(),
        controls: this.settings,
        color: COLOR,
        events: { hud: (hud) => this.store.set({ hud }) },
      });
      this.game.startRun(this.seed, {
        offer: (offers, secret, next) => this.store.set({ stage: "pick", offers, secret, next }),
        arrived: (level, biome) => this.store.set({ arrived: { level, biome, at: performance.now() } }),
        ended: (summary) => this.ended(summary),
      });
      // Hold still on the start line until take-off
      if (this.store.get().stage === "intro") this.game.holdRun(true);
    } catch (e) {
      console.error(e);
      this.store.set({ error: `The game couldn't start: ${(e as Error).message}` });
    }
  }

  unmount() {
    this.game?.dispose();
    this.game = null;
    this.container = null;
  }

  setSettings(settings: Settings) {
    this.settings = settings;
    this.game?.setControls(settings);
  }

  engage() {
    this.game?.engage();
  }

  /** Off the intro panel and into the air */
  begin() {
    if (this.store.get().stage !== "intro") return;
    this.store.set({ stage: "flying" });
    this.game?.holdRun(false);
    this.game?.engage();
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
    this.store.set({ stage: "flying", summary: null, offers: [], arrived: null, best: bestRun(this.seed) });
    this.create();
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
  }
}
