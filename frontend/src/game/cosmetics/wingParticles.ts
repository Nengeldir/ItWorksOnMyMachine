import * as THREE from "three";
import { Kind } from "../particles";
import { COSMETIC_FX } from "../tuning";
import { type WingId, wingSpec } from "./catalog";

// What each pair of wings sheds as it flies (looks only, CLAUDE.md rule 6). Every pair has its own
// shapes and palette, and the rarer the pair, the richer it gets:
//
//  - common (0): one light sprinkle from the tips;
//  - uncommon (1): two layers, along the whole span;
//  - rare (2): three layers, and a small fan thrown off every downstroke;
//  - legendary (3): four layers, the last a few big slow "hero" pieces, and a wide fan on each beat.
//
// The shapes are the particle system's crisp kinds (feathers, snowflakes, petals, maple leaves, cogs,
// gems, stars, confetti…): hard edges that turn and tumble, never a soft blurred ball. Rates are
// multiples of `COSMETIC_FX.wingParticles` per second and sizes multiples of
// `COSMETIC_FX.wingParticleSize`, so the `?tune` panel still scales them all.
//
// The glowing pairs (cosmetics/wings.ts `AURA`) mark some layers `glow`: those always add light, brighter
// (`COSMETIC_FX.glowParticles`, enough to bloom). The others add light on dark skies but are drawn as solid
// shapes on light ones, where added light vanishes. Either way their colors are pushed for the sky
// (`skyTint`): a little richer on dark maps, much richer and a shade deeper on light ones.

export interface WingLayer {
  /** Each particle picks one of these shapes… */
  kinds: readonly Kind[];
  /** …and one of these colors */
  colors: readonly THREE.Color[];
  /** × `COSMETIC_FX.wingParticles` per second */
  rate: number;
  /** × `COSMETIC_FX.wingParticleSize` */
  size: readonly [number, number];
  life: readonly [number, number];
  /** m/s²: positive falls (snow, leaves), negative rises (embers, light) */
  gravity: number;
  drag: number;
  /** Brightness; above ~1.3 blooms */
  light: number;
  /** Where along the span they start: 0 the shoulder … 1 the tip (a random spot from here out) */
  from: number;
  /** m/s of random scatter */
  scatter: number;
  /** Glows: always added light, brighter (glowing pairs only) */
  glow: boolean;
}

export interface WingParticles {
  rarity: number;
  layers: readonly WingLayer[];
  /** Particles of the first layer thrown down off every downstroke (rare and legendary) */
  burst: number;
}

const colors = (...values: string[]) => values.map((v) => new THREE.Color(v));

type Recipe = Omit<WingLayer, "colors"> & { colors: string[] };
const layer = (r: Partial<Recipe> & Pick<Recipe, "kinds" | "colors" | "rate">): WingLayer => ({
  size: [1, 1.5], life: [0.7, 1.2], gravity: 0, drag: 1.2, light: 1, from: 0.5, scatter: 0.5, glow: false,
  ...r, colors: colors(...r.colors),
});

