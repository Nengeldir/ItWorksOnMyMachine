import type { Biome } from "./types";

// Ember Wastes: a volcanic valley where a river of lava steps down in glowing
// falls, between terraced basalt tablelands and obsidian spikes, a volcano
// smoking on the horizon, embers rising and ash drifting down.

export const EMBER: Biome = {
  id: "ember",
  name: "Ember Wastes",
  tagline: "Lava falls, basalt terraces and obsidian spires",
  moods: [
    {
      name: "Ashen day",
      horizon: "#b8a090",
      zenith: "#6a6a78",
      grass: "#5a3a30",
      forest: "#2a2222",
      trunk: "#1e1a1a",
      rock: "#2e2a2c",
      snow: "#dddddd",
      cloud: "#7a7070",
      accent: "#ff4fd8",
      sun: "#ffd8b0",
      sunIntensity: 2.0,
      ambient: 1.5,
      sunElevation: 30,
      sunAzimuth: 30,
      night: 0.1,
      mist: "#8a7a70",
      mistDensity: 0.55,
      glow: 1.2,
      underglow: "#5a2a14",
    },
    {
      name: "Ember dusk",
      horizon: "#a8442a",
      zenith: "#2a0f14",
      grass: "#4a2a24",
      forest: "#1e1818",
      trunk: "#141010",
      rock: "#241f22",
      snow: "#c0a0a0",
      cloud: "#4a2a2a",
      accent: "#5ff0ff",
      sun: "#ff9a5a",
      sunIntensity: 1.8,
      ambient: 1.4,
      sunElevation: 8,
      sunAzimuth: -25,
      night: 0.55,
      mist: "#6a2a1a",
      mistDensity: 0.6,
      glow: 1.1,
      underglow: "#b8401a",
    },
  ],
  terrain: {
    kind: "v2",
    ground: {
      depth: 26,
      steps: { length: [200, 340], clearance: 28 },
      river: {
        kind: "lava",
        colors: { deep: "#2a1410", shallow: "#ff5a1a", foam: "#ffd27a" },
        width: [14, 28],
        lakes: 0.35,
        meander: 20,
        bank: 3,
        bed: 3,
      },
      valley: 70,
      wall: 0.32,
      wallCurve: 0.0002,
      floorHills: 3,
      hills: { amp: 50, scale: 140 },
      mountains: { amp: 420, scale: 460, warp: 1.2, sharpness: 2.6, from: 300, ramp: 300 },
      terraces: { step: 16, sharpness: 0.85, cover: 0.45 },
      crevasses: { spacing: 90, width: 4, depth: 8 },
      overhang: 6,
      roughness: 1.8,
      falloff: null,
      level: null,
      extent: 1400,
    },
    groundSurface: 0,
    surfaces: [
      // 0: basalt and scoria, glowing cracks
      { rock: "#2e2a2c", rock2: "#3a3434", under: "#191517", top: "#5a3a30", top2: "#4a4444", snow: false, glow: 0.05 },
      // 1: obsidian
      { rock: "#15121a", rock2: "#2a2030", under: "#0c0a10", top: "#3a3434", snow: false, glow: 0.02, bare: true },
      // 2: banded basalt mesas and arches
      { rock: "#3a3436", rock2: "#2a2628", bands: 4, under: "#1a1618", top: "#6a3a2a", top2: "#4a3a34", snow: false, glow: 0.03 },
      // 3: the volcano, its crater aglow
      { rock: "#2a2224", rock2: "#3a2a26", bands: 7, under: "#140f10", top: "#4a2a24", top2: "#3a2a28", snow: false, glow: 0.12, bare: true },
    ],
    layers: { dirt: "#2a2222", sand: "#3a2a24", snow: "#dddddd", snowLine: 9999, topSlope: 0.72, texture: 1.3, glow: "#ff6a1a" },
    land: {
      gates: { shards: 3, arch: 2, spur: 2, pillars: 2, overhang: 1 },
      gateSurface: 2,
      features: [
        { kind: "shards", count: 60, radius: [4, 10], rise: [30, 120], lateral: [60, 380], tilt: 0.4, surface: 1 },
        { kind: "mesas", count: 9, radius: [50, 110], rise: [80, 200], lateral: [300, 800], step: 18, surface: 2 },
        { kind: "volcano", lateral: 900, radius: 420, rise: 520, surface: 3 },
        { kind: "boulders", count: 100, size: [2, 5], lateral: [20, 150], surface: 0 },
      ],
    },
  },
  vegetation: {
    kind: "flora",
    spacing: 8,
    density: 0.35,
    openDensity: 0.05,
    forest: { scale: 160, cover: 0.35 },
    treeline: 300,
    minUp: 0.72,
    species: [
      { id: "deadTree", weight: 4, height: [5, 10], foliage: "#2a2222", trunk: "#1e1a1a" },
      { id: "basalt", weight: 3, height: [3, 9], foliage: "#3a3436", foliage2: "#2c2829" },
      { id: "bush", weight: 1.5, height: [0.8, 1.6], foliage: "#8a2a1a", foliage2: "#c4401a", where: { forest: false } },
      { id: "boulder", weight: 1, height: [1.2, 3], foliage: "#2e2a2c", foliage2: "#4a3a30", where: { forest: false } },
    ],
    grass: { spacing: 3.2, height: [0.35, 0.7], color: "#3a2a20", tip: "#8a5a2a", flowers: ["#ff6a1a", "#ffb02a"], flowerShare: 0.15, glow: 0.6 },
  },
  structures: [
    // A forge-temple running with lava; obelisks cut with runes, braziers still burning, the columns of a broken aqueduct
    { id: "forgeTemple", landmark: 1100, spacing: 60, chance: 1, height: [28, 34], colors: { stone: "#54474c", stone2: "#3a3136", roof: "#2a2430", cloth: "#ffd24a", light: "#ff7a2a", trim: "#c98a2e" }, where: { above: [0, 140], lateral: [90, 380], facing: true } },
    { id: "obelisk", spacing: 130, chance: 0.7, height: [9, 15], colors: { stone: "#4c4152", stone2: "#3a3136", roof: "#6a5a86", light: "#ff8a3a" }, where: { lateral: [30, 450] } },
    { id: "brazier", spacing: 55, chance: 0.5, height: [3, 4.2], colors: { stone: "#3a3136", stone2: "#2a2428", roof: "#3a3136", cloth: "#ffd24a", light: "#ff7a2a", trim: "#8a6a3a" }, where: { above: [-30, 30], lateral: [0, 260] } },
    { id: "ruinColumn", spacing: 90, chance: 0.6, height: [12, 18], colors: { stone: "#8a7a74", stone2: "#5a4c4a", roof: "#8a7a74" }, where: { above: [-30, 60], lateral: [40, 420] } },
  ],
  sky: { cloudSea: null, puffs: 25, puffsBelow: false, puffLift: 350, mist: { mode: "valley", above: 10, thickness: 26 } },
  particles: {
    ambient: [
      { kind: "embers", rate: 50, colors: ["#ff7a2a", "#ffb04a"], night: 0.5 },
      { kind: "ash", rate: 30, colors: ["#4a4444", "#6a6060"] },
    ],
  },
  portals: { color: "#ff8a3a" },
};
