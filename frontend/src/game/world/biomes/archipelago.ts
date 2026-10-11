import type { Biome } from "./types";

// Sky Archipelago: islands adrift in golden light, carved by wind into
// overhangs and arches, waterfalls pouring off their rims into the void, cloud
// banks to dive through, and a sea of clouds far below.

export const ARCHIPELAGO: Biome = {
  id: "archipelago",
  name: "Sky Archipelago",
  tagline: "Islands adrift in golden light, waterfalls pouring into the void",
  moods: [
    {
      name: "Golden hour",
      horizon: "#ffd9a8",
      zenith: "#5f8fd6",
      grass: "#8fbf55",
      forest: "#3f7a3a",
      trunk: "#6b4a2f",
      rock: "#b08d6b",
      snow: "#fff8ee",
      cloud: "#fff2e0",
      accent: "#3fd8ff",
      sun: "#ffd9a0",
      sunIntensity: 2.4,
      ambient: 1.4,
      sunElevation: 9,
      sunAzimuth: -20,
      night: 0.1,
      mist: "#ffe2bf",
      mistDensity: 0.5,
      glow: 1.15,
    },
    {
      name: "Starfall night",
      horizon: "#3a3070",
      zenith: "#0b0a26",
      grass: "#4a6a5a",
      forest: "#1f3a44",
      trunk: "#3a2c3c",
      rock: "#5b4a6a",
      snow: "#d8d0ff",
      cloud: "#6a5aa0",
      accent: "#ffe680",
      sun: "#d0c4ff",
      sunIntensity: 1.3,
      ambient: 1.6,
      sunElevation: 28,
      sunAzimuth: 30,
      night: 1,
      mist: "#4a3c80",
      mistDensity: 0.55,
      glow: 0.9,
    },
  ],
  terrain: {
    kind: "v2",
    ground: null,
    groundSurface: 0,
    surfaces: [
      // 0: warm sandstone islands, banded, grassy on top
      { rock: "#b08d6b", rock2: "#c9a47a", bands: 6, under: "#6d5341", top: "#8fbf55", top2: "#c4cf6a", snow: false },
      // 1: bare floating rock
      { rock: "#9c8a78", rock2: "#b49e86", bands: 4, under: "#5d4d40", top: "#a5c46a", snow: false },
    ],
    layers: { dirt: "#7a5a3a", sand: "#e0c58f", snow: "#ffffff", snowLine: 9999, topSlope: 0.7, texture: 1, glow: "#ffd98a" },
    land: {
      gates: { tunnel: 3, squeeze: 2, arch: 2, needles: 1 },
      gateSurface: 1,
      features: [
        { kind: "islands", count: 120, size: [16, 60], lateral: [30, 300], rise: [-110, 120], surface: 0, holes: 0.35 },
        { kind: "islands", count: 14, size: [70, 120], lateral: [320, 620], rise: [-150, 160], surface: 0, holes: 0.5 },
        { kind: "rings", count: 10, radius: [14, 24], lateral: [60, 260], rise: [-60, 80], surface: 1 },
      ],
    },
    islandFalls: { chance: 0.35, colors: { deep: "#3f8fb0", shallow: "#9fdff0", foam: "#ffffff" } },
  },
  vegetation: {
    kind: "flora",
    spacing: 7,
    density: 0.55,
    openDensity: 0.06,
    forest: { scale: 180, cover: 0.4 },
    treeline: 400,
    minUp: 0.7,
    species: [
      { id: "pine", weight: 3, height: [8, 15], foliage: "#3f7a3a", foliage2: "#4d8a40", trunk: "#6b4a2f" },
      { id: "oak", weight: 3, height: [7, 12], foliage: "#c9a43a", foliage2: "#e0b94a", trunk: "#5b4330", tints: ["#ffffff", "#ffe0b0", "#ffd0a0"] },
      { id: "bush", weight: 2, height: [1.4, 2.4], foliage: "#7aa848", foliage2: "#a8b850", where: { forest: false } },
      { id: "boulder", weight: 0.4, height: [1.2, 2.6], foliage: "#b49e86", foliage2: "#9c8a78", where: { forest: false } },
    ],
    grass: { spacing: 2.6, height: [0.5, 0.9], color: "#7aa848", tip: "#e0d070", flowers: ["#ffffff", "#ffd84a", "#ff9ac8"], flowerShare: 0.2 },
  },
  structures: [
    // A temple on one of the islands; broken colonnades, prayer flags in the wind and lanterns on the others
    { id: "monastery", landmark: 1100, spacing: 40, chance: 1, height: [24, 30], colors: { stone: "#fbf6ea", stone2: "#cfc4ac", roof: "#3f7fb8", cloth: "#f2c761" }, where: { lateral: [40, 420], on: "rock", facing: true } },
    { id: "ruinColumn", spacing: 50, chance: 0.7, height: [8, 13], colors: { stone: "#f3ecdc", stone2: "#b8c79a", roof: "#f3ecdc" }, where: { lateral: [20, 500], on: "rock" } },
    { id: "prayerPole", spacing: 60, chance: 0.6, height: [7, 10], colors: { stone: "#cfc4ac", roof: "#f2c761" }, where: { lateral: [20, 500], on: "rock", hilltop: true } },
    { id: "stoneLantern", spacing: 24, chance: 0.4, height: [2.6, 3.4], colors: { stone: "#efe6d2", stone2: "#b8c79a", roof: "#3f7fb8" }, where: { lateral: [0, 400], on: "rock" } },
  ],
  sky: { cloudSea: { depth: 260 }, puffs: 30, puffsBelow: true, puffLift: 0, banks: 6, mist: { mode: "camera" } },
  particles: {
    ambient: [
      { kind: "dust", rate: 7, colors: ["#fff1cf", "#ffe4b0"], night: 0.4 },
      { kind: "motes", rate: 22, colors: ["#ffe9b0", "#fff6dc"] },
      { kind: "fireflies", rate: 4, colors: ["#fff2a0"], night: 4 },
    ],
  },
  portals: { color: "#ffd27a" },
};
