import type { Biome } from "./types";

// Verdant Highlands: a river valley stepping down through lakes and
// waterfalls, rolling meadows and terraced hillsides, ridged mountains behind,
// forests, and mist pooling on the valley floor in the morning light.

export const VERDANT: Biome = {
  id: "verdant",
  name: "Verdant Highlands",
  tagline: "A river valley of lakes, waterfalls and old forests",
  moods: [
    {
      name: "Morning",
      horizon: "#f3e6cf",
      zenith: "#6aa3da",
      grass: "#6fa53e",
      forest: "#2f6a35",
      trunk: "#5b4330",
      rock: "#7d7466",
      snow: "#f4f7fa",
      cloud: "#ffffff",
      accent: "#ff5fa2",
      sun: "#fff0d8",
      sunIntensity: 2.3,
      ambient: 1.45,
      sunElevation: 17,
      sunAzimuth: 62,
      night: 0,
      mist: "#eef2f2",
      mistDensity: 0.7,
      glow: 1.2,
    },
    {
      name: "Moonlit",
      horizon: "#2d3c60",
      zenith: "#0a1130",
      grass: "#3f6a4a",
      forest: "#1f3d33",
      trunk: "#3a2e2a",
      rock: "#55596a",
      snow: "#d6e0ff",
      cloud: "#55658c",
      accent: "#ffd36b",
      sun: "#c4d6ff",
      sunIntensity: 1.25,
      ambient: 1.45,
      sunElevation: 32,
      sunAzimuth: -40,
      night: 0.9,
      mist: "#3a4d78",
      mistDensity: 0.65,
      glow: 0.9,
    },
  ],
  terrain: {
    kind: "v2",
    ground: {
      depth: 24,
      steps: { length: [170, 300], clearance: 26 },
      river: {
        kind: "water",
        colors: { deep: "#1d5a6e", shallow: "#5fb6a8", foam: "#f4fbff" },
        width: [14, 26],
        lakes: 0.3,
        meander: 22,
        bank: 3,
        bed: 4,
      },
      valley: 70,
      wall: 0.25,
      wallCurve: 0.00005,
      floorHills: 2.5,
      hills: { amp: 60, scale: 180 },
      mountains: { amp: 330, scale: 520, warp: 0.9, sharpness: 2.2, from: 330, ramp: 320 },
      terraces: { step: 7, sharpness: 0.65, cover: 0.3 },
      crevasses: null,
      overhang: 7,
      roughness: 1.4,
      falloff: null,
      level: null,
      extent: 1500,
    },
    groundSurface: 0,
    surfaces: [
      // 0: the valley, hills and mountains
      { rock: "#7d7466", rock2: "#6c6457", under: "#4f4a42", top: "#6fa53e", top2: "#a5b84f", snow: true },
      // 1: outcrops, pillars, arches
      { rock: "#8f8676", rock2: "#a39a88", bands: 5, streaks: 0.3, under: "#5a5348", top: "#79a848", top2: "#93b453", snow: true },
      // 2: worked stone (bridges): courses of pale masonry, a paved top
      { rock: "#d6ccb8", rock2: "#c4baa4", bands: 2.5, under: "#a59c89", top: "#cfc6b0", top2: "#bfb69f", snow: false, bare: true },
    ],
    layers: { dirt: "#6b5236", sand: "#c9b98a", snow: "#f4f7fa", snowLine: 190, topSlope: 0.72, texture: 1, glow: "#ffffff" },
    land: {
      gates: { arch: 3, pillars: 2, needles: 1, spur: 2, overhang: 2 },
      gateSurface: 1,
      features: [
        { kind: "pillars", count: 40, radius: [8, 16], rise: [40, 140], lateral: [120, 420], surface: 1 },
        { kind: "boulders", count: 160, size: [2, 6], lateral: [20, 160], surface: 1 },
        { kind: "arches", count: 6, radius: [18, 30], lateral: [150, 400], surface: 1 },
        // Table mountains on the horizon, their sides stepped in ledges
        { kind: "mesas", count: 7, radius: [60, 120], rise: [120, 260], lateral: [520, 1000], step: 22, surface: 1 },
        { kind: "bridges", chance: 0.8, width: 12, surface: 2 },
      ],
    },
  },
  vegetation: {
    kind: "flora",
    spacing: 7,
    density: 0.62,
    openDensity: 0.04,
    forest: { scale: 260, cover: 0.45 },
    treeline: 210,
    minUp: 0.72,
    species: [
      { id: "pine", weight: 3, height: [9, 18], foliage: "#2f6a35", foliage2: "#3b7a3b", trunk: "#5b4330", where: { above: [-80, 260] } },
      { id: "oak", weight: 4, height: [7, 13], foliage: "#4f8f37", foliage2: "#6aa342", trunk: "#5b4330", where: { above: [-80, 120] } },
      { id: "birch", weight: 2, height: [8, 13], foliage: "#8cbf4a", foliage2: "#a9cd57", trunk: "#e8e4da", where: { above: [-60, 140] } },
      { id: "bush", weight: 2, height: [1.4, 2.6], foliage: "#4d8a35", foliage2: "#6a9d3d", where: { forest: false } },
      { id: "boulder", weight: 0.6, height: [1.2, 3], foliage: "#8f8676", foliage2: "#7d7466", where: { forest: false } },
    ],
    grass: { spacing: 2.4, height: [0.5, 0.95], color: "#4f8a32", tip: "#a8c95a", flowers: ["#ffffff", "#ffd84a", "#c58cff", "#ff7a9c"], flowerShare: 0.25 },
  },
  structures: [
    // Old mills on the shoulders of the hills, watchtowers above the valley, lanterns along the river
    // An Easter egg, in about one level in six: ETH Zurich's main building, dome and all, above the valley
    { id: "ethMainBuilding", landmark: 2400, spacing: 60, chance: 0.1, height: [30, 34], colors: { stone: "#dccba6", stone2: "#b9a987", roof: "#7f9c8f", cloth: "#1f407a" }, where: { above: [-5, 130], lateral: [120, 420], facing: true } },
    // And another: a great bust of Albert Einstein, close by the racing line, in about one level in ten
    { id: "einsteinBust", landmark: 2400, spacing: 30, chance: 0.3, height: [6, 7], colors: { stone: "#c9c2b2", stone2: "#a39c8c", roof: "#a07c4c", cloth: "#f3f0e8", wood: "#3a2c20" }, where: { above: [-26, 25], lateral: [25, 140], facing: true } },
    { id: "windmill", spacing: 130, chance: 0.9, height: [15, 19], colors: { stone: "#d9cfbb", stone2: "#b9b59a", roof: "#b5533c", cloth: "#f6ecd6" }, where: { above: [-10, 150], lateral: [60, 700], forest: false, hilltop: true } },
    { id: "watchtower", spacing: 170, chance: 0.6, height: [15, 21], colors: { stone: "#cfc6b4", stone2: "#9aa784", roof: "#3f6f8f", cloth: "#d84a4a" }, where: { above: [-15, 170], lateral: [50, 800] } },
    { id: "shrineGate", spacing: 130, chance: 0.6, height: [8, 11], colors: { stone: "#bdb6a6", stone2: "#93a07c", roof: "#3a3a44", cloth: "#d84a3a" }, where: { above: [-18, 120], lateral: [30, 500], facing: true } },
    { id: "stoneLantern", spacing: 12, chance: 0.7, height: [2.6, 3.6], colors: { stone: "#bdb6a6", stone2: "#93a07c", roof: "#7a7466" }, where: { lateral: [0, 160], wet: true } },
  ],
  sky: { cloudSea: null, puffs: 50, puffsBelow: false, puffLift: 380, mist: { mode: "valley", above: 18, thickness: 34 } },
  particles: {
    ambient: [
      { kind: "fireflies", rate: 14, colors: ["#d8ff7a", "#fff2a0"], night: 3 },
      { kind: "motes", rate: 10, colors: ["#fff6dc"] },
      { kind: "petals", rate: 3, colors: ["#ffffff", "#ffd6e8"] },
    ],
  },
  portals: { color: "#7dff9e" },
};
