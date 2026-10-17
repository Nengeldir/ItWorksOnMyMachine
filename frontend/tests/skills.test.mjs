import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { rankGain, rewardsLadder, SKILL_IDS, skillProgress, withWisdom } from '../src/game/skills.ts';
import { EMBLEMS, SKY_LINKS, SKY_MAP } from '../src/components/world/emblems.ts';
import { skill } from '../src/catalog.ts';

// Skill XP and levels (plan F4). backend/tests/test_skills.py runs the same vectors against skills.py.

const vectors = JSON.parse(readFileSync(new URL('../../shared/catalog/tests/skill-vectors.json', import.meta.url), 'utf8'));

test('levels from XP agree with the server', () => {
  for (const [[id, xp], [level, into, next]] of vectors.levels) assert.deepEqual(skillProgress(id, xp), { level, into, next }, `${id} ${xp}`);
});

test('wisdom and Wind Rank agree with the server', () => {
  for (const [[xp, wisdom], expected] of vectors.wisdom) assert.equal(withWisdom(xp, wisdom), expected);
  for (const [[before, after], expected] of vectors.rank) assert.equal(rankGain(before, after), expected);
});

test('levels never fall as XP grows', () => {
  for (const id of SKILL_IDS) {
    let last = 1;
    for (let xp = 0; xp < 40_000; xp += 97) {
      const { level } = skillProgress(id, xp);
      assert.ok(level >= last, id);
      last = level;
    }
  }
});

test("the ladder adds up each level's stats and places every unlock", () => {
  const ladder = rewardsLadder('farming');
  assert.equal(ladder.length, skill('farming').maxLevel - 1);
  assert.deepEqual(ladder[8].stats, { harvestFortune: 18 });
  assert.deepEqual(ladder.find((step) => step.level === 5).unlocks, [{ level: 5, kind: 'region', id: 'lantern_wood' }]);
});

test('every skill has an emblem and a place on the constellation', () => {
  for (const id of SKILL_IDS) {
    const { points, lines } = EMBLEMS[id];
    assert.ok(points.length >= 3, id);
    for (const [a, b] of lines) assert.ok(points[a] && points[b], `${id} line ${a}-${b}`);
    for (const [x, y] of points) assert.ok(x >= 0 && x <= 100 && y >= 0 && y <= 100, `${id} point in the box`);
    assert.ok(SKY_MAP[id], id);
  }
  for (const [a, b] of SKY_LINKS) assert.ok(SKY_MAP[a] && SKY_MAP[b]);
});
