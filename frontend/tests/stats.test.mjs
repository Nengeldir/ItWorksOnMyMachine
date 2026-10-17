import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { makeRng } from '../src/game/rng.ts';
import {
  baseStats, computeStats, computeStatsInto, emptyStats, itemSource, skillSource, STAT_IDS, swiftnessTopSpeed,
} from '../src/game/stats.ts';
import { STAT_INFO } from '../src/catalog.ts';

// The stat system (plan F2). backend/tests/test_stats.py runs the same vectors against backend/stats.py.

const { cases } = JSON.parse(readFileSync(new URL('../../shared/catalog/tests/stats-vectors.json', import.meta.url), 'utf8'));

const source = (entry) =>
  entry.item ? itemSource(entry.item) : entry.skills ? skillSource(entry.skills) : { add: entry.add, percent: entry.percent };

test('the shared vectors', () => {
  for (const vector of cases) {
    const base = { ...baseStats(), ...vector.base };
    const stats = computeStats(base, vector.sources.map(source));
    const expected = { ...baseStats(), ...vector.expect };
    assert.deepEqual(stats, expected, vector.name);
    if (vector.topSpeed !== undefined) assert.equal(swiftnessTopSpeed(stats), vector.topSpeed, vector.name);
  }
});

test('every stat is known once, in stats.json order', () => {
  assert.deepEqual([...STAT_IDS], STAT_INFO.map((info) => info.id));
  assert.equal(new Set(STAT_IDS).size, 14);
});

test('the order of sources never changes the result', () => {
  const rng = makeRng(7, 'stats-order');
  const value = () => Math.round((rng() * 200 - 60) * 100) / 100;
  for (let round = 0; round < 300; round++) {
    const sources = Array.from({ length: 1 + Math.floor(rng() * 8) }, () => {
      const add = {};
      const percent = {};
      for (const id of STAT_IDS) {
        if (rng() < 0.3) add[id] = value();
        if (rng() < 0.15) percent[id] = value() / 4;
      }
      return { add, percent };
    });
    const forward = computeStats(baseStats(), sources);
    const shuffled = [...sources];
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    assert.deepEqual(computeStats(baseStats(), shuffled), forward);
    for (const info of STAT_INFO) {
      assert.ok(forward[info.id] >= 0, `${info.id} below 0`);
      if (info.cap !== undefined) assert.ok(forward[info.id] <= info.cap, `${info.id} above its cap`);
    }
  }
});

test('computeStatsInto writes into the given object', () => {
  const out = emptyStats();
  const result = computeStatsInto(out, baseStats(), [itemSource('wing_blades')]);
  assert.equal(result, out);
  assert.equal(out.might, 40);
});
