# Infinite mode: prototype plan

Status: **a plan, not implemented**. Written 2026-10-11 with feasibility
trials (`docs/prototypes/infinite/trial.mjs`) whose results are quoted below.
Nothing in the game changes until the team decides to build it.

## What it is

Explore mode (`/?explore=<biome>&seed=<n>`) already lets you fly any biome
freely: no clock, nothing saved. The infinite mode grows that into a mode of
its own, in two flavours chosen on its map select:

1. **Endless map**: pick any map (the shared map pool's card). Its racing
   line, gates and land go on forever in the same biome, respawns are
   unlimited, and the score is distance, gates and style. A calm, Sky-like
   flight with no end.
2. **Wandering skies**: one endless journey whose land changes biome every
   few kilometres, crossfading between biomes that share a shape family:
   *valley biomes* (Verdant Highlands, Glacier Peaks, Ember Wastes, Twilight
   Forest, Aurora Summit, Coral Lagoon) with each other, *island biomes* (Sky
   Archipelago, and Sky Isles once ported to generator v2) with each other,
   and occasionally a valley rising out of island country (see trial E).

It fits Wind Rider's direction: vast, peaceful spaces (Sky's Isle of Dawn,
Genshin's open vistas), light and color guiding the way, no hard failure.

## The mechanics

| Mechanic | Endless map | Wandering skies |
| :--- | :--- | :--- |
| Lives | Unlimited: a crash respawns you at the last gate (as test mode's `lives: Infinity`) | Same |
| Score | Gates (chained, as in adventures), style, distance (1 point per 10 m) | Same, plus a bonus for each new biome reached |
| Stamina | Stamina orbs, as in adventures (no natural recharge) | Same; orbs get rarer slowly with distance |
| Difficulty | Rises slowly with distance: `Course` difficulty (see "Harder levels") from 0 at the start to 1 at 20 km | Same |
| Items, charms, powers | All, like an adventure (rule 6: never in races) | Same |
| Portals | None; a "rest gate" every 5 km saves a checkpoint and offers an upgrade (the run's picker) | A biome gate marks each crossfade |
| Rewards | XP per gate (like races, through a new server report with a distance cap); no crystals (or a small, capped amount) | Same |
| End | When the player leaves; best distance per map kept on the server | Best distance overall |

## What has to change, and where

### 1. The racing line without an end (`world/course.ts`)

`Course.x(z)` is simplex noise of z, defined everywhere; only the height table
(`ys`, the slope integrated every 2 m) and the gates stop at 2280 m. An
endless course integrates the slope chunk by chunk on demand (2 km chunks)
and draws each chunk's gates from its own random stream
(`makeRng(seed, "gates/<chunk>")`).

- **Trial A1:** the endless line equals the game's line on its first 2 km
  (max difference 0.0000 m, heights measured from z = 0).
- **Trial A2:** no height jump at chunk seams (6e-7 m over 100 km).
- **Trial A4:** gate spacing stays 95 to 130 m over 100 km.
- **Trial A3:** with the game's always-down slope the line is 22 km below
  its start after 100 km. That is harmless with a floating origin (below),
  but the cloud sea, `World.lost` and the sky shader assume heights near the
  line; they already follow the line (`seaAt`, the cloud sea at a depth below
  it), so they keep working. A gentler alternative: let the slope average
  zero over each chunk with "updraft rests" (rising air the pilot rides).

Interface: an `EndlessCourse` implementing what `Course` exposes (`x`, `y`,
`pointAt`, `tangentAt`, `distance`, `rings`) where `rings` becomes a window
of the gates near the pilot (index → ring, created and dropped as the pilot
moves). Everything that loops over `course.rings` (gates in `Game.step` and
`RunController.step`, the pet's `hoopNear`, collection placement, orbs) must
take the window instead of the whole array; there are about a dozen loops.

### 2. Land that streams forever (`world/terrain/streamer.ts`, `world/World.ts`)

Generator-v2 land is already streamed by an octree keyed by integer node
coordinates (`LandStreamer`), with a bounded hidden-mesh cache, so it has no
size limit in itself. What's finite is what the land is built from:

- `buildLand` places shapes (arches, pillars, mesas…) along the course once,
  for the whole level. Make it chunked: shapes for chunk k are placed when
  chunk k comes within 1.5 km, from `makeRng(seed, "land/<k>")`, and
  dropped when it is 3 km behind. `TerrainField` already queries its shapes
  through boxes; it needs an add/remove API and the mesher workers need the
  same chunk set (they rebuild the World from a `LevelKey`: add the chunk
  window to the message).
- `Ground` and `Steps` (valley floor, river pools and falls) are built along
  the line for its length: build them per chunk the same way, joining at the
  seams (the river's level carries over).
- Flora placement (`flora/placement.ts`) works per node already.
- Sky Isles (`legacyIslands`) is frozen for races; the infinite mode should
  only use generator-v2 biomes (Sky Archipelago is the island biome there).

### 3. Precision far from the origin (floating origin)

The GPU keeps positions in 32-bit floats. **Trial B1**: the gap between
neighbouring float32 values is 0.0001 m at 2 km, 0.002 m at 20 km, 0.008 m at
100 km and 0.06 m at 1000 km. Vertices would visibly shake beyond roughly
100 km. Fix: a floating origin. Every 10 km, subtract the pilot's position
(rounded to a node size, 384 m, so octree keys stay integers) from everything
in world space: the flight state, the camera, the streamed nodes' positions,
the particle ring buffer (its stored starts), trails, the pet, the gate and
orb instances. Keep a `worldOffset` (float64 on the CPU) that every
generator query adds back (`field.distance(x + ox, …)`), so noise and seeds
see true coordinates and the land doesn't change. This is the largest change
in the plan and touches most per-frame systems; ghosts and multiplayer don't
apply in this mode.

### 4. Biomes that crossfade (`world/biomes/`, `world/terrain/field.ts`, `world/atmosphere.ts`)

The land of two generator-v2 biomes around the same line can be mixed as
`d = (1 − w) · dA + w · dB`, with `w` a smoothstep across a window.

- **Trial C (Verdant → Glacier) and C′ (Verdant → Ember):** near the
  surface the blended field's gradient matches its parts (median 0.53 to
  0.56; 99th percentile 12.9 and 15.1 against the biomes' own 7.7 to 15.3;
  each biome's field already has occasional steep jumps, most likely at the
  river's steps and falls). Crossfading doesn't make it worse.
- **All trials:** the racing tube stays clear through the blend (closest rock
  11.0 to 11.1 m from the line, the tube's radius), and there are no
  contradictions (points inside rock in both biomes but in air in the blend).
- **Trial D/E (Sky Archipelago → Verdant), island into valley:** also clean
  (gradient p99 6.4, tube 11.0 m, no contradictions). Under the line, the
  valley floor rises out of the cloud sea from 184 m below to its normal 52 m
  within about 150 m of a 300 m window, with island fragments early in it.
  Use longer windows (600 to 800 m) for these, between gates, so the rise
  reads as a reveal, not a pop.

What to build: a `BlendField` (two `TerrainField`s and the window) behind the
same interface; per-vertex surface ids from whichever side weighs more (the
terrain shader's paint already comes per face); flora: each side's species in
its half, thinned towards the middle; water: the river of the side that has
one, fading its pools out across the window; light: cross-fade the palettes
exactly as the portal transition does (`RunController.blendSky`), driven by
the pilot's position instead of a timer; music: `MusicPlayer` already
crossfades on `setBiome`.

Exclude: Sunken Reef (underwater: different atmosphere, fog and sky shader;
it could be reached through a portal-like dive instead), and the frozen Sky
Isles.

### 5. The mode itself (`session/`, `route.ts`, components)

- `route.ts`: `/?infinite=<biome>&seed=<n>` (Endless map) and
  `/?infinite=wander&seed=<n>`.
- `InfiniteSession` (from `ExploreSession`): starts a run-like controller
  with `lives: Infinity`, no portals, rest gates every 5 km, distance score.
- `MapSelect` gets a fourth mode; the landing page an "Endless skies" card.
- Backend: `POST /api/profile/infinite` with distance and gates, checked like
  the adventure report (distance against the server's clock at the top
  speed, a cap per minute), and a best-distance board.

## Effort and order

1. Endless line and chunked land for one biome, no floating origin (fine to
   about 50 km): **about 3 days**. Playable as "Endless map".
2. Floating origin: **3 to 5 days** (it touches the most code; do it behind a
   flag and test with a forced rebase every 2 km).
3. Crossfading valley biomes with each other: **3 days**; island into valley
   with long windows: **1 to 2 days** more.
4. Session, map select, server report and boards: **2 days**.

## Risks

- Memory: shapes and flora per chunk must be dropped behind the pilot; the
  hidden-mesh cache is already bounded (48 MiB).
- `World.lost` (falling below the line) and the glide-in assume a level
  start; both need the chunk window.
- Long sessions: particle and trail buffers must survive origin shifts
  (shift their stored positions, or clear them at the shift under a short
  veil).
- The race map's frozen hashes (`__raceHashes()`) are unaffected: the mode
  never uses Sky Isles' generator.

## Re-running the trials

```bash
cd frontend
node --experimental-strip-types --import ./tests/register.mjs ../docs/prototypes/infinite/trial.mjs
```

Output on 2026-10-11 (Node 22.14):

```
A1 endless line = the game's line on its first 2 km (max error m) 0.0000
A2 height jump at chunk seams over 100 km (m)              6.27e-7
A3 height after 100 km with the game's always-down slope (m) -22076
A4 gate spacing over 100 km, min..max (m)                  95..130
B1 float32 spacing near 2,000 / 20,000 / 100,000 / 1,000,000 m: 0.0001 / 0.0020 / 0.0078 / 0.0625
C  (Verdant -> Glacier) gradient median / p99: verdant 0.56 / 11.84, glacier 0.59 / 13.22, blend 0.56 / 12.93; tube 11.1 m; contradictions 0
C' (Verdant -> Ember)   gradient median / p99: verdant 0.56 / 7.73, ember 0.56 / 15.28, blend 0.53 / 15.06; tube 11.1 m; contradictions 0
D  (Archipelago -> Verdant) gradient median / p99: archipelago 0.08 / 1.69, verdant 0.59 / 10.65, blend 0.40 / 6.38; tube 11.0 m; contradictions 0
E  land under the line across the crossfade (m below, every 50 m): 12 none 14 184 54 52 78 60 52
```
