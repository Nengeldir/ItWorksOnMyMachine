import { makeRng, pick } from "../rng";

export interface Palette {
  name: string;
  horizon: string; // sky at the horizon, also the fog color
  zenith: string; // sky straight up
  ground: string; // canyon floor
  rock: string; // steep walls and obstacles
  top: string; // high plateaus
  accent: string; // the next ring
  sun: string;
  sunIntensity: number;
  ambient: number;
}

// Each map picks one from its seed, like Superflight's color themes
export const PALETTES: readonly Palette[] = [
  {
    name: "Dusk",
    horizon: "#ffb38a",
    zenith: "#5b4fc4",
    ground: "#c9705a",
    rock: "#8a4b5c",
    top: "#f6d9b8",
    accent: "#00f0ff",
    sun: "#fff0d6",
    sunIntensity: 2.2,
    ambient: 1.4,
  },
  {
    name: "Glacier",
    horizon: "#d6ecff",
    zenith: "#3f86d8",
    ground: "#8db3d6",
    rock: "#4f6f96",
    top: "#ffffff",
    accent: "#ff3d7f",
    sun: "#ffffff",
    sunIntensity: 2.4,
    ambient: 1.5,
  },
  {
    name: "Jungle",
    horizon: "#c9f2d3",
    zenith: "#2d8d86",
    ground: "#4f9a4a",
    rock: "#3b6b58",
    top: "#dbe86d",
    accent: "#ff4fa3",
    sun: "#fffbe0",
    sunIntensity: 2.2,
    ambient: 1.4,
  },
  {
    name: "Desert",
    horizon: "#ffe2a8",
    zenith: "#e27f3a",
    ground: "#e0a35b",
    rock: "#b5603c",
    top: "#fff1cc",
    accent: "#2b7fff",
    sun: "#fff4dc",
    sunIntensity: 2.3,
    ambient: 1.4,
  },
  {
    name: "Nightshade",
    horizon: "#4b2a6e",
    zenith: "#0d0a26",
    ground: "#47307a",
    rock: "#2a1d4a",
    top: "#b4ff6a",
    accent: "#b4ff6a",
    sun: "#d8c6ff",
    sunIntensity: 1.8,
    ambient: 1.6,
  },
  {
    name: "Lagoon",
    horizon: "#a6ebf9",
    zenith: "#1e6bd0",
    ground: "#40c0b0",
    rock: "#2c7a8c",
    top: "#fdf4cf",
    accent: "#ff6a3d",
    sun: "#ffffff",
    sunIntensity: 2.3,
    ambient: 1.4,
  },
];

export function paletteFor(seed: number): Palette {
  return pick(makeRng(seed, "palette"), PALETTES);
}
