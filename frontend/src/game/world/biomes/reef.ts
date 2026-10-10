import type { Biome } from "./types";

// Sunken Reef: the run dives under the sea. The racing line follows a valley
// in the seabed down between reef walls: coral arches and table corals to
// thread, kelp forests, anemones and sea fans on the sand, the columns and
// gates of a drowned shrine, a galleon asleep on a reef. Overhead the water's
// surface ripples with light, shafts of it slant down, ripples of it run over
// the sand; schools of fish circle, jellyfish drift, bubbles rise. You fly it
// like any other level: the water only changes what you see.

export const REEF: Biome = {
  id: "reef",
  name: "Sunken Reef",
  tagline: "Coral gardens, kelp forests and a galleon asleep on the seabed",
  moods: [
    {
      // Under the sea, `horizon` is the water all around (and the haze), `zenith` the light of the surface
      name: "Sunlit shallows",
      horizon: "#2f9fc4",
      zenith: "#c9fbff",
      grass: "#4fb8a0",
      forest: "#2f8a7a",
      trunk: "#7a7a3a",
      rock: "#5f7f95",
      snow: "#ffffff",
      cloud: "#8fd8d0",
      accent: "#ff7ab0",
      sun: "#f2fff4",
      sunIntensity: 2.3,
      ambient: 1.5,
      sunElevation: 66,
      sunAzimuth: 15,
      night: 0.12,
      mist: "#1b6f9e",
      mistDensity: 0.5,
      glow: 1.25,
    },
    {
      name: "Moonlit deep",
      horizon: "#0d2f52",
      zenith: "#2f6a9a",
      grass: "#2a6a6a",
      forest: "#1a4a52",
      trunk: "#3a4a3a",
      rock: "#3a4f6a",
      snow: "#dfe9ff",
      cloud: "#1f4a6a",
      accent: "#7affd0",
      sun: "#a8dcff",
      sunIntensity: 1.25,
      ambient: 1.5,
      sunElevation: 62,
      sunAzimuth: -20,
      night: 0.85,
      mist: "#061c38",
      mistDensity: 0.6,
      glow: 0.9,
    },
  ],
  terrain: {
    kind: "v2",
    ground: {
      depth: 30,
      steps: null,
      river: null,
      valley: 80,
      wall: 0.22,
      wallCurve: 0.00012,
      floorHills: 5,
      hills: { amp: 42, scale: 130 },
      mountains: { amp: 250, scale: 420, warp: 1.1, sharpness: 1.5, from: 380, ramp: 320 },
      terraces: { step: 12, sharpness: 0.8, cover: 0.4 },
      crevasses: { spacing: 120, width: 6, depth: 10 },
      overhang: 7,
      roughness: 1,
      falloff: null,
      level: null,
      extent: 1400,
    },
    groundSurface: 0,
    surfaces: [
      // 0: the seabed: blue-grey rock, pale sand with patches of algae
      { rock: "#7f9aa6", rock2: "#6f8c9c", under: "#3f5a6c", top: "#e6dcb4", top2: "#bcd8b0", snow: false, glow: 0.015 },
      // 1: reef limestone, crusted with pink and orange coral on top
      { rock: "#8494b4", rock2: "#a08ac0", streaks: 0.4, under: "#4a5a80", top: "#ff8f9f", top2: "#ffb37a", snow: false, glow: 0.03 },
      // 2: the stems of the table corals
      { rock: "#f0dcc8", rock2: "#e6c8b8", under: "#b89a90", top: "#f6e6d6", snow: false, bare: true },
      // 3: their plates, glowing faintly underneath
      { rock: "#ff7fa0", rock2: "#ff9f7a", under: "#ffd0e0", top: "#ff8fb0", top2: "#ffa98a", snow: false, glow: 0.12, bare: true },
      // 4: brain corals
      { rock: "#e8a04a", rock2: "#d8843a", bands: 2, under: "#9a5a2a", top: "#f2b85a", top2: "#e89a5a", snow: false, bare: true },
      // 5: violet coral arches
      { rock: "#9a6ad8", rock2: "#7a5ac0", bands: 2.5, under: "#4a3a80", top: "#b88af0", snow: false, glow: 0.06, bare: true },
    ],
    layers: { dirt: "#b8b494", sand: "#efe6c0", snow: "#ffffff", snowLine: 9999, topSlope: 0.5, texture: 1.1, glow: "#7afff0" },
    land: {
      gates: { arch: 3, mushroom: 3, pillars: 2, roots: 2, spur: 2, needles: 1, overhang: 1 },
      gateSurface: 1,
      named: { stem: 2, cap: 3 },
      features: [
        { kind: "pillars", count: 70, radius: [7, 16], rise: [30, 110], lateral: [50, 420], surface: 1 },
        // Table corals: the giant mushrooms' shape, in coral
        { kind: "mushrooms", count: 50, cap: [10, 26], rise: [10, 42], lateral: [30, 340], stem: 2, surface: 3 },
        { kind: "arches", count: 12, radius: [12, 24], lateral: [50, 320], surface: 5 },
        { kind: "boulders", count: 70, size: [6, 12], lateral: [18, 240], surface: 4 },
        { kind: "mesas", count: 8, radius: [40, 90], rise: [40, 110], lateral: [220, 700], step: 12, surface: 1 },
      ],
    },
  },
  vegetation: {
    kind: "flora",
    spacing: 6,
    density: 0.45,
    openDensity: 0.16,
    forest: { scale: 130, cover: 0.5 },
    treeline: 260,
    minUp: 0.68,
    species: [
      // Kelp forests; coral gardens, fans, anemones and sponges in the open (`trunk`: the glowing tips and mouths)
      { id: "kelp", weight: 5, height: [10, 24], foliage: "#6fb84a", foliage2: "#b0c84a", trunk: "#8a8a3a", where: { forest: true } },
      { id: "coral", weight: 3, height: [1.5, 4.5], foliage: "#ff7fa0", foliage2: "#ff9f8a", trunk: "#fff0c0", where: { forest: false } },
      { id: "coral", weight: 2, height: [1.5, 4], foliage: "#7a8aff", foliage2: "#a07aff", trunk: "#b0fff0" },
      { id: "seaFan", weight: 2, height: [2, 5], foliage: "#d04a9a", foliage2: "#ff8ac0", trunk: "#8a3a6a" },
      { id: "anemone", weight: 2, height: [0.9, 2], foliage: "#ffb04a", foliage2: "#fff0a0", trunk: "#c05a6a" },
      { id: "sponge", weight: 1.5, height: [1.4, 3.4], foliage: "#f2d24a", foliage2: "#e8a83a", trunk: "#7afff0", where: { forest: false } },
      { id: "boulder", weight: 0.5, height: [1, 2.6], foliage: "#6c7fa0", foliage2: "#ff8f9f", where: { forest: false } },
    ],
    // Seagrass, and little glowing blooms in it
    grass: { spacing: 2.4, height: [0.6, 1.2], color: "#2f8a6a", tip: "#8fe0a0", flowers: ["#ff8ac0", "#ffe08a", "#7afff0"], flowerShare: 0.3, glow: 0.7 },
  },
  structures: [
    // A galleon asleep on a reef; the columns, gates, guardians and lanterns of a drowned shrine, still glowing
    { id: "shipwreck", landmark: 1100, spacing: 60, chance: 1, height: [24, 30], colors: { stone: "#5f7890", stone2: "#3f9a8a", roof: "#a8845a", wood: "#8f6846", cloth: "#e8e0c8", trim: "#ffd24a", light: "#ffe08a" }, where: { lateral: [45, 300] } },
    { id: "ruinColumn", spacing: 70, chance: 0.6, height: [10, 16], colors: { stone: "#dfe8e4", stone2: "#6fb8a8", roof: "#dfe8e4" }, where: { lateral: [20, 420] } },
    { id: "shrineGate", spacing: 120, chance: 0.6, height: [9, 13], colors: { stone: "#9fb0b8", stone2: "#5fa898", roof: "#2f6a7a", cloth: "#e85a6a", light: "#7afff0", trim: "#ffe08a" }, where: { lateral: [30, 380], facing: true } },
    { id: "spiritStatue", spacing: 150, chance: 0.5, height: [4, 6], colors: { stone: "#9fb0b8", stone2: "#5fa898", roof: "#9fb0b8", light: "#7afff0", trim: "#ffe08a" }, where: { lateral: [20, 380], facing: true } },
    { id: "stoneLantern", spacing: 44, chance: 0.4, height: [2.6, 3.6], colors: { stone: "#b8c4c8", stone2: "#5fa898", roof: "#2f6a7a", light: "#7afff0", trim: "#ffe08a" }, where: { lateral: [0, 300] } },
  ],
  sky: {
    cloudSea: null,
    puffs: 0,
    puffsBelow: false,
    puffLift: 0,
    // The deep blue gathers towards the seabed, and the water hides what is far
    mist: { mode: "valley", above: 50, thickness: 50 },
    fog: [30, 640],
    underwater: {
      surface: 130,
      shoals: 70,
      fish: ["#ffb347", "#ffe066", "#ff7a8a", "#7ad8ff", "#c8f0ff", "#b08aff"],
      jellyfish: 110,
      jelly: ["#ff9ad8", "#9ad8ff", "#c8a0ff", "#a0ffe0"],
    },
  },
  particles: {
    ambient: [
      { kind: "bubbles", rate: 14, colors: ["#e8fbff", "#c8f0ff"] },
      // Plankton adrift, lighting up at night
      { kind: "motes", rate: 14, colors: ["#d8fff4", "#aee8ff"], night: 1 },
      { kind: "spores", rate: 5, colors: ["#7afff0", "#ff9ad0"], night: 3 },
    ],
  },
  portals: { color: "#3fe0ff" },
};
