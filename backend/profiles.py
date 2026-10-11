"""Adventure progression, the shop, the daily wheel and public pilot pages.

Every balance, reward and unlock is decided here, on the server. Clients only
report what they flew (pickups touched, a run's score and gates, a race's
time), and each report is checked against the server's own clock and limits
before it counts. All SQL uses placeholders; profile JSON is validated and
migrated on load.
"""
import hashlib
import hmac
import json
import re
import secrets
import time
from datetime import datetime, timedelta, timezone

from store import Store

RARITIES = ["common", "uncommon", "rare", "legendary"]
XP = [8, 20, 55, 140]
# What a duplicate find is worth instead (cosmetics, pets and keepsakes are unique)
DUPLICATE_CRYSTALS = [8, 20, 50, 150]
PRICES = [80, 200, 500, 1500]
# Each rarity is three times harder to find than the one before (67.5 / 22.5 / 7.5 / 2.5 %)
FIND_ODDS = [27, 9, 3, 1]
# Below this player level a find of that rarity never appears (pickups, shop, wheel); overrides below
MIN_LEVEL_BY_RARITY = [1, 1, 3, 6]
MIN_LEVEL = {
    "cape:ember": 7, "wings:astral": 9, "pet:phoenix": 10, "pet:dragon": 8, "pet:kirin": 12,
    "item:goldenFeather": 12, "item:phoenixFeather": 8, "item:duskHourglass": 10, "item:mothCape": 8,
    "item:firework": 4, "item:dragonTear": 5, "item:electroPrism": 5,
}
DEFAULT_EQUIPPED = {"cape": "classic", "hat": "none", "shoes": "classic", "wings": "classic", "pet": "none", "charm": "none"}
SLOTS = tuple(DEFAULT_EQUIPPED)

# Adventure reports: a level can't be flown faster than this, nor carry more than this
LEVELS = 8
MIN_LEVEL_SECONDS = 15
MAX_GATES_PER_LEVEL = 30
MAX_SCORE_PER_LEVEL = 40_000
XP_PER_GATE = 2
XP_PER_LEVEL = 10
XP_COMPLETE = 60
SCORE_PER_CRYSTAL = 200
CRYSTALS_PER_RUN = 1500
# Races: one XP per gate on a validated finish
RACE_GATES_MAX = 40
ADVENTURES_PER_HOUR = 20
KEEP_ADVENTURES = 40
PET_NAME = re.compile(r"^[\w][\w '\-.!?]{0,19}$")

WHEEL = [
    {"id": "nothing", "label": "Nothing", "weight": 22},
    {"id": "crystals25", "label": "25 crystals", "weight": 24, "crystals": 25},
    {"id": "crystals75", "label": "75 crystals", "weight": 14, "crystals": 75},
    {"id": "crystals200", "label": "200 crystals", "weight": 6, "crystals": 200},
    {"id": "common", "label": "Common treasure", "weight": 15, "rarity": 0},
    {"id": "uncommon", "label": "Uncommon treasure", "weight": 10, "rarity": 1},
    {"id": "rare", "label": "Rare treasure", "weight": 6, "rarity": 2},
    {"id": "legendary", "label": "Legendary treasure", "weight": 3, "rarity": 3},
]


def entry(kind, asset, name, rarity, slot=None):
    key = f"{kind}:{asset}"
    return {"key": key, "kind": kind, "asset": asset, "name": name,
            "rarity": RARITIES[rarity], "xp": XP[rarity], "slot": slot,
            "min_level": MIN_LEVEL.get(key, MIN_LEVEL_BY_RARITY[rarity]), "price": PRICES[rarity]}


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
    # Keepsakes: one is carried as the charm, its power on every adventure. The adventure items' rarities
