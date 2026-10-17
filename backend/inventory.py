"""The persistent inventory and its action log (docs/open-world-plan.md F3).

The server owns value (plan ground rule 3): the client predicts an action, queues it with its own
`action_id` and sends batches; this applies each one in its own transaction (check, change,
record the result) and answers. Sending the same `action_id` again returns the recorded result
and changes nothing, so the client's outbox can retry freely.

Where things are:
- stackables (`inventory`): counts per item and location: `bag`, `storage`, or `wallet` for
  currency (the crystals: no bag slot, and the profile's balance reads them from here);
- unique things (`gear`: tools, weapons, mantles, charms): one row each with a uuid, its own
  `data` (stars, tempering, enchants later) and a location: `bag`, `storage` or `equipped`.

The bag has BAG_SLOTS slots (a stack of up to the item's `stack` fills one, a piece of gear one);
storage starts at STORAGE_SLOTS (the Home Isle's first chest). Later steps add action kinds here
(craft in F10, harvest in R2...).
"""
import json
import math
import re
import sqlite3
import time
import uuid

import skills
from catalog import Catalog

BAG_SLOTS = 36
STORAGE_SLOTS = 27
MAX_BATCH = 50
MAX_GRANT_GEAR = 10
ACTION_ID = re.compile(r"^[A-Za-z0-9_-]{8,64}$")
# Most actions of a kind per minute per pilot (a brake on scripted floods)
RATE_LIMITS = {"move": 300, "sell": 120, "discard": 120, "grant": 600, "grant_xp": 600}
STACK_PLACES = ("bag", "storage")
GEAR_PLACES = ("bag", "storage", "equipped")
CURRENCY = "crystal"


def create_tables(db):
    db.executescript("""
        CREATE TABLE IF NOT EXISTS inventory (
            user_id TEXT NOT NULL, item_id TEXT NOT NULL, location TEXT NOT NULL,
            count INTEGER NOT NULL CHECK (count > 0 OR (location = 'wallet' AND count = 0)),
            PRIMARY KEY (user_id, item_id, location)
        );
        CREATE TABLE IF NOT EXISTS gear (
            uuid TEXT PRIMARY KEY, user_id TEXT NOT NULL, item_id TEXT NOT NULL,
            data TEXT NOT NULL DEFAULT '{}', location TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS gear_user ON gear (user_id);
        CREATE TABLE IF NOT EXISTS storage_slots (user_id TEXT PRIMARY KEY, slots INTEGER NOT NULL CHECK (slots >= 0));
        CREATE TABLE IF NOT EXISTS actions (
            action_id TEXT PRIMARY KEY, user_id TEXT NOT NULL, kind TEXT NOT NULL, at INTEGER NOT NULL, result TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS actions_user ON actions (user_id, kind, at);
        CREATE TABLE IF NOT EXISTS skills (
            user_id TEXT NOT NULL, skill TEXT NOT NULL, xp INTEGER NOT NULL DEFAULT 0 CHECK (xp >= 0),
            PRIMARY KEY (user_id, skill)
        );
        CREATE TABLE IF NOT EXISTS collections (
            user_id TEXT NOT NULL, item_id TEXT NOT NULL, total INTEGER NOT NULL CHECK (total >= 0),
            PRIMARY KEY (user_id, item_id)
        );
        CREATE TABLE IF NOT EXISTS inventory_rev (user_id TEXT PRIMARY KEY, rev INTEGER NOT NULL);
    """)


def bump(db, user_id):
    db.execute("INSERT INTO inventory_rev VALUES (?, 1) ON CONFLICT(user_id) DO UPDATE SET rev = rev + 1", (user_id,))


def count(db, user_id, item_id, location) -> int:
    row = db.execute("SELECT count FROM inventory WHERE user_id = ? AND item_id = ? AND location = ?",
                     (user_id, item_id, location)).fetchone()
    return row["count"] if row else 0


def add(db, user_id, item_id, location, delta):
    """Changes a stack by delta; never below 0 (raises ValueError). Rows at 0 are removed, except the
    wallet's: its row says the pilot's balance lives here now"""
    total = count(db, user_id, item_id, location) + delta
    if total < 0:
        raise ValueError(f"Not enough {item_id}")
    if total == 0 and location != "wallet":
        db.execute("DELETE FROM inventory WHERE user_id = ? AND item_id = ? AND location = ?", (user_id, item_id, location))
    else:
        db.execute("INSERT INTO inventory VALUES (?, ?, ?, ?) ON CONFLICT(user_id, item_id, location) DO UPDATE SET count = ?",
                   (user_id, item_id, location, total, total))


