import type { ReactNode } from "react";
import {
  IconArmchair, IconBook, IconCoffee, IconCoin, IconDiamond, IconFeather, IconHexagon, IconLeaf, IconSeedling, IconShirt, IconSparkles,
  IconSword, IconTools, IconWand,
} from "@tabler/icons-react";
import type { Item, ItemKind } from "../../catalog";
import type { SlotItem } from "../ui/Slot";

// Until item icons are rendered from their models (plan F8), a slot shows its item kind's sign, tinted
// by rarity (ui.css). F8 swaps `icon` for the atlas cell; nothing else changes.

export const ITEM_KIND_ICON: Record<ItemKind, ReactNode> = {
  currency: <IconDiamond size={24} />,
  material: <IconLeaf size={24} />,
  tool: <IconTools size={24} />,
  weapon: <IconSword size={24} />,
  mantle: <IconShirt size={24} />,
  charm: <IconSparkles size={24} />,
  rune: <IconWand size={24} />,
  tea: <IconCoffee size={24} />,
  seed: <IconSeedling size={24} />,
  furniture: <IconArmchair size={24} />,
  book: <IconBook size={24} />,
  gem: <IconHexagon size={24} />,
  stone: <IconCoin size={24} />,
  essence: <IconFeather size={24} />,
};

/** A catalog item as a slot shows it */
export function slotItem(item: Item, count = 1, extra: Partial<SlotItem> = {}): SlotItem {
  return { id: item.id, name: item.name, count, rarity: item.rarity, icon: ITEM_KIND_ICON[item.kind], ...extra };
}
