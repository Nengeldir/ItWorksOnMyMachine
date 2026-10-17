"""The shared catalog (plan F1): the backend reads the same files as the frontend and finds the same problems.

frontend/tests/catalog.test.mjs runs the same broken cases (shared/catalog/tests/invalid.json) against check.mjs.
"""
import copy
import json

import pytest

from catalog import CATALOG_DIR, LISTS, SCHEMAS, check_catalog, load_catalog, load_files
from profiles import RARITIES

FILES = load_files()
CASES = json.loads((CATALOG_DIR / "tests" / "invalid.json").read_text(encoding="utf-8"))["cases"]


def apply_case(files, change):
    """A copy of the files with one case's change (as check.mjs applyCase)"""
    files = copy.deepcopy(files)
    entries = files[change["file"]][LISTS[change["file"]]]
    if "add" in change:
        entries.append(copy.deepcopy(change["add"]))
    if "id" in change:
        entry = next(e for e in entries if e["id"] == change["id"])
        entry.update(copy.deepcopy(change.get("set", {})))
        for field in change.get("drop", []):
            entry.pop(field, None)
    if "top" in change:
        files[change["file"]].update(copy.deepcopy(change["top"]))
    return files


def test_the_catalog_is_valid():
    assert check_catalog(FILES) == []
    catalog = load_catalog()
    assert len(catalog.items) == len(FILES["items"]["items"])
    assert catalog.items["moonwheat"].rarity == "common"
    assert catalog.items["wing_blades"].stats == {"might": 30, "crit": 5}
    assert catalog.hub.id == "lanternhaven"
    assert len(catalog.curves["standard"]) == catalog.skills["farming"].maxLevel - 1


@pytest.mark.parametrize("change", CASES, ids=[case["name"] for case in CASES])
def test_a_broken_catalog_fails_with_a_readable_message(change):
    errors = check_catalog(apply_case(FILES, change))
    text = "\n".join(errors)
    for expected in change["expect"]:
        assert expected in text, f"{change['name']}: expected {expected!r} among:\n{text or '(no errors)'}"


def test_load_catalog_refuses_a_broken_catalog(tmp_path, monkeypatch):
    broken = apply_case(FILES, CASES[0])
    for file, data in broken.items():
        (tmp_path / f"{file}.json").write_text(json.dumps(data), encoding="utf-8")
    with pytest.raises(RuntimeError, match='region "nowhere" is not in regions.json'):
        load_catalog(tmp_path)


def test_the_catalogs_rarities_are_the_profiles():
    assert SCHEMAS["common"]["$defs"]["Rarity"]["enum"] == RARITIES


def test_skill_curves_rise():
    for name, steps in FILES["skills"]["curves"].items():
        assert all(b > a for a, b in zip(steps, steps[1:])), name
