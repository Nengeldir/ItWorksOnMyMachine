"""The stat system (docs/open-world-plan.md F2), the same math as frontend/src/game/stats.ts.

Both read shared/catalog (stats.json for bases and caps, items.json for gear, skills.json for
per-level stats) and both run shared/catalog/tests/stats-vectors.json. The order, fixed:

1. flat    = base + the sum of every source's `add`
2. percent = the sum of every source's `percent`
3. value   = flat * (1 + percent / 100)
4. clamped to [0, cap]
5. rounded to 4 decimals (half up, as JavaScript's Math.round)

Every amount counts in whole units of 1/10 000 and the sums are of integers, which are exact: the
order of sources can never change the result, and both languages agree to the last bit.

Nothing uses it yet: the server will read stats when actions need them (gathering yields, combat
run checks). Races never do (rule 6).
"""
import math
from dataclasses import dataclass, field

from catalog import Catalog

PRECISION = 10_000


def units(value: float) -> int:
    """An amount in whole units of 1/10 000: Math.round(value * 1e4), halves up as in JavaScript"""
    scaled = value * PRECISION
    whole = math.floor(scaled)
    return whole + 1 if scaled - whole >= 0.5 else whole


def round_stat(value: float) -> float:
    return units(value) / PRECISION


@dataclass(frozen=True)
class StatSource:
    """One thing that changes stats: flat additions and percentage bonuses"""
    add: dict[str, float] = field(default_factory=dict)
    percent: dict[str, float] = field(default_factory=dict)


def stat_ids(catalog: Catalog) -> list[str]:
    return list(catalog.stats)


def base_stats(catalog: Catalog) -> dict[str, float]:
    return {stat_id: info.base for stat_id, info in catalog.stats.items()}


def compute_stats(catalog: Catalog, base: dict[str, float], sources: list[StatSource]) -> dict[str, float]:
    stats = {}
    for stat_id, info in catalog.stats.items():
        flat, percent = units(base[stat_id]), 0
        for source in sources:
            flat += units(source.add.get(stat_id, 0))
            percent += units(source.percent.get(stat_id, 0))
        value = (flat / PRECISION) * (1 + percent / (PRECISION * 100))
        cap = info.cap if info.cap is not None else math.inf
        stats[stat_id] = round_stat(min(cap, max(0.0, value)))
    return stats


def item_source(catalog: Catalog, item_id: str) -> StatSource:
    """A piece of gear's stats (items.json `stats`, all flat)"""
    return StatSource(add=dict(catalog.items[item_id].stats or {}))


def skill_source(catalog: Catalog, levels: dict[str, int]) -> StatSource:
    """What skill levels give: each skill's perLevel for every level above the first"""
    add: dict[str, float] = {}
    for skill_id, level in levels.items():
        skill = catalog.skills[skill_id]
        steps = max(0, min(skill.maxLevel, math.floor(level)) - 1)
        for stat_id, amount in skill.perLevel.items():
            add[stat_id] = add.get(stat_id, 0) + amount * steps
    return StatSource(add=add)


def swiftness_top_speed(catalog: Catalog, stats: dict[str, float]) -> float:
    """Runs only: the fraction swiftness adds to top speed (capped)"""
    flight = catalog.swiftness_flight
    return round_stat(min(flight.cap, stats["swiftness"] * flight.perPoint))
