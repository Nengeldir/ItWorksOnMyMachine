// Seeded randomness. Every client builds the same world from the same seed, so
// world code must only use these generators, never Math.random().

export type Rng = () => number;

// cyrb128: hashes a string into four 32-bit seeds
function hash128(text: string): [number, number, number, number] {
  let h1 = 1779033703;
  let h2 = 3144134277;
  let h3 = 1013904242;
  let h4 = 2773480762;
  for (let i = 0; i < text.length; i++) {
    const k = text.charCodeAt(i);
    h1 = h2 ^ Math.imul(h1 ^ k, 597399067);
    h2 = h3 ^ Math.imul(h2 ^ k, 2869860233);
    h3 = h4 ^ Math.imul(h3 ^ k, 951274213);
    h4 = h1 ^ Math.imul(h4 ^ k, 2716044179);
  }
  h1 = Math.imul(h3 ^ (h1 >>> 18), 597399067);
  h2 = Math.imul(h4 ^ (h2 >>> 22), 2869860233);
  h3 = Math.imul(h1 ^ (h3 >>> 17), 951274213);
  h4 = Math.imul(h2 ^ (h4 >>> 19), 2716044179);
  h1 ^= h2 ^ h3 ^ h4;
  h2 ^= h1;
  h3 ^= h1;
  h4 ^= h1;
  return [h1 >>> 0, h2 >>> 0, h3 >>> 0, h4 >>> 0];
}

// sfc32: small, fast and good enough for level generation
export function makeRng(seed: number | string, stream: string): Rng {
  let [a, b, c, d] = hash128(`${seed}/${stream}`);
  return () => {
    a |= 0;
    b |= 0;
    c |= 0;
    d |= 0;
    const t = (((a + b) | 0) + d) | 0;
    d = (d + 1) | 0;
    a = b ^ (b >>> 9);
    b = (c + (c << 3)) | 0;
    c = (c << 21) | (c >>> 11);
    c = (c + t) | 0;
    return (t >>> 0) / 4294967296;
  };
}

export function range(rng: Rng, min: number, max: number): number {
  return min + (max - min) * rng();
}

export function pick<T>(rng: Rng, items: readonly T[]): T {
  return items[Math.floor(rng() * items.length)];
}

export function hashToUnit(text: string): number {
  return hash128(text)[0] / 4294967296;
}

// The same course for everyone on the same (UTC) day
export function dailySeed(date = new Date()): number {
  return 1 + (hash128(`daily/${date.toISOString().slice(0, 10)}`)[0] % 999_999);
}

/** Today's adventure: a seed of its own, so it doesn't start on today's course */
export function dailyRunSeed(date = new Date()): number {
  return 1 + (hash128(`daily-run/${date.toISOString().slice(0, 10)}`)[0] % 999_999);
}

export function randomSeed(): number {
  return 1 + Math.floor(Math.random() * 999_999);
}

/** A fast hash of three integers to 0..1, for per-vertex and per-face variation */
export function hash3(a: number, b: number, c: number): number {
  let h = Math.imul(a | 0, 374761393) ^ Math.imul(b | 0, 668265263) ^ Math.imul(c | 0, 2147483647);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}