# match their run rarity (frontend run/items.ts), which is what their power is balanced on
    *[entry("item", asset, name, rarity, "charm") for asset, name, rarity in [
        ("firework", "Giant firework", 2), ("candyWrapped", "Berry candy", 0),
        ("lollipop", "Swirl lollipop", 0), ("starCandy", "Star candy", 1),
        ("goldenFeather", "Golden feather", 3), ("aviatorCap", "Aviator keepsake", 1),
        ("wingedHelm", "Winged helm keepsake", 2), ("apple", "Apple", 0),
        ("peach", "Peach", 0), ("grapes", "Grapes", 0),
        ("cherries", "Cherries", 0), ("starfruit", "Starfruit", 1),
        ("spiritLantern", "Spirit Lantern", 1), ("echoConch", "Echoing Conch", 0),
        ("phoenixFeather", "Feather of the Great Phoenix", 3), ("silkRibbon", "Cloud-Spun Silk Ribbon", 1),
        ("vortexGeode", "Vortex Geode", 1), ("aeroBoots", "Aero-Boots of the Adepti", 2),
        ("stormKite", "Stormcaller's Kite", 1), ("glacialPrism", "Glacial Prism", 2),
        ("sunNectar", "Sun-Kissed Nectar", 0), ("windTether", "Tether of the Wind Spirit", 2),
        ("mothCape", "Illusory Moth Cape", 3), ("resonantChimes", "Resonant Chimes", 1),
        ("crystalUpdraft", "Crystallized Updraft", 1), ("duskHourglass", "Dusk-Weaver's Hourglass", 3),
        ("electroPrism", "Electro-Charged Prism", 2), ("dragonTear", "Tear of the Dragon", 2),
        ("anemoCatcher", "Anemo Catcher", 0), ("starflakeShield", "Starflake Shield", 2),
        ("gliderWax", "Luminescent Glider Wax", 1)]],
]
BY_KEY = {e["key"]: e for e in CATALOG}
STARTERS = {f"{slot}:{asset}": 1 for slot, asset in DEFAULT_EQUIPPED.items() if slot not in ("pet", "charm")}
ACHIEVEMENTS = [
    ("firstFlight", "First flight", "Finish a race or an adventure"),
    ("journeysEnd", "Journey's end", "Fly all eight maps of an adventure"),
    ("untouched", "Untouched", "Finish an adventure without a single crash"),
    ("collector", "Collector", "Discover 15 treasures"),
    ("legendary", "Legend in hand", "Own a legendary treasure"),
    ("menagerie", "Menagerie", "Befriend four companions"),
    ("hoopHunter", "Hoop hunter", "Fly through 500 gates"),
    ("hoarder", "Crystal hoarder", "Earn 2,000 crystals"),
    ("seasoned", "Seasoned pilot", "Reach level 10"),
    ("skyLegend", "Sky legend", "Reach level 25"),
    ("devoted", "Daily devotion", "Spin the wheel on seven days"),
    ("speedster", "Speedster", "Finish a time trial in under a minute"),
    ("shopper", "Market regular", "Buy a treasure at the market"),
    ("completionist", "Completionist", "Own every treasure"),
]


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


def roll_rarity(roll):
    """A rarity from a uniform roll, each one three times rarer than the last"""
    total, edge = sum(FIND_ODDS), 0
    for rarity, odds in enumerate(FIND_ODDS):
        edge += odds / total
        if roll < edge:
            return rarity
    return len(FIND_ODDS) - 1


def unlocked(item, player_level):
    return item["min_level"] <= player_level and item["key"] not in STARTERS


def treasure_pool(rarity, kind, player_level):
    """Finds of this rarity and kind open to this level; falls back to other kinds, then rarer-to-commoner"""
    def pool(r, k):
        return [e for e in CATALOG if unlocked(e, player_level) and e["rarity"] == RARITIES[r]
                and (e["kind"] in ("cape", "hat", "shoes", "wings") if k == "cosmetic" else e["kind"] == k)]
    for r in range(rarity, -1, -1):
        for k in dict.fromkeys([kind, "cosmetic", "item", "pet"]):
            found = pool(r, k)
            if found:
                return found
    return []


