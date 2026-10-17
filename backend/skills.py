"""Skill XP, levels and Wind Rank (docs/open-world-plan.md F4), the same math as frontend/src/game/skills.ts.

XP is only ever granted here, as part of an action's result (harvests later; the dev grant now).
Wisdom (a stat, stats.py) adds its percentage once. Every skill XP also feeds the profile's level,
Wind Rank, by `windRankShare` of the running total (skills.json), so no fraction is lost. Both
languages run shared/catalog/tests/skill-vectors.json.
"""
import math

from catalog import Catalog
from stats import base_stats, compute_stats, item_source, skill_source


def skill_progress(catalog: Catalog, skill_id: str, xp: int) -> tuple[int, int, int]:
    """(level, XP into it, XP the next level costs; 0 at the top)"""
    level, remaining = 1, max(0, math.floor(xp))
    for cost in catalog.curves[catalog.skills[skill_id].curve]:
        if remaining < cost:
            return level, remaining, cost
        remaining -= cost
        level += 1
    return level, 0, 0


def with_wisdom(xp: int, wisdom: float) -> int:
    return math.floor(xp * (100 + wisdom) / 100)


def rank_gain(catalog: Catalog, before: int, after: int) -> int:
    share = catalog.wind_rank_share
    return math.floor(after * share) - math.floor(before * share)


def skill_xp(db, user_id) -> dict[str, int]:
    return {row["skill"]: row["xp"] for row in db.execute("SELECT skill, xp FROM skills WHERE user_id = ?", (user_id,))}


def player_stats(db, catalog: Catalog, user_id) -> dict[str, float]:
    """A pilot's stats on the server: the bases, skill levels and worn gear (teas and pets join later)"""
    levels = {skill_id: skill_progress(catalog, skill_id, xp)[0] for skill_id, xp in skill_xp(db, user_id).items()
              if skill_id in catalog.skills}
    worn = [row["item_id"] for row in db.execute("SELECT item_id FROM gear WHERE user_id = ? AND location = 'equipped'", (user_id,))]
    return compute_stats(catalog, base_stats(catalog), [skill_source(catalog, levels), *(item_source(catalog, i) for i in worn)])


def grant(db, catalog: Catalog, user_id, skill_id: str, xp: int) -> dict:
    """Adds skill XP (with wisdom); returns what changed. Wind Rank XP is in `rank` (the caller adds it)"""
    wisdom = player_stats(db, catalog, user_id)["wisdom"]
    gained = with_wisdom(xp, wisdom)
    before_all = sum(skill_xp(db, user_id).values())
    before = skill_xp(db, user_id).get(skill_id, 0)
    total = before + gained
    db.execute("INSERT INTO skills VALUES (?, ?, ?) ON CONFLICT(user_id, skill) DO UPDATE SET xp = ?",
               (user_id, skill_id, total, total))
    old_level = skill_progress(catalog, skill_id, before)[0]
    level, into, cost = skill_progress(catalog, skill_id, total)
    unlocks = [u.model_dump() for u in catalog.skills[skill_id].unlocks if old_level < u.level <= level]
    return {"skill": skill_id, "gained": gained, "xp": total, "level": level, "into": into, "next": cost,
            "levels": level - old_level, "unlocks": unlocks, "rank": rank_gain(catalog, before_all, before_all + gained)}
