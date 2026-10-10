import type { Palette } from "../palette";
import type { GroundSpec } from "../terrain/ground";

// A biome is data: what a level looks like, what grows there, what floats in
// the air, and what there is to do. One engine renders them all; nothing here
// is code that runs per frame.

export type BiomeId = "skyIsles" | "verdant";

/**
 * How a kind of land is painted. The mesher picks the rock color per face
 * (with strata and streaks) and the color of what covers flat ground; the
 * terrain shader blends rock, soil, cover, sand and snow by slope and height.
 */
export interface Surface {
  rock: string; // cliffs and steep faces
  rock2?: string; // the other strata band, or the streaks
  bands?: number; // metres between strata bands (0: none)
  streaks?: number; // 0..1: dark vertical streaks down the cliffs (karst, sandstone)
  under?: string; // faces looking down
  top: string; // what covers flat ground: grass, moss, sand, ash, a mushroom cap…
  top2?: string; // drier or lusher patches of it
  snow: boolean; // snow settles on it above the snow line
  glow?: number; // self-lit cracks (lava) or spots, as a share of faces
}

/** Biome-wide layers for the terrain shader */
export interface Layers {
  dirt: string; // the soil band between cover and rock
  sand: string; // beaches and banks near water
  snow: string;
  snowLine: number; // metres above the racing line where snow begins
  topSlope: number; // faces flatter than this (normal.y) take the cover
  texture: number; // strength of the triplanar noise on cliffs
  glow: string; // color of glowing cracks and spots
}

export type GateKind = "arch" | "pillars" | "needles" | "spur" | "overhang" | "tunnel" | "squeeze";

/** Scenery placed around the line */
export type Feature =
  | { kind: "pillars"; count: number; radius: [number, number]; rise: [number, number]; lateral: [number, number]; surface: number }
  | { kind: "boulders"; count: number; size: [number, number]; lateral: [number, number]; surface: number }
  | { kind: "arches"; count: number; radius: [number, number]; lateral: [number, number]; surface: number }
  | { kind: "islands"; count: number; size: [number, number]; lateral: [number, number]; rise: [number, number]; surface: number; holes: number }
  | { kind: "mesas"; count: number; radius: [number, number]; rise: [number, number]; lateral: [number, number]; step: number; surface: number };

export interface LandRecipe {
  /** What each gate makes you thread, by weight */
  gates: Partial<Record<GateKind, number>>;
  /** Surface of the rock the gates are made of */
  gateSurface: number;
  features: Feature[];
}

/** How the land is shaped */
export type TerrainRecipe =
  /** The race map, kept bit for bit so ghosts and leaderboards stay valid */
  | { kind: "legacyIslands" }
  /** Generator v2: a ground heightfield (or none) plus rock shapes, one distance field */
  | { kind: "v2"; ground: GroundSpec | null; groundSurface: number; surfaces: Surface[]; layers: Layers; land: LandRecipe };

/** What grows on the land. "legacyPines": one pine species placed by the mesher, as on the race map */
export type VegetationSpec = { kind: "legacyPines" } | { kind: "none" };

/** Mist and clouds around the land */
export interface SkySpec {
  /** A faceted floor of clouds this far below the racing line (null: none) */
  cloudSea: { depth: number } | null;
  /** Puffy clouds drifting above (and, over a sea of clouds, below) the land */
  puffs: number;
  /** Some puffs drift below the line too (only where there is no ground in the way) */
  puffsBelow: boolean;
  /** Metres added to the height of the puffs above the line (clear of hills and mountains) */
  puffLift: number;
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
