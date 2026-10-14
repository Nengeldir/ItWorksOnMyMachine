import { type LeaderboardEntry, finishRun, getGhosts, getLeaderboard, startRun } from "../api";
import { type FinishResult, Game, type HudState } from "../game/Game";
import type { Settings } from "../storage";
import type { InputObserver } from "../game/input";
import { Store } from "./store";
import { achievements } from "../game/achievements";
import { profileClient } from "../profile/client";

const COUNTDOWN_MS = 3000;
const SOLO_COLOR = "#ff5d73";

export interface SoloResult {
  timeMs: number;
  saving: boolean;
  rank?: number;
  personalBestMs?: number;
  /** XP the finish earned on the pilot's profile */
  xp?: number;
  error?: string;
}

export interface SoloState {
  hud: HudState | null;
  stage: "ready" | "racing" | "results";
  result: SoloResult | null;
  leaderboard: LeaderboardEntry[];
  ghosts: string[];
  error: string | null; // the game couldn't start (no WebGL)
}

/** A time trial against the clock and the best ghosts on one seed */
export class SoloSession {
  readonly seed: number;
  readonly store = new Store<SoloState>({
    hud: null,
    stage: "ready",
    result: null,
    leaderboard: [],
    ghosts: [],
    error: null,
  });
  private readonly clientId: string;
  private settings: Settings;
  private game: Game | null = null;
  private runToken: Promise<string | null> | null = null;
  private attempt = 0;
  /** This pilot's best time on the course before the flight just finished (undefined: none known) */
  private previousBest: number | undefined;

  constructor(seed: number, clientId: string, settings: Settings) {
    this.seed = seed;
    this.clientId = clientId;
    this.settings = settings;
  }

  mount(container: HTMLElement) {
    try {
      this.game = this.createGame(container);
    } catch (e) {
      console.error(e);
      this.store.set({ error: `The game couldn't start: ${(e as Error).message}` });
      return;
    }
    void this.loadLeaderboard();
  }

  private createGame(container: HTMLElement): Game {
    return new Game(container, {
      track: true,
      seed: this.seed,
      clock: () => performance.now(),
      controls: this.settings,
      color: SOLO_COLOR,
      events: {
        hud: (hud) => this.store.set({ hud }),
        raceStarted: () => {
          // The server times the run too and checks the finish time against its own clock
          this.runToken = startRun(this.seed)
            .then((r) => r.run_token)
            .catch(() => null);
        },
        finished: (result) => void this.finished(result),
      },
    });
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

  engage() {
    this.game?.engage();
  }

  resume() {
    if (this.store.get().hud?.paused) this.game?.togglePause();
  }

  /** Countdown, then race; ghosts of the best runs fly along */
  start() {
    const game = this.game;
    if (!game || this.store.get().stage === "racing") return;
    const attempt = ++this.attempt;
    this.runToken = null;
    game.startCountdown(performance.now() + COUNTDOWN_MS);
    this.store.set({ stage: "racing", result: null });
    getGhosts(this.seed)
      .then((runs) => {
        if (attempt !== this.attempt || !this.game) return;
        this.game.setGhosts(runs);
        this.store.set({ ghosts: runs.map((r) => r.name) });
      })
      .catch(() => {});
  }

  /** Back to free flight without finishing */
  abort() {
    this.attempt++;
    this.game?.freeFlight(true);
    this.store.set({ stage: "ready" });
  }

  private async loadLeaderboard() {
    try {
      const leaderboard = await getLeaderboard(this.seed, this.clientId);
      // Your best on this course so far, if it made the board (Better than yesterday)
      const mine = leaderboard.find((entry) => entry.is_me);
      if (mine && this.previousBest === undefined) this.previousBest = mine.time_ms;
      this.store.set({ leaderboard });
    } catch {
      // Offline: the race still works
    }
  }

  private async finished({ timeMs, ghost }: FinishResult) {
    const attempt = this.attempt;
    this.store.set({ stage: "results", result: { timeMs, saving: true } });
    const token = await this.runToken;
    if (attempt !== this.attempt) return;
    if (!token) {
      this.store.set({ result: { timeMs, saving: false, error: "Couldn't reach the server, time not saved" } });
      return;
    }
    try {
      const saved = await finishRun({
        run_token: token,
        time_ms: timeMs,
        client_id: this.clientId,
        nickname: this.settings.nickname,
        ghost,
        gates: this.store.get().hud?.totalCheckpoints ?? 0,
      });
      // The finish's XP (one per gate) shows up in the profile
      if (saved.xp) void profileClient.refresh().catch(() => {});
      if (attempt !== this.attempt) return;
      // Beat the best this pilot had on the course before this flight
      const before = this.previousBest;
      if (before !== undefined && timeMs < before) achievements.unlock("personalBest");
      this.previousBest = Math.min(before ?? Infinity, saved.personal_best_ms ?? timeMs);
      this.store.set({
        result: { timeMs, saving: false, rank: saved.rank, personalBestMs: saved.personal_best_ms, xp: saved.xp },
        leaderboard: saved.leaderboard,
      });
    } catch (e) {
      this.store.set({ result: { timeMs, saving: false, error: `Time not saved: ${(e as Error).message}` } });
    }
  }
}
