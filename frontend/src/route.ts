import { BIOMES, type BiomeId } from "./game/world/biomes/index";

export type Screen =
  | { kind: "menu"; joinCode?: string }
  | { kind: "solo"; seed: number }
  // `seed`: creating the room on the map picked in the map select (not in the URL: joiners get the room's)
  | { kind: "room"; code: string; seed?: number }
  | { kind: "explore"; biome: BiomeId; seed: number }
  | { kind: "test"; biome: BiomeId; seed: number }
  | { kind: "run"; seed: number }
  | { kind: "gallery" };

export function validBiome(biome: string | null): biome is BiomeId {
  return biome !== null && Object.hasOwn(BIOMES, biome);
}

function validSeed(value: string | null): number | null {
  const n = Number(value);
  return value !== null && Number.isInteger(n) && n >= 1 && n < 2 ** 31 ? n : null;
}

/**
 * Screens live in the URL, so a room link can be shared and reloads keep you in place.
 * `test` may be added to any single-player URL (`?test`, `?test=verdant`,
 * `?explore=verdant&test`, `?seed=42&test`, `?run=5&test`): it opens the test
 * sandbox there. Rooms and the gallery ignore it.
 */
export function screenFromSearch(search: string, hasNickname: boolean): Screen {
  const params = new URLSearchParams(search);
  const room = params.get("room")?.toUpperCase();
  if (room && /^[A-Z0-9]{3,8}$/.test(room)) {
    // First visit through an invite link: pick a name before joining
    return hasNickname ? { kind: "room", code: room } : { kind: "menu", joinCode: room };
  }
  if (params.has("gallery")) return { kind: "gallery" };
  const seed = validSeed(params.get("seed"));
  const run = validSeed(params.get("run"));
  if (params.has("test")) {
    // The world may be named by test= or explore=; the seed by seed= or run=
    const biome = [params.get("test"), params.get("explore")].find(validBiome) ?? "skyIsles";
    return { kind: "test", biome, seed: seed ?? run ?? 1 };
  }
  if (run !== null) return { kind: "run", seed: run };
  // /?explore=ember, or just /?explore to start in the first world and switch from there
  const explore = params.get("explore");
  if (explore !== null) return { kind: "explore", biome: validBiome(explore) ? explore : "skyIsles", seed: seed ?? 1 };
  if (seed !== null) return { kind: "solo", seed };
  return { kind: "menu" };
}

export function urlFor(screen: Screen): string {
  if (screen.kind === "solo") return `/?seed=${screen.seed}`;
  if (screen.kind === "room") return `/?room=${screen.code}`;
  if (screen.kind === "explore" || screen.kind === "test") return `/?${screen.kind}=${screen.biome}&seed=${screen.seed}`;
  if (screen.kind === "run") return `/?run=${screen.seed}`;
  if (screen.kind === "gallery") return "/?gallery";
  return "/";
}
