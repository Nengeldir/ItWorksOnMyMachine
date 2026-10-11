import time
from concurrent.futures import ThreadPoolExecutor

import pytest
from fastapi.testclient import TestClient

from app import app
from models import User
from profiles import BY_KEY, CATALOG, MIN_LEVEL_SECONDS, STARTERS, Profiles, level_progress, reward_plan
from store import Store


class Clock:
    """A clock the tests move by hand (adventures check how long they have been flown)"""

    def __init__(self):
        self.now = time.time()

    def __call__(self):
        return self.now


def test_profile_survives_restart_and_claim_retry(tmp_path):
    path = str(tmp_path / "profile.db")
    user = User(id="pilot", name="Pilot")
    store = Store(path)
    clock = Clock()
    profiles = Profiles(store, clock)
    adventure = profiles.start(user, 42)
    clock.now += 8 * MIN_LEVEL_SECONDS
    reward = next(r for r in adventure["rewards"] if r["kind"] in ("cape", "hat", "shoes", "wings", "pet"))
    first = profiles.claim(user, adventure["token"], [reward["id"], reward["id"], "1:c0"])
    assert len(first["accepted"]) == 2
    assert first["profile"]["xp"] == reward["xp"] + 3
    assert first["profile"]["crystals"] == 3
    profiles.equip(user, reward["slot"], reward["asset"])
    store.db.close()
    reopened = Profiles(Store(path))
    saved = reopened.get(user)
    assert saved["equipped"][reward["slot"]] == reward["asset"]
    assert saved["inventory"][reward["key"]] == 1
    repeated = reopened.claim(user, adventure["token"], [reward["id"], "1:c0"])
    assert repeated["accepted"] == []
    assert repeated["profile"] == saved


def test_atomic_claims_and_parallel_retries():
    profiles = Profiles(Store(":memory:"))
    user = User(id="parallel", name="Pilot")
    token = profiles.start(user, 7)["token"]
    with pytest.raises(ValueError):
        profiles.claim(user, token, ["1:c0", "not-issued"])
    assert profiles.get(user)["xp"] == 0
    with ThreadPoolExecutor(max_workers=8) as pool:
        results = list(pool.map(lambda _: profiles.claim(user, token, ["1:c0"]), range(8)))
    assert sum(len(r["accepted"]) for r in results) == 1
    assert profiles.get(user)["xp"] == 3
    assert profiles.get(user)["crystals"] == 3


def test_duplicates_of_every_kind_become_crystals():
    clock = Clock()
    profiles = Profiles(Store(":memory:"), clock)
    user = User(id="collector", name="Pilot")
    first = profiles.start(user, 42)
    second = profiles.start(user, 42)
    clock.now += 8 * MIN_LEVEL_SECONDS
    cosmetic = next(r for r in first["rewards"] if r["kind"] in ("cape", "hat", "shoes", "wings", "pet"))
    item = next(r for r in first["rewards"] if r["kind"] == "item")
    ids = [cosmetic["id"], item["id"]]
    profiles.claim(user, first["token"], ids)
    duplicate = profiles.claim(user, second["token"], ids)
    profile = duplicate["profile"]
    # Keepsakes are unique like cosmetics now: a second one is a duplicate message and crystals
    assert profile["inventory"][cosmetic["key"]] == 1
    assert profile["inventory"][item["key"]] == 1
    assert duplicate["crystals"] > 0
    assert profile["xp"] == 2 * (cosmetic["xp"] + item["xp"])
    assert sum(a["duplicate"] for a in duplicate["accepted"]) == 2
    assert all(a["crystals"] > 0 and a["rarity"] in ("common", "uncommon", "rare", "legendary") for a in duplicate["accepted"])


def test_xp_boundaries_multiple_levels_and_cap():
    assert level_progress(0) == (1, 0, 100)
    assert level_progress(99) == (1, 99, 100)
    assert level_progress(100) == (2, 0, 145)
    assert level_progress(245) == (3, 0, 200)
    assert level_progress(450) == (4, 5, 265)
    assert level_progress(10**9) == (100, 0, 0)
    clock = Clock()
    profiles = Profiles(Store(":memory:"), clock)
    user = User(id="level", name="Pilot")
    journey = profiles.start(user, 42)
    clock.now += 8 * MIN_LEVEL_SECONDS
    ids = [r["id"] for r in journey["rewards"]]
    result = None
    for i in range(0, len(ids), 24):
        result = profiles.claim(user, journey["token"], ids[i:i + 24])
    # Claimed in batches of 24 (the request's limit): the whole plan lifts a newcomer several levels
    assert result["profile"]["level"] > 2
    assert result["profile"]["level_xp"] < result["profile"]["next_level_xp"]


def test_plan_is_seeded_balanced_and_catalog_complete():
    assert reward_plan(42) == reward_plan(42)
    assert reward_plan(42) != reward_plan(43)
    assert len(BY_KEY) == len(CATALOG) == 65
    plans = [r for seed in range(1, 101) for r in reward_plan(seed)]
    treasures = [r for r in plans if r["kind"] != "crystal"]
    assert len(treasures) == 4800
    counts = {rarity: sum(r["rarity"] == rarity for r in treasures) / len(treasures)
              for rarity in ("common", "uncommon", "rare", "legendary")}
    # Each rarity three times rarer than the one before: 67.5 / 22.5 / 7.5 / 2.5 %
    assert .63 < counts["common"] < .72
    assert .19 < counts["uncommon"] < .26
    assert .055 < counts["rare"] < .095
    assert .014 < counts["legendary"] < .036
    assert {r["key"] for r in treasures} == set(BY_KEY) - set(STARTERS)
    assert len({r["id"] for r in reward_plan(42)}) == 192


