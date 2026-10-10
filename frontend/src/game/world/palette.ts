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
  sunAzimuth: number; // degrees; 0 = straight down the course (ahead of you), so low suns backlight the run
  night: number; // 0 = day … 1 = night: stars, glowing trims, stronger bloom
  mist: string; // haze that thickens below you, towards the sea of clouds
  mistDensity: number; // 0..1
  glow: number; // brightness of particles and trails; bright scenes need more to read
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

/** Unit vector towards the sun (or moon) */
export function sunDirection(palette: Palette): Vector3 {
  const el = MathUtils.degToRad(palette.sunElevation);
  const az = MathUtils.degToRad(palette.sunAzimuth);
  return new Vector3(Math.sin(az) * Math.cos(el), Math.sin(el), Math.cos(az) * Math.cos(el));
}

export function paletteFor(seed: number): Palette {
  return pick(makeRng(seed, "palette"), PALETTES);
}
