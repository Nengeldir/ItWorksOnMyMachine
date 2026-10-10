import { useEffect } from "react";
import { Color, SRGBColorSpace } from "three";
import { raceLevel } from "./game/world/biomes";
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

/** Recolors the whole UI for a map: the CSS derives every shade from these two */
export function applyUiTheme(palette: Palette) {
  const root = document.documentElement.style;
  root.setProperty("--ink", INKS[palette.name] ?? deriveInk(palette));
  root.setProperty("--tint", palette.horizon);
}

/** Keeps the UI in the colors of the map with this seed */
export function useUiTheme(seed: number | undefined) {
  useEffect(() => {
    if (seed !== undefined) applyUiTheme(raceLevel(seed).palette);
  }, [seed]);
}

/** Keeps the UI in the colors of the level being flown (runs and explore: any biome, any mood) */
export function usePaletteTheme(palette: Palette | undefined) {
  useEffect(() => {
    if (palette) applyUiTheme(palette);
  }, [palette]);
}
