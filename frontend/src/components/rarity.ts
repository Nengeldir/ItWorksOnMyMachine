import type { CSSProperties } from "react";
import { RARITY_STYLE, type Rarity } from "../game/collection/rarity";

/** A collectible's rarity as CSS variables: `--rarity` (its color; common carries none) and `--rarity-deep` (text) */
export const rarityStyle = (item: { rarity: Rarity }) =>
  ({ "--rarity": RARITY_STYLE[item.rarity].color, "--rarity-deep": RARITY_STYLE[item.rarity].deep } as CSSProperties);
