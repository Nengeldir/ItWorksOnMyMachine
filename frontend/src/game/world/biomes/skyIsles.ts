import type { Palette } from "../palette";
import type { Biome, VegetationSpec } from "./types";

// Sky Isles: pine-crowned islands adrift over a sea of clouds, threaded by rock
// tunnels. Built like every other map (generator v2); its rock, grass and pines
// take each mood's colors (`recolor`), so autumn woods, a winter's snow and
// starlit rock are the mood's own.

// A map picks one of these from its seed (the "palette" stream)
const MOODS: readonly Palette[] = [
  {
    name: "Alpine",
    horizon: "#cdeaf6",
    zenith: "#3f8fd2",
    grass: "#8cb648",
    forest: "#3f7a3a",
    trunk: "#6b4a2f",
    rock: "#93694a",
    snow: "#f4f6f8",
    cloud: "#ffffff",
    accent: "#ff4f9a",
    sun: "#fffaf0",
    sunIntensity: 2.4,
    ambient: 1.5,
    sunElevation: 32,
    sunAzimuth: 30,
    night: 0,
    mist: "#e6f4fb",
    mistDensity: 0.45,
    glow: 1.25,
  },
  {
    name: "Misty pines",
    horizon: "#e2e9d6",
    zenith: "#9fbcac",
    grass: "#6e8e55",
    forest: "#355a3e",
    trunk: "#5a4634",
    rock: "#b3ab8e",
    snow: "#eeeee2",
    cloud: "#f4f6ee",
    accent: "#ff7a3d",
    sun: "#fff8e8",
    sunIntensity: 2.0,
    ambient: 1.7,
    sunElevation: 22,
    sunAzimuth: -35,
    night: 0,
    mist: "#e9eee0",
    mistDensity: 0.75,
    glow: 1.2,
  },
  {
    name: "Autumn",
    horizon: "#ffe2bd",
    zenith: "#5f9bd6",
    grass: "#a9a24c",
    forest: "#c4642c",
    trunk: "#5a3b25",
    rock: "#8a6b58",
    snow: "#fffaf2",
    cloud: "#fff8ee",
    accent: "#2b7fff",
    sun: "#fff1d6",
    sunIntensity: 2.3,
    ambient: 1.5,
    sunElevation: 26,
    sunAzimuth: 40,
    night: 0,
    mist: "#ffe8cc",
    mistDensity: 0.45,
    glow: 1.2,
  },
  {
    name: "Dusk",
    horizon: "#ffb894",
    zenith: "#5a4fc0",
    grass: "#6f8a4c",
    forest: "#36503c",
    trunk: "#4a3530",
    rock: "#8a5c5e",
    snow: "#ffe8e2",
    cloud: "#ffd6cc",
    accent: "#00f0ff",
    sun: "#ffe0c8",
    sunIntensity: 2.0,
    ambient: 1.5,
    sunElevation: 11,
    sunAzimuth: -28,
    night: 0.2,
    mist: "#ffc4a3",
    mistDensity: 0.55,
    glow: 1.1,
  },
  {
    name: "Winter",
    horizon: "#dde8f4",
    zenith: "#5e86c2",
    grass: "#e6edf4",
    forest: "#2e4f48",
    trunk: "#4d3b30",
    rock: "#7a8594",
    snow: "#ffffff",
    cloud: "#ffffff",
    accent: "#ff3d5a",
    sun: "#ffffff",
    sunIntensity: 2.3,
    ambient: 1.6,
    sunElevation: 28,
    sunAzimuth: 20,
    night: 0,
    mist: "#eef4fb",
    mistDensity: 0.55,
    glow: 1.3,
  },
  {
    name: "Starlight",
    horizon: "#4a2f6e",
    zenith: "#0e0b28",
    grass: "#3f5a6e",
    forest: "#1f3a44",
    trunk: "#3a2c3c",
    rock: "#4b3f6a",
    snow: "#cfd8ff",
    cloud: "#6a5aa0",
    accent: "#b4ff6a",
    sun: "#d8c6ff",
    sunIntensity: 1.6,
    ambient: 1.7,
    sunElevation: 26,
    sunAzimuth: -18,
    night: 1,
    mist: "#5c3f8f",
    mistDensity: 0.6,
    glow: 0.9,
  },
];

