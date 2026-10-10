import { makeRng } from "../rng";
import { type BiomeId, MAPS, seedMap } from "../world/biomes/index";
import type { UpgradeId } from "./upgrades";

// The shape of a roguelike run: which biome comes when, and how it scores.
// A run is RUN_LENGTH levels, each on a different map: it starts on the map
// its seed stands for (the one picked in the map select, or today's), then
// flies seven of the other eight in an order the seed draws; one sits out.
// Every level ends in a portal to the next biome and a choice of upgrades,
// the last one in the finale.

export const RUN_LENGTH = 8;
export const GATE_POINTS = 100;
export const CHAIN_MAX = 5; // gates in a row without crashing multiply their points, up to this
export const LEVEL_BONUS = 1000;
export const PAR_POINTS = 20; // per second under par at the portal

/** The biomes of a run, level by level (index 0 = level 1): the seed's own map first, then seven others */
export function runOrder(runSeed: number): BiomeId[] {
  const first = seedMap(runSeed).biome;
  const rest = MAPS.filter((biome) => biome !== first);
  const rng = makeRng(runSeed, "biome order");
  for (let i = rest.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [rest[i], rest[j]] = [rest[j], rest[i]];
  }
  return [first, ...rest.slice(0, RUN_LENGTH - 1)];
}

/**
 * Where the next portal leads, given the biomes visited so far: the next
 * biome on the run's order not yet seen
 */
export function destination(runSeed: number, path: readonly BiomeId[]): BiomeId {
  const order = runOrder(runSeed);
  return order.find((biome) => !path.includes(biome)) ?? order[order.length - 1];
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
  /** Gates passed in this level: a crash puts you back after the last one */
  checkpoint: number;
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
  /** Flying time over all levels (the level clocks), in milliseconds */
  timeMs: number;
  gates: number;
  crashes: number;
  bestChain: number;
  /** Style points, all levels together */
  style: number;
}
