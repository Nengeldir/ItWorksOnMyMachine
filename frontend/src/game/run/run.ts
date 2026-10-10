import { makeRng } from "../rng";
import type { BiomeId } from "../world/biomes";
import type { UpgradeId } from "./upgrades";

// The shape of a roguelike run: which biome comes when, and how it scores.
// A run is RUN_LENGTH levels: Sky Isles first, Verdant Highlands second, the
// other biomes in an order shuffled by the run seed, and Aurora Summit last.
// Every level ends in a portal to the next biome and a choice of upgrades.

export const RUN_LENGTH = 8;
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
 * Where the portal of level `level` (1-based) leads, given the biomes visited
 * so far: the next biome on the run's order not yet seen (the finale last).
 */
export function destination(runSeed: number, level: number, path: readonly BiomeId[]): BiomeId {
  if (level >= RUN_LENGTH - 1) return "aurora";
  return runOrder(runSeed).find((b) => b !== "aurora" && !path.includes(b)) ?? "aurora";
}

export type RunPhase = "arrive" | "explore" | "portal" | "pick" | "finale" | "won";

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
  chain: number;
  objectives: Objective[];
  /** Where the portal is: angle on screen (0 = straight up, clockwise, radians), metres, and whether it is ahead */
  compass: { angle: number; distance: number; ahead: boolean } | null;
  abilities: { id: UpgradeId; name: string; key: string; charge: number; ready: boolean; count?: number }[];
  upgrades: UpgradeId[];
  toast: { text: string; points: number; id: number } | null;
}

/** A finished run */
export interface RunSummary {
  seed: number;
  score: number;
  levels: number;
  path: BiomeId[];
  upgrades: UpgradeId[];
}
