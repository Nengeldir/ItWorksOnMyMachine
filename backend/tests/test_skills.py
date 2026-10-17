"""Skill XP, levels and Wind Rank (plan F4): the same vectors as frontend/tests/skills.test.mjs."""
import json
import uuid

import pytest

import skills
from catalog import CATALOG_DIR, load_catalog
from inventory import Inventory
from models import User
from profiles import Profiles, level_progress
from store import Store

CATALOG = load_catalog()
VECTORS = json.loads((CATALOG_DIR / "tests" / "skill-vectors.json").read_text(encoding="utf-8"))


def make():
    store = Store(":memory:")
    profiles = Profiles(store)
    inv = Inventory(store, CATALOG, dev=True)
    inv.on_rank_xp = profiles.add_rank_xp
    return profiles, inv


def grant(inv, user_id, skill, xp):
    action = {"action_id": uuid.uuid4().hex, "kind": "grant_xp", "skill": skill, "xp": xp}
    return inv.apply_batch(user_id, [action])["results"][0]


@pytest.mark.parametrize("vector", VECTORS["levels"], ids=[f"{v[0][0]}-{v[0][1]}" for v in VECTORS["levels"]])
def test_levels_from_xp(vector):
    (skill_id, xp), expected = vector
    assert list(skills.skill_progress(CATALOG, skill_id, xp)) == expected


def test_wisdom_and_rank_vectors():
    for (xp, wisdom), expected in VECTORS["wisdom"]:
        assert skills.with_wisdom(xp, wisdom) == expected
    for (before, after), expected in VECTORS["rank"]:
        assert skills.rank_gain(CATALOG, before, after) == expected


def test_curves_rise_so_levels_never_fall():
    for skill_id in CATALOG.skills:
        levels = [skills.skill_progress(CATALOG, skill_id, xp)[0] for xp in range(0, 30_000, 97)]
        assert levels == sorted(levels), skill_id


def test_a_grant_raises_the_skill_and_the_wind_rank():
    profiles, inv = make()
    user = User(id="farmer", name="Farmer")
    profiles.get(user)
    result = grant(inv, user.id, "farming", 1093)
    assert result["ok"] and result["xp"]["level"] == 10 and result["xp"]["levels"] == 9
    assert result["xp"]["rank"] == 109
    # Crossing level 5 unlocks Lantern Wood (skills.json), listed once
    assert result["xp"]["unlocks"] == [{"level": 5, "kind": "region", "id": "lantern_wood"}]
    assert grant(inv, user.id, "farming", 10)["xp"]["unlocks"] == []
    assert profiles.get(user)["xp"] == 110
    assert profiles.get(user)["level"] == level_progress(110)[0]
    assert inv.state(user.id)["skills"] == {"farming": 1103}


def test_a_grant_for_a_pilot_without_a_profile_makes_one():
    profiles, inv = make()
    grant(inv, "new", "mining", 500)
    assert profiles.get(User(id="new", name="New"))["xp"] == 50


def test_wisdom_is_applied_once(monkeypatch):
    _, inv = make()
    monkeypatch.setattr(skills, "player_stats", lambda *args: {"wisdom": 50})
    result = grant(inv, "sage", "enchanting", 200)
    assert result["xp"]["gained"] == 300
    assert inv.state("sage")["skills"]["enchanting"] == 300


def test_xp_grants_are_dev_only_and_checked():
    store = Store(":memory:")
    Profiles(store)
    closed = Inventory(store, CATALOG, dev=False)
    assert grant(closed, "pilot", "farming", 10)["error"] == "Unknown action 'grant_xp'"
    _, inv = make()
    assert grant(inv, "pilot", "swordplay", 10)["error"] == "Unknown skill 'swordplay'"
    assert grant(inv, "pilot", "farming", 0)["error"] == "xp must be a whole number from 1"
