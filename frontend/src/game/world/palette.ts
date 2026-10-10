import { MathUtils, Vector3 } from "three";
import { makeRng, pick } from "../rng";

export interface Palette {
  name: string;
  horizon: string; // sky at the horizon, also the fog color
  zenith: string; // sky straight up
  grass: string; // the islands' grassy tops
  forest: string; // pine needles, and the darker ground under them
  trunk: string;
  rock: string; // steep faces and the bare slopes below the snow
  snow: string;
  cloud: string;
  accent: string; // the next ring
  sun: string;
  sunIntensity: number;
  ambient: number;
  // Lighting mood
  sunElevation: number; // degrees above the horizon
  sunAzimuth: number; // degrees; 0 = straight down the canyon (ahead of you), so low suns backlight the run
  night: number; // 0 = day … 1 = night: stars, glowing trims, stronger bloom
  mist: string; // valley mist that pools on the canyon floor
  mistDensity: number; // 0..1
  clouds: string;
  glow: number; // brightness of particles and trails; bright scenes need more to read
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
    sunElevation: 11,
    sunAzimuth: -28,
    night: 0.2,
    mist: "#ffc4a3",
    mistDensity: 0.55,
    clouds: "#ffd3c4",
    glow: 1.1,
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
    sunElevation: 32,
    sunAzimuth: 35,
    night: 0,
    mist: "#eef8ff",
    mistDensity: 0.45,
    clouds: "#ffffff",
    glow: 1.3,
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
    sunElevation: 48,
    sunAzimuth: -40,
    night: 0,
    mist: "#d8f6de",
    mistDensity: 0.7,
    clouds: "#f6fff7",
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
    ambient: 1.4,
    sunElevation: 24,
    sunAzimuth: 40,
    night: 0,
    mist: "#ffe5bd",
    mistDensity: 0.35,
    clouds: "#fff1da",
    glow: 1.25,
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
    sunElevation: 26,
    sunAzimuth: -18,
    night: 1,
    mist: "#6a3d9e",
    mistDensity: 0.6,
    clouds: "#5e4488",
    glow: 0.9,
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
    ambient: 1.4,
    sunElevation: 42,
    sunAzimuth: 15,
    night: 0,
    mist: "#cbf3ff",
    mistDensity: 0.5,
    clouds: "#ffffff",
    glow: 1.2,
  },
];

/** Unit vector towards the sun (or moon) */
export function sunDirection(palette: Palette): Vector3 {
  const el = MathUtils.degToRad(palette.sunElevation);
  const az = MathUtils.degToRad(palette.sunAzimuth);
  return new Vector3(Math.sin(az) * Math.cos(el), Math.sin(el), Math.cos(az) * Math.cos(el));
}

export function paletteFor(seed: number): Palette {
  return pick(makeRng(seed, "palette"), PALETTES);
}
