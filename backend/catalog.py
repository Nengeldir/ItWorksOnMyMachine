"""The shared catalog (shared/catalog at the repo root, docs/open-world-plan.md F1).

Every item, recipe, skill curve, loot table, enemy, region, NPC and quest of the
open world, read here and by the frontend (frontend/src/catalog.ts) from the
same JSON files. Two layers of checks, as shared/catalog/check.mjs does:

1. Shape: pydantic models, strict, no unknown fields. The enums (rarities,
   biomes, stats, kinds...) are read from the JSON Schemas, never copied.
2. Meaning: ids unique, references resolve, loot weights > 0, no loops...
   with messages word for word the same as check.mjs's (both test suites run
   shared/catalog/tests/invalid.json).

`load_catalog()` runs at startup and refuses to start on a broken catalog.
"""
import json
import math
import os
import re
from pathlib import Path
from typing import Annotated, Any, Literal

from pydantic import BaseModel, ConfigDict, Field, StringConstraints, ValidationError

CATALOG_DIR = Path(os.getenv("CATALOG_DIR") or Path(__file__).resolve().parent.parent / "shared" / "catalog")
FILES = ["items", "recipes", "skills", "loot", "enemies", "regions", "npcs", "quests", "stats"]
LISTS = {"items": "items", "recipes": "recipes", "skills": "skills", "loot": "tables",
         "enemies": "enemies", "regions": "regions", "npcs": "npcs", "quests": "quests", "stats": "stats"}
MIN_TELEGRAPH = 0.6
UNSTACKABLE = ["tool", "weapon", "mantle", "charm"]


def _read(path: Path):
    with open(path, encoding="utf-8") as file:
        return json.load(file)


SCHEMAS = {name: _read(CATALOG_DIR / "schema" / f"{name}.schema.json") for name in ["common", *FILES]}


def _enum(schema: str, name: str):
    """A Literal of a schema definition's enum: one list of values for both languages"""
    return Literal[tuple(SCHEMAS[schema]["$defs"][name]["enum"])]


def _pattern(schema: str, name: str) -> str:
    return SCHEMAS[schema]["$defs"][name]["pattern"]


Id = Annotated[str, StringConstraints(pattern=_pattern("common", "Id"))]
Text = Annotated[str, StringConstraints(min_length=1)]
Model = Annotated[str, StringConstraints(pattern=SCHEMAS["items"]["$defs"]["Item"]["properties"]["model"]["pattern"])]
Count = Annotated[int, Field(ge=1)]
Rarity = _enum("common", "Rarity")
BiomeId = _enum("common", "BiomeId")
StatId = _enum("common", "StatId")
StatBlock = dict[StatId, float]
CountRange = tuple[Annotated[int, Field(ge=0)], Annotated[int, Field(ge=0)]]
Point = tuple[float, float]


class Strict(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True, strict=True)


class File(Strict):
    schema_: str | None = Field(None, alias="$schema")


class Amount(Strict):
    item: Id
    count: Count


class Item(Strict):
    id: Id
    name: Text
    kind: _enum("items", "ItemKind")
    rarity: Rarity
    stack: Annotated[int, Field(ge=1, le=1024)]
    model: Model
    icon: Text
    sell: Annotated[int, Field(ge=0)]
    region: Id | None = None
    lore: Text
    slot: _enum("items", "GearSlot") | None = None
    stats: StatBlock | None = None
    ability: Id | None = None
    requires: dict[Id, Count] | None = None
    skill: Id | None = None
    fortune: Annotated[float, Field(ge=0)] | None = None
    speed: Annotated[float, Field(gt=0)] | None = None
    breaks: Annotated[list[_enum("items", "NodeKind")], Field(min_length=1)] | None = None


class ItemsFile(File):
    items: list[Item]


class RecipeUnlock(Strict):
    skill: Id | None = None
    level: Count | None = None
    collection: Id | None = None
    tier: Count | None = None


class Recipe(Strict):
    id: Id
    station: _enum("recipes", "Station")
    inputs: Annotated[list[Amount], Field(min_length=1)]
    output: Amount
    time: Annotated[float, Field(ge=0)]
    unlock: RecipeUnlock | None = None


class RecipesFile(File):
    recipes: list[Recipe]


class SkillUnlock(Strict):
    level: Annotated[int, Field(ge=2)]
    kind: _enum("skills", "UnlockKind")
    id: Id


class Skill(Strict):
    id: Id
    name: Text
    color: Annotated[str, StringConstraints(pattern=r"^#[0-9a-f]{6}$")]
    curve: Id
    maxLevel: Annotated[int, Field(ge=2)]
    perLevel: StatBlock
    unlocks: list[SkillUnlock]