def test_existing_auth_identity_ownership_validation_and_guest_isolation():
    a = TestClient(app, headers={"X-User-Id": "profile-a", "X-User-Name": "Zo%C3%AB"})
    b = TestClient(app, headers={"X-User-Id": "profile-b"})
    body = {"client_id": "same-browser", "seed": 42}
    journey = a.post("/api/profile/adventures", json=body).json()
    token = journey["token"]
    claim = {"client_id": "other-browser", "token": token, "pickups": ["1:c0"]}
    assert b.post("/api/profile/claim", json=claim).status_code == 400
    result = a.post("/api/profile/claim", json=claim).json()
    assert result["profile"]["user_id"] == "profile-a"
    assert result["profile"]["name"] == "Zoë"
    assert a.get("/api/profile", params={"client_id": "new-browser"}).json()["crystals"] == 3
    assert b.get("/api/profile", params={"client_id": "same-browser"}).json()["crystals"] == 0
    assert a.post("/api/profile/equip", json={"client_id": "x", "slot": "pet", "asset": "dragon"}).status_code == 400
    assert a.post("/api/profile/equip", json={"client_id": "x", "slot": "pet", "asset": "none"}).status_code == 200
    assert a.post("/api/profile/equip", json={"client_id": "x", "slot": "physics", "asset": "fast"}).status_code == 422
    assert a.post("/api/profile/adventures", json={"client_id": "x", "seed": 0}).status_code == 422
    assert a.post("/api/profile/claim", json={**claim, "pickups": ["1:c0"] * 25}).status_code == 422
    guest = TestClient(app)
    for pilot in ("local-a", "local-b"):
        assert guest.get("/api/profile", params={"client_id": pilot}).json()["user_id"] == f"guest:{pilot}"


def test_every_inventory_asset_has_a_frontend_model_catalog():
    import re
    from pathlib import Path
    root = Path(__file__).resolve().parents[2] / "frontend" / "src" / "game"
    catalog = (root / "cosmetics" / "catalog.ts").read_text()
    for kind, array in [("cape", "CAPES"), ("hat", "HATS"), ("shoes", "SHOES"), ("wings", "WINGS")]:
        block = catalog.split(f"export const {array} = [")[1].split("] as const")[0]
        ids = set(re.findall(r'id: "([^"\n]+)"', block))
        assert ids == {e["asset"] for e in CATALOG if e["kind"] == kind}
    for kind, file, array in [("pet", "pets/catalog.ts", "PETS"), ("item", "items/models.ts", "ITEMS")]:
        block = (root / file).read_text().split(f"export const {array}")[1].split("// --- building")[0]
        ids = set(re.findall(r'id: "([^"\n]+)"', block))
        assert ids == {e["asset"] for e in CATALOG if e["kind"] == kind}


def test_issued_rewards_remain_frozen_after_balance_changes(monkeypatch):
    import profiles as module
    profiles = Profiles(Store(":memory:"))
    user = User(id="frozen", name="Pilot")
    journey = profiles.start(user, 42)
    monkeypatch.setattr(module, "reward_plan", lambda seed: [])
    result = profiles.claim(user, journey["token"], ["1:c0"])
    assert result["xp"] == result["crystals"] == 3


def test_legacy_profiles_gain_wings_without_losing_pets_or_progress():
    import json
    store = Store(":memory:")
    profiles = Profiles(store)
    user = User(id="legacy", name="Pilot")
    old = {"version": 1, "xp": 245, "crystals": 19, "revision": 4,
           "inventory": {"pet:none": 1, "pet:dragon": 1, "cape:aurora": 1},
           "equipped": {"cape": "aurora", "hat": "none", "shoes": "classic", "pet": "dragon"}}
    with store.db:
        store.db.execute("INSERT INTO profiles (user_id, data) VALUES (?, ?)", (user.id, json.dumps(old)))
    saved = profiles.get(user)
    assert saved["xp"] == 245 and saved["crystals"] == 19
    assert "pet:none" not in saved["inventory"] and "pet:none" not in BY_KEY
    assert saved["inventory"]["wings:classic"] == 1
    assert saved["equipped"]["pet"] == "dragon" and saved["equipped"]["wings"] == "classic"
    assert len([entry for entry in CATALOG if entry["kind"] == "pet"]) == 8
    with pytest.raises(ValueError):
        profiles.equip(user, "wings", "astral")
    assert profiles.equip(user, "pet", "none")["equipped"]["pet"] == "none"
    token = profiles.start(user, 7)["token"]
    profiles.claim(user, token, ["1:c0"])
    raw = json.loads(store.db.execute("SELECT data FROM profiles WHERE user_id = ?", (user.id,)).fetchone()["data"])
    assert raw["version"] == 3 and "pet:none" not in raw["inventory"]
    assert saved["equipped"]["charm"] == "none" and saved["stats"]["adventures"] == 0


def test_old_adventure_plans_are_pruned(monkeypatch):
    import profiles as module
    monkeypatch.setattr(module, "KEEP_ADVENTURES", 3)
    client = TestClient(app, headers={"X-User-Id": "prune-pilot"})
    tokens = [client.post("/api/profile/adventures", json={"client_id": "prune-client", "seed": 7}).json()["token"] for _ in range(5)]
    from app import store
    with store.lock:
        kept = {row["token"] for row in store.db.execute("SELECT token FROM adventures WHERE user_id = ?", ("prune-pilot",))}
    assert kept == set(tokens[-3:])
