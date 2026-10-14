import { Game, type HudState } from "../game/Game";
import { dailySeed } from "../game/rng";
import { runOrder, type RunSummary } from "../game/run/run";
import type { Upgrade, UpgradeId } from "../game/run/upgrades";
import { type BiomeId, runLevel } from "../game/world/biomes";
import type { Settings } from "../storage";
import type { InputObserver } from "../game/input";
import { Store } from "./store";
import { profileClient } from "../profile/client";
import type { Adventure, RunReward } from "../profile/types";
import type { TestAction } from "../game/input";
import type { Appearance } from "../game/cosmetics/storage";
import type { ItemId } from "../game/items/models";
import type { RunItemId } from "../game/run/items";

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
  /** What the finished adventure earned on the profile (null while saving or offline) */
  reward: RunReward | null;
  /** Test mode: the playback speed (1, or ½ with Shift+S) */
  speed: number;
}

/** Test mode (?test): the real adventure with the sandbox's tools; nothing is saved or reported */
export interface RunTestOptions {
  /** The biome the first level is in (the test URL's) */
  biome: BiomeId;
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
  /** The adventure's reward plan and token (null offline), and whether its result went to the server */
  private adventure: Adventure | null = null;
  private reported = false;
  /** Test mode, and what it has put on the pilot (the fitting room) */
  readonly test: RunTestOptions | null;
  previewLook: Appearance | null = null;
  private resumeAfterPreview = false;

  constructor(seed: number, settings: Settings, test: RunTestOptions | null = null) {
    this.seed = seed;
    this.settings = settings;
    this.test = test;
    this.store = new Store<RunState>({
      hud: null,
      stage: "intro",
      offers: [],
      next: null,
      arrived: null,
      summary: null,
      best: bestRun(seed),
      error: null,
      reward: null,
      speed: 1,
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
      const adventure = this.test ? null : await profileClient.start(this.seed).catch((error: unknown) => {
        console.warn("Adventure rewards unavailable:", error);
        return null;
      });
      if (generation !== this.generation || !this.container) return;
      this.adventure = adventure;
      this.reported = false;
      const first = runLevel(this.seed, 1, this.test?.biome ?? runOrder(this.seed)[0]);
      this.game = new Game(this.container, {
        track: !this.test,
        testMode: !!this.test,
        seed: this.seed,
        level: first,
        clock: () => performance.now(),
        controls: this.settings,
        color: COLOR,
        // Steering during the opening autopilot takes the controls where the pilot is
        events: { hud: (hud) => this.store.set({ hud }), takeOver: () => this.begin(false), testSpeed: (speed) => this.store.set({ speed }) },
      });
      if (this.previewLook) this.game.testAppearance(this.previewLook);
      this.game.startRun(this.seed, {
        rewards: adventure?.rewards,
        collected: reward => { if (adventure) profileClient.collect(adventure.token, reward.id); },
        offer: (offers, next) => this.store.set({ stage: "pick", offers, next }),
        arrived: (level, biome) => this.store.set({ arrived: { level, biome, at: performance.now() } }),
        ended: (summary) => this.ended(summary),
      // The pilot's level: items and abilities above it never turn up (what they wear comes from the profile).
      // Test mode never runs out of lives, and every item and ability is open
      }, this.test ? first : undefined, this.test ? { lives: Infinity } : { playerLevel: profileClient.level() });
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
    // Leaving mid-flight still counts what was flown: its gates' XP and its score's crystals
    const progress = this.game?.runSnapshot();
    if (progress && this.store.get().stage !== "intro") this.report(progress);
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
    const progress = this.game?.runSnapshot();
    if (progress && this.store.get().stage === "flying") this.report(progress);
    this.game?.dispose();
    this.game = null;
    this.store.set({ stage: "flying", summary: null, offers: [], arrived: null, hud: null, error: null, best: bestRun(this.seed), reward: null });
    void this.create();
  }

  /** Sends the adventure's result once (the profile client keeps retrying it if the server is away) */
  private report(summary: RunSummary) {
    if (this.test) return;
    const adventure = this.adventure;
    if (!adventure || this.reported || (summary.gates === 0 && summary.score === 0)) return;
    this.reported = true;
    void profileClient.reportRun(adventure.token, {
      score: Math.max(0, Math.round(summary.score)), levels: Math.max(1, Math.min(8, summary.levels)), completed: summary.completed,
      gates: summary.gates, time_ms: Math.max(0, summary.timeMs), crashes: summary.crashes,
    }).then((reward) => { if (reward && this.adventure === adventure) this.store.set({ reward }); });
  }

  retry() {
    if (this.game) return;
    this.store.set({ error: null });
    void this.create();
  }

  private ended(summary: RunSummary) {
    if (this.test) {
      // Test results never enter the local best scores or the server
      this.store.set({ stage: "summary", summary, best: null });
      this.game?.victoryLap(dailySeed());
      return;
    }
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
    this.report(summary);
    // Back to the default sky map, flown by itself, behind the finish screen
    this.game?.victoryLap(dailySeed());
  }

  // --- test mode (?test) ------------------------------------------------------------------------------

  /** Shift+P / O / S, and their touch buttons: a portal ahead, victory, half speed */
  testAction(action: TestAction) {
    if (this.test) this.game?.testAction(action);
  }

  /** The fitting room opens: the game holds still while it's open */
  beginCollectionPreview() {
    if (!this.test || !this.game) return;
    this.resumeAfterPreview = !this.store.get().hud?.paused;
    if (this.resumeAfterPreview) this.game.togglePause();
  }

  endCollectionPreview() {
    if (this.test && this.resumeAfterPreview && this.store.get().hud?.paused) this.game?.togglePause();
    this.resumeAfterPreview = false;
  }

  previewAppearance(look: Appearance | null) {
    if (!this.test) return;
    this.previewLook = look;
    this.game?.testAppearance(look);
  }
  previewItem(id: ItemId) { if (this.test) this.game?.equip(id); }
  /** Carry a keepsake as the charm in this test run (null: the profile's own) */
  previewCharm(id: string | null) { if (this.test) this.game?.testCharmItem(id); }
  previewUseItem() { if (this.test) this.game?.useItem(); }
  previewThrust(on: boolean) { if (this.test) this.game?.thrust(on ? 1 : 0); }
  clearPreviewItems() {
    if (!this.test) return;
    for (const slot of ["hand", "head", "back"] as const) this.game?.unequip(slot);
  }

  /** Test mode's "Get items & abilities": an adventure item into the bag (the oldest leaves a full one) */
  giveItem(id: RunItemId) { if (this.test) this.game?.testGiveItem(id); }
  /** …and an upgrade or ability, right now */
  giveUpgrade(id: UpgradeId) { if (this.test) this.game?.grant(id); }
}