class SkillsFile(File):
    windRankShare: Annotated[float, Field(gt=0, le=1)]
    curves: dict[Id, Annotated[list[Count], Field(min_length=1)]]
    skills: list[Skill]


class Drop(Strict):
    item: Id
    count: CountRange


class WeightedDrop(Strict):
    item: Id
    weight: float
    count: CountRange


class RareDrop(Strict):
    item: Id
    chance: Annotated[float, Field(gt=0, le=1)]
    pity: Annotated[int, Field(ge=0)] | None = None
    count: CountRange


class LootTable(Strict):
    id: Id
    rolls: Annotated[int, Field(ge=0)]
    guaranteed: list[Drop] | None = None
    entries: list[WeightedDrop]
    rare: list[RareDrop] | None = None


class LootFile(File):
    tables: list[LootTable]


class Telegraph(Strict):
    cue: Text
    seconds: float


class Enemy(Strict):
    id: Id
    name: Text
    behaviour: _enum("enemies", "Behaviour")
    light: Annotated[float, Field(gt=0)]
    might: Annotated[float, Field(ge=0)]
    ward: Annotated[float, Field(ge=0)]
    speed: Annotated[float, Field(gt=0)]
    telegraph: Telegraph
    freed: Text
    loot: Id
    model: Model
    lore: Text


class EnemiesFile(File):
    enemies: list[Enemy]


class Hub(Strict):
    id: Id
    name: Text
    center: Point
    radius: Annotated[float, Field(gt=0)]


class Region(Strict):
    id: Id
    name: Text
    biome: BiomeId
    skills: list[Id]
    places: list[Text]
    center: Point
    radius: Annotated[float, Field(gt=0)]
    layer: _enum("regions", "Layer")
    note: str | None = None


class Borders(Strict):
    band: Annotated[float, Field(gt=0)]
    hubBand: Annotated[float, Field(gt=0)]
    warp: Annotated[float, Field(ge=0)]
    warpScale: Annotated[float, Field(gt=0)]


class RegionsFile(File):
    worldRadius: Annotated[float, Field(gt=0)]
    cell: Annotated[float, Field(gt=0)]
    seed: Annotated[int, Field(ge=0)]
    borders: Borders
    hub: Hub
    regions: list[Region]


class Choice(Strict):
    text: Text
    next: Id | None = None
    quest: Id | None = None


class Line(Strict):
    id: Id
    text: Text
    choices: list[Choice] | None = None


class Npc(Strict):
    id: Id
    name: Text
    role: Text
    region: Id
    station: _enum("recipes", "Station") | None = None
    voice: Annotated[float, Field(gt=0)]
    idle: Text
    lines: Annotated[list[Line], Field(min_length=1)]


class NpcsFile(File):
    npcs: list[Npc]


class QuestGoal(Strict):
    item: Id | None = None
    count: Count | None = None
    npc: Id | None = None
    region: Id | None = None


class QuestRewards(Strict):
    coins: Annotated[int, Field(ge=0)] | None = None
    items: list[Amount] | None = None
    xp: dict[Id, Count] | None = None


class Quest(Strict):
    id: Id
    name: Text
    giver: Id
    kind: _enum("quests", "QuestKind")
    goal: QuestGoal
    rewards: QuestRewards
    requires: list[Id] | None = None
    board: bool | None = None
    text: Text


class QuestsFile(File):
    quests: list[Quest]


class StatInfo(Strict):
    id: StatId
    name: Text
    group: _enum("stats", "StatGroup")
    base: Annotated[float, Field(ge=0)]
    cap: Annotated[float, Field(gt=0)] | None = None
    unit: _enum("stats", "StatUnit")
    description: Text


class SwiftnessFlight(Strict):
    perPoint: Annotated[float, Field(ge=0)]
    cap: Annotated[float, Field(ge=0, le=0.25)]


class StatsFile(File):
    stats: list[StatInfo]
    swiftnessFlight: SwiftnessFlight


MODELS = {"items": ItemsFile, "recipes": RecipesFile, "skills": SkillsFile, "loot": LootFile,
          "enemies": EnemiesFile, "regions": RegionsFile, "npcs": NpcsFile, "quests": QuestsFile, "stats": StatsFile}


# --- shape -----------------------------------------------------------------------


