import { hashToUnit, makeRng } from "../../rng";
import { ARCHIPELAGO } from "./archipelago";
import { AURORA } from "./aurora";
import { EMBER } from "./ember";
import { GLACIER } from "./glacier";
import { LAGOON } from "./lagoon";
import { REEF } from "./reef";
import { SKY_ISLES } from "./skyIsles";
import { TWILIGHT } from "./twilight";
import { VERDANT } from "./verdant";
import type { Biome, BiomeId, Level, LevelKey } from "./types";

export type { Biome, BiomeId, Level, LevelKey } from "./types";
export { SKY_ISLES };

export const BIOMES: Record<BiomeId, Biome> = {
  skyIsles: SKY_ISLES,
  verdant: VERDANT,
  glacier: GLACIER,
  archipelago: ARCHIPELAGO,
  lagoon: LAGOON,
  twilight: TWILIGHT,
  ember: EMBER,
  aurora: AURORA,
  reef: REEF,
};

/**
 * Every map, shared by all three modes: time trials, rooms and runs fly the same pool. A seed picks one
 * of them by its place in this list, so adding a biome changes which map most seeds stand for.
 */
export const MAPS = Object.keys(BIOMES) as BiomeId[];

/** The map a seed stands for, in every mode: which biome, and which of its moods */
export function seedMap(seed: number): { biome: BiomeId; mood: number } {
  const biome = MAPS[Math.floor(makeRng(seed, "map")() * MAPS.length)];
  const mood = Math.floor(makeRng(seed, "palette")() * BIOMES[biome].moods.length);
  return { biome, mood };
}

/** Time trials and rooms: the map the seed stands for (any biome) */
export function seedLevel(seed: number): Level {
  const { biome, mood } = seedMap(seed);
  return makeLevel({ biome, seed, mood, runSeed: 0, index: 0 });
}

/**
 * Sky Isles on a seed, with the mood that seed picks: the old race map, whose generator stays frozen
 * (`__raceHashes()` checks it on seeds 1, 7 and 42)
 */
export function skyIslesLevel(seed: number): Level {
  const mood = Math.floor(makeRng(seed, "palette")() * SKY_ISLES.moods.length);
  return makeLevel({ biome: "skyIsles", seed, mood, runSeed: 0, index: 0 });
}

const SEED_SEARCH = 10_000; // a seed for a given biome turns up in about as many tries as there are maps

/**
 * Level `index` of the run `runSeed` in `biome`: the same map for everyone on the same run seed. Its seed
 * is one that stands for `biome`, so the level is exactly the map a time trial on that seed flies.
 */
export function runLevel(runSeed: number, index: number, biome: BiomeId): Level {
  // The first level is the very map the run's seed stands for: the card picked in the map select
  const own = seedMap(runSeed);
  if (index === 1 && own.biome === biome) return makeLevel({ biome, seed: runSeed, mood: own.mood, runSeed, index });
  for (let k = 0; k < SEED_SEARCH; k++) {
    const seed = 1 + Math.floor(hashToUnit(`run/${runSeed}/${index}/${biome}/${k}`) * 2_147_483_000);
    const map = seedMap(seed);
    if (map.biome === biome) return makeLevel({ biome, seed, mood: map.mood, runSeed, index });
  }
  throw new Error(`No seed stands for ${biome}`);
}

/** The lowest seed that stands for `biome`: its showcase course in the map selects */
export function featuredSeed(biome: BiomeId): number {
  for (let seed = 1; seed < SEED_SEARCH; seed++) if (seedMap(seed).biome === biome) return seed;
  throw new Error(`No seed stands for ${biome}`);
}

/** Rebuilds a level from its key (the mesher workers get keys, not levels) */
export function makeLevel(key: LevelKey): Level {
  const biome = BIOMES[key.biome];
  return {
    key,
    biome,
    seed: key.seed,
    palette: biome.moods[key.mood % biome.moods.length],
    run: key.runSeed ? { seed: key.runSeed, index: key.index } : null,
  };
}

/** Identifies a level's map, e.g. to cache it or to drop stale worker results */
export function levelId(key: LevelKey): string {
  return `${key.biome}:${key.seed}:${key.mood}`;
}
