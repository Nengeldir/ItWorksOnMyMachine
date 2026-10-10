"""Adventure progression. Rewards and XP are issued by the server, never by clients."""
import hashlib
import json
import secrets
import time

from store import Store

RARITIES = ["common", "uncommon", "rare", "legendary"]
XP = [8, 20, 55, 140]
DUPLICATE_CRYSTALS = [2, 5, 15, 40]
DEFAULT_EQUIPPED = {"cape": "classic", "hat": "none", "shoes": "classic", "wings": "classic", "pet": "none"}


def entry(kind, asset, name, rarity, slot=None):
    return {"key": f"{kind}:{asset}", "kind": kind, "asset": asset, "name": name,
            "rarity": RARITIES[rarity], "xp": XP[rarity], "slot": slot}


CATALOG = [
    entry("cape", "classic", "Wayfarer", 0, "cape"),
    entry("cape", "dawn", "Dawn sail", 1, "cape"),
    entry("cape", "verdant", "Leafwhisper", 1, "cape"),
    entry("cape", "aurora", "Aurora veil", 2, "cape"),
    entry("cape", "ember", "Phoenix mantle", 3, "cape"),
    entry("cape", "royal", "Cloud court", 2, "cape"),
    entry("hat", "none", "Wind in your hair", 0, "hat"),
    entry("hat", "aviatorCap", "Aviator cap", 0, "hat"),
    entry("hat", "wingedHelm", "Winged helm", 2, "hat"),
    entry("hat", "starwitch", "Stargazer hat", 2, "hat"),
    entry("hat", "lotus", "Lotus crown", 1, "hat"),
    entry("hat", "antlers", "Grove antlers", 1, "hat"),
    entry("hat", "beret", "Sky courier", 0, "hat"),
    entry("shoes", "classic", "Wayfarer boots", 0, "shoes"),
    entry("shoes", "cloud", "Cloud slippers", 0, "shoes"),
    entry("shoes", "petal", "Petal steps", 1, "shoes"),
    entry("shoes", "frost", "Frost walkers", 2, "shoes"),
    entry("shoes", "ember", "Ember greaves", 2, "shoes"),
    *[entry("pet", asset, name, rarity, "pet") for asset, name, rarity in [
        ("swallow", "Ribbon swallow", 1),
        ("owl", "Moon owl", 1), ("crane", "Jade crane", 2),
        ("phoenix", "Dawn phoenix", 3), ("dragon", "Cloud dragon", 3),
        ("kirin", "Star kirin", 3), ("fox", "Lantern fox", 2),
        ("griffin", "Sun griffin", 2)]],
    *[entry("wings", asset, name, rarity, "wings") for asset, name, rarity in [
        ("classic", "Wayfarer feathers", 0), ("prism", "Prismatic plumage", 1),
        ("gale", "Zephyr filigree", 1), ("tide", "Pearl tide", 1),
        ("frost", "Glacial cathedral", 2), ("ember", "Phoenix sunrise", 2),
        ("storm", "Thunder sovereign", 2), ("astral", "Constellation wings", 3)]],
    *[entry("item", asset, name, rarity) for asset, name, rarity in [
        ("firework", "Giant firework", 2), ("candyWrapped", "Berry candy", 0),
        ("lollipop", "Swirl lollipop", 0), ("starCandy", "Star candy", 1),
        ("goldenFeather", "Golden feather", 3), ("aviatorCap", "Aviator keepsake", 1),
        ("wingedHelm", "Winged helm keepsake", 2), ("apple", "Apple", 0),
        ("peach", "Peach", 0), ("grapes", "Grapes", 0),
        ("cherries", "Cherries", 0), ("starfruit", "Starfruit", 1)]],
]
BY_KEY = {e["key"]: e for e in CATALOG}
STARTERS = {f"{slot}:{asset}": 1 for slot, asset in DEFAULT_EQUIPPED.items() if slot != "pet"}


def level_progress(xp):
    level, remaining = 1, xp
    while level < 100:
        cost = 100 + 40 * (level - 1) + 5 * (level - 1) ** 2
        if remaining < cost:
            return level, remaining, cost
        remaining -= cost
        level += 1
    return 100, 0, 0


def draw(seed, level, slot, purpose):
    raw = hashlib.sha256(f"profile-v1:{seed}:{level}:{slot}:{purpose}".encode()).digest()
    return int.from_bytes(raw[:4], "big") / 2**32


def reward_plan(seed):
    rewards = []
    for level in range(1, 9):
        for slot in range(18):
            rewards.append({"id": f"{level}:c{slot}", "level": level, "anchor": (slot + 0.5) / 18,
                            "key": "crystal", "kind": "crystal", "asset": "crystal", "name": "Wind crystals",
                            "rarity": "common", "xp": 3, "crystals": 3,
                            "angle": draw(seed, level, slot, "crystal-angle") * 6.283185307})
        for slot in range(6):
            roll = draw(seed, level, slot, "rarity")
            rarity = 0 if roll < .50 else 1 if roll < .82 else 2 if roll < .97 else 3
            kind_roll = draw(seed, level, slot, "kind")
            kind = "item" if kind_roll < .50 else "cosmetic" if kind_roll < .85 else "pet"
            # Common rolls cannot produce a pet; keep the common economy instead.
            if rarity == 0 and kind == "pet":
                kind = "cosmetic"
            pool = [e for e in CATALOG if e["key"] not in STARTERS and e["rarity"] == RARITIES[rarity]
                    and (e["kind"] in ("cape", "hat", "shoes", "wings") if kind == "cosmetic" else e["kind"] == kind)]
            reward = dict(pool[int(draw(seed, level, slot, "asset") * len(pool))])
            rewards.append({**reward, "id": f"{level}:t{slot}", "level": level, "anchor": (slot + .5) / 6,
                            "crystals": 0, "angle": draw(seed, level, slot, "angle") * 6.283185307})
    return rewards