def wallet(db, user_id) -> int | None:
    """The crystals in the wallet, or None if this pilot's balance was never moved here"""
    row = db.execute("SELECT count FROM inventory WHERE user_id = ? AND item_id = ? AND location = 'wallet'",
                     (user_id, CURRENCY)).fetchone()
    return row["count"] if row else None


def set_wallet(db, user_id, crystals):
    """The profile's balance, written through to the wallet (profiles.py `_save`)"""
    if crystals < 0:
        raise ValueError("Not enough crystals")
    if wallet(db, user_id) != crystals:
        db.execute("INSERT INTO inventory VALUES (?, ?, 'wallet', ?) ON CONFLICT(user_id, item_id, location) DO UPDATE SET count = ?",
                   (user_id, CURRENCY, crystals, crystals))
        bump(db, user_id)


def profile_crystals(db, user_id) -> int:
    """The balance still in the profile's JSON (before it moved to the wallet)"""
    try:
        row = db.execute("SELECT data FROM profiles WHERE user_id = ?", (user_id,)).fetchone()
    except sqlite3.OperationalError:
        return 0
    return max(0, int(json.loads(row["data"]).get("crystals", 0))) if row else 0


def earn(db, user_id, crystals):
    """Adds to the wallet, moving the profile's balance in first if it never was"""
    current = wallet(db, user_id)
    set_wallet(db, user_id, (profile_crystals(db, user_id) if current is None else current) + crystals)


class ActionError(ValueError):
    """A broken game rule: the action fails and its failure is recorded"""