def describe_path(file: str, path: list, data) -> str:
    """The readable place of a value: the list's entry by its id, then the field path (as check.mjs)"""
    lst, label, rest = LISTS[file], "", list(path)
    if len(path) > 1 and path[0] == lst and isinstance(path[1], int):
        entries = data.get(lst) if isinstance(data, dict) else None
        entry = entries[path[1]] if isinstance(entries, list) and path[1] < len(entries) else None
        entry_id = entry.get("id") if isinstance(entry, dict) else None
        label = entry_id if isinstance(entry_id, str) else f"{lst}[{path[1]}]"
        rest = path[2:]
    tail = ""
    for part in rest:
        tail += f"[{part}]" if isinstance(part, int) else (f".{part}" if tail else str(part))
    return ": ".join(part for part in (label, tail) if part)


def _message(error) -> tuple[list, str]:
    """A pydantic error as check.mjs words it (exactly for missing, unknown and enum errors)"""
    path, kind = list(error["loc"]), error["type"]
    key = bool(path) and path[-1] == "[key]"
    if key:
        path = path[:-1]
    if kind == "missing":
        return path[:-1], f'missing "{path[-1]}"'
    if kind == "extra_forbidden":
        return path[:-1], f'unknown field "{path[-1]}"'
    if kind == "literal_error":
        allowed = ", ".join(re.findall(r"'([^']*)'", error["ctx"]["expected"]))
        return path, f"{'key ' if key else ''}{json.dumps(error['input'])} is not one of {allowed}"
    return path, error["msg"][0].lower() + error["msg"][1:]


def shape_errors(files: dict) -> list[str]:
    errors = []
    for file in FILES:
        try:
            MODELS[file].model_validate_json(json.dumps(files[file]), strict=True)
        except ValidationError as error:
            for detail in error.errors():
                path, message = _message(detail)
                where = describe_path(file, path, files[file])
                errors.append(f"{file}.json: {where + ': ' if where else ''}{message}")
    return errors


# --- meaning ---------------------------------------------------------------------


def find_loop(graph: dict[str, list[str]]) -> str | None:
    """The first loop in a graph of id -> ids, as "a → b → a", or None (same visiting order as check.mjs)"""
    state: dict[str, int] = {}
    stack: list[str] = []

    def visit(node):
        state[node] = 1
        stack.append(node)
        for nxt in graph.get(node, []):
            if state.get(nxt) == 1:
                return " → ".join([*stack[stack.index(nxt):], nxt])
            if nxt not in state:
                loop = visit(nxt)
                if loop:
                    return loop
        stack.pop()
        state[node] = 2
        return None

    for node in graph:
        if node not in state:
            loop = visit(node)
            if loop:
                return loop
    return None


def _add_edge(graph, source, target):
    edges = graph.setdefault(source, [])
    if target not in edges:
        edges.append(target)


def _num(value) -> str:
    """Numbers printed as JavaScript prints them (2, not 2.0)"""
    return str(int(value)) if isinstance(value, float) and value.is_integer() else str(value)


