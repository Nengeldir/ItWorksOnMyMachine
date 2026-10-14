import { useEffect } from "react";
import { Color, SRGBColorSpace } from "three";
import { seedLevel } from "./game/world/biomes";
import type { Palette } from "./game/world/palette";

// The UI's ink (text and primary buttons) for each map palette, picked by eye to sit with its sky.
// All are dark enough for body text on the light glass.
const INKS: Record<string, string> = {
  Alpine: "#16304d",
  "Misty pines": "#1e3a2f",
  Autumn: "#3b2417",
  Dusk: "#4a1d2e",
  Winter: "#2e1b3a",
};

const hsl = { h: 0, s: 0, l: 0 };

/** For palettes without a picked ink: the sky's hue, deep and muted */
function deriveInk(palette: Palette): string {
  new Color(palette.zenith).getHSL(hsl, SRGBColorSpace);
  return `#${new Color().setHSL(hsl.h, Math.min(hsl.s, 0.45), 0.16, SRGBColorSpace).getHexString(SRGBColorSpace)}`;
}

const sky = new Color();

/**
 * Whether a map's sky is dark (night, dusk, the deep): the landing page then writes in pristine white and
 * pale gold instead of the map's ink. The sky's average brightness (horizon and zenith), or its night
 */
export function darkSky(palette: Palette): boolean {
  const horizon = sky.set(palette.horizon).getHSL(hsl, SRGBColorSpace).l;
  const zenith = sky.set(palette.zenith).getHSL(hsl, SRGBColorSpace).l;
  return palette.night >= 0.5 || (horizon + zenith) / 2 < 0.45;
}

/** Recolors the whole UI for a map: the CSS derives every shade from these two (and `data-sky`) */
export function applyUiTheme(palette: Palette) {
  const root = document.documentElement;
  root.style.setProperty("--ink", INKS[palette.name] ?? deriveInk(palette));
  root.style.setProperty("--tint", palette.horizon);
  root.dataset.sky = darkSky(palette) ? "dark" : "light";
}

/** Keeps the UI in the colors of the map with this seed */
export function useUiTheme(seed: number | undefined) {
  useEffect(() => {
    if (seed !== undefined) applyUiTheme(seedLevel(seed).palette);
  }, [seed]);
}

/** Keeps the UI in the colors of the level being flown (runs and explore: any biome, any mood) */
export function usePaletteTheme(palette: Palette | undefined) {
  useEffect(() => {
    if (palette) applyUiTheme(palette);
  }, [palette]);
}
