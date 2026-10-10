import { CAPES, HATS, SHOES, WINGS } from "./catalog";
import { PETS } from "../pets/catalog";
import { ITEMS } from "../items/models";
import type { Collectible } from "../../profile/types";

/** Offline test catalog. It never represents ownership or issues profile rewards. */
export const SANDBOX_COLLECTION: Collectible[] = [
  ...([ ["cape", CAPES], ["hat", HATS], ["shoes", SHOES], ["wings", WINGS], ["pet", PETS] ] as const)
    .flatMap(([kind, entries]) => entries.map(entry => ({ key: `${kind}:${entry.id}`, kind, asset: entry.id,
      name: entry.name, rarity: "common" as const, xp: 0, slot: kind }))),
  ...ITEMS.map(item => ({ key: `item:${item.id}`, kind: "item" as const, asset: item.id, name: item.name, rarity: "common" as const, xp: 0 })),
];