def meaning_errors(files: dict) -> list[str]:
    errors: list[str] = []
    err = errors.append
    ids: dict[str, set[str]] = {}
    for file in FILES:
        seen: set[str] = set()
        for entry in files[file][LISTS[file]]:
            if entry["id"] in seen:
                err(f'{file}.json: duplicate id "{entry["id"]}"')
            seen.add(entry["id"])
        ids[file] = seen
    hub = files["regions"]["hub"]["id"]
    if hub in ids["regions"]:
        err(f'regions.json: the hub\'s id "{hub}" is also a region\'s')
    places = ids["regions"] | {hub}

    def item(file, owner, what, value):
        if value not in ids["items"]:
            err(f'{file}.json: {owner}: {what} "{value}" is not in items.json')

    def skill(file, owner, what, value):
        if value not in ids["skills"]:
            err(f'{file}.json: {owner}: {what} "{value}" is not in skills.json')

    for entry in files["items"]["items"]:
        if "region" in entry and entry["region"] not in places:
            err(f'items.json: {entry["id"]}: region "{entry["region"]}" is not in regions.json')
        if entry["kind"] == "tool" and "skill" not in entry:
            err(f'items.json: {entry["id"]}: a tool needs a "skill"')
        if "skill" in entry:
            skill("items", entry["id"], "skill", entry["skill"])
        for key in entry.get("requires") or {}:
            skill("items", entry["id"], "requires", key)
        if entry["kind"] in ("weapon", "mantle") and "slot" not in entry:
            err(f'items.json: {entry["id"]}: a {entry["kind"]} needs a "slot"')
        if entry["kind"] == "currency" and entry["sell"] != 0:
            err(f'items.json: {entry["id"]}: currency can\'t be sold (sell must be 0)')
        if entry["kind"] in UNSTACKABLE and entry["stack"] != 1:
            err(f'items.json: {entry["id"]}: a {entry["kind"]} doesn\'t stack (stack must be 1)')

    crafts: dict[str, list[str]] = {}
    for recipe in files["recipes"]["recipes"]:
        for entry in recipe["inputs"]:
            item("recipes", recipe["id"], "input", entry["item"])
            _add_edge(crafts, entry["item"], recipe["output"]["item"])
        item("recipes", recipe["id"], "output", recipe["output"]["item"])
        unlock = recipe.get("unlock")
        if unlock:
            by_skill = "skill" in unlock and "level" in unlock
            by_collection = "collection" in unlock and "tier" in unlock
            if by_skill == by_collection or len(unlock) != 2:
                err(f'recipes.json: {recipe["id"]}: unlock needs "skill" and "level", or "collection" and "tier"')
            elif by_skill:
                skill("recipes", recipe["id"], "unlock skill", unlock["skill"])
            else:
                item("recipes", recipe["id"], "unlock collection", unlock["collection"])
    loop = find_loop(crafts)
    if loop:
        err(f"recipes.json: recipes loop: {loop}")

    for name, steps in files["skills"]["curves"].items():
        for i in range(1, len(steps)):
            if steps[i] <= steps[i - 1]:
                err(f'skills.json: curve "{name}" must rise at every level (step {i + 1})')
    unlock_files = {"recipe": "recipes", "region": "regions", "item": "items"}
    for entry in files["skills"]["skills"]:
        curve = files["skills"]["curves"].get(entry["curve"])
        if curve is None:
            err(f'skills.json: {entry["id"]}: curve "{entry["curve"]}" is not in curves')
        elif len(curve) != entry["maxLevel"] - 1:
            err(f'skills.json: {entry["id"]}: curve "{entry["curve"]}" has {len(curve)} steps, '
                f'{entry["maxLevel"]} levels need {entry["maxLevel"] - 1}')
        for unlock in entry["unlocks"]:
            file = unlock_files[unlock["kind"]]
            if unlock["id"] not in ids[file]:
                err(f'skills.json: {entry["id"]}: unlock at level {unlock["level"]}: {unlock["kind"]} '
                    f'"{unlock["id"]}" is not in {file}.json')
            if unlock["level"] > entry["maxLevel"]:
                err(f'skills.json: {entry["id"]}: unlock at level {unlock["level"]} is above max level {entry["maxLevel"]}')

    for table in files["loot"]["tables"]:
        for drop in [*(table.get("guaranteed") or []), *table["entries"], *(table.get("rare") or [])]:
            item("loot", table["id"], "drop", drop["item"])
            if drop["count"][0] > drop["count"][1]:
                err(f'loot.json: {table["id"]}: count of "{drop["item"]}" is [{drop["count"][0]}, {drop["count"][1]}]: min above max')
        for entry in table["entries"]:
            if not entry["weight"] > 0:
                err(f'loot.json: {table["id"]}: weight of "{entry["item"]}" must be > 0')
        if table["rolls"] > 0 and not table["entries"]:
            err(f'loot.json: {table["id"]}: {table["rolls"]} rolls but no entries')

    for enemy in files["enemies"]["enemies"]:
        if enemy["loot"] not in ids["loot"]:
            err(f'enemies.json: {enemy["id"]}: loot "{enemy["loot"]}" is not in loot.json')
        if enemy["telegraph"]["seconds"] < MIN_TELEGRAPH:
            err(f'enemies.json: {enemy["id"]}: telegraph of {_num(enemy["telegraph"]["seconds"])} s is under {MIN_TELEGRAPH} s')

    world_radius = files["regions"]["worldRadius"]
    for region in files["regions"]["regions"]:
        for skill_id in region["skills"]:
            skill("regions", region["id"], "skill", skill_id)
        reach = math.hypot(*region["center"]) + region["radius"]
        if reach > world_radius:
            err(f'regions.json: {region["id"]}: reaches {math.floor(reach + 0.5)} m from the hub, '
                f'beyond worldRadius {_num(world_radius)}')

    for npc in files["npcs"]["npcs"]:
        if npc["region"] not in places:
            err(f'npcs.json: {npc["id"]}: region "{npc["region"]}" is not in regions.json')
        lines: set[str] = set()
        for line in npc["lines"]:
            if line["id"] in lines:
                err(f'npcs.json: {npc["id"]}: duplicate line "{line["id"]}"')
            lines.add(line["id"])
        for line in npc["lines"]:
            for choice in line.get("choices") or []:
                if "next" in choice and choice["next"] not in lines:
                    err(f'npcs.json: {npc["id"]}: line "{line["id"]}" leads to "{choice["next"]}", not a line of {npc["id"]}')
                if "quest" in choice and choice["quest"] not in ids["quests"]:
                    err(f'npcs.json: {npc["id"]}: line "{line["id"]}" offers quest "{choice["quest"]}", not in quests.json')

    chains: dict[str, list[str]] = {}
    needs_by_kind = {"fetch": ["item", "count"], "gather": ["item", "count"], "catch": ["item", "count"],
                     "deliver": ["item", "count", "npc"], "explore": ["region"]}
    for quest in files["quests"]["quests"]:
        if quest["giver"] not in ids["npcs"]:
            err(f'quests.json: {quest["id"]}: giver "{quest["giver"]}" is not in npcs.json')
        goal, needs = quest["goal"], needs_by_kind[quest["kind"]]
        if any(field not in goal for field in needs) or any(field not in needs for field in goal):
            err(f'quests.json: {quest["id"]}: a {quest["kind"]} goal takes {", ".join(chr(34) + f + chr(34) for f in needs)}')
        if "item" in goal:
            item("quests", quest["id"], "goal item", goal["item"])
        if "npc" in goal and goal["npc"] not in ids["npcs"]:
            err(f'quests.json: {quest["id"]}: goal npc "{goal["npc"]}" is not in npcs.json')
        if "region" in goal and goal["region"] not in places:
            err(f'quests.json: {quest["id"]}: goal region "{goal["region"]}" is not in regions.json')
        for reward in quest["rewards"].get("items") or []:
            item("quests", quest["id"], "reward", reward["item"])
        for skill_id in quest["rewards"].get("xp") or {}:
            skill("quests", quest["id"], "reward xp", skill_id)
        for required in quest.get("requires") or []:
            if required not in ids["quests"]:
                err(f'quests.json: {quest["id"]}: requires "{required}", not in quests.json')
            _add_edge(chains, quest["id"], required)
    loop = find_loop(chains)
    if loop:
        err(f"quests.json: quests loop: {loop}")

    for stat_id in SCHEMAS["common"]["$defs"]["StatId"]["enum"]:
        if stat_id not in ids["stats"]:
            err(f'stats.json: missing stat "{stat_id}"')
    for stat in files["stats"]["stats"]:
        if "cap" in stat and stat["base"] > stat["cap"]:
            err(f'stats.json: {stat["id"]}: base {_num(stat["base"])} is above its cap {_num(stat["cap"])}')
    return errors


