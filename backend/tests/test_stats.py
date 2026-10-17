"""The stat system (plan F2): the same vectors as frontend/tests/stats.test.mjs."""
import json
import random

import pytest

from catalog import CATALOG_DIR, load_catalog
from stats import StatSource, base_stats, compute_stats, item_source, round_stat, skill_source, swiftness_top_speed

CATALOG = load_catalog()
CASES = json.loads((CATALOG_DIR / "tests" / "stats-vectors.json").read_text(encoding="utf-8"))["cases"]


def source(entry):
    if "item" in entry:
        return item_source(CATALOG, entry["item"])
    if "skills" in entry:
        return skill_source(CATALOG, entry["skills"])
    return StatSource(add=entry.get("add", {}), percent=entry.get("percent", {}))


@pytest.mark.parametrize("vector", CASES, ids=[case["name"] for case in CASES])
def test_the_shared_vectors(vector):
    base = {**base_stats(CATALOG), **vector.get("base", {})}
    stats = compute_stats(CATALOG, base, [source(entry) for entry in vector["sources"]])
    assert stats == {**base_stats(CATALOG), **vector["expect"]}
    if "topSpeed" in vector:
        assert swiftness_top_speed(CATALOG, stats) == vector["topSpeed"]


def test_the_order_of_sources_never_changes_the_result():
    rng = random.Random(7)
    ids = list(CATALOG.stats)
    for _ in range(300):
        sources = [StatSource(add={i: round(rng.uniform(-60, 140), 2) for i in ids if rng.random() < 0.3},
                              percent={i: round(rng.uniform(-15, 35), 2) for i in ids if rng.random() < 0.15})
                   for _ in range(rng.randint(1, 8))]
        forward = compute_stats(CATALOG, base_stats(CATALOG), sources)
        shuffled = sources[:]
        rng.shuffle(shuffled)
        assert compute_stats(CATALOG, base_stats(CATALOG), shuffled) == forward
        for stat_id, info in CATALOG.stats.items():
            assert forward[stat_id] >= 0
            assert info.cap is None or forward[stat_id] <= info.cap


def test_rounding_matches_javascript():
    # Math.round rounds halves up, unlike Python's round()
    assert round_stat(0.00005) == 0.0001
    assert round_stat(2.5 / 10_000) == 0.0003
    assert round_stat(0.1 + 0.2) == 0.3
