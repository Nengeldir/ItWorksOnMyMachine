import { Color, MathUtils, SRGBColorSpace, Vector3 } from "three";

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
  aurora?: number; // 0..1: curtains of light across the night sky
  underglow?: string; // light from below the horizon (lava), if any
}

/** Unit vector towards the sun (or moon) */
export function sunDirection(palette: Palette): Vector3 {
  const el = MathUtils.degToRad(palette.sunElevation);
  const az = MathUtils.degToRad(palette.sunAzimuth);
  return new Vector3(Math.sin(az) * Math.cos(el), Math.sin(el), Math.cos(az) * Math.cos(el));
}

const sky = new Color();
const hsl = { h: 0, s: 0, l: 0 };

/** Whether a sky is dark (night, dusk, the deep): its night, or its average brightness (horizon and zenith) */
export function skyIsDark(palette: Palette): boolean {
  const horizon = sky.set(palette.horizon).getHSL(hsl, SRGBColorSpace).l;
  const zenith = sky.set(palette.zenith).getHSL(hsl, SRGBColorSpace).l;
  return palette.night >= 0.5 || (horizon + zenith) / 2 < 0.45;
}
