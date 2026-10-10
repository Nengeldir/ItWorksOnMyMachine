import type { SpeciesId } from "../flora/species";
import type { Palette } from "../palette";
import type { StructureId } from "../structures/kinds";
import type { GroundSpec } from "../terrain/ground";

// A biome is data: what a level looks like, what grows there, what floats in
// the air, and what there is to do. One engine renders them all; nothing here
// is code that runs per frame.

export type BiomeId = "skyIsles" | "verdant" | "glacier" | "archipelago" | "lagoon" | "twilight" | "ember" | "aurora";

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
  bare?: boolean; // nothing grows on it
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

export type GateKind =
  | "arch" // a ring of rock standing over the line (or floating, without ground)
  | "pillars" // two columns either side (sea stacks where there is a sea)
  | "needles" // a slalom of thin spires
  | "shards" // a slalom of leaning, sharp spikes (ice, obsidian)
  | "spur" // a ridge across the valley, tunnelled through
  | "overhang" // a shelf reaching over the line from one side
  | "tunnel" // a floating island on the line, tunnelled through
  | "squeeze" // one island above, one below
  | "mushroom" // two giant mushrooms whose caps meet over the line
  | "roots"; // tangled root arches

type Range = [number, number];

/** Scenery placed around the line. `lateral`: metres either side of the line; `rise`: metres above the ground (or the line, for floating things) */
export type Feature =
  | { kind: "pillars"; count: number; radius: Range; rise: Range; lateral: Range; surface: number }
  | { kind: "boulders"; count: number; size: Range; lateral: Range; surface: number }
  | { kind: "arches"; count: number; radius: Range; lateral: Range; surface: number }
  | { kind: "islands"; count: number; size: Range; lateral: Range; rise: Range; surface: number; holes: number; terraces?: number }
  | { kind: "mesas"; count: number; radius: Range; rise: Range; lateral: Range; step: number; surface: number }
  | { kind: "shards"; count: number; radius: Range; rise: Range; lateral: Range; tilt: number; surface: number }
  | { kind: "trunks"; count: number; radius: Range; rise: Range; lateral: Range; surface: number; canopy: number }
  | { kind: "mushrooms"; count: number; cap: Range; rise: Range; lateral: Range; stem: number; surface: number }
  | { kind: "islets"; count: number; radius: Range; lateral: Range; surface: number }
  | { kind: "rings"; count: number; radius: Range; lateral: Range; rise: Range; surface: number }
  | { kind: "volcano"; lateral: number; radius: number; rise: number; surface: number }
  /** Humped stone bridges over the river, a little upstream of some falls (list them last: they are built around everything else) */
  | { kind: "bridges"; chance: number; width: number; surface: number }
  | { kind: "summit"; along: number; lateral: number; radius: number; rise: number; surface: number };

export interface LandRecipe {
  /** What each gate makes you thread, by weight */
  gates: Partial<Record<GateKind, number>>;
  /** Surface of the rock the gates are made of */
  gateSurface: number;
  /** Surfaces for gates made of something else: giant mushrooms' stems and caps */
  named?: { stem?: number; cap?: number };
  features: Feature[];
}

/** A sea at a fixed height: solid water to skim, with the ground as its floor */
export interface SeaSpec {
  level: number; // metres above the lowest point of the racing line
  colors: { deep: string; shallow: string; foam: string };
}

/** Waterfalls pouring off the rims of floating islands into the void */
export interface IslandFallsSpec {
  chance: number; // share of big islands with a fall
  colors: { deep: string; shallow: string; foam: string };
}

/** How the land is shaped */
export type TerrainRecipe =
  /** The race map, kept bit for bit so ghosts and leaderboards stay valid */
  | { kind: "legacyIslands" }
  /** Generator v2: a ground heightfield (or none) plus rock shapes, one distance field */
  | {
      kind: "v2";
      ground: GroundSpec | null;
      groundSurface: number;
      surfaces: Surface[];
      layers: Layers;
      land: LandRecipe;
      sea?: SeaSpec;
      islandFalls?: IslandFallsSpec;
    };

