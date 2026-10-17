// The shared catalog's checker (docs/open-world-plan.md, F1). Two layers:
//
// 1. Shape: every file against its JSON Schema in schema/ (a small validator for
//    the subset of draft 2020-12 the schemas use, so nothing new to install).
// 2. Meaning: ids unique, references resolve across files, loot weights > 0,
//    recipes and quest chains don't loop, telegraphs are readable...
//
// Meaning is only checked once the shapes are right. backend/catalog.py does
// the same checks with the same messages (word for word for layer 2), and both
// test suites run tests/invalid.json against their own implementation.
//
//   node shared/catalog/check.mjs        prints every problem, exits 1 if any

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const CATALOG_DIR = dirname(fileURLToPath(import.meta.url));
export const FILES = ["items", "recipes", "skills", "loot", "enemies", "regions", "npcs", "quests", "stats"];
/** Each file's list of entries with ids */
export const LISTS = {
  items: "items", recipes: "recipes", skills: "skills", loot: "tables",
  enemies: "enemies", regions: "regions", npcs: "npcs", quests: "quests", stats: "stats",
};
/** A telegraph must be visible this long before damage (plan A4) */
export const MIN_TELEGRAPH = 0.6;
/** Kinds that are one per slot: gear and tools never stack */
export const UNSTACKABLE = ["tool", "weapon", "mantle", "charm"];

const readJson = (path) => JSON.parse(readFileSync(path, "utf8"));

export function loadSchemas(dir = CATALOG_DIR) {
  const schemas = { "common.schema.json": readJson(join(dir, "schema", "common.schema.json")) };
  for (const file of FILES) schemas[`${file}.schema.json`] = readJson(join(dir, "schema", `${file}.schema.json`));
  return schemas;
}

export function loadFiles(dir = CATALOG_DIR) {
  return Object.fromEntries(FILES.map((file) => [file, readJson(join(dir, `${file}.json`))]));
}

// --- shape -----------------------------------------------------------------------

const typeOf = (value) =>
  value === null ? "null" : Array.isArray(value) ? "array" : Number.isInteger(value) ? "integer" : typeof value;

function matchesType(value, type) {
  const actual = typeOf(value);
  return actual === type || (type === "number" && actual === "integer");
}

function resolveRef(ref, schemas, base) {
  const [file, pointer] = ref.split("#");
  const doc = file ? schemas[file] : schemas[base];
  if (!doc) throw new Error(`schema ${file} not found (from ${base})`);
  let node = doc;
  for (const part of (pointer ?? "").split("/").filter(Boolean)) node = node[part];
  if (!node) throw new Error(`schema ref ${ref} not found (from ${base})`);
  return { node, base: file || base };
}

/** The readable place of a value: the list's entry by its id, then the field path */
export function describePath(file, path, data) {
  const list = LISTS[file];
  let label = "";
  let rest = path;
  if (path[0] === list && typeof path[1] === "number") {
    const id = data?.[list]?.[path[1]]?.id;
    label = typeof id === "string" ? id : `${list}[${path[1]}]`;
    rest = path.slice(2);
  }
  let tail = "";
  for (const part of rest) tail += typeof part === "number" ? `[${part}]` : tail ? `.${part}` : part;
  return [label, tail].filter(Boolean).join(": ");
}

