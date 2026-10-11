import type { Biome } from "./types";

// Coral Lagoon: jungle islands floating high above a turquoise lagoon, and
// further down, limestone sea stacks notched by the waves, sea arches, sandy
// islets with palms, foam around every rock, and the run ending in a low
// swoop over the water.

export const LAGOON: Biome = {
  id: "lagoon",
  name: "Coral Lagoon",
  tagline: "Sea stacks, palm islets and turquoise shallows",
  moods: [
    {
      name: "Tropical noon",
      horizon: "#d9f3ff",
      zenith: "#2f8fe0",
      grass: "#3f9a4a",
      forest: "#2f7a3a",
      trunk: "#8a6a4a",
      rock: "#d8cfbc",
      snow: "#ffffff",
      cloud: "#ffffff",
      accent: "#ff4fa0",
      sun: "#fffaf0",
      sunIntensity: 2.6,
      ambient: 1.5,
      sunElevation: 58,
      sunAzimuth: 20,
      night: 0,
      mist: "#e6f8ff",
      mistDensity: 0.35,
      glow: 1.3,
    },
    {
      name: "Moonlit lagoon",
      horizon: "#22406a",
      zenith: "#06102a",
      grass: "#2f5a46",
      forest: "#1f4a3a",
      trunk: "#4a3a30",
      rock: "#6a6a7a",
      snow: "#dfe9ff",
      cloud: "#4a5f88",
      accent: "#ffe066",
      sun: "#d6e4ff",
      sunIntensity: 1.3,
      ambient: 1.5,
      sunElevation: 35,
      sunAzimuth: -20,
      night: 0.85,
      mist: "#2a4a7a",
      mistDensity: 0.5,
      glow: 0.9,
    },
  ],
  terrain: {
    kind: "v2",
    ground: {
      depth: 36, // the sandy floor follows the line down, like the sea over it
      steps: null,
      river: null,
      valley: 0,
      wall: 0,
      wallCurve: 0,
      floorHills: 6,
      hills: { amp: 8, scale: 110 },
      mountains: null,
      terraces: null,
      crevasses: null,
      overhang: 0,
      roughness: 0.8,
      falloff: null,
      level: null,
      extent: 1400,
    },
    groundSurface: 0,
    surfaces: [
      // 0: the lagoon's sandy floor and sandbars
      { rock: "#e8d6a8", rock2: "#dcc898", under: "#b8a478", top: "#f2e4bc", top2: "#e6d29a", snow: false },
      // 1: limestone karst, streaked, jungle on top
      { rock: "#d8cfbc", rock2: "#a89e88", streaks: 0.55, under: "#7d7462", top: "#3f9a4a", top2: "#5cb04f", snow: false },
      // 2: sandy islets
      { rock: "#e8d39f", rock2: "#dcc58a", under: "#b8a070", top: "#f0e2b4", top2: "#cfd890", snow: false },
      // 3: coral arches
      { rock: "#ff8a7a", rock2: "#ffb38a", bands: 2, under: "#c85a5a", top: "#ffd0a0", snow: false, bare: true },
    ],
    layers: { dirt: "#7a6a48", sand: "#f3e4b8", snow: "#ffffff", snowLine: 9999, topSlope: 0.68, texture: 1, glow: "#ff9a7a" },
    land: {
      gates: { pillars: 3, arch: 2, tunnel: 1, needles: 1, squeeze: 1 },
      gateSurface: 1,
      features: [
        { kind: "pillars", count: 80, radius: [10, 24], rise: [40, 200], lateral: [60, 520], surface: 1 },
        { kind: "islands", count: 50, size: [18, 45], lateral: [40, 300], rise: [-60, 100], surface: 1, holes: 0.25 },
        { kind: "islets", count: 45, radius: [18, 45], lateral: [50, 700], surface: 2 },
        { kind: "arches", count: 8, radius: [14, 24], lateral: [80, 400], surface: 3 },
      ],
    },
    sea: { level: -24, colors: { deep: "#0a5a8c", shallow: "#3fe0d0", foam: "#ffffff" } },
    islandFalls: { chance: 0.3, colors: { deep: "#2f8fb0", shallow: "#9fe8f0", foam: "#ffffff" } },
  },
  vegetation: {
    kind: "flora",
    spacing: 7,
    density: 0.6,
    openDensity: 0.1,
    forest: { scale: 140, cover: 0.55 },
    treeline: 600,
    minUp: 0.7,
    species: [
      { id: "palm", weight: 4, height: [8, 14], foliage: "#3f8f3a", foliage2: "#5fae45", trunk: "#9a7a5a" },
      { id: "jungle", weight: 4, height: [10, 16], foliage: "#2f7a3a", foliage2: "#3f8f42", trunk: "#5a4a3a", where: { forest: true } },
      { id: "bush", weight: 2, height: [1.2, 2.2], foliage: "#3f8f3a", foliage2: "#e85a8a" },
      { id: "boulder", weight: 0.3, height: [1, 2.2], foliage: "#d8cfbc", foliage2: "#a89e88", where: { forest: false } },
    ],
    grass: { spacing: 2.6, height: [0.5, 0.9], color: "#5aa040", tip: "#b8d070", flowers: ["#ff5a8a", "#ffd84a", "#ffffff", "#ff8a3a"], flowerShare: 0.3 },
  },
  structures: [
    // A lighthouse on a sea stack or an islet; huts on stilts and the columns of a drowned city in the shallows, lanterns on the islets
    { id: "lighthouse", landmark: 1100, spacing: 50, chance: 1, height: [36, 42], colors: { stone: "#f6f1e6", stone2: "#9c9484", roof: "#c8473a", cloth: "#d9574a", light: "#fff0b0" }, where: { lateral: [70, 420], water: [-40, -1], on: "rock" } },
    { id: "stiltHut", spacing: 34, chance: 0.6, height: [7, 9], colors: { stone: "#e6d2a8", stone2: "#d0b888", roof: "#b8894a", wood: "#7a5636" }, where: { lateral: [20, 420], water: [0.4, 2.6], on: "any" } },
    { id: "ruinColumn", spacing: 44, chance: 0.6, height: [9, 14], colors: { stone: "#efe6d2", stone2: "#bfd8c6", roof: "#efe6d2" }, where: { lateral: [20, 500], water: [0.5, 5] } },
    { id: "stoneLantern", spacing: 18, chance: 0.5, height: [2.6, 3.4], colors: { stone: "#e3d8c0", stone2: "#bfd8c6", roof: "#c8473a" }, where: { lateral: [0, 400], water: [-6, -0.6], on: "rock" } },
  ],
  sky: { cloudSea: null, puffs: 45, puffsBelow: false, puffLift: 250, mist: { mode: "valley", above: 10, thickness: 30 } },
  particles: {
    ambient: [
      { kind: "dust", rate: 7, colors: ["#fff1cf", "#ffe4b0"], night: 0.4 },
      { kind: "motes", rate: 8, colors: ["#fffbe8"] },
      { kind: "petals", rate: 2, colors: ["#ff9ac8", "#ffffff"] },
      { kind: "fireflies", rate: 2, colors: ["#d8ff7a"], night: 6 },
    ],
  },
  portals: { color: "#4ff0e0" },
};
