"""The server-side economy: run reports, the market, the wheel, pet names and public pilot pages."""
import json
import time

import pytest
from fastapi.testclient import TestClient

import app as app_module
from app import app
from models import User
from profiles import (ADVENTURES_PER_HOUR, BY_KEY, CATALOG, CRYSTALS_PER_RUN, MIN_LEVEL_SECONDS, PRICES, RARITIES,
                      STARTERS, WHEEL, Profiles, level_progress, reward_plan, shop_offers)
from store import Store


class Clock:
    def __init__(self):
        self.now = time.time()

    def __call__(self):
        return self.now


def setup(name="pilot"):
    clock = Clock()
    profiles = Profiles(Store(":memory:"), clock)
    return profiles, User(id=name, name=name.title()), clock


def give_xp(profiles, user, xp):
    with profiles.store.db:
        data = profiles._load(user)
        data["xp"] = xp
        profiles._save(user, data)


def give_crystals(profiles, user, crystals):
    with profiles.store.db:
        data = profiles._load(user)
        data["crystals"] = crystals
        profiles._save(user, data)


def test_later_levels_cannot_be_claimed_before_they_could_be_flown():
    profiles, user, clock = setup()
    journey = profiles.start(user, 9)
    level3 = next(r["id"] for r in journey["rewards"] if r["level"] == 3)
    assert profiles.claim(user, journey["token"], ["1:c0"])["accepted"]
    with pytest.raises(ValueError):
        profiles.claim(user, journey["token"], [level3])
    clock.now += 2 * MIN_LEVEL_SECONDS
    assert profiles.claim(user, journey["token"], [level3])["accepted"]
    # A retry of something already accepted is a no-op, whatever the clock says
    clock.now -= 10 * MIN_LEVEL_SECONDS
    assert profiles.claim(user, journey["token"], [level3])["accepted"] == []


def test_run_reports_turn_gates_into_xp_and_score_into_crystals_once():
    profiles, user, clock = setup()
    journey = profiles.start(user, 5)
    clock.now += 600
    report = {"score": 24_000, "levels": 8, "completed": True, "gates": 150, "time_ms": 420_000, "crashes": 0}
    first = profiles.report(user, journey["token"], report)
    assert first["xp"] == 150 * 2 + 7 * 10 + 60
    assert first["crystals"] == 24_000 // 200
    again = profiles.report(user, journey["token"], {**report, "score": 99_999})
    assert again["repeated"] and again["crystals"] == first["crystals"]
    profile = again["profile"]
    assert profile["crystals"] == first["crystals"] and profile["xp"] == first["xp"]
    assert profile["stats"]["completed"] == 1 and profile["stats"]["flawless"] == 1
    assert profile["stats"]["best_adventure_ms"] == 420_000 and profile["stats"]["gates"] == 150
    # Crystals grow with the pilot's level, and are capped per run
    give_xp(profiles, user, 4000)
    level = profiles.get(user)["level"]
    second = profiles.start(user, 6)
    clock.now += 600
    big = profiles.report(user, second["token"], {**report, "score": 300_000})
    assert big["crystals"] == min(CRYSTALS_PER_RUN, int(300_000 / 200 * (1 + 0.05 * (level - 1))))


def test_implausible_run_reports_are_refused():
    profiles, user, clock = setup()
    journey = profiles.start(user, 5)
    clock.now += 60
    base = {"score": 1000, "levels": 1, "completed": False, "gates": 10, "time_ms": 40_000, "crashes": 1}
    with pytest.raises(ValueError):
        profiles.report(user, journey["token"], {**base, "time_ms": 120_000})  # longer than the adventure existed
    with pytest.raises(ValueError):
        profiles.report(user, journey["token"], {**base, "score": 50_000})  # more than one level holds
    with pytest.raises(ValueError):
        profiles.report(user, journey["token"], {**base, "gates": 31})
    clock.now += 200
    with pytest.raises(ValueError):
        profiles.report(user, journey["token"], {**base, "levels": 8, "completed": True, "time_ms": 30_000})
    other = User(id="thief", name="Thief")
    with pytest.raises(ValueError):
        profiles.report(other, journey["token"], base)
    # An abandoned run (not completed) still counts what was flown
    result = profiles.report(user, journey["token"], base)
    assert result["xp"] == 20 and result["profile"]["stats"]["completed"] == 0


