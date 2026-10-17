import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { applyCase, checkCatalog, loadFiles, loadSchemas } from '../../shared/catalog/check.mjs';
import { generate, OUTPUT } from '../../shared/catalog/types.mjs';
import { ENEMIES, HUB, ITEMS, item, LOOT, QUESTS, RECIPES, REGIONS, skill, skillCurve, SKILLS } from '../src/catalog.ts';
import { RARITY_ORDER } from '../src/game/collection/rarity.ts';
import { MAPS } from '../src/game/world/biomes/index.ts';

// The shared catalog (plan F1): shared/catalog/*.json, read by this frontend and by the backend.
// backend/tests/test_catalog.py runs the same broken cases against backend/catalog.py.

const files = loadFiles();
const schemas = loadSchemas();
const { cases } = JSON.parse(readFileSync(new URL('../../shared/catalog/tests/invalid.json', import.meta.url), 'utf8'));

test('the catalog is valid', () => {
  assert.deepEqual(checkCatalog(files, schemas), []);
});

test('every broken catalog fails with a readable message', () => {
  for (const change of cases) {
    const errors = checkCatalog(applyCase(files, change), schemas);
    const text = errors.join('\n');
    for (const expected of change.expect)
      assert.ok(text.includes(expected), `${change.name}: expected "${expected}" among:\n${text || '(no errors)'}`);
  }
});

test('catalog.gen.ts is fresh (run `npm run catalog` after changing shared/catalog)', () => {
  assert.equal(readFileSync(OUTPUT, 'utf8'), generate(), 'frontend/src/catalog.gen.ts is stale: run `npm run catalog`');
});

test("the schemas' rarities and biomes are the game's", () => {
  const common = schemas['common.schema.json'].$defs;
  assert.deepEqual(common.Rarity.enum, [...RARITY_ORDER]);
  assert.deepEqual([...common.BiomeId.enum].sort(), [...MAPS].sort());
});

test('the frontend reads the same entries as the files', () => {
  assert.equal(ITEMS.length, files.items.items.length);
  assert.equal(RECIPES.length, files.recipes.recipes.length);
  assert.equal(SKILLS.length, files.skills.skills.length);
  assert.equal(LOOT.length, files.loot.tables.length);
  assert.equal(ENEMIES.length, files.enemies.enemies.length);
  assert.equal(REGIONS.length, files.regions.regions.length);
  assert.equal(QUESTS.length, files.quests.quests.length);
  assert.equal(HUB.id, 'lanternhaven');
  assert.equal(item('moonwheat').name, 'Moonwheat');
  assert.throws(() => item('nope'), /No item "nope"/);
});

test('every skill curve rises and fits its levels', () => {
  for (const entry of SKILLS) {
    const curve = skillCurve(entry.id);
    assert.equal(curve.length, entry.maxLevel - 1, entry.id);
    for (let i = 1; i < curve.length; i++) assert.ok(curve[i] > curve[i - 1], `${entry.id} step ${i + 1}`);
  }
  assert.equal(skill('runecrafting').maxLevel, 25);
});

test('the plan\'s skills are all there', () => {
  const ids = SKILLS.map((entry) => entry.id).sort();
  assert.deepEqual(ids, ['alchemy', 'carpentry', 'enchanting', 'farming', 'fishing', 'foraging', 'mining', 'purification',
    'runecrafting', 'taming', 'windspire']);
});
