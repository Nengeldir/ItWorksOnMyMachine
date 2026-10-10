// Plant species as data: how big they get, how they collide and how much the
// wind moves them. Shared by the mesher workers (placement, colliders) and the
// main thread (meshes in flora/meshes.ts). No three.js geometry here.

export type SpeciesId =
  | "pine"
  | "fir"
  | "snowFir"
  | "oak"
  | "birch"
  | "bush"
  | "palm"
  | "jungle"
  | "mushroom"
  | "crystal"
  | "deadTree"
  | "basalt"
  | "boulder"
  | "redwood";

/**
 * How a plant collides, as shares of its height (y) and radius (r):
 * a tapered trunk from the ground up, plus an optional canopy ellipsoid.
 */
export interface ColliderShape {
  trunk: number; // trunk radius at the ground, as a share of the radius
  top: number; // the trunk reaches this share of the height
  taper: number; // trunk radius at the top, as a share of the bottom
  canopy: { y: number; r: number; h: number } | null; // center height, radius, half height (shares)
  lean: number; // the top leans sideways by this share of the height (palms), along the plant's yaw
  /** An upright disc facing along the yaw (a windmill's sails): center height and distance out front, radius, half thickness (shares of the height) */
  disc?: { y: number; out: number; r: number; t: number };
  /** A gate: two posts `x` either side along the model's x axis (radius `r`, up to `y`) and a bar of radius `bar` across their tops (shares of the height) */
  gate?: { x: number; r: number; y: number; bar: number };
  /** A long building: a box from the ground up to `y`, half as long as `x` along the model's x axis and half as deep as `z` (shares of the height) */
  hall?: { x: number; y: number; z: number };
}

export interface SpeciesInfo {
  aspect: [number, number]; // radius as a share of the height
  collider: ColliderShape;
  sway: number; // how far the wind moves the top, as a share of the radius
  glows: boolean; // has self-lit parts (mushroom caps, crystals)
}

const cone = (trunk = 0.9): ColliderShape => ({ trunk, top: 1, taper: 0, canopy: null, lean: 0 });

export const SPECIES: Record<SpeciesId, SpeciesInfo> = {
  pine: { aspect: [0.26, 0.34], collider: cone(), sway: 0.05, glows: false },
  fir: { aspect: [0.2, 0.26], collider: cone(), sway: 0.04, glows: false },
  snowFir: { aspect: [0.22, 0.28], collider: cone(), sway: 0.03, glows: false },
  oak: { aspect: [0.42, 0.55], collider: { trunk: 0.12, top: 0.55, taper: 0.7, canopy: { y: 0.7, r: 0.95, h: 0.25 }, lean: 0 }, sway: 0.06, glows: false },
  birch: { aspect: [0.22, 0.3], collider: { trunk: 0.14, top: 0.7, taper: 0.7, canopy: { y: 0.75, r: 0.85, h: 0.24 }, lean: 0 }, sway: 0.08, glows: false },
  bush: { aspect: [0.7, 0.95], collider: { trunk: 0.5, top: 0.5, taper: 0.8, canopy: { y: 0.45, r: 0.9, h: 0.4 }, lean: 0 }, sway: 0.05, glows: false },
  palm: { aspect: [0.32, 0.42], collider: { trunk: 0.12, top: 0.92, taper: 0.7, canopy: { y: 0.92, r: 0.8, h: 0.12 }, lean: 0.28 }, sway: 0.1, glows: false },
  jungle: { aspect: [0.5, 0.65], collider: { trunk: 0.1, top: 0.7, taper: 0.7, canopy: { y: 0.8, r: 0.95, h: 0.18 }, lean: 0 }, sway: 0.05, glows: false },
  mushroom: { aspect: [0.55, 0.75], collider: { trunk: 0.2, top: 0.6, taper: 0.8, canopy: { y: 0.68, r: 0.92, h: 0.16 }, lean: 0 }, sway: 0.02, glows: true },
  crystal: { aspect: [0.32, 0.45], collider: cone(0.8), sway: 0, glows: true },
  deadTree: { aspect: [0.3, 0.42], collider: { trunk: 0.18, top: 1, taper: 0.4, canopy: null, lean: 0 }, sway: 0.02, glows: false },
  basalt: { aspect: [0.45, 0.6], collider: { trunk: 0.85, top: 1, taper: 0.9, canopy: null, lean: 0 }, sway: 0, glows: false },
  boulder: { aspect: [1.1, 1.5], collider: { trunk: 0, top: 0, taper: 1, canopy: { y: 0.4, r: 0.85, h: 0.5 }, lean: 0 }, sway: 0, glows: false },
  redwood: { aspect: [0.15, 0.2], collider: { trunk: 0.35, top: 0.6, taper: 0.6, canopy: { y: 0.75, r: 0.9, h: 0.3 }, lean: 0 }, sway: 0.02, glows: false },
};

/** Floats per plant in the worker results: species, x, y, z, height, radius, yaw, variant */
export const PLANT_STRIDE = 8;
/** Floats per grass tuft or flower: x, y, z, scale, shade, kind (0 grass, 1+ flower color) */
export const TUFT_STRIDE = 6;