def load_files(directory: Path = CATALOG_DIR) -> dict[str, Any]:
    return {file: _read(directory / f"{file}.json") for file in FILES}


def check_catalog(files: dict) -> list[str]:
    """Every problem, shape first; meaning only once the shapes are right"""
    return shape_errors(files) or meaning_errors(files)


class Catalog:
    """The checked catalog: each file's model, and every list by id"""

    def __init__(self, files: dict):
        self.files = {file: MODELS[file].model_validate_json(json.dumps(files[file]), strict=True) for file in FILES}
        self.items: dict[str, Item] = {e.id: e for e in self.files["items"].items}
        self.recipes: dict[str, Recipe] = {e.id: e for e in self.files["recipes"].recipes}
        self.skills: dict[str, Skill] = {e.id: e for e in self.files["skills"].skills}
        self.curves: dict[str, list[int]] = dict(self.files["skills"].curves)
        self.wind_rank_share: float = self.files["skills"].windRankShare
        self.loot: dict[str, LootTable] = {e.id: e for e in self.files["loot"].tables}
        self.enemies: dict[str, Enemy] = {e.id: e for e in self.files["enemies"].enemies}
        self.regions: dict[str, Region] = {e.id: e for e in self.files["regions"].regions}
        self.hub: Hub = self.files["regions"].hub
        self.npcs: dict[str, Npc] = {e.id: e for e in self.files["npcs"].npcs}
        self.quests: dict[str, Quest] = {e.id: e for e in self.files["quests"].quests}
        self.stats: dict[str, StatInfo] = {e.id: e for e in self.files["stats"].stats}
        self.swiftness_flight: SwiftnessFlight = self.files["stats"].swiftnessFlight


def load_catalog(directory: Path = CATALOG_DIR) -> Catalog:
    files = load_files(directory)
    errors = check_catalog(files)
    if errors:
        raise RuntimeError("The shared catalog has problems:\n" + "\n".join(errors))
    return Catalog(files)
