import type { Palette } from "../palette";

// A biome is data: what a level looks like, what grows there, what floats in
// the air, and what there is to do. One engine renders them all; nothing here
// is code that runs per frame.

export type BiomeId = "skyIsles";

/** How the land is shaped. "legacyIslands" is the race map, kept bit for bit so ghosts and leaderboards stay valid */
export type TerrainRecipe = { kind: "legacyIslands" };

/** What grows on the land. "legacyPines": one pine species placed by the mesher, as on the race map */
export type VegetationSpec = { kind: "legacyPines" };

/** Mist and clouds around the land */
export interface SkySpec {
  /** A faceted floor of clouds this far below the racing line (null: none) */
  cloudSea: { depth: number } | null;
  /** Puffy clouds drifting above and below the land */
  puffs: number;
}

/** The air's own particles, drifting around the camera (pollen, snow, embers…) */
export interface ParticleStyle {
  motes: number; // per second around the camera; 0 = none
}

export type SidequestKind = "beacons" | "thread" | "collect" | "chase" | "skim" | "thermals" | "rescue" | "waterfalls";

/** A sidequest as data; the framework places it from the level's seed */
export interface SidequestSpec {
  kind: SidequestKind;
  title: string; // shown in the objectives
  thing: string; // what one target is called ("cairn", "ice bell")
  count: number;
  reward: number; // points for finishing it
}

/** The way out of a level */
export interface PortalSpec {
  color: string; // the veil, beam and tunnel; also hints at this biome when seen from the level before
  secret: boolean; // a second portal, opened by finishing a sidequest
}

export interface Biome {
  readonly id: BiomeId;
  readonly name: string;
  readonly tagline: string;
  /** Lighting moods; every level picks one */
  readonly moods: readonly Palette[];
  readonly terrain: TerrainRecipe;
  readonly vegetation: VegetationSpec;
  readonly sky: SkySpec;
  readonly particles: ParticleStyle;
  readonly sidequests: readonly SidequestSpec[];
  readonly portals: PortalSpec;
}

/** Everything that decides a level, small enough to post to the mesher workers */
export interface LevelKey {
  biome: BiomeId;
  seed: number; // the world seed: every random thing in the map comes from it
  mood: number; // index into the biome's moods
  runSeed: number; // 0 outside a run
  index: number; // level number in the run (0 outside a run)
}

export interface Level {
  readonly key: LevelKey;
  readonly biome: Biome;
  readonly seed: number;
  readonly palette: Palette;
  /** The roguelike run this level belongs to, or null for races and time trials */
  readonly run: { seed: number; index: number } | null;
}
