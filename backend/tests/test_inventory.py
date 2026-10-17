"""The persistent inventory and its action log (plan F3)."""
import json
import random
import threading
import time
import uuid
from concurrent.futures import ThreadPoolExecutor

from fastapi.testclient import TestClient

from app import app
from catalog import load_catalog
from inventory import BAG_SLOTS, RATE_LIMITS, Inventory
from models import User
from profiles import Profiles
from store import Store

CATALOG = load_catalog()


class Clock:
    def __init__(self):
        self.now = time.time()

    def __call__(self):
        return self.now


def make(dev=True, path=":memory:"):
    store = Store(path)
    clock = Clock()
    profiles = Profiles(store, clock)
    return store, profiles, Inventory(store, CATALOG, clock, dev=dev), clock


def act(kind, **fields):
    return {"action_id": uuid.uuid4().hex, "kind": kind, **fields}


def totals(state):
    """Every stackable's total over bag and storage, and every gear uuid"""
    items = {}
    for place in ("bag", "storage"):
        for item, n in state[place]["items"].items():
            items[item] = items.get(item, 0) + n
    gear = {g["uuid"] for place in ("bag", "storage") for g in state[place]["gear"]} | {g["uuid"] for g in state["equipped"].values()}
    return items, gear


def test_the_same_action_twice_counts_once():
    _, _, inv, _ = make()
    grant = act("grant", item="moonwheat", count=40)
    move = act("move", item="moonwheat", count=15, **{"from": "bag", "to": "storage"})
    first = inv.apply_batch("pilot", [grant, move])
    again = inv.apply_batch("pilot", [grant, move])
    assert [r["ok"] for r in first["results"]] == [True, True]
    assert all(r["replayed"] for r in again["results"])
    assert again["inventory"]["bag"]["items"] == {"moonwheat": 25}
    assert again["inventory"]["storage"]["items"] == {"moonwheat": 15}
    assert again["inventory"]["rev"] == first["inventory"]["rev"]


def test_failures_are_recorded_and_change_nothing():
    _, _, inv, _ = make()
    inv.apply_batch("pilot", [act("grant", item="sunberry", count=3)])
    sell = act("sell", item="sunberry", count=5)
    result = inv.apply_batch("pilot", [sell])
    assert result["results"][0] == {"action_id": sell["action_id"], "ok": False, "error": "Not enough Sunberry in your bag"}
    assert result["inventory"]["bag"]["items"] == {"sunberry": 3}
    inv.apply_batch("pilot", [act("grant", item="sunberry", count=10)])
    # The same id again answers the same, even though there would be enough now
    assert inv.apply_batch("pilot", [sell])["results"][0]["ok"] is False


def test_an_action_id_belongs_to_one_pilot():
    _, _, inv, _ = make()
    grant = act("grant", item="moonwheat", count=1)
    inv.apply_batch("a", [grant])
    other = inv.apply_batch("b", [grant])
    assert other["results"][0]["ok"] is False and other["inventory"]["bag"]["items"] == {}


def test_selling_pays_crystals_into_the_profile_balance():
    _, profiles, inv, _ = make()
    user = User(id="seller", name="Seller")
    assert profiles.get(user)["crystals"] == 0
    inv.apply_batch(user.id, [act("grant", item="moonbark_log", count=3)])
    sold = inv.apply_batch(user.id, [act("sell", item="moonbark_log", count=2)])
    assert sold["results"][0]["crystals"] == 2 * CATALOG.items["moonbark_log"].sell
    assert sold["inventory"]["wallet"] == {"crystal": 80}
    assert profiles.get(user)["crystals"] == 80


