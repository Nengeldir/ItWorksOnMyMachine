import type { Biome, StructureSpec } from "../biomes/types";
import { SPECIES, type SpeciesInfo } from "../flora/species";

// Structures as data: towers, lanterns, windmills… Built things ride the
// plants' pipeline (placed in the mesher workers, instanced, impostors far
// away, colliders near you): in a node's plant list they come after the
// biome's species, as kind `species.length + i`. Their meshes are 1 m tall in
// true proportions (radius = height), so parts can turn without shearing.
// No three.js geometry here.

export type StructureId = "watchtower" | "stoneLantern" | "windmill" | "monastery" | "bellPavilion" | "stoneHut" | "prayerPole" | "lighthouse" | "stiltHut" | "ruinColumn" | "shrineGate" | "spiritStatue" | "forgeTemple" | "obelisk" | "brazier" | "observatory" | "pylon" | "starAltar" | "ethMainBuilding" | "einsteinBust";

export interface StructureInfo extends SpeciesInfo {
  foot: number; // radius of the ground it stands on, as a share of the height
  sink: number; // the plinth reaches this far below the ground (share of the height): how uneven its site may be
  /** Parts that turn, radians a second: about the model's z axis at height `y` (sails), or about its own upright axis (`upright`: a lighthouse's beam) */
  spin: { y: number; rate: number; upright?: boolean } | null;
}