function validate(value, schema, ctx, path, out) {
  if (schema.$ref) {
    const { node, base } = resolveRef(schema.$ref, ctx.schemas, ctx.base);
    validate(value, node, { ...ctx, base }, path, out);
  }
  const fail = (message) => out.push({ path, message });
  if (schema.enum && !schema.enum.includes(value)) {
    fail(`${JSON.stringify(value)} is not one of ${schema.enum.join(", ")}`);
    return;
  }
  if (schema.type && !matchesType(value, schema.type)) {
    fail(`expected ${schema.type}, got ${typeOf(value)}`);
    return;
  }
  if (typeof value === "string") {
    if (schema.minLength !== undefined && value.length < schema.minLength)
      fail(schema.minLength === 1 ? "must not be empty" : `must be at least ${schema.minLength} characters`);
    if (schema.pattern && !new RegExp(schema.pattern, "u").test(value))
      fail(`${JSON.stringify(value)} doesn't match ${schema.pattern}`);
  }
  if (typeof value === "number") {
    if (schema.minimum !== undefined && value < schema.minimum) fail(`must be ≥ ${schema.minimum}`);
    if (schema.exclusiveMinimum !== undefined && value <= schema.exclusiveMinimum) fail(`must be > ${schema.exclusiveMinimum}`);
    if (schema.maximum !== undefined && value > schema.maximum) fail(`must be ≤ ${schema.maximum}`);
  }
  if (Array.isArray(value)) {
    if (schema.minItems !== undefined && value.length < schema.minItems) fail(`needs at least ${schema.minItems} entries`);
    if (schema.maxItems !== undefined && value.length > schema.maxItems) fail(`takes at most ${schema.maxItems} entries`);
    const prefix = schema.prefixItems ?? [];
    value.forEach((item, i) => {
      const itemSchema = prefix[i] ?? schema.items;
      if (itemSchema) validate(item, itemSchema, ctx, [...path, i], out);
    });
  }
  if (typeOf(value) === "object") {
    for (const key of schema.required ?? []) if (!(key in value)) fail(`missing "${key}"`);
    const props = schema.properties ?? {};
    for (const [key, child] of Object.entries(value)) {
      if (props[key]) validate(child, props[key], ctx, [...path, key], out);
      else if (schema.additionalProperties === false) fail(`unknown field "${key}"`);
      else if (typeof schema.additionalProperties === "object") {
        if (schema.propertyNames) {
          const keyErrors = [];
          validate(key, schema.propertyNames, ctx, path, keyErrors);
          for (const error of keyErrors) out.push({ path: [...path, key], message: `key ${error.message}` });
        }
        validate(child, schema.additionalProperties, ctx, [...path, key], out);
      }
    }
  }
}

export function shapeErrors(files, schemas) {
  const errors = [];
  for (const file of FILES) {
    const out = [];
    validate(files[file], schemas[`${file}.schema.json`], { schemas, base: `${file}.schema.json` }, [], out);
    for (const { path, message } of out) {
      const where = describePath(file, path, files[file]);
      errors.push(`${file}.json: ${where ? `${where}: ` : ""}${message}`);
    }
  }
  return errors;
}

// --- meaning ---------------------------------------------------------------------

/** The first loop in a graph of id -> ids, as "a → b → a", or null. Visits in insertion order */
export function findLoop(graph) {
  const state = new Map();
  const stack = [];
  const visit = (node) => {
    state.set(node, 1);
    stack.push(node);
    for (const next of graph.get(node) ?? []) {
      if (state.get(next) === 1) return [...stack.slice(stack.indexOf(next)), next].join(" → ");
      if (!state.has(next)) {
        const loop = visit(next);
        if (loop) return loop;
      }
    }
    stack.pop();
    state.set(node, 2);
    return null;
  };
  for (const node of graph.keys()) {
    if (!state.has(node)) {
      const loop = visit(node);
      if (loop) return loop;
    }
  }
  return null;
}

function addEdge(graph, from, to) {
  if (!graph.has(from)) graph.set(from, []);
  if (!graph.get(from).includes(to)) graph.get(from).push(to);
}

