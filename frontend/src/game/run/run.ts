import { makeRng } from "../rng";
import type { BiomeId } from "../world/biomes";
import type { UpgradeId } from "./upgrades";

// The shape of a roguelike run: which biome comes when, and how it scores.
// A run is RUN_LENGTH levels: Sky Isles first, Verdant Highlands second, the
// other biomes in an order shuffled by the run seed, and Aurora Summit last.
// Every level ends in a portal; a second, secret portal opens when you finish
// a sidequest and leads somewhere else, with a better choice of upgrades.

export const RUN_LENGTH = 8;
export const START_LIVES = 3;
export const GATE_POINTS = 100;
export const CHAIN_MAX = 5; // gates in a row without crashing multiply their points, up to this
export const LEVEL_BONUS = 1000;
export const PAR_POINTS = 20; // per second under par at the portal

const MIDDLE: BiomeId[] = ["glacier", "archipelago", "lagoon", "twilight", "ember"];

/** The biomes of a run, level by level (index 0 = level 1), when you always take the main portal */
export function runOrder(runSeed: number): BiomeId[] {
  const rng = makeRng(runSeed, "biome order");
  const middle = [...MIDDLE];
  for (let i = middle.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [middle[i], middle[j]] = [middle[j], middle[i]];
  }
  return ["skyIsles", "verdant", ...middle, "aurora"];
}

/**
 * Where the portals of level `level` (1-based) lead, given the biomes visited
 * so far: the main portal to the next biome on the run's order not yet seen,
 * the secret one to another unseen biome (the finale stays last either way).
 */
export function destinations(runSeed: number, level: number, path: readonly BiomeId[]): { main: BiomeId; secret: BiomeId } {
  if (level >= RUN_LENGTH - 1) return { main: "aurora", secret: "aurora" };
  const order = runOrder(runSeed).filter((b) => b !== "aurora" && !path.includes(b));
  const main = order[0] ?? "aurora";
  const rest = order.slice(1);
  const rng = makeRng(runSeed, `secret/${level}`);
  const secret = rest.length ? rest[Math.floor(rng() * rest.length)] : main;
  return { main, secret };
}

export type RunPhase = "arrive" | "explore" | "portal" | "pick" | "over" | "won";

export interface Objective {
  title: string;
  progress: string; // "2 / 4", "7 s left"…
  fraction: number; // 0..1
  done: boolean;
  failed: boolean;
}

/** What the run shows on screen; refreshed with the HUD */
export interface RunHud {
  seed: number;
  level: number;
  length: number;
  biome: string;
  mood: string;
  phase: RunPhase;
  score: number;
  lives: number;
  chain: number;
  objectives: Objective[];
  /** Where the portal is: angle on screen (0 = straight up, clockwise, radians), metres, and whether it is ahead */
  compass: { angle: number; distance: number; ahead: boolean; secret: boolean } | null;
  secretOpen: boolean;
  abilities: { id: UpgradeId; name: string; key: string; charge: number; ready: boolean; count?: number }[];
  upgrades: UpgradeId[];
  timer: number | null; // seconds left on a timed sidequest
  toast: { text: string; points: number; id: number } | null;
}

/** A finished (or failed) run */
export interface RunSummary {
  seed: number;
  score: number;
  levels: number;
  path: BiomeId[];
  upgrades: UpgradeId[];
  sidequests: number;
  won: boolean;
}
