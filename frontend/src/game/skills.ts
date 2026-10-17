// Skill XP and levels (docs/open-world-plan.md F4), the same math as
// backend/skills.py on the same curves (shared/catalog/skills.json); both run
// shared/catalog/tests/skill-vectors.json. The server decides XP (it comes
// only in an action's answer); this shows it: levels, bars, the rewards ladder.

import { SKILLS, skill, skillCurve, WIND_RANK_SHARE } from "../catalog";
import type { SkillId, SkillUnlock, StatBlock } from "../catalog";

export interface SkillProgress {
  level: number;
  /** XP since this level began */
  into: number;
  /** XP this level takes to finish (0 at the top) */
  next: number;
}

export function skillProgress(id: SkillId, xp: number): SkillProgress {
  const curve = skillCurve(id);
  let level = 1;
  let remaining = Math.max(0, Math.floor(xp));
  for (const cost of curve) {
    if (remaining < cost) return { level, into: remaining, next: cost };
    remaining -= cost;
    level++;
  }
  return { level, into: 0, next: 0 };
}

/** XP after wisdom (a percentage bonus), applied once, rounded down */
export const withWisdom = (xp: number, wisdom: number): number => Math.floor((xp * (100 + wisdom)) / 100);

/** Wind Rank XP from skill XP: its share of the running total, so no fraction is ever lost */
export const rankGain = (before: number, after: number): number =>
  Math.floor(after * WIND_RANK_SHARE) - Math.floor(before * WIND_RANK_SHARE);

export interface LadderStep {
  level: number;
  /** Everything the skill gives at this level, in total */
  stats: StatBlock;
  unlocks: readonly SkillUnlock[];
}

/** Every level's reward, for the journal's ladder */
export function rewardsLadder(id: SkillId): LadderStep[] {
  const entry = skill(id);
  const steps: LadderStep[] = [];
  for (let level = 2; level <= entry.maxLevel; level++) {
    const stats: Record<string, number> = {};
    for (const [stat, amount] of Object.entries(entry.perLevel)) stats[stat] = (amount ?? 0) * (level - 1);
    steps.push({ level, stats, unlocks: entry.unlocks.filter((unlock) => unlock.level === level) });
  }
  return steps;
}

export const SKILL_IDS: readonly SkillId[] = SKILLS.map((entry) => entry.id as SkillId);