export const STRUCTURE_INFO: Record<StructureId, StructureInfo> = {
  watchtower: {
    aspect: [1, 1],
    collider: { trunk: 0.19, top: 0.86, taper: 0.75, canopy: { y: 0.9, r: 0.2, h: 0.11 }, lean: 0 },
    sway: 0.012,
    glows: true,
    foot: 0.2,
    sink: 0.2,
    spin: null,
  },
  stoneLantern: {
    aspect: [1, 1],
    collider: { trunk: 0.2, top: 1, taper: 0.9, canopy: null, lean: 0 },
    sway: 0,
    glows: true,
    foot: 0.2,
    sink: 0.2,
    spin: null,
  },
  windmill: {
    aspect: [1, 1],
    collider: { trunk: 0.21, top: 0.8, taper: 0.65, canopy: { y: 0.87, r: 0.17, h: 0.14 }, lean: 0, disc: { y: 0.78, out: 0.21, r: 0.44, t: 0.035 } },
    sway: 0,
    glows: true,
    foot: 0.22,
    sink: 0.2,
    spin: { y: 0.78, rate: 0.45 },
  },
  monastery: {
    aspect: [1, 1],
    collider: { trunk: 0.37, top: 0.64, taper: 0.8, canopy: { y: 0.8, r: 0.21, h: 0.2 }, lean: 0 },
    sway: 0.006,
    glows: true,
    foot: 0.36,
    sink: 0.28,
    spin: null,
  },
  bellPavilion: {
    aspect: [1, 1],
    collider: { trunk: 0.4, top: 0.92, taper: 0.85, canopy: null, lean: 0 },
    sway: 0.02,
    glows: true,
    foot: 0.42,
    sink: 0.4,
    spin: null,
  },
  stoneHut: {
    aspect: [1, 1],
    collider: { trunk: 0.56, top: 0.6, taper: 0.95, canopy: { y: 0.7, r: 0.5, h: 0.3 }, lean: 0 },
    sway: 0,
    glows: true,
    foot: 0.55,
    sink: 0.45,
    spin: null,
  },
  prayerPole: {
    aspect: [1, 1],
    // (the strings of flags don't collide: only the pole and its cairn)
    collider: { trunk: 0.05, top: 1, taper: 0.5, canopy: { y: 0.04, r: 0.14, h: 0.08 }, lean: 0 },
    sway: 0.02,
    glows: false,
    foot: 0.25,
    sink: 0.3,
    spin: null,
  },
  lighthouse: {
    aspect: [1, 1],
    collider: { trunk: 0.14, top: 0.82, taper: 0.62, canopy: { y: 0.89, r: 0.12, h: 0.12 }, lean: 0 },
    sway: 0,
    glows: true,
    foot: 0.2,
    sink: 0.28,
    spin: { y: 0.86, rate: 0.5, upright: true },
  },
  stiltHut: {
    aspect: [1, 1],
    collider: { trunk: 0.3, top: 0.5, taper: 1, canopy: { y: 0.72, r: 0.42, h: 0.28 }, lean: 0 },
    sway: 0,
    glows: true,
    foot: 0.3,
    sink: 0.3,
    spin: null,
  },
  ruinColumn: {
    aspect: [1, 1],
    collider: { trunk: 0.3, top: 1, taper: 0.7, canopy: null, lean: 0 },
    sway: 0,
    glows: false,
    foot: 0.3,
    sink: 0.3,
    spin: null,
  },
  shrineGate: {
    aspect: [1, 1],
    collider: { trunk: 0, top: 0, taper: 1, canopy: null, lean: 0, gate: { x: 0.36, r: 0.045, y: 0.86, bar: 0.06 } },
    sway: 0.012,
    glows: true,
    foot: 0.42,
    sink: 0.3,
    spin: null,
  },
  spiritStatue: {
    aspect: [1, 1],
    collider: { trunk: 0.3, top: 1, taper: 0.6, canopy: null, lean: 0 },
    sway: 0,
    glows: true,
    foot: 0.3,
    sink: 0.3,
    spin: null,
  },
  forgeTemple: {
    aspect: [1, 1],
    collider: { trunk: 0.44, top: 0.7, taper: 0.45, canopy: { y: 0.82, r: 0.13, h: 0.17 }, lean: 0 },
    sway: 0.012,
    glows: true,
    foot: 0.4,
    sink: 0.28,
    spin: null,
  },
  obelisk: {
    aspect: [1, 1],
    collider: { trunk: 0.11, top: 1, taper: 0.4, canopy: null, lean: 0 },
    sway: 0,
    glows: true,
    foot: 0.14,
    sink: 0.3,
    spin: null,
  },
  brazier: {
    aspect: [1, 1],
    collider: { trunk: 0.26, top: 0.85, taper: 1, canopy: null, lean: 0 },
    sway: 0.03,
    glows: true,
    foot: 0.26,
    sink: 0.3,
    spin: null,
  },
  observatory: {
    aspect: [1, 1],
    collider: { trunk: 0.23, top: 0.62, taper: 0.85, canopy: { y: 0.7, r: 0.3, h: 0.22 }, lean: 0 },
    sway: 0,
    glows: true,
    foot: 0.25,
    sink: 0.28,
    spin: { y: 0.72, rate: 0.3, upright: true },
  },
  pylon: {
    aspect: [1, 1],
    collider: { trunk: 0.13, top: 1, taper: 0.5, canopy: null, lean: 0 },
    sway: 0.004,
    glows: true,
    foot: 0.16,
    sink: 0.3,
    spin: null,
  },
  starAltar: {
    aspect: [1, 1],
    collider: { trunk: 0.6, top: 0.2, taper: 1, canopy: { y: 0.72, r: 0.16, h: 0.16 }, lean: 0 },
    sway: 0.03,
    glows: true,
    foot: 0.6,
    sink: 0.5,
    spin: null,
  },
  // An Easter egg: ETH Zurich's main building, where VIScon is held
  ethMainBuilding: {
    aspect: [1, 1],
    collider: { trunk: 0.3, top: 0.72, taper: 0.9, canopy: { y: 0.8, r: 0.27, h: 0.2 }, lean: 0, hall: { x: 1.12, y: 0.55, z: 0.4 } },
    sway: 0.008,
    glows: true,
    foot: 0.8,
    sink: 0.32,
    spin: null,
  },
  // Another Easter egg: a bust of Albert Einstein, who studied and taught at ETH
  einsteinBust: {
    aspect: [1, 1],
    collider: { trunk: 0.24, top: 1, taper: 0.75, canopy: null, lean: 0 },
    sway: 0,
    glows: true,
    foot: 0.25,
    sink: 0.3,
    spin: null,
  },
};

export function structuresOf(biome: Biome): readonly StructureSpec[] {
  return biome.vegetation.kind === "flora" ? (biome.structures ?? []) : [];
}

/** How the `kind`th entry of a node's plant list collides and sways: a species, or a structure after them */
export function kindInfo(biome: Biome, kind: number): SpeciesInfo {
  const species = biome.vegetation.kind === "flora" ? biome.vegetation.species : [];
  return kind < species.length ? SPECIES[species[kind].id] : STRUCTURE_INFO[structuresOf(biome)[kind - species.length].id];
}
