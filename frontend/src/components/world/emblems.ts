import type { SkillId } from "../../catalog";

// Each skill's emblem (plan F4): a little constellation, stars joined by lines,
// like the landing page's mode emblems. Points are in a 100 × 100 box.

export interface Emblem {
  readonly points: readonly (readonly [number, number])[];
  readonly lines: readonly (readonly [number, number])[];
}

const ring = (n: number, r: number, turn = 0): [number, number][] =>
  Array.from({ length: n }, (_, i) => {
    const a = turn + (i / n) * Math.PI * 2;
    return [Math.round(50 + Math.sin(a) * r), Math.round(50 - Math.cos(a) * r)];
  });

const star = ring(5, 40);
const sun = [[50, 50], ...ring(6, 20), ...ring(6, 40)] as [number, number][];

export const EMBLEMS: Record<SkillId, Emblem> = {
  // An ear of wheat
  farming: {
    points: [[50, 92], [50, 70], [50, 50], [50, 30], [50, 10], [32, 62], [68, 56], [32, 42], [68, 36], [36, 22]],
    lines: [[0, 1], [1, 2], [2, 3], [3, 4], [1, 5], [1, 6], [2, 7], [2, 8], [3, 9]],
  },
  // A leaf and its midrib
  foraging: {
    points: [[50, 8], [80, 44], [50, 92], [20, 50], [50, 50], [64, 30], [36, 68]],
    lines: [[0, 1], [1, 2], [2, 3], [3, 0], [0, 4], [4, 2], [4, 5], [4, 6]],
  },
  // A crystal
  mining: {
    points: [[50, 6], [74, 30], [70, 78], [50, 94], [30, 78], [26, 30], [50, 50]],
    lines: [[0, 1], [1, 2], [2, 3], [3, 4], [4, 5], [5, 0], [0, 6], [6, 3], [5, 6], [6, 1]],
  },
  // A koi
  fishing: {
    points: [[12, 50], [38, 30], [66, 40], [66, 60], [38, 70], [90, 28], [90, 72], [28, 46]],
    lines: [[0, 1], [1, 2], [2, 3], [3, 4], [4, 0], [2, 5], [5, 6], [6, 3]],
  },
  // A star, drawn in one stroke
  enchanting: { points: star, lines: [[0, 2], [2, 4], [4, 1], [1, 3], [3, 0]] },
  // A kettle
  alchemy: {
    points: [[30, 42], [70, 42], [80, 78], [20, 78], [50, 24], [92, 50], [10, 56]],
    lines: [[0, 1], [1, 2], [2, 3], [3, 0], [0, 4], [4, 1], [1, 5], [0, 6], [6, 3]],
  },
  // A paw
  taming: {
    points: [[50, 72], [24, 44], [40, 26], [60, 26], [76, 44], [50, 92]],
    lines: [[0, 1], [0, 2], [0, 3], [0, 4], [1, 2], [2, 3], [3, 4], [0, 5]],
  },
  // A cottage and its door
  carpentry: {
    points: [[18, 50], [50, 16], [82, 50], [78, 90], [22, 90], [44, 90], [44, 68], [56, 68], [56, 90]],
    lines: [[0, 1], [1, 2], [2, 3], [3, 4], [4, 0], [0, 2], [5, 6], [6, 7], [7, 8]],
  },
  // A rune
  runecrafting: {
    points: [[34, 8], [34, 92], [68, 28], [34, 50], [70, 76], [70, 92]],
    lines: [[0, 1], [0, 2], [2, 3], [3, 4], [4, 5]],
  },
  // A sun: purified light
  purification: {
    points: sun,
    lines: [[1, 2], [2, 3], [3, 4], [4, 5], [5, 6], [6, 1], [1, 7], [2, 8], [3, 9], [4, 10], [5, 11], [6, 12], [0, 1], [0, 4]],
  },
  // The Windspire: a tower in a spiral of wind
  windspire: {
    points: [[50, 6], [34, 28], [66, 44], [34, 60], [66, 76], [50, 94], [50, 50]],
    lines: [[0, 1], [1, 2], [2, 3], [3, 4], [4, 5], [0, 6], [6, 5]],
  },
};

/** Where each emblem sits on the journal's constellation (percent of the map) */
export const SKY_MAP: Record<SkillId, readonly [number, number]> = {
  farming: [14, 24],
  foraging: [32, 12],
  mining: [52, 22],
  fishing: [72, 12],
  enchanting: [88, 28],
  alchemy: [22, 54],
  taming: [42, 50],
  carpentry: [62, 54],
  runecrafting: [82, 62],
  purification: [34, 84],
  windspire: [62, 86],
};

/** The faint lines between neighbouring skills on that map */
export const SKY_LINKS: readonly (readonly [SkillId, SkillId])[] = [
  ["farming", "foraging"], ["foraging", "mining"], ["mining", "fishing"], ["fishing", "enchanting"],
  ["farming", "alchemy"], ["alchemy", "taming"], ["taming", "carpentry"], ["carpentry", "runecrafting"],
  ["enchanting", "runecrafting"], ["mining", "taming"], ["alchemy", "purification"], ["purification", "windspire"],
  ["carpentry", "windspire"],
];
