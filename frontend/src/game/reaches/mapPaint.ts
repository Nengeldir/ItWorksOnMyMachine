import { HUB, REGIONS, WORLD_RADIUS } from "../../catalog";
import type { PlaceId } from "../../catalog";
import { EDGE, type MapPlace, regionWeights, valueNoise } from "./regions";

// The Reaches' map painted like a watercolour (plan R1): every place a wash of its own color, blended where
// places meet as the land does, the paper's grain showing through, an ink line along each border and round
// the hub, and drifting cloud over every place not yet found. Painted once per opening (or per discovery)
// into pixels; MapSheet puts it on a canvas and draws the pilot's arrow over it.

/** Metres from the middle to the map's edge (a little beyond the world's, so the sky shows round it) */
export const MAP_REACH = WORLD_RADIUS * 1.08;

type Rgb = [number, number, number];
const hex = (value: string): Rgb => [1, 3, 5].map((i) => parseInt(value.slice(i, i + 2), 16)) as Rgb;

/** Each biome's wash on the map */
const BIOME_WASH: Record<string, string> = {
  verdant: "#9fcc7c", twilight: "#9a86cf", aurora: "#86d2c9", glacier: "#cfe5f2", ember: "#e8a072",
  skyIsles: "#dcca98", archipelago: "#a8cdee", reef: "#62aabc", lagoon: "#82d8ca",
};
const HUB_WASH = hex("#f2cf84");
const SKY = hex("#e7edf6");
const PAPER = hex("#f6ecd8");
const INK = hex("#4a3f52");
const CLOUD = hex("#fbf8f2");

const WASH = new Map<MapPlace, Rgb>([
  [HUB.id as PlaceId, HUB_WASH],
  [EDGE, SKY],
  ...REGIONS.map((region) => [region.id as PlaceId, hex(BIOME_WASH[region.biome] ?? "#cccccc")] as [MapPlace, Rgb]),
]);

/** The world point under a map pixel (north, −z, up) */
export function mapToWorld(px: number, py: number, size: number): [number, number] {
  return [((px + 0.5) / size * 2 - 1) * MAP_REACH, ((py + 0.5) / size * 2 - 1) * MAP_REACH];
}

/** The map pixel over a world point */
export function worldToMap(x: number, z: number, size: number): [number, number] {
  return [((x / MAP_REACH + 1) / 2) * size, ((z / MAP_REACH + 1) / 2) * size];
}

/** RGBA pixels of the map, `size` × `size`; places in `found` are clear, the rest under cloud */
export function paintMap(size: number, found: ReadonlySet<PlaceId>): Uint8ClampedArray {
  const pixels = new Uint8ClampedArray(size * size * 4);
  const metresPerPixel = (MAP_REACH * 2) / size;
  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      const [x, z] = mapToWorld(px, py, size);
      const w = regionWeights(x, z);
      let r = 0, g = 0, b = 0, fog = 0;
      for (let i = 0; i < w.places.length; i++) {
        const place = w.places[i], k = w.weights[i];
        const wash = WASH.get(place) ?? SKY;
        r += wash[0] * k; g += wash[1] * k; b += wash[2] * k;
        if (place !== EDGE && !found.has(place as PlaceId)) fog += k;
      }
      // Watercolour: the wash pools darker in blotches, the paper shows through in others
      const pool = valueNoise(x / 420, z / 420, 91) * 0.6 + valueNoise(x / 130, z / 130, 92) * 0.4;
      const paper = 0.18 + 0.2 * pool;
      r = r * (1 - paper) + PAPER[0] * paper;
      g = g * (1 - paper) + PAPER[1] * paper;
      b = b * (1 - paper) + PAPER[2] * paper;
      // An ink line where places meet (about a pixel and a half wide, whatever the size)
      const ink = Math.max(0, 1 - w.border / (metresPerPixel * 1.4)) * (w.places.includes(EDGE) ? 0.35 : 0.75);
      r += (INK[0] - r) * ink; g += (INK[1] - g) * ink; b += (INK[2] - b) * ink;
      // Cloud over what isn't found yet, thick in the middle of a place, thinning in curls at its rim
      const curl = valueNoise(x / 260, z / 260, 93);
      const cloud = Math.min(1, fog * (0.82 + 0.3 * curl));
      r += (CLOUD[0] - r) * cloud; g += (CLOUD[1] - g) * cloud; b += (CLOUD[2] - b) * cloud;
      const o = (py * size + px) * 4;
      pixels[o] = r; pixels[o + 1] = g; pixels[o + 2] = b; pixels[o + 3] = 255;
    }
  }
  return pixels;
}