const RECIPES: Record<WingId, WingLayer[]> = {
  // ── Common ──
  classic: [
    layer({ kinds: [Kind.Feather], colors: ["#fff4f8", "#f1dce9", "#f3c869"], rate: 0.25, size: [1.1, 1.6], gravity: 0.5, from: 0.7 }),
  ],
  sparrow: [
    layer({ kinds: [Kind.Feather], colors: ["#c9a27e", "#fff1dc", "#a77b56"], rate: 0.35, size: [0.9, 1.3], gravity: 0.9, from: 0.6, scatter: 0.8 }),
  ],
  cardboard: [
    layer({ kinds: [Kind.Confetti, Kind.Triangle], colors: ["#e8584f", "#f3c869", "#6fb7d8", "#fff4e0"], rate: 0.4, size: [0.9, 1.3], gravity: 1.6, drag: 1.5, from: 0.5, scatter: 1 }),
  ],
  // ── Uncommon ──
  prism: [
    layer({ kinds: [Kind.Feather], colors: ["#bc8aca", "#69d9ce", "#ffd779", "#ff9ec7"], rate: 0.55, size: [1.2, 1.8], gravity: 0.4, from: 0.4, light: 1.1 }),
    layer({ kinds: [Kind.Sparkle], colors: ["#ffffff", "#c9fff6", "#ffe2ff"], rate: 0.35, size: [0.7, 1.1], life: [0.4, 0.7], gravity: -0.3, from: 0.8, light: 1.4 }),
  ],
  gale: [
    layer({ kinds: [Kind.Petal], colors: ["#66bfaa", "#b8f5d0", "#e7ffe2"], rate: 0.55, size: [1.1, 1.6], gravity: -0.2, from: 0.3, scatter: 1.2 }),
    layer({ kinds: [Kind.Ring], colors: ["#fffaf0", "#e7ffe2"], rate: 0.3, size: [0.6, 0.9], gravity: 0.2, from: 0.6, light: 1.2 }),
  ],
  tide: [
    layer({ kinds: [Kind.Scale], colors: ["#638dc8", "#a9f0ef", "#8fd3ff"], rate: 0.5, size: [1, 1.4], gravity: 0.3, from: 0.4 }),
    layer({ kinds: [Kind.Ring, Kind.Ring, Kind.Petal], colors: ["#ffe9f0", "#ffb3c1", "#ffffff"], rate: 0.35, size: [0.6, 1], gravity: -0.6, from: 0.5, light: 1.2 }),
  ],
  paper: [
    layer({ kinds: [Kind.Triangle, Kind.Confetti], colors: ["#fbf3ea", "#ffffff", "#ffd2da"], rate: 0.5, size: [1, 1.5], gravity: 0.8, drag: 1.6, from: 0.4, scatter: 1 }),
    layer({ kinds: [Kind.Petal], colors: ["#e8546b", "#ff8fa3"], rate: 0.3, size: [0.9, 1.2], gravity: 0.5, from: 0.6 }),
  ],
  butterfly: [
    layer({ kinds: [Kind.Petal], colors: ["#f2a65a", "#ffcf8a", "#ff8fb1"], rate: 0.5, size: [1.1, 1.6], gravity: 0.2, from: 0.4, scatter: 1 }),
    layer({ kinds: [Kind.Scale, Kind.Sparkle], colors: ["#6f73c4", "#ffe08a", "#ffffff"], rate: 0.4, size: [0.6, 0.9], life: [0.5, 0.9], gravity: -0.3, from: 0.7, light: 1.25 }),
  ],
  maple: [
    layer({ kinds: [Kind.Maple], colors: ["#e0703f", "#c8452b", "#f6a33b", "#ffd27a"], rate: 0.55, size: [1.4, 2], life: [0.9, 1.4], gravity: 1.2, drag: 1.4, from: 0.3, scatter: 1.1 }),
    layer({ kinds: [Kind.Petal], colors: ["#ffd27a", "#f0b04a"], rate: 0.3, size: [0.8, 1.1], gravity: 0.8, from: 0.6 }),
  ],
  // ── Rare ──
  frost: [
    layer({ kinds: [Kind.Snowflake], colors: ["#ffffff", "#e8fbff", "#c9ecff"], rate: 0.7, size: [1.4, 2.1], life: [0.9, 1.4], gravity: 0.7, from: 0.3, light: 1.15 }),
    layer({ kinds: [Kind.Hex, Kind.Triangle], colors: ["#a8e4ff", "#c9d8ff", "#e8fbff"], rate: 0.5, size: [0.8, 1.2], gravity: 1, from: 0.5, light: 1.2 }),
    layer({ kinds: [Kind.Sparkle], colors: ["#ffffff", "#dff6ff"], rate: 0.4, size: [0.6, 1], life: [0.35, 0.6], from: 0.8, light: 1.6, glow: true }),
  ],
  ember: [
    layer({ kinds: [Kind.Feather], colors: ["#ffb469", "#ff6a3a", "#ffd181"], rate: 0.6, size: [1.3, 1.9], gravity: -0.6, from: 0.3, light: 1.3 }),
    layer({ kinds: [Kind.Petal, Kind.Sparkle], colors: ["#ffe28a", "#ff9a4a", "#ff3d6e"], rate: 0.6, size: [0.6, 1], life: [0.5, 0.9], gravity: -1.4, from: 0.4, scatter: 0.9, light: 1.5, glow: true }),
    layer({ kinds: [Kind.Glow], colors: ["#ffcf7a", "#ff7a3a"], rate: 0.5, size: [0.5, 0.8], life: [0.6, 1], gravity: -1.8, from: 0.2, scatter: 1, light: 1.3, glow: true }),
  ],
  storm: [
    layer({ kinds: [Kind.Triangle], colors: ["#a98bff", "#8c72c9", "#f1c7ff"], rate: 0.6, size: [1, 1.5], gravity: 0.3, from: 0.4, scatter: 1.4, light: 1.15 }),
    layer({ kinds: [Kind.Sparkle], colors: ["#ffffff", "#f1c7ff", "#7fe0ff"], rate: 0.6, size: [0.8, 1.4], life: [0.2, 0.45], from: 0.6, scatter: 2, light: 1.8, glow: true }),
    layer({ kinds: [Kind.Hex], colors: ["#c08cff", "#e6b8ff"], rate: 0.3, size: [0.7, 1], gravity: 0.6, from: 0.5, light: 1.3 }),
  ],
  clockwork: [
    layer({ kinds: [Kind.Cog], colors: ["#ffd27a", "#c9965a", "#e6b56a"], rate: 0.6, size: [1.2, 1.8], life: [0.8, 1.2], gravity: 1.2, from: 0.3, scatter: 0.8 }),
    layer({ kinds: [Kind.Sparkle, Kind.Triangle], colors: ["#ffe9a8", "#7fd0d6"], rate: 0.5, size: [0.6, 0.9], life: [0.3, 0.6], gravity: 2, from: 0.6, scatter: 1.6, light: 1.4 }),
    layer({ kinds: [Kind.Wisp], colors: ["#e9f6ff"], rate: 0.35, size: [3, 4.5], life: [0.6, 0.9], gravity: -1.2, from: 0.2, light: 0.35 }),
  ],
  ruin: [
    layer({ kinds: [Kind.Hex], colors: ["#ffad4a", "#ffe2a8", "#ffc56a"], rate: 0.6, size: [1, 1.5], gravity: -0.2, from: 0.3, light: 1.3 }),
    layer({ kinds: [Kind.Ring], colors: ["#7fd0c0", "#ffad4a"], rate: 0.35, size: [1, 1.5], life: [0.6, 1], gravity: -0.3, from: 0.5, light: 1.2 }),
    layer({ kinds: [Kind.Triangle, Kind.Confetti], colors: ["#9aa8a2", "#7b8c86", "#c7b28a"], rate: 0.4, size: [0.8, 1.2], gravity: 1.5, from: 0.4, scatter: 0.9, light: 0.8 }),
  ],
  wyrm: [
    layer({ kinds: [Kind.Scale], colors: ["#5fae96", "#8fd8bd", "#bff1e0"], rate: 0.65, size: [1.1, 1.6], gravity: 0.2, from: 0.3, light: 1.1 }),
    layer({ kinds: [Kind.Petal, Kind.Sparkle], colors: ["#f4f0dc", "#ffffff", "#ffe6a8"], rate: 0.45, size: [0.7, 1.1], gravity: -0.4, from: 0.6, light: 1.35 }),
    layer({ kinds: [Kind.Wisp], colors: ["#e8fff6"], rate: 0.35, size: [3.5, 5], life: [0.7, 1.1], gravity: -0.2, from: 0.2, light: 0.35 }),
  ],
  // ── Legendary ──
  astral: [
    layer({ kinds: [Kind.Star5], colors: ["#c4e5ff", "#fff3c2", "#9fa8ff", "#ffb8e6"], rate: 0.8, size: [1.2, 1.9], life: [0.9, 1.4], gravity: -0.2, from: 0.3, light: 1.45 }),
    layer({ kinds: [Kind.Sparkle, Kind.Star], colors: ["#ffffff", "#e6f2ff", "#fff3c2"], rate: 0.8, size: [0.8, 1.4], life: [0.4, 0.8], from: 0.4, scatter: 1, light: 1.7, glow: true }),
    layer({ kinds: [Kind.Ring], colors: ["#c4e5ff", "#ffe3a8"], rate: 0.4, size: [1, 1.6], life: [0.7, 1.1], gravity: -0.1, from: 0.6, light: 1.3 }),
    layer({ kinds: [Kind.Star5], colors: ["#fff6d8", "#d9ecff"], rate: 0.12, size: [3, 4], life: [1.4, 2], gravity: -0.15, drag: 2, from: 0.7, scatter: 0.3, light: 1.6, glow: true }),
  ],
  seraph: [
    layer({ kinds: [Kind.Feather], colors: ["#fff6e6", "#fff1c8", "#ffe6b0", "#ffcf6a"], rate: 0.85, size: [1.4, 2.1], life: [1, 1.5], gravity: -0.3, from: 0.3, scatter: 0.8, light: 1.4 }),
    layer({ kinds: [Kind.Sparkle, Kind.Star5], colors: ["#ffffff", "#ffe6a8", "#ffb27a"], rate: 0.8, size: [0.7, 1.2], life: [0.4, 0.8], gravity: -0.6, from: 0.5, light: 1.8, glow: true }),
    layer({ kinds: [Kind.Ring], colors: ["#ffcf6a", "#fff1c8"], rate: 0.35, size: [1.1, 1.7], life: [0.6, 1], gravity: -0.5, from: 0.5, light: 1.4, glow: true }),
    layer({ kinds: [Kind.Feather], colors: ["#ffffff", "#fff1c8"], rate: 0.14, size: [3.2, 4.4], life: [1.6, 2.2], gravity: 0.15, drag: 2, from: 0.8, scatter: 0.3, light: 1.5 }),
  ],
};