def test_gear_is_unique_and_equips_by_slot():
    _, _, inv, _ = make()
    state = inv.apply_batch("pilot", [act("grant", item="wing_blades", count=2), act("grant", item="wooden_sickle", count=1)])["inventory"]
    blades = [g["uuid"] for g in state["bag"]["gear"] if g["item"] == "wing_blades"]
    sickle = next(g["uuid"] for g in state["bag"]["gear"] if g["item"] == "wooden_sickle")
    state = inv.apply_batch("pilot", [act("move", gear=blades[0], to="equipped")])["inventory"]
    assert state["equipped"]["weapon"]["uuid"] == blades[0]
    # The second blade takes the slot; the first goes back to the bag
    state = inv.apply_batch("pilot", [act("move", gear=blades[1], to="equipped")])["inventory"]
    assert state["equipped"]["weapon"]["uuid"] == blades[1]
    assert blades[0] in {g["uuid"] for g in state["bag"]["gear"]}
    worn = inv.apply_batch("pilot", [act("move", gear=sickle, to="equipped"), act("sell", gear=blades[1])])["results"]
    assert [r["ok"] for r in worn] == [False, False]
    assert worn[0]["error"] == "Wooden sickle isn't worn"


def test_the_bag_has_a_size():
    _, _, inv, _ = make()
    inv.apply_batch("pilot", [act("grant", item="moonwheat", count=512 * BAG_SLOTS)])
    full = inv.apply_batch("pilot", [act("grant", item="sunberry", count=1)])
    assert full["results"][0] == {**full["results"][0], "ok": False, "error": "Your bag is full"}
    assert full["inventory"]["slots"]["bag"] == {"size": BAG_SLOTS, "used": BAG_SLOTS}
    # Topping up a stack that has room needs no new slot... but these are all full; storage has room
    moved = inv.apply_batch("pilot", [act("move", item="moonwheat", count=512, **{"from": "bag", "to": "storage"})])
    assert moved["inventory"]["slots"]["storage"]["used"] == 1


def test_grants_need_dev_tools():
    _, _, inv, _ = make(dev=False)
    result = inv.apply_batch("pilot", [act("grant", item="moonwheat", count=1)])
    assert result["results"][0]["error"] == "Unknown action 'grant'"


def test_rate_limits_hold_without_recording():
    _, _, inv, clock = make()
    inv.apply_batch("pilot", [act("grant", item="moonwheat", count=500)])
    limit = RATE_LIMITS["discard"]
    for start in range(0, limit, 50):
        inv.apply_batch("pilot", [act("discard", item="moonwheat", count=1) for _ in range(min(50, limit - start))])
    over = act("discard", item="moonwheat", count=1)
    assert inv.apply_batch("pilot", [over])["results"][0]["retry"] is True
    clock.now += 61
    # Not recorded, so the same action goes through once the minute has passed
    assert inv.apply_batch("pilot", [over])["results"][0]["ok"] is True


def test_two_batches_at_once_never_go_negative(tmp_path):
    store, _, inv, _ = make(path=str(tmp_path / "inv.db"))
    inv.apply_batch("pilot", [act("grant", item="sunberry", count=30)])
    batches = [[act("sell", item="sunberry", count=1) for _ in range(20)] for _ in range(2)]
    barrier = threading.Barrier(2)

    def run(batch):
        barrier.wait()
        return inv.apply_batch("pilot", batch)

    with ThreadPoolExecutor(2) as pool:
        results = [r for out in pool.map(run, batches) for r in out["results"]]
    assert sum(r["ok"] for r in results) == 30
    state = inv.state("pilot")
    assert state["bag"]["items"] == {}
    assert state["wallet"]["crystal"] == 30 * CATALOG.items["sunberry"].sell
    store.db.close()


def test_the_crystals_move_into_the_wallet_once(tmp_path):
    path = str(tmp_path / "old.db")
    store = Store(path)
    # A database from before the inventory: profiles only
    store.db.executescript("""
        CREATE TABLE profiles (user_id TEXT PRIMARY KEY, data TEXT NOT NULL);
        CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    """)
    with store.db:
        store.db.execute("INSERT INTO profiles (user_id, data) VALUES (?, ?)",
                         ("old", json.dumps({"version": 3, "xp": 10, "crystals": 123, "revision": 2})))
    profiles = Profiles(store)
    assert store.db.execute("SELECT value FROM meta WHERE key = 'inventory_v1'").fetchone()
    assert Inventory(store, CATALOG).state("old")["wallet"] == {"crystal": 123}
    assert profiles.get(User(id="old", name="Old"))["crystals"] == 123
    store.db.close()
    # Reopened, nothing moves twice
    again = Store(path)
    Profiles(again)
    assert Inventory(again, CATALOG).state("old")["wallet"] == {"crystal": 123}