class Profiles:
    def __init__(self, store: Store):
        self.store = store
        with store.lock, store.db:
            store.db.executescript("""
                CREATE TABLE IF NOT EXISTS profiles (user_id TEXT PRIMARY KEY, data TEXT NOT NULL);
                CREATE TABLE IF NOT EXISTS adventures (
                    token TEXT PRIMARY KEY, user_id TEXT NOT NULL, seed INTEGER NOT NULL, created_at INTEGER NOT NULL, plan TEXT
                );
                CREATE TABLE IF NOT EXISTS adventure_claims (
                    token TEXT NOT NULL, pickup TEXT NOT NULL, PRIMARY KEY (token, pickup)
                );
            """)
            if "plan" not in {row["name"] for row in store.db.execute("PRAGMA table_info(adventures)")}:
                store.db.execute("ALTER TABLE adventures ADD COLUMN plan TEXT")

    def _load(self, user):
        row = self.store.db.execute("SELECT data FROM profiles WHERE user_id = ?", (user.id,)).fetchone()
        data = json.loads(row["data"]) if row else {"version": 2, "xp": 0, "crystals": 0,
            "inventory": dict(STARTERS), "equipped": dict(DEFAULT_EQUIPPED), "revision": 0}
        # Add original wings to existing profiles, preserving all earned discoveries.
        data["version"] = 2
        data["inventory"].pop("pet:none", None)
        data["inventory"].setdefault("wings:classic", 1)
        data["equipped"].setdefault("wings", "classic")
        return data

    def _save(self, user, data):
        data["revision"] += 1
        self.store.db.execute("INSERT INTO profiles VALUES (?, ?) ON CONFLICT(user_id) DO UPDATE SET data = excluded.data",
                              (user.id, json.dumps(data)))

    def _view(self, user, data):
        level, progress, cost = level_progress(data["xp"])
        return {**data, "user_id": user.id, "name": user.name, "level": level,
                "level_xp": progress, "next_level_xp": cost, "catalog": CATALOG}

    def get(self, user):
        with self.store.lock:
            return self._view(user, self._load(user))

    def start(self, user, seed):
        token = secrets.token_urlsafe(24)
        plan = reward_plan(seed)
        with self.store.lock, self.store.db:
            self.store.db.execute("INSERT INTO adventures (token, user_id, seed, created_at, plan) VALUES (?, ?, ?, ?, ?)",
                                  (token, user.id, seed, int(time.time()), json.dumps(plan)))
        return {"token": token, "seed": seed, "rewards": plan}

    def claim(self, user, token, pickups):
        with self.store.lock, self.store.db:
            journey = self.store.db.execute("SELECT * FROM adventures WHERE token = ? AND user_id = ?", (token, user.id)).fetchone()
            if not journey:
                raise ValueError("Adventure not found for this pilot")
            plan = {r["id"]: r for r in (json.loads(journey["plan"]) if journey["plan"] else reward_plan(journey["seed"]))}
            if any(p not in plan for p in pickups):
                raise ValueError("Unknown adventure pickup")
            data = self._load(user)
            before = level_progress(data["xp"])[0]
            gained_xp = gained_crystals = 0
            accepted = []
            for pickup in dict.fromkeys(pickups):
                inserted = self.store.db.execute("INSERT OR IGNORE INTO adventure_claims VALUES (?, ?)", (token, pickup)).rowcount
                if not inserted:
                    continue
                reward = plan[pickup]
                xp, crystals = reward["xp"], reward["crystals"]
                key = reward["key"]
                duplicate = False
                if key != "crystal":
                    count = data["inventory"].get(key, 0)
                    duplicate = count > 0 and reward["kind"] != "item"
                    if duplicate:
                        crystals += DUPLICATE_CRYSTALS[RARITIES.index(reward["rarity"])]
                    else:
                        data["inventory"][key] = count + 1
                data["xp"] += xp
                data["crystals"] += crystals
                gained_xp += xp
                gained_crystals += crystals
                accepted.append({"id": pickup, "name": reward["name"], "duplicate": duplicate})
            if accepted:
                self._save(user, data)
            return {"profile": self._view(user, data), "accepted": accepted, "xp": gained_xp,
                    "crystals": gained_crystals, "levels": level_progress(data["xp"])[0] - before}

    def equip(self, user, slot, asset):
        key = f"{slot}:{asset}"
        with self.store.lock, self.store.db:
            data = self._load(user)
            unequip_pet = slot == "pet" and asset == "none"
            if not unequip_pet and (slot not in DEFAULT_EQUIPPED or key not in BY_KEY or not data["inventory"].get(key)):
                raise ValueError("Collect this cosmetic or pet before equipping it")
            data["equipped"][slot] = asset
            self._save(user, data)
            return self._view(user, data)