def test_market_offers_three_unlocked_treasures_and_sells_each_once():
    profiles, user, clock = setup()
    shop = profiles.shop(user)
    offers = shop["offers"]
    assert len(offers) == 3 and len({o["key"] for o in offers}) == 3
    assert all(o["min_level"] <= 1 and o["key"] not in STARTERS for o in offers)
    assert shop["offers"] == profiles.shop(user)["offers"]
    offer = offers[0]
    with pytest.raises(ValueError):
        profiles.buy(user, offer["key"])  # no crystals yet
    give_crystals(profiles, user, 5000)
    bought = profiles.buy(user, offer["key"])
    assert bought["profile"]["crystals"] == 5000 - offer["price"]
    assert bought["profile"]["inventory"][offer["key"]] == 1
    with pytest.raises(ValueError):
        profiles.buy(user, offer["key"])  # owned
    absent = next(e["key"] for e in CATALOG if e["key"] not in {o["key"] for o in offers} and e["key"] not in STARTERS)
    with pytest.raises(ValueError):
        profiles.buy(user, absent)
    assert profiles.shop(user)["offers"][0]["owned"]
    assert offer["price"] == PRICES[RARITIES.index(offer["rarity"])]


def test_low_levels_never_see_locked_treasures():
    locked = {e["key"] for e in CATALOG if e["min_level"] > 1}
    assert {"pet:phoenix", "pet:kirin", "item:goldenFeather"} <= locked
    for seed in range(1, 60):
        assert not {r["key"] for r in reward_plan(seed, 1)} & locked
        assert not {o["key"] for o in shop_offers(f"2026-10-{seed % 28 + 1:02d}", f"p{seed}", 1)} & locked
    # Once the level is there, they can turn up
    assert {r["key"] for seed in range(1, 200) for r in reward_plan(seed, 100)} & locked


def test_wheel_spins_once_a_day_and_pays_out_what_it_lands_on():
    profiles, user, clock = setup()
    profiles.rng.random = lambda: 0.999  # the last segment: legendary
    give_xp(profiles, user, 10**6)
    result = profiles.spin(user)
    assert result["id"] == WHEEL[-1]["id"] and result["prize"]["rarity"] == "legendary"
    assert result["profile"]["inventory"][result["prize"]["key"]] == 1
    with pytest.raises(PermissionError):
        profiles.spin(user)
    assert profiles.shop(user)["spin_ready"] is False
    clock.now += 86_400
    profiles.rng.random = lambda: 0.3  # inside "25 crystals"
    before = profiles.get(user)["crystals"]
    result = profiles.spin(user)
    assert result["id"] == "crystals25" and result["profile"]["crystals"] == before + 25
    clock.now += 86_400
    profiles.rng.random = lambda: 0.0
    assert profiles.spin(user)["id"] == "nothing"
    assert profiles.get(user)["stats"]["spins"] == 3


def test_pets_can_be_named_once_befriended():
    profiles, user, _ = setup()
    with pytest.raises(ValueError):
        profiles.name_pet(user, "fox", "Mochi")
    with profiles.store.db:
        data = profiles._load(user)
        data["inventory"]["pet:fox"] = 1
        profiles._save(user, data)
    assert profiles.name_pet(user, "fox", "  Mochi   the  Brave ")["pet_names"]["fox"] == "Mochi the Brave"
    for bad in ("<script>", "x" * 21, "a;b", "-dash"):
        with pytest.raises(ValueError):
            profiles.name_pet(user, "fox", bad)
    assert "fox" not in profiles.name_pet(user, "fox", "")["pet_names"]


def test_charm_slot_takes_owned_keepsakes_only():
    profiles, user, _ = setup()
    with pytest.raises(ValueError):
        profiles.equip(user, "charm", "firework")
    with profiles.store.db:
        data = profiles._load(user)
        data["inventory"]["item:firework"] = 1
        profiles._save(user, data)
    assert profiles.equip(user, "charm", "firework")["equipped"]["charm"] == "firework"
    assert profiles.equip(user, "charm", "none")["equipped"]["charm"] == "none"
    assert all(e["slot"] == "charm" for e in CATALOG if e["kind"] == "item")