def test_random_actions_keep_the_rules():
    _, _, inv, _ = make()
    rng = random.Random(11)
    stackables = ["moonwheat", "sunberry", "glowcap", "quartzlight", "meadow_tea"]
    gear_kinds = ["wing_blades", "wayfarer_mantle", "quartz_pick"]
    state = inv.state("fuzz")
    earned = 0
    for _ in range(120):
        items, gear = totals(state)
        options = [act("grant", item=rng.choice(stackables), count=rng.randint(1, 300)),
                   act("grant", item=rng.choice(gear_kinds), count=1)]
        for item in items:
            place = rng.choice(["bag", "storage"])
            options += [act("move", item=item, count=rng.randint(1, 400), **{"from": place, "to": "storage" if place == "bag" else "bag"}),
                        act(rng.choice(["sell", "discard"]), item=item, count=rng.randint(1, 200), **{"from": place})]
        for piece in gear:
            options += [act("move", gear=piece, to=rng.choice(["bag", "storage", "equipped"])), act("sell", gear=piece)]
        batch = rng.sample(options, min(len(options), rng.randint(1, 6)))
        out = inv.apply_batch("fuzz", batch)
        after_items, after_gear = totals(out["inventory"])
        for action, result in zip(batch, out["results"]):
            assert result["action_id"] == action["action_id"]
            earned += result.get("crystals", 0) if result["ok"] else 0
        for place in ("bag", "storage"):
            slots = out["inventory"]["slots"][place]
            assert slots["used"] <= slots["size"]
            assert all(n > 0 for n in out["inventory"][place]["items"].values())
        # Moves conserve: only grants add, only sells and discards take away
        kinds = {a["kind"] for a, r in zip(batch, out["results"]) if r["ok"]}
        if not kinds & {"grant", "sell", "discard"}:
            assert after_items == items and after_gear == gear
        state = out["inventory"]
    # The wallet is exactly what was sold
    assert earned > 0 and state["wallet"]["crystal"] == earned


def test_grant_move_sell_through_the_api_and_replay_the_outbox():
    client = TestClient(app, headers={"X-User-Id": "inv@ethz.ch", "X-User-Name": "Inv"})
    who = {"client_id": "inv-browser"}
    before = client.get("/api/inv", params=who).json()
    start = before["wallet"].get("crystal", 0)
    batch = [act("grant", item="sky_apple", count=12),
             act("move", item="sky_apple", count=5, **{"from": "bag", "to": "storage"}),
             act("sell", item="sky_apple", count=4, **{"from": "bag"})]
    first = client.post("/api/inv/actions", json={**who, "actions": batch})
    assert first.status_code == 200, first.text
    assert [r["ok"] for r in first.json()["results"]] == [True, True, True]
    reloaded = client.get("/api/inv", params=who).json()
    assert reloaded["bag"]["items"]["sky_apple"] == 3 and reloaded["storage"]["items"]["sky_apple"] == 5
    assert reloaded["wallet"]["crystal"] == start + 4 * CATALOG.items["sky_apple"].sell
    # The outbox sends the same batch again after a lost answer: nothing changes
    replay = client.post("/api/inv/actions", json={**who, "actions": batch}).json()
    assert all(r["replayed"] for r in replay["results"])
    assert replay["inventory"] == reloaded
    assert client.get("/api/profile", params=who).json()["crystals"] == reloaded["wallet"]["crystal"]
    too_many = client.post("/api/inv/actions", json={**who, "actions": [act("discard", item="sky_apple", count=1)] * 51})
    assert too_many.status_code == 422
