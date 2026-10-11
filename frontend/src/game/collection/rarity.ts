// One rarity palette for everything: the run's bag and pickups, the
// persistent treasures, the inventory, the market and the wheel. Common
// things carry no color of their own (a neutral moonlight white); uncommon is
// sky blue, rare a soft violet, legendary gold. `light` is the brighter tone
// for glows and pickup beams, `deep` the darker one for text and borders on
// pale glass.

export type Rarity = "common" | "uncommon" | "rare" | "legendary";
export const RARITY_ORDER: readonly Rarity[] = ["common", "uncommon", "rare", "legendary"];

export interface RarityStyle {
  name: string;
  /** The rarity's own color (borders, rings, spotlights) */
  color: string;
  /** Brighter, for light shafts and particles */
  light: string;
  /** Darker, for text on pale glass */
  deep: string;
  /** False for common: no tint, just light */
  tinted: boolean;
}

export const RARITY_STYLE: Record<Rarity, RarityStyle> = {
  common: { name: "Common", color: "#e9edf2", light: "#ffffff", deep: "#5d6675", tinted: false },
  uncommon: { name: "Uncommon", color: "#7fcdfb", light: "#c4ecff", deep: "#2f7fb0", tinted: true },
  rare: { name: "Rare", color: "#b48cff", light: "#dccbff", deep: "#6f4cc2", tinted: true },
  legendary: { name: "Legendary", color: "#ffc94d", light: "#fff0bf", deep: "#a8730a", tinted: true },
};

/** 0 common … 3 legendary */
export const rarityIndex = (rarity: Rarity): number => RARITY_ORDER.indexOf(rarity);
export const rarityAt = (index: number): Rarity => RARITY_ORDER[Math.max(0, Math.min(3, Math.round(index)))];
