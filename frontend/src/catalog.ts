// The shared catalog (shared/catalog at the repo root, plan F1): every item,
// recipe, skill curve, loot table, enemy, region, NPC and quest of the open
// world, read by this frontend and by the backend (backend/catalog.py) from
// the same JSON. Types come from catalog.gen.ts (generated from the schemas).
// Nothing in races imports this: only the open-world modes do, so it lands in
// their chunks.

import itemsFile from "../../shared/catalog/items.json" with { type: "json" };
import recipesFile from "../../shared/catalog/recipes.json" with { type: "json" };
import skillsFile from "../../shared/catalog/skills.json" with { type: "json" };
import lootFile from "../../shared/catalog/loot.json" with { type: "json" };
import enemiesFile from "../../shared/catalog/enemies.json" with { type: "json" };
import regionsFile from "../../shared/catalog/regions.json" with { type: "json" };
import npcsFile from "../../shared/catalog/npcs.json" with { type: "json" };
import questsFile from "../../shared/catalog/quests.json" with { type: "json" };
import statsFile from "../../shared/catalog/stats.json" with { type: "json" };
import type {
  StatInfo, StatsFile,
  EnemiesFile, Enemy, EnemyId, Item, ItemId, ItemsFile, LootFile, LootTable, LootTableId, Npc, NpcId, NpcsFile,
  Quest, QuestId, QuestsFile, Recipe, RecipeId, RecipesFile, Region, RegionId, RegionsFile, Skill, SkillId, SkillsFile,
} from "./catalog.gen";

export type * from "./catalog.gen";

// JSON imports are typed loosely (string, not the unions); the files are checked against their
// schemas by shared/catalog/check.mjs in `npm run build` and `npm test`, so this cast is safe
const typed = <T>(json: unknown): T => json as T;

const ITEMS_FILE = typed<ItemsFile>(itemsFile);
const RECIPES_FILE = typed<RecipesFile>(recipesFile);
const SKILLS_FILE = typed<SkillsFile>(skillsFile);
const LOOT_FILE = typed<LootFile>(lootFile);
const ENEMIES_FILE = typed<EnemiesFile>(enemiesFile);
const REGIONS_FILE = typed<RegionsFile>(regionsFile);
const NPCS_FILE = typed<NpcsFile>(npcsFile);
const QUESTS_FILE = typed<QuestsFile>(questsFile);
const STATS_FILE = typed<StatsFile>(statsFile);

export const ITEMS: readonly Item[] = ITEMS_FILE.items;
export const RECIPES: readonly Recipe[] = RECIPES_FILE.recipes;
export const SKILLS: readonly Skill[] = SKILLS_FILE.skills;
export const SKILL_CURVES = SKILLS_FILE.curves;
/** The part of skill XP that is also Wind Rank XP (the profile's level) */
export const WIND_RANK_SHARE = SKILLS_FILE.windRankShare;
export const LOOT: readonly LootTable[] = LOOT_FILE.tables;
export const ENEMIES: readonly Enemy[] = ENEMIES_FILE.enemies;
export const REGIONS: readonly Region[] = REGIONS_FILE.regions;
export const HUB = REGIONS_FILE.hub;
export const WORLD_RADIUS = REGIONS_FILE.worldRadius;
export const REGION_CELL = REGIONS_FILE.cell;
/** The Reaches' world seed (the same world for everyone) and how its regions meet */
export const WORLD_SEED = REGIONS_FILE.seed;
export const REGION_BORDERS = REGIONS_FILE.borders;
export const NPCS: readonly Npc[] = NPCS_FILE.npcs;
export const QUESTS: readonly Quest[] = QUESTS_FILE.quests;
/** Every stat once, in display order: base, cap, unit (game/stats.ts does the math) */
export const STAT_INFO: readonly StatInfo[] = STATS_FILE.stats;
export const SWIFTNESS_FLIGHT = STATS_FILE.swiftnessFlight;

function lookup<T extends { readonly id: string }, K extends string>(what: string, list: readonly T[]) {
  const map = new Map(list.map((entry) => [entry.id, entry]));
  const find = (id: K): T => {
    const found = map.get(id);
    if (!found) throw new Error(`No ${what} "${id}" in the catalog`);
    return found;
  };
  return { map: map as ReadonlyMap<string, T>, find };
}

const items = lookup<Item, ItemId>("item", ITEMS);
const recipes = lookup<Recipe, RecipeId>("recipe", RECIPES);
const skills = lookup<Skill, SkillId>("skill", SKILLS);
const loot = lookup<LootTable, LootTableId>("loot table", LOOT);
const enemies = lookup<Enemy, EnemyId>("enemy", ENEMIES);
const regions = lookup<Region, RegionId>("region", REGIONS);
const npcs = lookup<Npc, NpcId>("NPC", NPCS);
const quests = lookup<Quest, QuestId>("quest", QUESTS);

export const ITEM_BY_ID = items.map;
export const item = items.find;
export const recipe = recipes.find;
export const skill = skills.find;
export const lootTable = loot.find;
export const enemy = enemies.find;
export const region = regions.find;
export const npc = npcs.find;
export const quest = quests.find;

/** XP needed for each level after the first, for this skill */
export function skillCurve(id: SkillId): readonly number[] {
  const curve = SKILL_CURVES[skill(id).curve];
  if (!curve) throw new Error(`Skill "${id}" has no curve`);
  return curve;
}
