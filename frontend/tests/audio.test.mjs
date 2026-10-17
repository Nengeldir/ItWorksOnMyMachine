import assert from 'node:assert/strict';
import test from 'node:test';
import { FAMILY_LIMITS, MAX_VOICES, VoicePool, variation } from '../src/game/audio/pool.ts';
import { audible, pickPanner, SPATIAL } from '../src/game/audio/spatial.ts';
import { parseSheet } from '../src/game/audio/samples.ts';
import { BEDS, REGION_BEDS, bedLevels, seamlessLoop } from '../src/game/audio/ambience.ts';
import { RECIPES, familyOf, soundsByFamily } from '../src/game/audio/families.ts';
import { dbToGain } from '../src/game/audio/buses.ts';
import { REGIONS, HUB } from '../src/catalog.ts';

// The open world's audio bookkeeping (plan F9): the voice pool's limits and stealing, the panner pool,
// sample sheets, ambience beds by region and their click-free loops.

test('a family never plays more than its limit, the mix never more than 24', () => {
  const pool = new VoicePool();
  for (let i = 0; i < 20; i++) pool.claim('pluck', 1, i * 0.001, 1);
  assert.equal(pool.active('pluck'), FAMILY_LIMITS.pluck);
  for (const family of Object.keys(FAMILY_LIMITS)) for (let i = 0; i < 30; i++) pool.claim(family, 1, 0.1 + i * 0.001, 1);
  assert.ok(pool.active() <= MAX_VOICES);
  for (const family of Object.keys(FAMILY_LIMITS)) assert.ok(pool.active(family) <= FAMILY_LIMITS[family], family);
});

test('the weakest voice is stolen: the oldest, the quietest; a quieter newcomer is dropped', () => {
  const pool = new VoicePool({ pluck: 2, chime: 8, water: 6, impact: 6, ui: 4, voice: 3, combat: 12, wing: 3 }, 24);
  const a = pool.claim('pluck', 1, 0, 1);
  const b = pool.claim('pluck', 1, 0.5, 1);
  assert.equal(a.steal, null);
  assert.equal(b.steal, null);
  // At 0.6 a has 40% left (weight 0.4), b 90%: a goes
  const c = pool.claim('pluck', 0.8, 0.6, 1);
  assert.equal(c.steal, a.id);
  // A whisper doesn't cut b (0.8 left) or c
  assert.equal(pool.claim('pluck', 0.1, 0.7, 1), null);
  assert.equal(pool.active('pluck'), 2);
  // Voices that ended free their place
  pool.expire(5);
  assert.equal(pool.active(), 0);
  const d = pool.claim('pluck', 0.1, 5, 1);
  assert.equal(d.steal, null);
  pool.release(d.id);
  assert.equal(pool.active(), 0);
});

test('every play varies within ±4% pitch and ±2 dB', () => {
  for (const [r1, r2] of [[0, 0], [0.999999, 0.999999], [0.5, 0.5], [0.25, 0.8]]) {
    const { rate, gain } = variation(r1, r2);
    assert.ok(rate >= 0.96 && rate <= 1.04, String(rate));
    assert.ok(gain >= dbToGain(-2) - 1e-9 && gain <= dbToGain(2) + 1e-9, String(gain));
  }
  assert.equal(variation(0.5, 0.5).rate, 1);
  assert.ok(Math.abs(dbToGain(-6) - 0.501) < 0.001);
});

test('panners: a free one first, else the farthest if the new sound is nearer; nothing past 80 m', () => {
  const slots = [{ busyUntil: 5, distance: 30 }, { busyUntil: 1, distance: 10 }, { busyUntil: 5, distance: 60 }];
  assert.equal(pickPanner(slots, 2, 20), 1);
  slots[1].busyUntil = 5;
  assert.equal(pickPanner(slots, 2, 20), 2);
  assert.equal(pickPanner(slots, 2, 70), -1);
  assert.ok(audible(SPATIAL.cull));
  assert.ok(!audible(SPATIAL.cull + 0.1));
  assert.equal(SPATIAL.panners, 16);
});

test('sample sheets are checked before use', () => {
  const sheet = parseSheet({ file: 'gathering.ogg', sounds: { pluck_leaf: [0, 0.2], chime_crystal: [0.3, 1.1] } });
  assert.deepEqual(sheet.sounds.chime_crystal, { start: 0.3, duration: 1.1 });
  assert.throws(() => parseSheet({ file: '../x.ogg', sounds: {} }), /audio file/);
  assert.throws(() => parseSheet({ file: 'a.ogg', sounds: { x: [0] } }), /\[start, duration\]/);
  assert.throws(() => parseSheet({ file: 'a.ogg', sounds: { x: [0, 9] } }), /under 6 s/);
  assert.throws(() => parseSheet(null), /object/);
});

test('every region of the catalog (and the hub) has its ambience beds', () => {
  for (const region of REGIONS) assert.ok(REGION_BEDS[region.id], region.id);
  assert.ok(REGION_BEDS[HUB.id], HUB.id);
  for (const beds of Object.values(REGION_BEDS)) for (const [bed, level] of Object.entries(beds)) assert.ok(BEDS.includes(bed) && level > 0 && level <= 1);
});

test('beds blend by region weight and stay within 0..1', () => {
  const meadow = bedLevels({ meadow_rise: 1 });
  assert.equal(meadow.birds, REGION_BEDS.meadow_rise.birds);
  assert.equal(meadow.cave, 0);
  const between = bedLevels({ meadow_rise: 0.5, hollow_deeps: 0.5 });
  assert.ok(between.birds > 0 && between.birds < meadow.birds);
  assert.ok(between.cave > 0);
  const piled = bedLevels({ shellshore: 3, drowned_garden: 3 });
  for (const bed of BEDS) assert.ok(piled[bed] <= 1);
  assert.deepEqual(bedLevels({ nowhere: 1, meadow_rise: -1 }), { wind: 0, birds: 0, water: 0, cave: 0, town: 0 });
});

test('a seamless loop runs on from its end into its start like the original did', () => {
  const data = new Float32Array(1000);
  for (let i = 0; i < data.length; i++) data[i] = Math.sin(i * 0.37) + Math.sin(i * 0.051) * 0.5;
  const fade = 100;
  const loop = seamlessLoop(data, fade);
  assert.equal(loop.length, 900);
  // The jump from the last sample to the first is the original's step at that point
  assert.equal(loop[0], data[900]);
  const jump = Math.abs(loop[0] - loop[loop.length - 1]);
  const step = Math.abs(data[900] - data[899]);
  assert.ok(Math.abs(jump - step) < 1e-6);
  // After the fade it's the original untouched
  for (let i = fade; i < loop.length; i++) assert.equal(loop[i], data[i]);
});

test('every sound belongs to a pool family', () => {
  for (const name of Object.keys(RECIPES)) assert.ok(FAMILY_LIMITS[familyOf(name)] > 0, name);
  const families = soundsByFamily();
  for (const family of ['pluck', 'chime', 'water', 'impact', 'ui', 'voice']) assert.ok(families[family]?.length, family);
});
