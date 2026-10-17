"""The region map (plan R1): the same vectors as frontend/tests/regions.test.mjs."""
import json

import pytest

from catalog import CATALOG_DIR, load_catalog
from regions import EDGE, RegionMap, lattice_hash

MAP = RegionMap(load_catalog())
VECTORS = json.loads((CATALOG_DIR / "tests" / "region-vectors.json").read_text(encoding="utf-8"))


@pytest.mark.parametrize("vector", VECTORS["hashes"])
def test_the_hash_matches_bit_for_bit(vector):
    assert lattice_hash(vector["ix"], vector["iz"], vector["stream"]) == vector["value"]


@pytest.mark.parametrize("vector", VECTORS["cases"], ids=[f'{c["x"]},{c["z"]}' for c in VECTORS["cases"]])
def test_the_shared_vectors(vector):
    assert list(MAP.warp(vector["x"], vector["z"])) == vector["warp"]
    weights = MAP.weights(vector["x"], vector["z"])
    assert weights.places == vector["places"]
    assert weights.weights == vector["weights"]
    assert weights.border == vector["border"]


def test_weights_sum_to_one_and_every_place_owns_its_middle():
    for x in range(-7000, 7001, 450):
        for z in range(-7000, 7001, 450):
            assert abs(sum(MAP.weights(x, z).weights) - 1) < 1e-12
    assert MAP.region_at(0, 0) == "lanternhaven"
    for region in MAP.surface:
        assert MAP.region_at(*region.center) == region.id
    assert MAP.region_at(9000, 0) == EDGE
