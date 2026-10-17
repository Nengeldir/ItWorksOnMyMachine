"""The Reaches' region map (docs/open-world-plan.md R1), the same function as
frontend/src/game/reaches/regions.ts.

Which place owns every point of the world, and how much: Lanternhaven in the middle, the surface regions
of shared/catalog/regions.json on a ring round it (each owning the land nearest its centre, a Voronoi map
whose borders wander: the point is warped by seeded value noise first), blending over `borders.band`
metres; the hub over `borders.hubBand`; open sky past `worldRadius`.

Both run shared/catalog/tests/region-vectors.json and agree to the last bit: only + - * /, floor and sqrt
(exactly rounded in both languages) and a 32-bit integer hash, never sin or cos. The server will use it to
name gathering nodes by region (R2) without storing them (ground rule 8).
"""
import math
from dataclasses import dataclass

from catalog import Catalog

EDGE = "edge"
MASK = 0xFFFFFFFF


def _mul(a: int, b: int) -> int:
    """32-bit unsigned multiply, as Math.imul(a, b) >>> 0"""
    return (a * b) & MASK


def lattice_hash(ix: int, iz: int, stream: int) -> float:
    """A number in [0, 1) for an integer lattice point and a stream"""
    h = _mul(ix & MASK, 0x27D4EB2D) ^ _mul(iz & MASK, 0x165667B1) ^ _mul(stream & MASK, 0x9E3779B1)
    h = _mul(h ^ (h >> 15), 0x85EBCA6B)
    h = _mul(h ^ (h >> 13), 0xC2B2AE35)
    h ^= h >> 16
    return h / 4294967296


def _smooth(t: float) -> float:
    return t * t * (3 - 2 * t)


def value_noise(x: float, z: float, stream: int) -> float:
    """Smooth value noise in [0, 1)"""
    ix, iz = math.floor(x), math.floor(z)
    fx, fz = _smooth(x - ix), _smooth(z - iz)
    a, b = lattice_hash(ix, iz, stream), lattice_hash(ix + 1, iz, stream)
    c, d = lattice_hash(ix, iz + 1, stream), lattice_hash(ix + 1, iz + 1, stream)
    top, bottom = a + (b - a) * fx, c + (d - c) * fx
    return top + (bottom - top) * fz


def _share(distance: float, band: float) -> float:
    t = min(1.0, max(0.0, distance / (band / 2)))
    return 0.5 * (1 - _smooth(t))


def _within(d: float, band: float) -> float:
    return _share(d, band) if d >= 0 else 1 - _share(-d, band)


@dataclass(frozen=True)
class RegionWeights:
    """Up to three places sharing a point, most first; weights sum to 1"""
    places: list[str]
    weights: list[float]
    border: float

    @property
    def a(self) -> str:
        return self.places[0]


class RegionMap:
    def __init__(self, catalog: Catalog):
        regions = catalog.files["regions"]
        self.borders = regions.borders
        self.seed = regions.seed
        self.world_radius = regions.worldRadius
        self.hub = regions.hub
        self.surface = [r for r in regions.regions if r.layer == "surface"]

    def warp(self, x: float, z: float) -> tuple[float, float]:
        amount, scale = self.borders.warp, self.borders.warpScale
        s = self.seed * 4
        fine = scale / 2.5
        wx = (value_noise(x / scale, z / scale, s) - 0.5) * 2 + (value_noise(x / fine, z / fine, s + 1) - 0.5) * 0.8
        wz = (value_noise(x / scale, z / scale, s + 2) - 0.5) * 2 + (value_noise(x / fine, z / fine, s + 3) - 0.5) * 0.8
        return x + wx * amount, z + wz * amount

    def weights(self, x: float, z: float) -> RegionWeights:
        px, pz = self.warp(x, z)
        band, hub_band = self.borders.band, self.borders.hubBand
        first, second, d1, d2 = 0, 1, math.inf, math.inf
        for i, region in enumerate(self.surface):
            cx, cz = region.center
            d = (px - cx) * (px - cx) + (pz - cz) * (pz - cz)
            if d < d1:
                second, d2, first, d1 = first, d1, i, d
            elif d < d2:
                second, d2 = i, d
        (ax, az), (bx, bz) = self.surface[first].center, self.surface[second].center
        apart = math.sqrt((bx - ax) * (bx - ax) + (bz - az) * (bz - az))
        border = (d2 - d1) / (2 * apart)
        wb = _share(border, band)
        hx, hz = self.hub.center
        from_hub = math.sqrt((px - hx) * (px - hx) + (pz - hz) * (pz - hz)) - self.hub.radius
        from_edge = self.world_radius - math.sqrt(px * px + pz * pz)
        hub = _within(from_hub, hub_band)
        sky = _within(from_edge, band)
        over = self.hub.id if hub >= sky else EDGE
        top = max(hub, sky)
        entries = [(over, top), (self.surface[first].id, (1 - top) * (1 - wb)), (self.surface[second].id, (1 - top) * wb)]
        kept = sorted([e for e in entries if e[1] > 0], key=lambda e: -e[1])
        near = abs(from_hub if hub >= sky else from_edge) if top >= 1 else min(abs(border), abs(from_hub), abs(from_edge))
        return RegionWeights([p for p, _ in kept], [w for _, w in kept], near)

    def region_at(self, x: float, z: float) -> str:
        return self.weights(x, z).a
