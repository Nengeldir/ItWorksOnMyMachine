import { makeRng, pick } from "../rng";

export interface Palette {
  name: string;
  horizon: string; // sky at the horizon, also the fog color
  zenith: string; // sky straight up
  grass: string; // meadows on the valley floor
  forest: string; // pine needles, and the darker ground under them
  trunk: string;
  rock: string; // steep faces and the bare slopes below the snow
  snow: string;
  water: string;
  cloud: string;
  accent: string; // the next ring
  sun: string;
  sunIntensity: number;
  ambient: number;
}

// Each map picks one from its seed
export const PALETTES: readonly Palette[] = [
  {
    name: "Alpine",
    horizon: "#cdeaf6",
    zenith: "#3f8fd2",
    grass: "#8cb648",
    forest: "#3f7a3a",
    trunk: "#6b4a2f",
    rock: "#93694a",
    snow: "#f4f6f8",
    water: "#9fe2f0",
    cloud: "#ffffff",
    accent: "#ff4f9a",
    sun: "#fffaf0",
    sunIntensity: 2.4,
    ambient: 1.5,
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
    water: "#a6dccb",
    cloud: "#f4f6ee",
    accent: "#ff7a3d",
    sun: "#fff8e8",
    sunIntensity: 2.0,
    ambient: 1.7,
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
    water: "#95d4e6",
    cloud: "#fff8ee",
    accent: "#2b7fff",
    sun: "#fff1d6",
    sunIntensity: 2.3,
    ambient: 1.5,
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
    water: "#a9b8f0",
    cloud: "#ffd6cc",
    accent: "#00f0ff",
    sun: "#ffe0c8",
    sunIntensity: 2.0,
    ambient: 1.5,
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
    water: "#86c2e6",
    cloud: "#ffffff",
    accent: "#ff3d5a",
    sun: "#ffffff",
    sunIntensity: 2.3,
    ambient: 1.6,
  },
];

export function paletteFor(seed: number): Palette {
  return pick(makeRng(seed, "palette"), PALETTES);
}
