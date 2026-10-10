import type { Biome, StructureSpec } from "../biomes/types";
import { SPECIES, type SpeciesInfo } from "../flora/species";

// Structures as data: towers, lanterns, windmills… Built things ride the
// plants' pipeline (placed in the mesher workers, instanced, impostors far
// away, colliders near you): in a node's plant list they come after the
// biome's species, as kind `species.length + i`. Their meshes are 1 m tall in
// true proportions (radius = height), so parts can turn without shearing.
// No three.js geometry here.

export type StructureId = "watchtower" | "stoneLantern" | "windmill";

export interface StructureInfo extends SpeciesInfo {
  foot: number; // radius of the ground it stands on, as a share of the height
  sink: number; // the plinth reaches this far below the ground (share of the height): how uneven its site may be
  spin: { y: number; rate: number } | null; // parts turning about the model's z axis at this height (sails), radians a second
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
};

export function structuresOf(biome: Biome): readonly StructureSpec[] {
  return biome.vegetation.kind === "flora" ? (biome.structures ?? []) : [];
}

/** How the `kind`th entry of a node's plant list collides and sways: a species, or a structure after them */
export function kindInfo(biome: Biome, kind: number): SpeciesInfo {
  const species = biome.vegetation.kind === "flora" ? biome.vegetation.species : [];
  return kind < species.length ? SPECIES[species[kind].id] : STRUCTURE_INFO[structuresOf(biome)[kind - species.length].id];
}