/** a mixed with b (hex colors), t of the way */
function mix(a: string, b: string, t: number): string {
  const ca = parseInt(a.slice(1), 16);
  const cb = parseInt(b.slice(1), 16);
  let out = 0;
  for (const shift of [16, 8, 0]) {
    const x = (ca >> shift) & 255;
    const y = (cb >> shift) & 255;
    out |= Math.round(x + (y - x) * t) << shift;
  }
  return `#${out.toString(16).padStart(6, "0")}`;
}

/** The islands' rock and cover, the pines and the grass, in a mood's colors */
function land(palette: Palette): Pick<Biome, "terrain" | "vegetation"> {
  const { rock, grass, forest, trunk, snow } = palette;
  const vegetation: VegetationSpec = {
    kind: "flora",
    spacing: 6,
    density: 0.7,
    openDensity: 0.08,
    forest: { scale: 160, cover: 0.55 },
    treeline: 400,
    minUp: 0.7,
    species: [
      { id: "pine", weight: 5, height: [8, 16], foliage: forest, foliage2: mix(forest, "#ffffff", 0.12), trunk },
      { id: "bush", weight: 1.5, height: [1.3, 2.2], foliage: mix(grass, forest, 0.4), foliage2: grass, where: { forest: false } },
      { id: "boulder", weight: 0.5, height: [1.2, 2.6], foliage: mix(rock, "#ffffff", 0.15), foliage2: rock, where: { forest: false } },
    ],
    grass: { spacing: 2.6, height: [0.5, 0.9], color: grass, tip: mix(grass, "#fff6c8", 0.35), flowers: ["#ffffff", "#ffd84a", "#c9a7ff"], flowerShare: palette.night > 0.5 ? 0.05 : 0.15 },
  };
  return {
    terrain: {
      kind: "v2",
      ground: null,
      groundSurface: 0,
      surfaces: [
        // 0: the islands: banded rock, grass on top
        { rock, rock2: mix(rock, "#ffffff", 0.18), bands: 5, under: mix(rock, "#000000", 0.35), top: grass, top2: mix(grass, forest, 0.25), snow: false },
        // 1: bare rock (the gates)
        { rock: mix(rock, "#808080", 0.2), rock2: mix(rock, "#ffffff", 0.12), bands: 3, under: mix(rock, "#000000", 0.4), top: mix(grass, rock, 0.5), snow: false },
      ],
      layers: { dirt: mix(rock, "#3a2a1c", 0.4), sand: "#e0c58f", snow, snowLine: 9999, topSlope: 0.7, texture: 1, glow: "#ffd98a" },
      land: {
        gates: { tunnel: 4, squeeze: 2, arch: 2, needles: 1 },
        gateSurface: 1,
        features: [
          { kind: "islands", count: 150, size: [18, 55], lateral: [25, 280], rise: [-90, 90], surface: 0, holes: 0.3 },
          { kind: "islands", count: 18, size: [60, 110], lateral: [280, 600], rise: [-140, 120], surface: 0, holes: 0.4 },
        ],
      },
    },
    vegetation,
  };
}

export const SKY_ISLES: Biome = {
  id: "skyIsles",
  name: "Sky Isles",
  tagline: "Pine-crowned islands adrift over a sea of clouds",
  moods: MOODS,
  ...land(MOODS[0]),
  recolor: land,
  structures: [
    // Small things on the island tops: lanterns, and prayer flags on the high points
    { id: "stoneLantern", spacing: 26, chance: 0.35, height: [2.6, 3.4], colors: { stone: "#efe6d2", stone2: "#b8c79a", roof: "#3f7fb8" }, where: { on: "rock" } },
    { id: "prayerPole", spacing: 70, chance: 0.5, height: [7, 10], colors: { stone: "#cfc4ac", roof: "#f2c761" }, where: { on: "rock", hilltop: true } },
  ],
  sky: { cloudSea: { depth: 260 }, puffs: 40, puffsBelow: true, puffLift: 0, banks: 3, mist: { mode: "camera" } },
  particles: {
    ambient: [
      { kind: "motes", rate: 16, colors: ["#ffffff", "#fff6dc"] },
      { kind: "fireflies", rate: 3, colors: ["#fff2a0"], night: 4 },
    ],
  },
  portals: { color: "#8fe3ff" },
};
