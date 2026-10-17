import { HUB, ITEM_BY_ID, RECIPES, REGIONS } from "../../catalog";
import type { SkillUnlock } from "../../catalog";

/** What a skill unlock reads as: "Recipe · Ashwind axe", "Region · Lantern Wood" */
export function unlockLabel(unlock: SkillUnlock): { kind: string; name: string } {
  if (unlock.kind === "recipe") {
    const output = RECIPES.find((recipe) => recipe.id === unlock.id)?.output.item;
    return { kind: "Recipe", name: (output && ITEM_BY_ID.get(output)?.name) ?? unlock.id };
  }
  if (unlock.kind === "region") {
    const name = unlock.id === HUB.id ? HUB.name : REGIONS.find((region) => region.id === unlock.id)?.name;
    return { kind: "Region", name: name ?? unlock.id };
  }
  return { kind: "Item", name: ITEM_BY_ID.get(unlock.id)?.name ?? unlock.id };
}