export function meaningErrors(files, schemas = loadSchemas()) {
  const errors = [];
  const err = (message) => errors.push(message);
  const ids = {};
  for (const file of FILES) {
    const seen = new Set();
    for (const entry of files[file][LISTS[file]]) {
      if (seen.has(entry.id)) err(`${file}.json: duplicate id "${entry.id}"`);
      seen.add(entry.id);
    }
    ids[file] = seen;
  }
  const hub = files.regions.hub.id;
  if (ids.regions.has(hub)) err(`regions.json: the hub's id "${hub}" is also a region's`);
  const places = new Set([...ids.regions, hub]);
  const item = (file, id, what, value) => {
    if (!ids.items.has(value)) err(`${file}.json: ${id}: ${what} "${value}" is not in items.json`);
  };
  const skill = (file, id, what, value) => {
    if (!ids.skills.has(value)) err(`${file}.json: ${id}: ${what} "${value}" is not in skills.json`);
  };

  for (const entry of files.items.items) {
    if (entry.region !== undefined && !places.has(entry.region))
      err(`items.json: ${entry.id}: region "${entry.region}" is not in regions.json`);
    if (entry.kind === "tool" && entry.skill === undefined) err(`items.json: ${entry.id}: a tool needs a "skill"`);
    if (entry.skill !== undefined) skill("items", entry.id, "skill", entry.skill);
    for (const key of Object.keys(entry.requires ?? {})) skill("items", entry.id, "requires", key);
    if ((entry.kind === "weapon" || entry.kind === "mantle") && entry.slot === undefined)
      err(`items.json: ${entry.id}: a ${entry.kind} needs a "slot"`);
    if (entry.kind === "currency" && entry.sell !== 0) err(`items.json: ${entry.id}: currency can't be sold (sell must be 0)`);
    if (UNSTACKABLE.includes(entry.kind) && entry.stack !== 1)
      err(`items.json: ${entry.id}: a ${entry.kind} doesn't stack (stack must be 1)`);
  }

  const crafts = new Map();
  for (const recipe of files.recipes.recipes) {
    for (const input of recipe.inputs) {
      item("recipes", recipe.id, "input", input.item);
      addEdge(crafts, input.item, recipe.output.item);
    }
    item("recipes", recipe.id, "output", recipe.output.item);
    const unlock = recipe.unlock;
    if (unlock) {
      const bySkill = unlock.skill !== undefined && unlock.level !== undefined;
      const byCollection = unlock.collection !== undefined && unlock.tier !== undefined;
      if (bySkill === byCollection || Object.keys(unlock).length !== 2)
        err(`recipes.json: ${recipe.id}: unlock needs "skill" and "level", or "collection" and "tier"`);
      else if (bySkill) skill("recipes", recipe.id, "unlock skill", unlock.skill);
      else item("recipes", recipe.id, "unlock collection", unlock.collection);
    }
  }
  const craftLoop = findLoop(crafts);
  if (craftLoop) err(`recipes.json: recipes loop: ${craftLoop}`);

  for (const [name, steps] of Object.entries(files.skills.curves)) {
    steps.forEach((xp, i) => {
      if (i > 0 && xp <= steps[i - 1]) err(`skills.json: curve "${name}" must rise at every level (step ${i + 1})`);
    });
  }
  const unlockFiles = { recipe: "recipes", region: "regions", item: "items" };
  for (const entry of files.skills.skills) {
    const curve = files.skills.curves[entry.curve];
    if (!curve) err(`skills.json: ${entry.id}: curve "${entry.curve}" is not in curves`);
    else if (curve.length !== entry.maxLevel - 1)
      err(`skills.json: ${entry.id}: curve "${entry.curve}" has ${curve.length} steps, ${entry.maxLevel} levels need ${entry.maxLevel - 1}`);
    for (const unlock of entry.unlocks) {
      const file = unlockFiles[unlock.kind];
      if (!ids[file].has(unlock.id))
        err(`skills.json: ${entry.id}: unlock at level ${unlock.level}: ${unlock.kind} "${unlock.id}" is not in ${file}.json`);
      if (unlock.level > entry.maxLevel)
        err(`skills.json: ${entry.id}: unlock at level ${unlock.level} is above max level ${entry.maxLevel}`);
    }
  }

  for (const table of files.loot.tables) {
    const drops = [...(table.guaranteed ?? []), ...table.entries, ...(table.rare ?? [])];
    for (const drop of drops) {
      item("loot", table.id, "drop", drop.item);
      if (drop.count[0] > drop.count[1])
        err(`loot.json: ${table.id}: count of "${drop.item}" is [${drop.count[0]}, ${drop.count[1]}]: min above max`);
    }
    for (const entry of table.entries)
      if (!(entry.weight > 0)) err(`loot.json: ${table.id}: weight of "${entry.item}" must be > 0`);
    if (table.rolls > 0 && table.entries.length === 0) err(`loot.json: ${table.id}: ${table.rolls} rolls but no entries`);
  }

  for (const enemy of files.enemies.enemies) {
    if (!ids.loot.has(enemy.loot)) err(`enemies.json: ${enemy.id}: loot "${enemy.loot}" is not in loot.json`);
    if (enemy.telegraph.seconds < MIN_TELEGRAPH)
      err(`enemies.json: ${enemy.id}: telegraph of ${enemy.telegraph.seconds} s is under ${MIN_TELEGRAPH} s`);
  }

  const { worldRadius } = files.regions;
  for (const region of files.regions.regions) {
    for (const id of region.skills) skill("regions", region.id, "skill", id);
    const distance = Math.hypot(region.center[0], region.center[1]);
    if (distance + region.radius > worldRadius)
      err(`regions.json: ${region.id}: reaches ${Math.round(distance + region.radius)} m from the hub, beyond worldRadius ${worldRadius}`);
  }

  for (const npc of files.npcs.npcs) {
    if (!places.has(npc.region)) err(`npcs.json: ${npc.id}: region "${npc.region}" is not in regions.json`);
    const lines = new Set();
    for (const line of npc.lines) {
      if (lines.has(line.id)) err(`npcs.json: ${npc.id}: duplicate line "${line.id}"`);
      lines.add(line.id);
    }
    for (const line of npc.lines) {
      for (const choice of line.choices ?? []) {
        if (choice.next !== undefined && !lines.has(choice.next))
          err(`npcs.json: ${npc.id}: line "${line.id}" leads to "${choice.next}", not a line of ${npc.id}`);
        if (choice.quest !== undefined && !ids.quests.has(choice.quest))
          err(`npcs.json: ${npc.id}: line "${line.id}" offers quest "${choice.quest}", not in quests.json`);
      }
    }
  }

  const chains = new Map();
  for (const quest of files.quests.quests) {
    if (!ids.npcs.has(quest.giver)) err(`quests.json: ${quest.id}: giver "${quest.giver}" is not in npcs.json`);
    const { goal } = quest;
    const needs = { fetch: ["item", "count"], gather: ["item", "count"], catch: ["item", "count"],
      deliver: ["item", "count", "npc"], explore: ["region"] }[quest.kind];
    const fields = Object.keys(goal);
    if (needs.some((field) => !fields.includes(field)) || fields.some((field) => !needs.includes(field)))
      err(`quests.json: ${quest.id}: a ${quest.kind} goal takes ${needs.map((field) => `"${field}"`).join(", ")}`);
    if (goal.item !== undefined) item("quests", quest.id, "goal item", goal.item);
    if (goal.npc !== undefined && !ids.npcs.has(goal.npc))
      err(`quests.json: ${quest.id}: goal npc "${goal.npc}" is not in npcs.json`);
    if (goal.region !== undefined && !places.has(goal.region))
      err(`quests.json: ${quest.id}: goal region "${goal.region}" is not in regions.json`);
    for (const reward of quest.rewards.items ?? []) item("quests", quest.id, "reward", reward.item);
    for (const id of Object.keys(quest.rewards.xp ?? {})) skill("quests", quest.id, "reward xp", id);
    for (const id of quest.requires ?? []) {
      if (!ids.quests.has(id)) err(`quests.json: ${quest.id}: requires "${id}", not in quests.json`);
      addEdge(chains, quest.id, id);
    }
  }
  const questLoop = findLoop(chains);
  if (questLoop) err(`quests.json: quests loop: ${questLoop}`);

  for (const id of schemas["common.schema.json"].$defs.StatId.enum)
    if (!ids.stats.has(id)) err(`stats.json: missing stat "${id}"`);
  for (const stat of files.stats.stats)
    if (stat.cap !== undefined && stat.base > stat.cap) err(`stats.json: ${stat.id}: base ${stat.base} is above its cap ${stat.cap}`);
  return errors;
}

/** Every problem, shape first; meaning only once the shapes are right */
export function checkCatalog(files = loadFiles(), schemas = loadSchemas()) {
  const shape = shapeErrors(files, schemas);
  return shape.length ? shape : meaningErrors(files, schemas);
}

/** Applies one case of tests/invalid.json to a deep copy of the files */
export function applyCase(files, change) {
  const copy = structuredClone(files);
  const list = copy[change.file][LISTS[change.file]];
  if (change.add) list.push(structuredClone(change.add));
  if (change.id !== undefined) {
    const entry = list.find((candidate) => candidate.id === change.id);
    if (!entry) throw new Error(`invalid.json case "${change.name}": no ${change.file} entry "${change.id}"`);
    Object.assign(entry, structuredClone(change.set ?? {}));
    for (const field of change.drop ?? []) delete entry[field];
  }
  if (change.top) Object.assign(copy[change.file], structuredClone(change.top));
  return copy;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const errors = checkCatalog();
  for (const error of errors) console.error(error);
  if (errors.length) {
    console.error(`\nshared/catalog: ${errors.length} problem${errors.length === 1 ? "" : "s"}`);
    process.exit(1);
  }
  console.log(`shared/catalog: ${FILES.length} files OK`);
}