def reward_plan(seed, player_level=100):
    """The crystals and treasures of an adventure, frozen when it starts (`player_level` gates the finds)"""
    rewards = []
    for level in range(1, LEVELS + 1):
        for slot in range(18):
            rewards.append({"id": f"{level}:c{slot}", "level": level, "anchor": (slot + 0.5) / 18,
                            "key": "crystal", "kind": "crystal", "asset": "crystal", "name": "Wind crystals",
                            "rarity": "common", "xp": 3, "crystals": 3, "min_level": 1, "price": 0,
                            "angle": draw(seed, level, slot, "crystal-angle") * 6.283185307})
        for slot in range(6):
            rarity = roll_rarity(draw(seed, level, slot, "rarity"))
            kind_roll = draw(seed, level, slot, "kind")
            kind = "item" if kind_roll < .50 else "cosmetic" if kind_roll < .85 else "pet"
            # Common rolls cannot produce a pet; keep the common economy instead.
            if rarity == 0 and kind == "pet":
                kind = "cosmetic"
            pool = treasure_pool(rarity, kind, player_level)
            reward = dict(pool[int(draw(seed, level, slot, "asset") * len(pool))])
            rewards.append({**reward, "id": f"{level}:t{slot}", "level": level, "anchor": (slot + .5) / 6,
                            "crystals": 0, "angle": draw(seed, level, slot, "angle") * 6.283185307})
    return rewards


def utc_day(now):
    return datetime.fromtimestamp(now, timezone.utc).strftime("%Y-%m-%d")


def next_day(now):
    day = datetime.fromtimestamp(now, timezone.utc).replace(hour=0, minute=0, second=0, microsecond=0)
    return (day + timedelta(days=1)).timestamp()


def shop_offers(day, user_id, player_level):
    """Three different treasures for this pilot today, rarer ones less often"""
    rng = hashlib.sha256(f"shop-v1:{day}:{user_id}".encode()).digest()
    offers, seen = [], set()
    for i in range(12):
        if len(offers) == 3:
            break
        roll = int.from_bytes(rng[i * 2:i * 2 + 2], "big") / 65536
        rarity = 0 if roll < .40 else 1 if roll < .75 else 2 if roll < .93 else 3
        pool = [e for e in CATALOG if unlocked(e, player_level) and e["rarity"] == RARITIES[rarity] and e["key"] not in seen]
        if not pool:
            continue
        pick = pool[int.from_bytes(hashlib.sha256(rng + bytes([i])).digest()[:4], "big") % len(pool)]
        seen.add(pick["key"])
        offers.append(pick)
    return offers


def default_stats():
    return {"gates": 0, "adventures": 0, "completed": 0, "flawless": 0, "playtime_ms": 0,
            "best_adventure_ms": None, "best_score": 0, "races": 0, "spins": 0, "purchases": 0,
            "crystals_earned": 0, "fastest_race_ms": None}


