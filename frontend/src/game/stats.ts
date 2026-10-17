// The stat system (docs/open-world-plan.md F2): one pure function from a base
// and a list of sources (gear, charms, teas, pets, callings, skill levels) to
// the pilot's stats. backend/stats.py is the same math on the same numbers
// (shared/catalog/stats.json, items.json, skills.json); both run
// shared/catalog/tests/stats-vectors.json, so the two can't drift.
//
// The order, fixed:
//   1. flat    = base + the sum of every source's `add`
//   2. percent = the sum of every source's `percent` (+10% and +20% make +30%)
//   3. value   = flat × (1 + percent / 100)
//   4. clamped to [0, cap] (cap from stats.json; no cap if it has none)
//   5. rounded to 4 decimals
// Every amount counts in whole units of 1/10 000 and the sums are of
// integers, which are exact: so the order of sources can never change the
// result (float sums can, at a rounding edge), and TypeScript and Python
// agree to the last bit.
//
// Where stats may act (rule 6): Adventure reads combat stats through
// CombatMods; swiftness may raise combat attack speed and, only in runs, top
// speed through FlightMods (swiftnessTopSpeed, capped at +8%). The Reaches
// read the gathering stats. Races read nothing: nothing in a race imports this.

import { item, skill, STAT_INFO, SWIFTNESS_FLIGHT } from "../catalog";
import type { ItemId, SkillId, StatBlock, StatId } from "../catalog";

export type Stats = Record<StatId, number>;

/** One thing that changes stats: flat additions and percentage bonuses */
export interface StatSource {
  readonly add?: StatBlock;
  readonly percent?: StatBlock;
}

/** Every stat, in display order */
export const STAT_IDS: readonly StatId[] = STAT_INFO.map((info) => info.id);
const CAPS = STAT_INFO.map((info) => info.cap ?? Infinity);
const PRECISION = 1e4;

/** An amount in whole units of 1/10 000 */
const units = (value: number): number => Math.round(value * PRECISION);
export const round = (value: number): number => units(value) / PRECISION;

export function emptyStats(): Stats {
  const stats = {} as Stats;
  for (const id of STAT_IDS) stats[id] = 0;
  return stats;
}

/** Every pilot's stats before any source */
export function baseStats(): Stats {
  const stats = emptyStats();
  for (const info of STAT_INFO) stats[info.id] = info.base;
  return stats;
}

/** The stats from a base and its sources, written into `out` (no allocation: for the hot path) */
export function computeStatsInto(out: Stats, base: Stats, sources: readonly StatSource[]): Stats {
  for (let s = 0; s < STAT_IDS.length; s++) {
    const id = STAT_IDS[s];
    let flat = units(base[id]);
    let percent = 0;
    for (let i = 0; i < sources.length; i++) {
      const source = sources[i];
      flat += units(source.add?.[id] ?? 0);
      percent += units(source.percent?.[id] ?? 0);
    }
    const value = (flat / PRECISION) * (1 + percent / (PRECISION * 100));
    out[id] = round(Math.min(CAPS[s], Math.max(0, value)));
  }
  return out;
}

export function computeStats(base: Stats, sources: readonly StatSource[]): Stats {
  return computeStatsInto(emptyStats(), base, sources);
}

/** A piece of gear's stats (items.json `stats`, all flat) */
export function itemSource(id: ItemId): StatSource {
  return { add: item(id).stats ?? {} };
}

/** What skill levels give: each skill's perLevel for every level above the first */
export function skillSource(levels: Partial<Record<SkillId, number>>): StatSource {
  const add: Partial<Record<StatId, number>> = {};
  for (const [id, level] of Object.entries(levels) as [SkillId, number][]) {
    const steps = Math.max(0, Math.min(skill(id).maxLevel, Math.floor(level)) - 1);
    for (const [stat, amount] of Object.entries(skill(id).perLevel) as [StatId, number][])
      add[stat] = (add[stat] ?? 0) + amount * steps;
  }
  return { add };
}

/** Runs only: the fraction swiftness adds to top speed (0.08 = +8% at most) */
export function swiftnessTopSpeed(stats: Stats): number {
  return round(Math.min(SWIFTNESS_FLIGHT.cap, stats.swiftness * SWIFTNESS_FLIGHT.perPoint));
}