class Inventory:
    def __init__(self, store, catalog: Catalog, clock=time.time, dev=False):
        self.store = store
        self.catalog = catalog
        self.clock = clock
        # Grants (and later other test tools) only with DEV_TOOLS=1
        self.dev = dev
        # Wind Rank XP earned by skills goes to the profile (app.py: Profiles.add_rank_xp)
        self.on_rank_xp = None
        with store.lock, store.db:
            create_tables(store.db)

    # --- reading ---------------------------------------------------------------------------

    def slots(self, user_id, location) -> int:
        if location == "bag":
            return BAG_SLOTS
        row = self.store.db.execute("SELECT slots FROM storage_slots WHERE user_id = ?", (user_id,)).fetchone()
        return row["slots"] if row else STORAGE_SLOTS

    def used(self, user_id, location) -> int:
        db = self.store.db
        stacks = db.execute("SELECT item_id, count FROM inventory WHERE user_id = ? AND location = ?", (user_id, location))
        used = sum(math.ceil(row["count"] / self.catalog.items[row["item_id"]].stack)
                   for row in stacks if row["item_id"] in self.catalog.items)
        return used + db.execute("SELECT COUNT(*) AS n FROM gear WHERE user_id = ? AND location = ?",
                                 (user_id, location)).fetchone()["n"]

    def _state(self, user_id):
        db = self.store.db
        rev = db.execute("SELECT rev FROM inventory_rev WHERE user_id = ?", (user_id,)).fetchone()
        places = {place: {"items": {}, "gear": []} for place in STACK_PLACES}
        state = {"rev": rev["rev"] if rev else 0, **places, "equipped": {}, "wallet": {},
                 "skills": skills.skill_xp(db, user_id),
                 "slots": {place: {"size": self.slots(user_id, place), "used": self.used(user_id, place)} for place in STACK_PLACES}}
        for row in db.execute("SELECT item_id, location, count FROM inventory WHERE user_id = ? ORDER BY item_id", (user_id,)):
            target = state["wallet"] if row["location"] == "wallet" else state[row["location"]]["items"]
            target[row["item_id"]] = row["count"]
        for row in db.execute("SELECT uuid, item_id, data, location FROM gear WHERE user_id = ? ORDER BY rowid", (user_id,)):
            piece = {"uuid": row["uuid"], "item": row["item_id"], "data": json.loads(row["data"])}
            if row["location"] == "equipped":
                state["equipped"][self.catalog.items[row["item_id"]].slot] = piece
            else:
                state[row["location"]]["gear"].append(piece)
        return state

    def state(self, user_id):
        with self.store.lock:
            return self._state(user_id)

    # --- writing ---------------------------------------------------------------------------

    def apply_batch(self, user_id, actions: list[dict]):
        """Applies up to MAX_BATCH actions in order, each in its own transaction; results in order"""
        if len(actions) > MAX_BATCH:
            raise ValueError(f"At most {MAX_BATCH} actions at once")
        with self.store.lock:
            results = [self._apply(user_id, action) for action in actions]
            return {"results": results, "inventory": self._state(user_id)}

    def _apply(self, user_id, action):
        action_id = action.get("action_id") if isinstance(action, dict) else None
        if not isinstance(action_id, str) or not ACTION_ID.fullmatch(action_id):
            return {"action_id": action_id, "ok": False, "error": "Each action needs an action_id (8-64 letters, digits, - or _)"}
        db = self.store.db
        done = db.execute("SELECT user_id, result FROM actions WHERE action_id = ?", (action_id,)).fetchone()
        if done:
            if done["user_id"] != user_id:
                return {"action_id": action_id, "ok": False, "error": "That action id belongs to another pilot"}
            return {**json.loads(done["result"]), "replayed": True}
        kind = action.get("kind")
        now_ms = int(self.clock() * 1000)
        if kind in RATE_LIMITS:
            recent = db.execute("SELECT COUNT(*) AS n FROM actions WHERE user_id = ? AND kind = ? AND at > ?",
                                (user_id, kind, now_ms - 60_000)).fetchone()["n"]
            if recent >= RATE_LIMITS[kind]:
                # Not recorded: the same action may go through in a moment
                return {"action_id": action_id, "ok": False, "error": "Slow down a little", "retry": True}
        record = "INSERT INTO actions VALUES (?, ?, ?, ?, ?)"
        try:
            with db:
                result = {"action_id": action_id, "ok": True, **self._run(user_id, kind, action)}
                bump(db, user_id)
                db.execute(record, (action_id, user_id, str(kind)[:32], now_ms, json.dumps(result)))
        except ValueError as error:
            # A broken rule (ActionError) or a stack that would go below zero: the transaction rolled
            # back, nothing changed; the failure is recorded so a retry answers the same
            result = {"action_id": action_id, "ok": False, "error": str(error)}
            with db:
                db.execute(record, (action_id, user_id, str(kind)[:32], now_ms, json.dumps(result)))
        return result

    def _item(self, item_id):
        found = self.catalog.items.get(item_id) if isinstance(item_id, str) else None
        if not found:
            raise ActionError(f"Unknown item {item_id!r}")
        return found

    @staticmethod
    def _count(action):
        amount = action.get("count")
        if not isinstance(amount, int) or isinstance(amount, bool) or not 1 <= amount <= 1_000_000:
            raise ActionError("count must be a whole number from 1")
        return amount

    def _gear(self, user_id, gear_id):
        row = self.store.db.execute("SELECT * FROM gear WHERE uuid = ? AND user_id = ?", (gear_id, user_id)).fetchone() \
            if isinstance(gear_id, str) else None
        if not row:
            raise ActionError("You don't have that")
        return row

    def _room(self, user_id, location, slots_needed):
        if self.used(user_id, location) + slots_needed > self.slots(user_id, location):
            raise ActionError(f"Your {location} is full")

    def _slots_for(self, user_id, item, location, extra):
        """How many more slots `extra` of a stackable takes in a location"""
        have = count(self.store.db, user_id, item.id, location)
        return math.ceil((have + extra) / item.stack) - math.ceil(have / item.stack)

    def _run(self, user_id, kind, action):
        if kind == "move":
            return self._move(user_id, action)
        if kind in ("sell", "discard"):
            return self._remove(user_id, action, sell=kind == "sell")
        if kind == "grant" and self.dev:
            return self._grant(user_id, action)
        if kind == "grant_xp" and self.dev:
            return self._grant_xp(user_id, action)
        raise ActionError(f"Unknown action {kind!r}")

    def _move(self, user_id, action):
        db = self.store.db
        if "gear" in action:
            row = self._gear(user_id, action["gear"])
            target = action.get("to")
            if target not in GEAR_PLACES:
                raise ActionError("Gear goes to the bag, storage or equipped")
            if target == row["location"]:
                return {"changes": []}
            item = self.catalog.items[row["item_id"]]
            changes = []
            if target == "equipped":
                if not item.slot:
                    raise ActionError(f"{item.name} isn't worn")
                # Whatever is in that slot goes where this came from
                for other in db.execute("SELECT uuid, item_id FROM gear WHERE user_id = ? AND location = 'equipped'", (user_id,)).fetchall():
                    if self.catalog.items[other["item_id"]].slot == item.slot:
                        db.execute("UPDATE gear SET location = ? WHERE uuid = ?", (row["location"], other["uuid"]))
                        changes.append({"gear": other["uuid"], "location": row["location"]})
                        break
            else:
                self._room(user_id, target, 1)
            db.execute("UPDATE gear SET location = ? WHERE uuid = ?", (target, row["uuid"]))
            changes.append({"gear": row["uuid"], "location": target})
            return {"changes": changes}
        item = self._item(action.get("item"))
        amount = self._count(action)
        source, target = action.get("from"), action.get("to")
        if source not in STACK_PLACES or target not in STACK_PLACES or source == target:
            raise ActionError("Stacks move between the bag and storage")
        if item.kind == "currency":
            raise ActionError("Crystals stay in your purse")
        if count(db, user_id, item.id, source) < amount:
            raise ActionError(f"Not enough {item.name} in your {source}")
        self._room(user_id, target, self._slots_for(user_id, item, target, amount))
        add(db, user_id, item.id, source, -amount)
        add(db, user_id, item.id, target, amount)
        return {"changes": [{"item": item.id, "location": source, "delta": -amount},
                            {"item": item.id, "location": target, "delta": amount}]}

    def _remove(self, user_id, action, sell):
        db = self.store.db
        if "gear" in action:
            row = self._gear(user_id, action["gear"])
            item = self.catalog.items[row["item_id"]]
            if row["location"] == "equipped":
                raise ActionError(f"Take {item.name} off first")
            db.execute("DELETE FROM gear WHERE uuid = ?", (row["uuid"],))
            changes, amount = [{"gear": row["uuid"], "location": None}], 1
        else:
            item = self._item(action.get("item"))
            amount = self._count(action)
            source = action.get("from", "bag")
            if source not in STACK_PLACES:
                raise ActionError("Sell or discard from the bag or storage")
            if item.kind == "currency":
                raise ActionError("Crystals can't be sold or thrown away")
            if count(db, user_id, item.id, source) < amount:
                raise ActionError(f"Not enough {item.name} in your {source}")
            add(db, user_id, item.id, source, -amount)
            changes = [{"item": item.id, "location": source, "delta": -amount}]
        crystals = item.sell * amount if sell else 0
        if crystals:
            earn(db, user_id, crystals)
            changes.append({"item": CURRENCY, "location": "wallet", "delta": crystals})
        return {"changes": changes, "crystals": crystals}

    def _grant(self, user_id, action):
        """Dev and tests only: puts items in the bag"""
        db = self.store.db
        item = self._item(action.get("item"))
        amount = self._count(action)
        if item.kind == "currency":
            earn(db, user_id, amount)
            return {"changes": [{"item": item.id, "location": "wallet", "delta": amount}]}
        if item.stack == 1 and item.kind in ("tool", "weapon", "mantle", "charm"):
            if amount > MAX_GRANT_GEAR:
                raise ActionError(f"At most {MAX_GRANT_GEAR} pieces of gear at once")
            self._room(user_id, "bag", amount)
            changes = []
            for _ in range(amount):
                gear_id = uuid.uuid4().hex
                db.execute("INSERT INTO gear VALUES (?, ?, ?, '{}', 'bag')", (gear_id, user_id, item.id))
                changes.append({"gear": gear_id, "item": item.id, "location": "bag"})
            return {"changes": changes}
        self._room(user_id, "bag", self._slots_for(user_id, item, "bag", amount))
        add(db, user_id, item.id, "bag", amount)
        return {"changes": [{"item": item.id, "location": "bag", "delta": amount}]}

    def _grant_xp(self, user_id, action):
        """Dev and tests only: skill XP, through the same path as a harvest's (wisdom, Wind Rank)"""
        skill_id, xp = action.get("skill"), action.get("xp")
        if skill_id not in self.catalog.skills:
            raise ActionError(f"Unknown skill {skill_id!r}")
        if not isinstance(xp, int) or isinstance(xp, bool) or not 1 <= xp <= 10_000_000:
            raise ActionError("xp must be a whole number from 1")
        gained = skills.grant(self.store.db, self.catalog, user_id, skill_id, xp)
        if gained["rank"] and self.on_rank_xp:
            self.on_rank_xp(user_id, gained["rank"])
        return {"xp": gained}
