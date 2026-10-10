import { createNoise2D, createNoise3D, type NoiseFunction2D, type NoiseFunction3D } from "simplex-noise";
import { makeRng } from "../../rng";

// Seeded noise for the terrain generator. Every function is pure and seeded,
// so the main thread and the mesher workers build exactly the same land.

export interface Noise {
  n2: NoiseFunction2D;
  n3: NoiseFunction3D;
}

export function makeNoise(seed: number | string, stream: string): Noise {
  return { n2: createNoise2D(makeRng(seed, `${stream}/2d`)), n3: createNoise3D(makeRng(seed, `${stream}/3d`)) };
}

/** Fractal noise, about -1..1 */
export function fbm(n: NoiseFunction2D, x: number, z: number, octaves: number, lacunarity = 2.03, gain = 0.5): number {
  let sum = 0;
  let amp = 1;
  let norm = 0;
  for (let i = 0; i < octaves; i++) {
    sum += n(x, z) * amp;
    norm += amp;
    x = x * lacunarity + 17.3;
    z = z * lacunarity - 9.1;
    amp *= gain;
  }
  return sum / norm;
}

/**
 * Ridged multifractal (Musgrave), about 0..1: sharp crests where the noise
 * crosses zero, each octave weighted by the last so detail gathers on ridges.
 * `sharpness` squares the ridges further.
 */
export function ridged(n: NoiseFunction2D, x: number, z: number, octaves: number, sharpness = 2): number {
  let sum = 0;
  let amp = 1;
  let norm = 0;
  let weight = 1;
  for (let i = 0; i < octaves; i++) {
    let r = 1 - Math.abs(n(x, z));
    r = r ** sharpness * weight;
    weight = Math.min(1, Math.max(0, r * 1.6));
    sum += r * amp;
    norm += amp;
    x = x * 2.07 + 31.7;
    z = z * 2.07 - 12.9;
    amp *= 0.5;
  }
  return sum / norm;
}

/** Ridged mountains on a domain-warped plane: the warp bends the ranges into natural curves */
export function warpedRidged(n: NoiseFunction2D, x: number, z: number, warp: number, octaves: number, sharpness: number): number {
  const wx = fbm(n, x + 5.2, z + 1.3, 3) * warp;
  const wz = fbm(n, x - 8.7, z + 2.8, 3) * warp;
  return ridged(n, x + wx, z + wz, octaves, sharpness);
}

/** Soft terraces: flat steps with short slopes between them (sharpness 0 = none, 1 = sheer) */
export function terrace(h: number, step: number, sharpness: number): number {
  if (step <= 0 || sharpness <= 0) return h;
  const k = h / step;
  const base = Math.floor(k);
  const f = k - base;
  // Push the fraction towards 0 (the flat) except near the top, where it climbs to the next step
  const e = 1 + sharpness * 10;
  const g = f ** e;
  return (base + (1 - sharpness) * f + sharpness * g) * step;
}
