import { hashToUnit, makeRng } from "../../rng";
import { ARCHIPELAGO } from "./archipelago";
import { AURORA } from "./aurora";
import { EMBER } from "./ember";
import { GLACIER } from "./glacier";
import { LAGOON } from "./lagoon";
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
};

/** Races and time trials: always Sky Isles, with the mood the seed has always picked */
export function raceLevel(seed: number): Level {
  const mood = Math.floor(makeRng(seed, "palette")() * SKY_ISLES.moods.length);
  return makeLevel({ biome: "skyIsles", seed, mood, runSeed: 0, index: 0 });
}

/** Level `index` of the run `runSeed` in `biome`: the same map for everyone on the same run seed */
export function runLevel(runSeed: number, index: number, biome: BiomeId): Level {
  const salt = `run/${runSeed}/${index}/${biome}`;
  const seed = 1 + Math.floor(hashToUnit(salt) * 2_147_483_000);
  const mood = Math.floor(makeRng(salt, "mood")() * BIOMES[biome].moods.length);
  return makeLevel({ biome, seed, mood, runSeed, index });
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