class Profiles:
    def __init__(self, store: Store, clock=time.time):
        self.store = store
        self.clock = clock
        self.rng = secrets.SystemRandom()
        with store.lock, store.db:
            store.db.executescript("""
                CREATE TABLE IF NOT EXISTS profiles (user_id TEXT PRIMARY KEY, data TEXT NOT NULL);
                CREATE TABLE IF NOT EXISTS adventures (
                    token TEXT PRIMARY KEY, user_id TEXT NOT NULL, seed INTEGER NOT NULL, created_at INTEGER NOT NULL, plan TEXT
                );
                CREATE TABLE IF NOT EXISTS adventure_claims (
                    token TEXT NOT NULL, pickup TEXT NOT NULL, PRIMARY KEY (token, pickup)
                );
                CREATE TABLE IF NOT EXISTS adventure_results (
                    token TEXT PRIMARY KEY, user_id TEXT NOT NULL, score INTEGER NOT NULL CHECK (score >= 0),
                    levels INTEGER NOT NULL CHECK (levels BETWEEN 1 AND 8), completed INTEGER NOT NULL,
                    gates INTEGER NOT NULL CHECK (gates >= 0), time_ms INTEGER NOT NULL CHECK (time_ms >= 0),
                    crashes INTEGER NOT NULL, xp INTEGER NOT NULL, crystals INTEGER NOT NULL, created_at INTEGER NOT NULL
                );
                CREATE TABLE IF NOT EXISTS purchases (
                    user_id TEXT NOT NULL, day TEXT NOT NULL, item TEXT NOT NULL, price INTEGER NOT NULL CHECK (price > 0),
                    created_at INTEGER NOT NULL, PRIMARY KEY (user_id, day, item)
                );
                CREATE TABLE IF NOT EXISTS spins (
                    user_id TEXT NOT NULL, day TEXT NOT NULL, segment TEXT NOT NULL, item TEXT,
                    crystals INTEGER NOT NULL, created_at INTEGER NOT NULL, PRIMARY KEY (user_id, day)
                );
                CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
                CREATE INDEX IF NOT EXISTS adventures_user ON adventures (user_id, created_at);
                CREATE INDEX IF NOT EXISTS results_user ON adventure_results (user_id);
            """)
            if "plan" not in {row["name"] for row in store.db.execute("PRAGMA table_info(adventures)")}:
                store.db.execute("ALTER TABLE adventures ADD COLUMN plan TEXT")
            # Columns the public leaderboard sorts and looks up by (the JSON stays the source of truth)
            columns = {row["name"] for row in store.db.execute("PRAGMA table_info(profiles)")}
            for column, kind in (("public_id", "TEXT"), ("xp", "INTEGER NOT NULL DEFAULT 0"), ("name", "TEXT")):
                if column not in columns:
                    store.db.execute(f"ALTER TABLE profiles ADD COLUMN {column} {kind}")
            store.db.execute("CREATE INDEX IF NOT EXISTS profiles_xp ON profiles (xp)")
            store.db.execute("CREATE UNIQUE INDEX IF NOT EXISTS profiles_public ON profiles (public_id)")
            row = store.db.execute("SELECT value FROM meta WHERE key = 'public-secret'").fetchone()
            if row:
                self.secret = bytes.fromhex(row["value"])
            else:
                self.secret = secrets.token_bytes(32)
                store.db.execute("INSERT INTO meta VALUES ('public-secret', ?)", (self.secret.hex(),))
            for row in store.db.execute("SELECT user_id, data FROM profiles WHERE public_id IS NULL").fetchall():
                xp = json.loads(row["data"]).get("xp", 0)
                store.db.execute("UPDATE profiles SET public_id = ?, xp = ? WHERE user_id = ?",
                                 (self.public_id(row["user_id"]), int(xp), row["user_id"]))

    # --- storage ------------------------------------------------------------------

    def public_id(self, user_id):
        """A stable id for public pages that reveals nothing about the login or browser id"""
        return hmac.new(self.secret, user_id.encode(), hashlib.sha256).hexdigest()[:16]

    def _load(self, user):
        return self._load_id(user.id)

    def _load_id(self, user_id):
        row = self.store.db.execute("SELECT data FROM profiles WHERE user_id = ?", (user_id,)).fetchone()
        data = json.loads(row["data"]) if row else {"version": 3, "xp": 0, "crystals": 0,
            "inventory": dict(STARTERS), "equipped": dict(DEFAULT_EQUIPPED), "revision": 0}
        # Migrations: add original wings, the charm slot, names and stats, preserving all earned discoveries
        data["version"] = 3
        data["xp"] = max(0, int(data.get("xp", 0)))
        data["crystals"] = max(0, int(data.get("crystals", 0)))
        inventory = data.get("inventory") if isinstance(data.get("inventory"), dict) else {}
        data["inventory"] = {key: int(count) for key, count in inventory.items() if key in BY_KEY and int(count) > 0}
        for key in STARTERS:
            data["inventory"].setdefault(key, 1)
        equipped = data.get("equipped") if isinstance(data.get("equipped"), dict) else {}
        data["equipped"] = {slot: equipped.get(slot, default) for slot, default in DEFAULT_EQUIPPED.items()}
        data.setdefault("revision", 0)
        names = data.get("pet_names") if isinstance(data.get("pet_names"), dict) else {}
        data["pet_names"] = {pet: name for pet, name in names.items() if isinstance(name, str) and f"pet:{pet}" in BY_KEY}
        data["style"] = 2 if data.get("style") == 2 else 1
        stats = default_stats()
        stats.update({k: v for k, v in (data.get("stats") or {}).items() if k in stats})
        data["stats"] = stats
        return data

    def _save(self, user, data):
        data["revision"] += 1
        data["name"] = user.name
        data["verified"] = bool(getattr(user, "verified", False))
        self.store.db.execute(
            "INSERT INTO profiles (user_id, data, public_id, xp, name) VALUES (?, ?, ?, ?, ?) "
            "ON CONFLICT(user_id) DO UPDATE SET data = excluded.data, xp = excluded.xp, name = excluded.name",
            (user.id, json.dumps(data), self.public_id(user.id), data["xp"], user.name))

    def _view(self, user, data):
        level, progress, cost = level_progress(data["xp"])
        return {**data, "user_id": user.id, "name": user.name, "public_id": self.public_id(user.id), "level": level,
                "level_xp": progress, "next_level_xp": cost, "catalog": CATALOG}

    def _gain(self, data, key):
        """A find or a prize: new ones join the collection, duplicates turn into crystals. Returns (duplicate, crystals)"""
        reward = BY_KEY[key]
        if data["inventory"].get(key, 0) > 0:
            crystals = DUPLICATE_CRYSTALS[RARITIES.index(reward["rarity"])]
            data["crystals"] += crystals
            data["stats"]["crystals_earned"] += crystals
            return True, crystals
        data["inventory"][key] = 1
        return False, 0

    def get(self, user):
        with self.store.lock:
            return self._view(user, self._load(user))

    # --- adventures --------------------------------------------------------------------

    def start(self, user, seed):
        now = int(self.clock())
        token = secrets.token_urlsafe(24)
        with self.store.lock, self.store.db:
            recent = self.store.db.execute("SELECT COUNT(*) AS n FROM adventures WHERE user_id = ? AND created_at > ?",
                                           (user.id, now - 3600)).fetchone()["n"]
            if recent >= ADVENTURES_PER_HOUR:
                raise PermissionError("Too many adventures this hour. Take a breather and try again soon.")
            level = level_progress(self._load(user)["xp"])[0]
            plan = reward_plan(seed, level)
            self.store.db.execute("INSERT INTO adventures (token, user_id, seed, created_at, plan) VALUES (?, ?, ?, ?, ?)",
                                  (token, user.id, seed, now, json.dumps(plan)))
            # Keep the latest adventures only: old plans and their claims are no longer needed
            old = [row["token"] for row in self.store.db.execute(
                "SELECT token FROM adventures WHERE user_id = ? ORDER BY created_at DESC LIMIT -1 OFFSET ?",
                (user.id, KEEP_ADVENTURES))]
            for stale in old:
                self.store.db.execute("DELETE FROM adventure_claims WHERE token = ?", (stale,))
                self.store.db.execute("DELETE FROM adventures WHERE token = ?", (stale,))
        return {"token": token, "seed": seed, "rewards": plan}

    def _journey(self, user, token):
        journey = self.store.db.execute("SELECT * FROM adventures WHERE token = ? AND user_id = ?", (token, user.id)).fetchone()
        if not journey:
            raise ValueError("Adventure not found for this pilot")
        return journey

    def claim(self, user, token, pickups):
        with self.store.lock, self.store.db:
            journey = self._journey(user, token)
            plan = {r["id"]: r for r in (json.loads(journey["plan"]) if journey["plan"] else reward_plan(journey["seed"]))}
            if any(p not in plan for p in pickups):
                raise ValueError("Unknown adventure pickup")
            # A level's pickups can't be reached before the levels ahead of it have been flown
            # (retries of pickups already accepted stay harmless no-ops)
            elapsed = max(0.0, self.clock() - journey["created_at"])
            claimed = {row["pickup"] for row in self.store.db.execute(
                "SELECT pickup FROM adventure_claims WHERE token = ?", (token,))}
            if any(p not in claimed and elapsed < (plan[p]["level"] - 1) * MIN_LEVEL_SECONDS for p in pickups):
                raise ValueError("Those pickups are further along than this adventure has flown")
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
                duplicate = False
                if reward["key"] != "crystal" and reward["key"] in BY_KEY:
                    duplicate, extra = self._gain(data, reward["key"])
                    crystals += extra
                else:
                    data["crystals"] += crystals
                    data["stats"]["crystals_earned"] += crystals
                data["xp"] += xp
                gained_xp += xp
                gained_crystals += crystals
                accepted.append({"id": pickup, "key": reward["key"], "name": reward["name"], "rarity": reward["rarity"],
                                 "kind": reward["kind"], "duplicate": duplicate, "crystals": crystals})
            if accepted:
                self._save(user, data)
            return {"profile": self._view(user, data), "accepted": accepted, "xp": gained_xp,
                    "crystals": gained_crystals, "levels": level_progress(data["xp"])[0] - before}

    def report(self, user, token, result):
        """A finished (or abandoned) adventure: gates become XP and the score becomes crystals, once per adventure"""
        with self.store.lock, self.store.db:
            journey = self._journey(user, token)
            data = self._load(user)
            existing = self.store.db.execute("SELECT * FROM adventure_results WHERE token = ?", (token,)).fetchone()
            if existing:
                return {"profile": self._view(user, data), "xp": existing["xp"], "crystals": existing["crystals"],
                        "levels": 0, "repeated": True}
            levels = result["levels"]
            completed = bool(result["completed"]) and levels == LEVELS
            elapsed_ms = (self.clock() - journey["created_at"]) * 1000
            if result["time_ms"] > elapsed_ms + 5_000:
                raise ValueError("That run took longer than the adventure has existed")
            if completed and result["time_ms"] < LEVELS * MIN_LEVEL_SECONDS * 1000:
                raise ValueError("No one can fly every map that fast")
            if result["gates"] > levels * MAX_GATES_PER_LEVEL or result["score"] > levels * MAX_SCORE_PER_LEVEL:
                raise ValueError("That score is beyond what those levels hold")
            level = level_progress(data["xp"])[0]
            xp = result["gates"] * XP_PER_GATE + (levels - 1) * XP_PER_LEVEL + (XP_COMPLETE if completed else 0)
            crystals = min(CRYSTALS_PER_RUN, int(result["score"] / SCORE_PER_CRYSTAL * (1 + 0.05 * (level - 1))))
            now = int(self.clock())
            self.store.db.execute(
                "INSERT INTO adventure_results VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                (token, user.id, result["score"], levels, int(completed), result["gates"], result["time_ms"],
                 result["crashes"], xp, crystals, now))
            stats = data["stats"]
            stats["gates"] += result["gates"]
            stats["adventures"] += 1
            stats["playtime_ms"] += result["time_ms"]
            stats["best_score"] = max(stats["best_score"], result["score"])
            stats["crystals_earned"] += crystals
            if completed:
                stats["completed"] += 1
                stats["flawless"] += int(result["crashes"] == 0)
                best = stats["best_adventure_ms"]
                stats["best_adventure_ms"] = result["time_ms"] if best is None else min(best, result["time_ms"])
            data["xp"] += xp
            data["crystals"] += crystals
            self._save(user, data)
            return {"profile": self._view(user, data), "xp": xp, "crystals": crystals,
                    "levels": level_progress(data["xp"])[0] - level, "repeated": False}

    def race_finished(self, user, time_ms, gates):
        """A validated race or time trial: one XP per gate, and the stats"""
        with self.store.lock, self.store.db:
            data = self._load(user)
            gates = max(0, min(RACE_GATES_MAX, gates))
            data["xp"] += gates
            stats = data["stats"]
            stats["races"] += 1
            stats["gates"] += gates
            stats["playtime_ms"] += time_ms
            best = stats["fastest_race_ms"]
            stats["fastest_race_ms"] = time_ms if best is None else min(best, time_ms)
            self._save(user, data)
            return gates

    # --- the collection ----------------------------------------------------------------

    def equip(self, user, slot, asset):
        key = f"{'item' if slot == 'charm' else slot}:{asset}"
        with self.store.lock, self.store.db:
            data = self._load(user)
            clearing = slot in ("pet", "charm") and asset == "none"
            if not clearing and (slot not in DEFAULT_EQUIPPED or key not in BY_KEY or not data["inventory"].get(key)):
                raise ValueError("Collect this cosmetic or pet before equipping it")
            data["equipped"][slot] = asset
            self._save(user, data)
            return self._view(user, data)

    def name_pet(self, user, pet, name):
        name = " ".join(name.split())
        with self.store.lock, self.store.db:
            data = self._load(user)
            if not data["inventory"].get(f"pet:{pet}"):
                raise ValueError("Befriend this companion before naming it")
            if name and not PET_NAME.fullmatch(name):
                raise ValueError("Names are up to 20 letters, digits, spaces and ' - . ! ?")
            if name:
                data["pet_names"][pet] = name
            else:
                data["pet_names"].pop(pet, None)
            self._save(user, data)
            return self._view(user, data)

    def set_style(self, user, style):
        with self.store.lock, self.store.db:
            data = self._load(user)
            data["style"] = 2 if style == 2 else 1
            self._save(user, data)
            return self._view(user, data)

    # --- the market and the wheel ---------------------------------------------------------

    def shop(self, user):
        now = self.clock()
        day = utc_day(now)
        with self.store.lock:
            data = self._load(user)
            level = level_progress(data["xp"])[0]
            spun = self.store.db.execute("SELECT 1 FROM spins WHERE user_id = ? AND day = ?", (user.id, day)).fetchone()
            offers = [{**offer, "owned": bool(data["inventory"].get(offer["key"]))} for offer in shop_offers(day, user.id, level)]
            return {"day": day, "resets_at": int(next_day(now) * 1000), "offers": offers,
                    "spin_ready": spun is None,
                    "wheel": [{"id": s["id"], "label": s["label"], "weight": s["weight"], "crystals": s.get("crystals", 0),
                               "rarity": s.get("rarity")} for s in WHEEL],
                    "profile": self._view(user, data)}

    def buy(self, user, key):
        now = self.clock()
        day = utc_day(now)
        with self.store.lock, self.store.db:
            data = self._load(user)
            level = level_progress(data["xp"])[0]
            offer = next((o for o in shop_offers(day, user.id, level) if o["key"] == key), None)
            if not offer:
                raise ValueError("That treasure isn't in today's market")
            if data["inventory"].get(key):
                raise ValueError("You already own this treasure")
            if data["crystals"] < offer["price"]:
                raise ValueError("Not enough crystals yet")
            data["crystals"] -= offer["price"]
            data["inventory"][key] = 1
            data["stats"]["purchases"] += 1
            self.store.db.execute("INSERT INTO purchases VALUES (?, ?, ?, ?, ?)", (user.id, day, key, offer["price"], int(now)))
            self._save(user, data)
            return {"profile": self._view(user, data), "bought": offer}

    def spin(self, user):
        now = self.clock()
        day = utc_day(now)
        with self.store.lock, self.store.db:
            if self.store.db.execute("SELECT 1 FROM spins WHERE user_id = ? AND day = ?", (user.id, day)).fetchone():
                raise PermissionError("The wheel is resting until tomorrow")
            data = self._load(user)
            level = level_progress(data["xp"])[0]
            roll = self.rng.random() * sum(s["weight"] for s in WHEEL)
            index = 0
            for index, segment in enumerate(WHEEL):
                roll -= segment["weight"]
                if roll < 0:
                    break
            segment = WHEEL[index]
            prize, duplicate, crystals = None, False, segment.get("crystals", 0)
            if "rarity" in segment:
                pool = treasure_pool(segment["rarity"], "item", level)
                pool = [e for e in pool if e["rarity"] == RARITIES[segment["rarity"]]] or pool
                # Prefer something new: a duplicate is the consolation, not the plan
                fresh = [e for e in CATALOG if unlocked(e, level) and e["rarity"] == RARITIES[segment["rarity"]]
                         and not data["inventory"].get(e["key"])]
                prize = self.rng.choice(fresh or pool) if (fresh or pool) else None
                if prize:
                    duplicate, extra = self._gain(data, prize["key"])
                    crystals = extra
                    data["xp"] += prize["xp"]
            elif crystals:
                data["crystals"] += crystals
                data["stats"]["crystals_earned"] += crystals
            data["stats"]["spins"] += 1
            self.store.db.execute("INSERT INTO spins VALUES (?, ?, ?, ?, ?, ?)",
                                  (user.id, day, segment["id"], prize["key"] if prize else None, crystals, int(now)))
            self._save(user, data)
            return {"segment": index, "id": segment["id"], "label": segment["label"], "prize": prize,
                    "duplicate": duplicate, "crystals": crystals, "profile": self._view(user, data)}

    # --- public pages --------------------------------------------------------------------

    def achievements(self, data, race_best_ms=None):
        stats, inventory = data["stats"], data["inventory"]
        level = level_progress(data["xp"])[0]
        discoveries = sum(1 for key in inventory if key not in STARTERS)
        owned = {key for key, count in inventory.items() if count}
        done = {
            "firstFlight": stats["adventures"] > 0 or stats["races"] > 0,
            "journeysEnd": stats["completed"] > 0,
            "untouched": stats["flawless"] > 0,
            "collector": discoveries >= 15,
            "legendary": any(BY_KEY[key]["rarity"] == "legendary" for key in owned if key in BY_KEY),
            "menagerie": sum(1 for key in owned if key.startswith("pet:")) >= 4,
            "hoopHunter": stats["gates"] >= 500,
            "hoarder": stats["crystals_earned"] >= 2000,
            "seasoned": level >= 10,
            "skyLegend": level >= 25,
            "devoted": stats["spins"] >= 7,
            "speedster": (race_best_ms or stats["fastest_race_ms"] or 10**9) < 60_000,
            "shopper": stats["purchases"] > 0,
            "completionist": owned >= set(BY_KEY),
        }
        return [{"id": id, "name": name, "description": description, "done": done[id]} for id, name, description in ACHIEVEMENTS]

    def players(self, limit=50):
        with self.store.lock:
            rows = self.store.db.execute(
                "SELECT data, public_id FROM profiles WHERE xp > 0 ORDER BY xp DESC, user_id LIMIT ?", (limit,)).fetchall()
        board = []
        for rank, row in enumerate(rows, 1):
            data = json.loads(row["data"])
            level, progress, cost = level_progress(data.get("xp", 0))
            board.append({"rank": rank, "public_id": row["public_id"], "name": data.get("name") or "Guest",
                          "verified": bool(data.get("verified")), "level": level, "xp": data.get("xp", 0),
                          "level_xp": progress, "next_level_xp": cost,
                          "equipped": {slot: (data.get("equipped") or {}).get(slot, default) for slot, default in DEFAULT_EQUIPPED.items()},
                          "style": 2 if data.get("style") == 2 else 1,
                          "best_score": (data.get("stats") or {}).get("best_score", 0)})
        return board

    def player(self, public_id):
        with self.store.lock:
            row = self.store.db.execute("SELECT user_id FROM profiles WHERE public_id = ?", (public_id,)).fetchone()
            if not row:
                return None
            user_id = row["user_id"]
            raw = json.loads(self.store.db.execute("SELECT data FROM profiles WHERE user_id = ?", (user_id,)).fetchone()["data"])
            data = self._load_id(user_id)
            races = self.store.db.execute(
                "SELECT seed, MIN(time_ms) AS best FROM runs WHERE user_id = ? AND rules = 'speed-control-v3' GROUP BY seed",
                (user_id,)).fetchall()
            rank = self.store.db.execute("SELECT COUNT(*) AS n FROM profiles WHERE xp > ?", (data["xp"],)).fetchone()["n"] + 1
        level, progress, cost = level_progress(data["xp"])
        race_best = min((r["best"] for r in races), default=None)
        pets = [{"asset": key.split(":", 1)[1], "name": BY_KEY[key]["name"], "rarity": BY_KEY[key]["rarity"],
                 "nickname": data["pet_names"].get(key.split(":", 1)[1])}
                for key in BY_KEY if key.startswith("pet:") and data["inventory"].get(key)]
        return {"public_id": public_id, "name": raw.get("name") or "Guest", "verified": bool(raw.get("verified")),
                "rank": rank, "level": level, "xp": data["xp"], "level_xp": progress, "next_level_xp": cost,
                "equipped": data["equipped"], "style": data["style"], "stats": data["stats"],
                "discoveries": sum(1 for key in data["inventory"] if key not in STARTERS), "catalog_size": len(BY_KEY) - len(STARTERS),
                "pets": pets, "races": [{"seed": r["seed"], "best_ms": r["best"]} for r in races],
                "achievements": self.achievements(data, race_best)}