def test_public_pages_rank_pilots_and_hide_private_ids():
    profiles, _, clock = setup()
    alice = User(id="guest:alice-browser", name="Alice")
    bob = User(id="bob@ethz.ch", name="Bob", verified=True)
    give_xp(profiles, alice, 500)
    give_xp(profiles, bob, 900)
    with profiles.store.db:
        profiles.store.db.execute("INSERT INTO runs (seed, user_id, name, time_ms, created_at, rules) VALUES (?, ?, ?, ?, ?, 'speed-control-v3')",
                                  (42, bob.id, "Bob", 58_000, int(clock.now)))
    board = profiles.players()
    assert [p["name"] for p in board] == ["Bob", "Alice"] and board[0]["rank"] == 1 and board[0]["verified"]
    # Public ids are keyed hashes: neither the login nor a guest's browser id (its key) appears anywhere
    text = json.dumps(board)
    assert "alice-browser" not in text and "guest:" not in text and "bob@ethz.ch" not in text
    page = profiles.player(board[0]["public_id"])
    assert page["name"] == "Bob" and page["level"] == level_progress(900)[0] and page["rank"] == 1
    assert page["races"] == [{"seed": 42, "best_ms": 58_000}]
    assert next(a for a in page["achievements"] if a["id"] == "speedster")["done"]
    assert "bob@ethz.ch" not in json.dumps(page)
    assert profiles.player("0" * 16) is None


def test_adventures_per_hour_are_limited():
    profiles, user, clock = setup()
    for _ in range(ADVENTURES_PER_HOUR):
        profiles.start(user, 3)
    with pytest.raises(PermissionError):
        profiles.start(user, 3)
    clock.now += 3601
    profiles.start(user, 3)
    # Old plans are pruned: at most the latest KEEP_ADVENTURES remain
    kept = profiles.store.db.execute("SELECT COUNT(*) AS n FROM adventures WHERE user_id = ?", (user.id,)).fetchone()["n"]
    assert kept <= 40


def test_endpoints_validate_limit_and_reward_races():
    client = TestClient(app, headers={"X-Flight-Rules": "speed-control-v3", "X-User-Id": "racer@ethz.ch", "X-User-Name": "Racer"})
    body = {"client_id": "racer"}
    assert client.get("/api/shop", params=body).status_code == 200
    assert client.post("/api/shop/buy", json={**body, "key": "'; DROP TABLE profiles; --"}).status_code == 422
    assert client.post("/api/profile/pets", json={**body, "pet": "Fox!", "name": "x"}).status_code == 422
    assert client.post("/api/profile/style", json={**body, "style": 3}).status_code == 422
    assert client.post("/api/profile/style", json={**body, "style": 2}).json()["style"] == 2
    assert client.post("/api/profile/runs", json={**body, "token": "nope", "score": 1, "levels": 1, "gates": 1, "time_ms": 1}).status_code == 400
    assert client.get("/api/players/not-hex").status_code == 422
    assert client.get("/api/players/" + "0" * 16).status_code == 404
    # A validated time trial finish gives one XP per gate
    token = client.post("/api/runs/start", json={"seed": 42}).json()["run_token"]
    app_module.solo_runs[token] = (42, app_module.now_ms() - 61_000)
    finished = client.post("/api/runs/finish", json={"run_token": token, "time_ms": 61_000, "client_id": "racer", "gates": 21}).json()
    assert finished["xp"] == 21
    assert client.get("/api/profile", params=body).json()["xp"] == 21
    # Spinning more than a few times a minute is refused before it reaches the wheel
    spins = [client.post("/api/shop/spin", json=body).status_code for _ in range(8)]
    assert spins[0] == 200 and 429 in spins


def test_rate_limit_refuses_bursts_and_forgives_with_time(monkeypatch):
    from fastapi import HTTPException
    clock = [100.0]
    monkeypatch.setattr(app_module.time, "monotonic", lambda: clock[0])
    limit = app_module.RateLimit(2, 60)
    limit.check("pilot")
    limit.check("pilot")
    with pytest.raises(HTTPException) as refused:
        limit.check("pilot")
    assert refused.value.status_code == 429
    limit.check("someone-else")
    clock[0] += 61
    limit.check("pilot")


def test_keepsakes_match_the_adventure_items_rarity_and_unlock_level():
    """The server's catalog and the frontend's run items (frontend/src/game/run/items.ts) must agree"""
    import re
    from pathlib import Path
    source = (Path(__file__).resolve().parents[2] / "frontend" / "src" / "game" / "run" / "items.ts").read_text()
    block = source.split("export const RUN_ITEMS")[1].split("];")[0]
    by_rarity = [1, 1, 3, 6]
    checked = 0
    for line in block.splitlines():
        found = re.search(r'id: "(\w+)", model: "(\w+)".*?rarity: (\d)', line)
        if not found or found.group(1) == "cometFirework":
            continue
        item, rarity = found.group(1), int(found.group(3))
        level = re.search(r"minLevel: (\d+)", line)
        entry = BY_KEY[f"item:{item}"]
        assert entry["rarity"] == RARITIES[rarity], item
        assert entry["min_level"] == (int(level.group(1)) if level else by_rarity[rarity]), item
        checked += 1
    assert checked == 19
