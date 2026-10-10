import type { Biome } from "./types";

// Twilight Forest: a valley of giant trees and giant mushrooms in the blue
// hour, roots arching over the line, streams and ponds glowing with
// bioluminescence, fireflies and spores drifting everywhere.

export const TWILIGHT: Biome = {
  id: "twilight",
  name: "Twilight Forest",
  tagline: "Giant trees, glowing mushrooms and bioluminescent ponds",
  moods: [
    {
      name: "Gloaming",
      horizon: "#8a6fb0",
      zenith: "#2a2a6a",
      grass: "#2f5a5a",
      forest: "#1f3a3a",
      trunk: "#5a3a2a",
      rock: "#4b3f6a",
      snow: "#e0d8ff",
      cloud: "#a08ac8",
      accent: "#7affb0",
      sun: "#ffb88a",
      sunIntensity: 1.6,
      ambient: 1.5,
      sunElevation: 6,
      sunAzimuth: -15,
      night: 0.45,
      mist: "#6a5a9a",
      mistDensity: 0.6,
      glow: 1.0,
    },
    {
      name: "Midnight bloom",
      horizon: "#2a1f4a",
      zenith: "#07051a",
      grass: "#1f3a3a",
      forest: "#152a2a",
      trunk: "#3a2a22",
      rock: "#3a3058",
      snow: "#c8c0ff",
      cloud: "#3f3270",
      accent: "#ffe08a",
      sun: "#bba8ff",
      sunIntensity: 1.1,
      ambient: 1.45,
      sunElevation: 30,
      sunAzimuth: 30,
      night: 1,
      mist: "#2f2458",
      mistDensity: 0.6,
      glow: 0.85,
      aurora: 0.25,
    },
  ],
  terrain: {
    kind: "v2",
    ground: {
      depth: 18,
      steps: { length: [180, 320], clearance: 22 },
      river: {
        kind: "glow",
        colors: { deep: "#06141f", shallow: "#123e4e", foam: "#5ff0ff" },
        width: [8, 16],
        lakes: 0.6,
        meander: 26,
        bank: 2,
        bed: 2.5,
      },
      valley: 90,
      wall: 0.18,
      wallCurve: 0.00006,
      floorHills: 3,
      hills: { amp: 45, scale: 150 },
      mountains: { amp: 220, scale: 380, warp: 1, sharpness: 1.6, from: 420, ramp: 300 },
      terraces: null,
      crevasses: null,
      overhang: 8,
      roughness: 1.6,
      falloff: null,
      level: null,
      extent: 1400,
    },
    groundSurface: 0,
    surfaces: [
      // 0: forest floor: purple stone, teal moss with glowing specks
      { rock: "#4b3f6a", rock2: "#5b4a80", under: "#2a2240", top: "#2f5a5a", top2: "#3a4f78", snow: false, glow: 0.04 },
      // 1: bark of the giant trees and roots, mossy on top
      { rock: "#5a3a2a", rock2: "#4a2e22", streaks: 0.6, under: "#2e1e16", top: "#3a5a3a", top2: "#2f4a3a", snow: false },
      // 2: giant mushroom stems
      { rock: "#d8cfe8", rock2: "#c8bce0", under: "#a89cc0", top: "#e0d8f0", snow: false, bare: true },
      // 3: giant mushroom caps, gills glowing underneath
      { rock: "#b04fd0", rock2: "#7a3ab0", under: "#f0c8ff", top: "#c060e0", top2: "#9a48c8", snow: false, glow: 0.2, bare: true },
      // 4: the giant trees' crowns
      { rock: "#2f5e44", rock2: "#3a6e4c", under: "#1a3328", top: "#4a8a56", top2: "#3a7a50", snow: false, glow: 0.03, bare: true },
    ],
    layers: { dirt: "#3a2c46", sand: "#5a4a70", snow: "#ffffff", snowLine: 9999, topSlope: 0.7, texture: 1, glow: "#8af0ff" },
    land: {
      gates: { mushroom: 3, roots: 2, pillars: 2, needles: 1, arch: 1 },
      gateSurface: 1,
      named: { stem: 2, cap: 3 },
      features: [
        { kind: "trunks", count: 70, radius: [5, 10], rise: [120, 220], lateral: [40, 380], surface: 1, canopy: 4 },
        { kind: "mushrooms", count: 45, cap: [12, 28], rise: [18, 55], lateral: [40, 360], stem: 2, surface: 3 },
        { kind: "arches", count: 10, radius: [12, 22], lateral: [60, 300], surface: 1 },
      ],
    },
  },
  vegetation: {
    kind: "flora",
    spacing: 6,
    density: 0.6,
    openDensity: 0.12,
    forest: { scale: 120, cover: 0.6 },
    treeline: 300,
    minUp: 0.7,
    species: [
      { id: "mushroom", weight: 4, height: [1.5, 5], foliage: "#c060e0", foliage2: "#7af0ff", trunk: "#e0d8f0" },
      { id: "mushroom", weight: 2, height: [1.2, 3.5], foliage: "#3fb8e0", foliage2: "#ffe08a", trunk: "#d8e0f0" },
      { id: "fir", weight: 3, height: [10, 20], foliage: "#1f3a3a", foliage2: "#24433f", trunk: "#3a2c2a", where: { forest: true } },
      { id: "redwood", weight: 1, height: [22, 34], foliage: "#21403a", foliage2: "#2a4a40", trunk: "#6a3a2a", where: { forest: true } },
      { id: "crystal", weight: 0.6, height: [1.5, 3], foliage: "#8af0ff", foliage2: "#c8a0ff", where: { forest: false } },
    ],
    grass: { spacing: 2.6, height: [0.45, 0.85], color: "#1f4a4a", tip: "#3fa0a0", flowers: ["#7af0ff", "#d080ff", "#ffe08a"], flowerShare: 0.35, glow: 1.2 },
  },
  structures: [
    // A great spirit gate; smaller gates, fox statues and lanterns glowing among the trees
    { id: "shrineGate", landmark: 1100, spacing: 50, chance: 1, height: [22, 26], colors: { stone: "#5d6a78", stone2: "#3f6a5c", roof: "#2a2440", cloth: "#7a3fb0", light: "#7af0ff", trim: "#b7fff0" }, where: { above: [-20, 80], lateral: [50, 320], facing: true } },
    { id: "shrineGate", spacing: 110, chance: 0.6, height: [8, 11], colors: { stone: "#5d6a78", stone2: "#3f6a5c", roof: "#2a2440", cloth: "#7a3fb0", light: "#7af0ff", trim: "#b7fff0" }, where: { above: [-20, 100], lateral: [30, 420], facing: true } },
    { id: "spiritStatue", spacing: 140, chance: 0.5, height: [3.5, 5.5], colors: { stone: "#6f7c88", stone2: "#3f7a5c", roof: "#6f7c88", light: "#b7fff0", trim: "#7af0ff" }, where: { lateral: [20, 420], facing: true } },
    { id: "stoneLantern", spacing: 46, chance: 0.35, height: [2.6, 3.6], colors: { stone: "#5d6a78", stone2: "#3f7a5c", roof: "#3a3458", light: "#7af0ff", trim: "#b7fff0" }, where: { lateral: [0, 300] } },
  ],
  sky: { cloudSea: null, puffs: 30, puffsBelow: false, puffLift: 320, mist: { mode: "valley", above: 12, thickness: 30 } },
  particles: {
    ambient: [
      { kind: "fireflies", rate: 30, colors: ["#c8ff7a", "#7af0ff"], night: 2 },
      { kind: "spores", rate: 22, colors: ["#7af0ff", "#d080ff"] },
    ],
  },
  portals: { color: "#c88aff" },
};