/** The downstroke fan, by rarity (30% more since 2026-10-17, like the steady flow: was 6 and 14) */
const BURST = [0, 0, 8, 18];

const cache = new Map<WingId, WingParticles>();

/** What a pair of wings sheds (every pair has something; the classic one only a sprinkle) */
export function wingParticles(id: WingId): WingParticles {
  let found = cache.get(id);
  if (!found) {
    const rarity = wingSpec(id).rarity;
    found = { rarity, layers: RECIPES[id] ?? RECIPES.classic, burst: BURST[rarity] ?? 0 };
    cache.set(id, found);
  }
  return found;
}

const hsl = { h: 0, s: 0, l: 0 };

/**
 * A layer's color as drawn under this sky (into `out`): saturation × `COSMETIC_FX.saturationDark/Light`, and
 * pale colored tints pulled towards mid lightness by `deepenDark/Light` so they gain color you can see (whites
 * and greys stay as they are)
 */
export function skyTint(color: THREE.Color, darkSky: boolean, out: THREE.Color): THREE.Color {
  const saturate = darkSky ? COSMETIC_FX.saturationDark : COSMETIC_FX.saturationLight;
  const deepen = darkSky ? COSMETIC_FX.deepenDark : COSMETIC_FX.deepenLight;
  color.getHSL(hsl);
  const l = hsl.l - Math.max(0, hsl.l - 0.5) * deepen * Math.min(1, hsl.s * 2);
  return out.setHSL(hsl.h, Math.min(1, hsl.s * saturate), l);
}