/** One species in a biome's flora, with its colors and where it grows */
export interface FloraSpecies {
  id: SpeciesId;
  weight: number;
  height: [number, number]; // metres
  foliage: string; // leaves, needles, cap, crystal…
  foliage2?: string; // a second shade, or the cap's spots and gills
  trunk?: string;
  tints?: string[]; // per-plant tints multiplied in (autumn reds and golds)
  where?: {
    above?: [number, number]; // metres above the racing line
    wet?: boolean; // only near water
    forest?: boolean; // true: only in forests, false: only in the open
  };
}

/** Grass tufts and flowers near the camera */
export interface GrassSpec {
  spacing: number; // metres between tufts
  height: [number, number];
  color: string; // base of the blades
  tip: string; // tips
  flowers: string[]; // flower colors (empty: none)
  flowerShare: number; // share of tufts that flower, where flowers grow at all
  glow?: number; // flowers light up by themselves (bioluminescent), mostly at night
}

/** What grows on the land */
export type VegetationSpec =
  /** One pine species placed by the mesher, as on the race map */
  | { kind: "legacyPines" }
  | { kind: "none" }
  | {
      kind: "flora";
      spacing: number; // metres between plant candidates (a jittered grid)
      density: number; // share of candidates that grow inside forests
      openDensity: number; // …and outside them
      forest: { scale: number; cover: number }; // forest patches: noise scale in metres, share of the land
      treeline: number; // nothing grows higher than this above the line
      minUp: number; // nothing grows on faces steeper than this (normal.y)
      species: FloraSpecies[];
      grass: GrassSpec | null;
    };

/**
 * Something built, standing on the land: placed on its own sparse grid by site
 * rules, drawn and collided like a plant. Only where the vegetation is "flora".
 */
export interface StructureSpec {
  id: StructureId;
  spacing: number; // metres between candidate sites (a jittered grid)
  chance: number; // share of candidates tried
  height: [number, number]; // metres
  /** A landmark: at most one per this many metres of the course, on the best site there (`chance` is ignored; `where.lateral` bounds the search). List landmarks first */
  landmark?: number;
  colors: {
    stone: string; // walls
    stone2?: string; // mossy or weathered patches
    roof: string;
    wood?: string;
    cloth?: string; // banners, sails
    trim?: string; // gold caps and finials
    light?: string; // windows and lanterns: dim by day, glowing at night
    snow?: string; // snow lying on its roofs
  };
  where?: {
    above?: [number, number]; // metres above the racing line
    lateral?: [number, number]; // metres to the side of the racing line
    wet?: boolean; // only near water (true) or away from it (false)
    water?: [number, number]; // standing in the sea, on ground this deep under it (stilts, sunken ruins)
    forest?: boolean; // true: only in forests, false: only in the open
    hilltop?: boolean; // only where the land falls away on most sides
    on?: "ground" | "rock" | "any"; // open ground (the default), or on top of rock shapes: islands, islets, mesas, sea stacks
    facing?: boolean; // its front turned towards the racing line (otherwise any way)
  };
}

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
  /** Cloud banks lying across the racing line, to fly through (generator-v2 biomes) */
  banks?: number;
  /**
   * Where the mood's mist gathers: below the camera (over a sea of clouds), or
   * pooling `above` metres over the valley floor, fading out `thickness` metres higher
   */
  mist: { mode: "camera" } | { mode: "valley"; above: number; thickness: number };
}

export type AmbientKind = "fireflies" | "motes" | "snow" | "leaves" | "embers" | "spores" | "ash" | "glitter" | "petals" | "starfall";

/** One kind of particle drifting around the camera */
export interface Ambient {
  kind: AmbientKind;
  rate: number; // per second, at full particle budget
  colors: string[];
  night?: number; // rate multiplier added at night (fireflies: many more)
}

/** The air's own particles, drifting around the camera (pollen, snow, embers…) */
export interface ParticleStyle {
  ambient: Ambient[];
}

/** The way out of a level */
export interface PortalSpec {
  color: string; // the veil, beam and tunnel; also hints at this biome when seen from the level before
}

export interface Biome {
  readonly id: BiomeId;
  readonly name: string;
  readonly tagline: string;
  /** Lighting moods; every level picks one */
  readonly moods: readonly Palette[];
  readonly terrain: TerrainRecipe;
  readonly vegetation: VegetationSpec;
  /** Towers, lanterns, windmills… (generator-v2 biomes with flora) */
  readonly structures?: readonly StructureSpec[];
  readonly sky: SkySpec;
  readonly particles: ParticleStyle;
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
