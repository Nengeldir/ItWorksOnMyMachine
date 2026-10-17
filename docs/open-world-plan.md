# Open world plan: the Reaches, the Windspire and the Gathering

Status: **in progress**. Written 2026-10-15; F1–F4, F7, F9, F11 and F12 done
2026-10-15, R1 part 1 (region map, discovery, the map) 2026-10-17, decision D1 taken (Zen lives on the Explore page) (ticked
below, details in `CLAUDE.md`'s change log). Nothing else in the game changes
until a step is picked up. Each step below is meant to be **picked
up cold** by someone (or a Claude session) who has read only `CLAUDE.md`,
this file's [Ground rules](#0-ground-rules-read-before-any-step), and the
step itself.

The brief: turn Wind Rider into an open-world game in the spirit of Hypixel
Survival, **without losing what Wind Rider is** (a Genshin / Sky styled
flying game: floaty, gentle, luminous).

- **Adventure** keeps its roguelike run (eight levels, portals, upgrades,
  lives) and takes in **all the combat and dungeon play**: weapons, classes,
  enemies, bosses, dungeon floors, slayer-style hunts, dungeon loot and gear
  upgrades.
- **Explore** becomes **the Reaches**, a persistent open world with **all
  the casual play**: a home isle, farming, foraging, mining, fishing,
  enchanting, runecrafting, alchemy, taming, carpentry, collections,
  crafting, resource sprites (Survival's minions), hidden lights (its fairy
  souls).
- A **fourth mode, the Gathering**, is the social layer: a live shared hub
  town (Lanternhaven), emotes, holding hands, chat, friends, parties,
  trading, a bazaar and auction house, guilds ("flocks"), island visits and
  live events.
- **Racing** stays exactly as it is (rule 6: none of this reaches races).
- **Zen** stays as it is; see [decision D1](#decisions-to-take-before-starting).

Contents:

0. [Ground rules](#0-ground-rules-read-before-any-step)
1. [The vision, translated to flight](#1-the-vision-translated-to-flight)
2. [Architecture overview](#2-architecture-overview)
3. [Art, animation, VFX and sound bible](#3-art-animation-vfx-and-sound-bible)
4. [Performance budget](#4-performance-budget)
5. [Layout and small screens](#5-layout-and-small-screens)
6. [Phase F: foundations](#phase-f-foundations) (F1–F12)
7. [Phase R: the Reaches (Explore)](#phase-r-the-reaches-explore) (R1–R20)
8. [Phase A: Adventure combat and the Windspire](#phase-a-adventure-combat-and-the-windspire) (A1–A20)
9. [Phase G: the Gathering (social)](#phase-g-the-gathering-social) (G1–G16)
10. [Phase P: polish, balance and live operation](#phase-p-polish-balance-and-live-operation) (P1–P10)
11. [Testing playbook](#testing-playbook)
12. [Enhancement playbook](#enhancement-playbook)
13. [Decisions to take before starting](#decisions-to-take-before-starting)
14. [Survival feature map](#appendix-survival-feature-map)

---

## 0. Ground rules (read before any step)

These add to `CLAUDE.md`'s rules; they don't replace them.

1. **Races never change.** Nothing here touches `SoloSession`,
   `RoomSession`, race rooms, ghosts or leaderboards. `__raceHashes()` must
   return the same tree/dist/ring hashes after every step. Combat, stats,
   gear and gathering all reach the game through *mods* passed in by the
   session (`FlightMods` for flight, new `CombatMods` / `WorldMods` below),
   never through constants that races read.
2. **Zen stays as it is.** Steps may *reuse* `world/open.ts` (cell
   streaming), but `ZenSession` itself is not changed by this plan.
3. **The server owns value.** Anything that can be traded or that raises a
   number (items, coins, XP, loot rolls, skill levels) is decided or checked
   on the server. The client predicts and shows it at once, then reconciles.
   The rule exists because the Gathering makes items tradable: a duplicated
   item becomes everyone's problem.
4. **One catalog.** Every item, recipe, enemy, skill table and loot table
   lives in `shared/catalog/*.json` (F1), read by the frontend build *and*
   the backend. No numbers copied by hand between TypeScript and Python.
5. **Gentle, not violent.** Enemies are *Murk*: corrupted wind and shadow
   (Sky's dark creatures, Genshin's Abyss motifs). They are **purified**,
   not killed: they burst into light, and a small freed spirit floats away
   happy. No blood, no corpses, no gore sounds. The player is never killed:
   they run out of Light and glide down gently (the current crash = respawn).
6. **Every step ships whole.** A step isn't done until it has its model,
   animation, VFX, sound, UI at desktop and 844×390 (touch), its tuning knobs
   in `tuning.ts` (looks) or a mode-specific tuning group, its tests, its
   README/CLAUDE.md rows and a change log entry. No "looks later".
7. **Performance is a feature.** Each step names its budget (draw calls,
   triangles, particles, CPU ms) and how to measure it. A step that blows its
   budget at Quality 0 isn't done.
8. **Determinism where it matters.** Adventure combat runs inside
   `Game.step` at 120 Hz with seeded random streams (`makeRng(seed,
   "combat/<level>/<what>")`), so a run can be replayed and checked by the
   server. Gathering node layouts are seeded from the world seed and the cell,
   so the server can name every node without storing it.

## 1. The vision, translated to flight

Survival is a walking game with blocks; Wind Rider is a flying game with
painted land. Copying Survival's verbs one to one would feel wrong. Every
activity below is re-thought so that **flying is the best way to do it**,
with a short perch (landing) state for the stations that need it.

| Survival | Wind Rider | The flight-native verb |
| :--- | :--- | :--- |
| Private island | **Home Isle**, a floating island you shape | Glide in, perch, build; sprites work on it while you're away |
| Hub | **Lanternhaven**, a lantern town on terraced isles | Fly between lantern-lit terraces; shops, the loom, the market |
| Farming | **Sky gardens** | Sow by flying low over furrows; harvest by *skimming* rows (the swathe you fly through is gathered) |
| Foraging | **Canopy foraging** | Pluck fruit and feathers flying through canopies; perch on giant branches to fell with a rhythm chop |
| Mining | **Crystal veins and the Deeps** | Hover at a vein and *resonate* it (a hold-and-release charge); caves of the Deeps with commissions |
| Fishing | **Cloud and tide fishing** | Cast a line of light into the cloud sea or water; reel with a tension minigame driven by pitch |
| Enchanting | **The Star Loom** | Weave constellations into gear; experiments are constellation memory games |
| Runecrafting | **Wind runes** | Purely cosmetic trail/hit effects, fused at a rune pedestal (as in Survival) |
| Alchemy | **Tea brewing** | Brew teas at a kettle: timed buffs |
| Taming | **Companion bonds** | The twelve pets level up from skill XP; perks per level |
| Carpentry | **Hearthcraft** | Furniture and decor for the Home Isle |
| Minions | **Sprites** | Little wind sprites placed on the Home Isle gather while you're offline |
| Collections | **The Field Guide's collections** | Gathering N of a thing unlocks recipes and lore pages |
| Fairy souls | **Lost Lights** | 120 hidden lights; every 5 raise your Light |
| Combat skill, Slayer | **Purification, Tempest Hunts** | Purify Murk by flying through them (the core verb), darts, gale bursts |
| Catacombs | **The Windspire** | A roguelike dungeon tower inside the adventure: rooms, puzzles, secrets, a keeper boss per floor |
| Dungeon classes | **Five callings** | Gale, Warden, Lantern, Archer, Sage |
| Reforges, stars, gemstones | **Tempering, stars, crystal sockets** | Upgrades at the smith with stones, essence and gems |
| Accessories | **Charm string** | Charms on a string; Wind Rider already has a charm in runs |
| Bazaar, Auction House | **The Lantern Market's two halls** | Grows out of the existing Lantern Market |
| Guilds | **Flocks** | Named groups with a banner and a shared nest |
| Mayors and events | **The Wind Council and festivals** | A seasonal vote and festivals (kite day, lantern night) |
| Survival level | **Wind Rank** | The existing profile XP and level, fed by every activity |

What makes it Wind Rider, not a clone:

- **Momentum is the reward.** The best players gather while flying fast and
  low: harvest swathes, canopy plucks, skim fishing, purification dashes. A
  slow player can do everything by perching; a skilled one never lands.
- **Light, not damage numbers.** Health is *Light* (Sky's wing light), shown
  as a glow around the pilot and a soft ring, not a red bar. Damage numbers
  are small, golden and optional (`settings.damageNumbers`).
- **No grind walls without beauty.** Every grind loop has a view: harvest at
  golden hour, mine in glowing caves, fish at moonrise.

## 2. Architecture overview

### 2.1 Modes and sessions

```
Menu ── Racing ──── SoloSession / RoomSession           (unchanged)
     ├─ Adventure ─ RunSession ── RunController         (+ CombatController, Windspire)
     ├─ Explore ─── ReachesSession ── WorldController   (new; builds on open.ts cells)
     ├─ Gathering ─ GatheringSession ── ShardClient     (new; Lanternhaven + visits)
     └─ Zen ─────── ZenSession                           (unchanged)        
```

- `ReachesSession` and `GatheringSession` share a `WorldController`
  (`game/reaches/controller.ts`): it owns nodes, stations, interaction,
  perch, inventory prediction. The Gathering adds `ShardClient` for live
  players. So Explore is *the Reaches played alone*, and the Gathering is
  *Lanternhaven and the Reaches played together*.
- `ExploreSession` (the debug biome flyer) stays as a dev tool at
  `/?explore=<biome>`; the new mode's URL is `/?reaches` (decision D2).

### 2.2 New frontend areas (target layout)

| Path | What |
| :--- | :--- |
| `shared/catalog/` (repo root) | JSON: items, recipes, skills, loot, enemies, regions, quests (F1) |
| `game/stats.ts` | Pure stat math: base + gear + charms + buffs (F2); mirrored in `backend/stats.py` from the same tables |
| `game/inventory/` | Client inventory model, predictions, server reconciliation, stack rules (F3) |
| `game/perch.ts` | Landing, perched hop-walk, take-off, for the Reaches and Gathering only (F5) |
| `game/interact.ts` | Nearest-interactable query, prompts, hold-to-use (F6) |
| `game/reaches/` | The Reaches: `regions.ts`, `nodes.ts` (resource nodes), `stations.ts`, `controller.ts`, one file per skill (`farming.ts`, `foraging.ts`, …) |
| `game/reaches/models/` | Nodes, stations, NPCs, sprites, furniture models (built with `items/builder.ts`) |
| `game/combat/` | `combat.ts` (hits, Light, damage), `enemies.ts` (SoA simulation), `ai/` (behaviours), `weapons.ts`, `callings.ts`, `fx.ts`, `models.ts` |
| `game/windspire/` | Dungeon generation (`layout.ts`), rooms (`rooms/`), puzzles (`puzzles/`), keepers (bosses, `keepers/`), scoring |
| `game/social/` | `shard.ts` (client), `avatars.ts` (remote pilots with appearance and LOD), `emotes.ts`, `hands.ts`, `chat.ts` |
| `game/audio/` | Buses, voice pool, spatial pool, sample loader (F9) beside today's `audio.ts` |
| `components/world/` | Sheets: inventory, crafting, skills, collections, stations, market halls, party, chat, map |
| `components/ui/` | Responsive primitives: `Sheet`, `Grid`, `Slot`, `Tooltip` (bottom sheet on touch), `RadialMenu`, `HoldButton` (F7) |
| `session/ReachesSession.ts`, `GatheringSession.ts` | The two new sessions |

### 2.3 Backend (target layout)

| Path | What |
| :--- | :--- |
| `backend/catalog.py` | Loads `shared/catalog/*.json`, validates (pydantic) |
| `backend/inventory.py` | Items, stacks, gear instances (with uuid), idempotent mutations |
| `backend/skills.py` | Skill XP, levels, collections |
| `backend/world.py` | Node checks (seeded positions, respawn timers), harvest/mine/fish claims, Home Isle state, sprites' offline yield |
| `backend/combat_runs.py` | Adventure run verification and dungeon loot rolls |
| `backend/market.py` | Bazaar order book and auction house |
| `backend/social.py` | Friends, parties, flocks, chat moderation |
| `backend/shards.py` | Live shards over WebSocket (G1), replacing SSE for the Gathering only; race rooms keep SSE |

Storage stays SQLite (WAL mode) for the hackathon scale: one writer, many
readers. Every mutation is an **idempotent action** (`action_id` uuid from
the client, unique index) so the client's outbox (as today's pickup and
run-report outboxes) can retry safely.

### 2.4 How value flows (anti-duplication)

1. The client predicts (shows +3 Moonwheat at once) and queues an action:
   `{action_id, kind: "harvest", node: "verdant/12,-3/17", at: t, tool}`.
2. The server checks: the node exists (re-derive it from world seed + cell
   + index with the same generator, ported or precomputed, see R2), it's
   ripe (its last harvest time + respawn), the player could have been there
   (last reported position within reach, rate limits per skill), the tool's
   fortune. It rolls the yield itself with its own seed, writes it, returns
   the real result.
3. The client reconciles: replaces its prediction with the truth (usually
   identical; if not, the counter quietly animates to the server's number).

Combat runs are verified differently (A19): the server gets the run's inputs
summary and seeds, re-checks plausibility (time, purifications per minute,
damage dealt against the best possible), then rolls the dungeon chests.

### 2.5 Data shapes (shared catalog)

```jsonc
// shared/catalog/items.json (one entry)
{
  "id": "moonwheat",
  "name": "Moonwheat",
  "kind": "material",            // material | tool | weapon | mantle | charm | rune | tea | seed | furniture | book | gem | stone | essence
  "rarity": "common",            // the existing rarity palette (collection/rarity.ts)
  "stack": 512,
  "model": "crop/moonwheat",     // a builder in game/reaches/models
  "icon": "auto",                // icons rendered from the model at build time (F8)
  "sell": 2,                     // coins to an NPC
  "region": "verdant",
  "lore": "Silver ears that open at moonrise."
}
// gear adds: "slot", "stats": {"might": 30, "crit": 5}, "ability": "gale_lunge", "requires": {"combat": 5}
// tools add: "skill": "farming", "fortune": 20, "speed": 1.2, "breaks": ["crop"]
```

Recipes, loot tables and skill curves have their own files; F1 defines them.

## 3. Art, animation, VFX and sound bible

Everything new answers "would this fit in Genshin or in Sky?". This section
is the checklist every step's "Looks" part is reviewed against.

### 3.1 Models

- **Built in code** with `items/builder.ts` (as every item and cosmetic
  today), shaded with `toonMaterial` (three light bands, rim, ink outline).
  No imported photo-textured assets. Small, chunky, rounded silhouettes;
  bevel every edge (the builder's rounded boxes and lathes).
- **Palette:** warm saturated base, gold trims on anything precious, a pale
  emissive accent on anything magical (colors above `FX.bloomThreshold` only
  where the eye should go). Per-biome tints come from the palette
  (`TOON_LIGHT`, `ATMOSPHERE`), never hard-coded.
- **Rarity reads at a glance:** common plain; uncommon a green-gold rim;
  rare a soft blue inner glow; epic a violet shimmer; legendary gold
  filigree and a slow orbiting mote; mythic a prism edge (reuse
  `collection/rarity.ts` and `CollectionFx`).
- **Triangle targets:** resource node 150–600 tris (LOD1 at half, impostor
  beyond 140 m like trees); NPC 2–4k; enemy 800–2.5k; boss 8–15k; station
  1.5–5k; furniture 100–800.
- **Every model ships with:** an idle motion (bob, sway, breathe), a reaction
  (touched, hit, harvested), its icon (F8) and a gallery entry (`/?gallery`
  gets tabs: items, nodes, enemies, NPCs, furniture).

### 3.2 Animation

- The pilot is the star: new actions get **anticipation, action,
  follow-through** like the wingbeats. Chop: lean back, swing with a
  wind-swirl, wood chips pop, the pilot bounces on its toes. Cast: a
  two-handed whip, the line arcs with a light trail, the bobber lands with a
  ripple ring. Resonate (mining): hands forward, a humming shake that builds
  with the charge, a recoil on release.
- **Procedural over baked.** Today's avatar is animated in code (springs,
  `Avatar.stance`, `armPose`). New actions are new stances with springs, not
  baked clips. Enemies animate in the vertex shader (per-instance phase,
  flap, squash) so a crowd costs one draw call per kind.
- **Perch locomotion** is a chibi hop-walk with folded wings, the cape
  lagging; turning is a little pivot with a foot scuff puff. Take-off: crouch,
  a wing snap, a burst of feathers and a gust ring on the ground.
- **Reactions are cute.** NPCs wave, lean in when you approach, bounce when
  you sell to them. Sprites cheer when they fill up. Purified Murk become a
  tiny round spirit that spins once and floats up with a chime.

### 3.3 VFX

- **One particle system** (`particles.ts`), one draw call per family, budget
  respected (`particles.budget`, Quality 0 = 40%). New families go in
  `Kind`; never a new `Points` per effect.
- **Effects language:** wind is cyan-white ribbons and swirls; growth is
  green-gold motes rising; minerals are prismatic sparks and a crystal ring;
  water is ripple rings and spray beads; starlight (enchanting) is a gold
  constellation line drawn point to point; Murk is ink-violet smoke with a
  dark core that inverts into white light when purified.
- **Rings and decals** reuse `RingQuads` and a new pooled *ground decal*
  (one instanced quad family: ripples, scorch-free "glow marks", gust rings).
- **Shaders:** new ones follow "Shader safety" (no `pow` of negatives, no
  divide by zero). Water, crops swaying, ore glints and enemy dissolve are
  done in vertex/fragment shaders with shared `fxTime`/`sceneryTime`.
- **Bloom only where it matters:** loot beams, rare drops, purifications,
  the Star Loom, boss tells. Ambient things stay below the threshold.

### 3.4 Sound

- Today's sounds are synthesized (`audio.ts`) plus the wingbeat sample. The
  open world needs more variety: add a **small sample library** (F9) of
  short OGG/Opus one-shots (≤ 1.5 MB total for gathering, ≤ 1.5 MB combat),
  layered with the synth for pitch/variation, so nothing repeats exactly.
- **Families:** pluck (wood/leaf/fruit), chime (crystal, starlight), water
  (cast, plop, reel click, splash), soft impacts (purify thump, shield
  bloom), UI (glass taps, coin trickle, level-up harp), ambience beds per
  region (wind, birds, water, cave hum), NPC voice "babble" (Animal
  Crossing-style syllables pitched per NPC).
- **Rules:** random pitch ±4% and volume ±2 dB on every one-shot, a voice
  limit per family (F9), ducking music −4 dB on level-ups and boss tells,
  spatial sound for anything in the world (pooled panners).
- **Music:** each region gets its biome's track (`music.ts` crossfade
  exists); Lanternhaven a gentle town theme with a night variant; combat
  layers a percussion stem over the biome track (stems crossfaded by
  combat intensity), never a hard switch; bosses get their own track.

## 4. Performance budget

Target: **60 fps at High on an integrated laptop GPU**, and **30 fps at
Quality 0 on a 2018 phone / 4 GB Chromebook**. Measured in a focused window
with `__bench(q)` (automation tabs are throttled).

| Budget per frame | Quality 2 | Quality 1 | Quality 0 |
| :--- | :--- | :--- | :--- |
| Draw calls (whole frame) | ≤ 320 | ≤ 260 | ≤ 180 |
| Triangles | ≤ 1.6 M | ≤ 1 M | ≤ 500 k |
| Particles alive | 100% budget | 70% | 40% |
| Resource nodes drawn | 3 000 (instanced) | 2 000 | 900 |
| Enemies active | 64 | 48 | 24 |
| Remote pilots full detail | 12 | 8 | 4 (rest are impostor sprites) |
| CPU, game logic (`step` + world) | ≤ 3 ms | ≤ 3 ms | ≤ 4 ms |
| UI (React) per frame while flying | 0 renders (HUD via store diff at ≤ 10 Hz) | same | same |
| JS heap growth over 10 min | 0 (no per-frame allocations) | same | same |
| Download (first load, gzip) | +1.5 MB over today, rest lazy | same | same |

How the budget is kept:

- **Instancing everything that repeats:** nodes, crops, crystals, fish
  shadows, enemies, sprites, lanterns, furniture in towns. One
  `InstancedMesh` per *kind × LOD*, shared materials.
- **Code-splitting:** Explore, Adventure combat, the Windspire and the
  Gathering are lazy chunks (`import()` in the session); races never load
  them.
- **Spatial hashing** for nodes, enemies, interactables, remote pilots
  (a shared `SpatialHash` in `game/math.ts`), queries without allocation.
- **Sim rates:** physics 120 Hz (unchanged); combat hits in `step`; enemy
  AI decisions 30 Hz with interpolation; far nodes' growth evaluated lazily
  (time-based, no ticking); remote pilots at 15 Hz, interpolated.
- **Workers:** cell generation (as today), node placement per cell, dungeon
  layout generation run in the existing mesher worker pool.
- **Quality knobs per feature:** every step adds its entries to `QUALITY`
  in `Game.ts` (counts, distances, shader variants) and `adaptQuality`
  keeps stepping down only.
- **Memory:** cells release nodes and decals when unloaded; textures are
  tiny gradient ramps (toon) and one shared noise atlas.

## 5. Layout and small screens

- **Four breakpoints** by the *game container* (container queries, not the
  window): `wide` ≥ 1100 px, `medium` 760–1100, `compact` < 760 wide,
  `short` < 480 tall (phones in landscape). `html.touch` stays the touch
  switch.
- **HUD zones**, fixed and named (CSS grid areas in a new
  `components/WorldLayout.css`, like `RunLayout.css`): top-left status
  (Light, region, skill toast), top-centre objective/score, top-right
  buttons, left thumb (touch stick), right thumb (action cluster), bottom
  centre hotbar, centre prompts. A feature *asks for a zone*; it never
  positions itself.
- **Hotbar:** 6 slots on wide, 4 + a "more" radial on compact, a radial menu
  only on touch-short. Tools switch automatically by context (looking at a
  vein selects the pick) with a setting to turn that off.
- **Sheets** (inventory, crafting, market…) are full-height side sheets on
  wide, centred glass panels on medium, bottom sheets with drag handles on
  compact/short; one scroll per sheet; slots ≥ 44 px on touch; tooltips
  become a bottom-sheet card on touch (long-press opens, release keeps it).
- **Text:** never below 12 px CSS; numbers abbreviated (1.2k, 3.4M); every
  label in one strings table (`components/strings.ts`) so translation is
  possible later.
- **Safe areas:** `env(safe-area-inset-*)` on every edge zone (notches).
- **Reduced motion:** sheets fade instead of sliding; screen shake off;
  particles halved; MenuMotes off (already).
- Checked at 1280×720, 1024×768, 844×390, 667×375, 390×760 with
  `html.touch` forced, plus a real phone where possible.

---

## How to read a step

Every step has the same parts:

- **Goal**: one paragraph of what the player gets.
- **Needs**: steps that must be done first. **Size**: rough days for one
  person who knows the code.
- **Read first**: files to open before starting.
- **Build**: what to make, file by file.
- **Looks and sound**: the quality bar (see §3).
- **Budget**: the performance limits (see §4).
- **Tests**: automated checks (`frontend/tests/*.test.mjs`, `backend/tests`).
- **Check by hand**: what to look at in the browser.
- **Done when**: the acceptance list. Then write the change log entry and
  move the step to done in this file (tick it: `F1 ✅ 2026-xx-xx`).

---

## Phase F: foundations

Nothing in phase F is visible as a feature on its own, but everything else
stands on it. Do F1–F4 in order; F5–F12 can run in parallel after F3.

### F1. The shared catalog ✅ 2026-10-15

**Goal:** one source of truth for every item, recipe, skill curve, loot
table, enemy and region, read by the frontend and the backend.
**Needs:** nothing. **Size:** 2 days.

**Read first:** `backend/profiles.py` (`entry`, the catalog of 99 entries,
`reward_plan`), `frontend/src/game/run/items.ts`, `collection/rarity.ts`.

**Build:**
- `shared/catalog/` at the repo root with `items.json`, `recipes.json`,
  `skills.json` (XP curves, per-level perks), `loot.json` (weighted tables
  with `rolls`, `guaranteed`, `rare` with pity), `enemies.json`,
  `regions.json`, `npcs.json`, `quests.json`. Start with the schema and 5–10
  real entries each; later steps add their own.
- `shared/catalog/schema/*.json` (JSON Schema) and a validator script
  `shared/catalog/check.mjs` (ids unique, references resolve, every item has
  a model id and a rarity, loot weights > 0, recipes don't loop).
- Frontend: `src/catalog.ts` imports the JSON (Vite handles JSON imports;
  tree-shaken per mode by splitting files per area if size grows) with
  TypeScript types generated by `shared/catalog/types.mjs` into
  `src/catalog.gen.ts` (run in `npm run build` and `npm test` pre-steps).
- Backend: `backend/catalog.py` loads and validates with pydantic at
  startup; the Dockerfile copies `shared/` (update `docker-compose.yml`
  build contexts so both images see it).
- Existing cosmetics stay in `profiles.py` for now; move them into the
  catalog in P-phase cleanup, not here (no behaviour change in F1).

**Tests:** `check.mjs` runs in `npm test`; a pytest loads the catalog and
checks the same invariants; a test that the generated types are fresh.

**Done when:** both sides load the same file; a bad reference fails both
test suites with a readable message; README "Project layout" lists `shared/`.

### F2. Stats ✅ 2026-10-15

**Goal:** a single, pure stat system for gear, charms, teas, pets and
callings, used by combat (Adventure) and gathering (Reaches).
**Needs:** F1. **Size:** 2 days.

**Build:**
- `game/stats.ts`: `type Stats = { light, ward, might, crit, critPower,
  haste, focus, swiftness, harvestFortune, timberFortune, oreFortune,
  angling, luck, wisdom }` (wisdom = skill XP bonus). `computeStats(base,
  sources[]) → Stats` with additive then multiplicative layers, in a fixed
  order, documented in the file header. No allocation in the hot path
  (`computeStatsInto(out, …)`).
- `backend/stats.py`: the same, reading the same `skills.json` /
  `items.json` numbers. A shared test vector file
  `shared/catalog/tests/stats-vectors.json` (inputs → expected outputs)
  both test suites run, so the two implementations can't drift.
- **Where stats may act** (rule 6): Adventure reads combat stats through
  `CombatMods`; `swiftness` may raise *combat* attack speed and, **only in
  runs**, feed `FlightMods` (capped, e.g. +8% top speed). The Reaches read
  gathering stats. Races read nothing.
- A **stat sheet** component (`components/world/StatSheet.tsx`) with icons
  (`kindIcons.tsx` style), used later by the journal and tooltips.

**Tests:** vectors pass in both languages; caps hold; a property test
(random sources) that order of sources doesn't change the result.

**Done when:** `computeStats` is used by nothing yet but is complete,
documented and tested on both sides.

### F3. Persistent inventory and the action log (server) ✅ 2026-10-15

**Goal:** a real inventory on the profile server: stacks, gear instances,
storage, idempotent actions.
**Needs:** F1. **Size:** 4 days.

**Read first:** `backend/profiles.py` (tables, `Profiles` class, balances),
`frontend/src/profile/client.ts` (outboxes).

**Build:**
- Tables: `inventory(user_id, item_id, count)` for stackables;
  `gear(uuid, user_id, item_id, data JSON, location)` for unique items
  (stars, tempering, enchants, gems, runes); `storage_slots`; `actions
  (action_id PRIMARY KEY, user_id, kind, at, result JSON)` for idempotency;
  `skills(user_id, skill, xp)`; `collections(user_id, item_id, total)`.
- `backend/inventory.py`: `apply(user, action)` in one transaction:
  validate → mutate → record the action and its result → return the result.
  Replaying an `action_id` returns the stored result and changes nothing.
- Endpoints: `GET /api/inv` (everything, with a `rev` counter), `POST
  /api/inv/actions` (a batch of up to 50 actions; results in order).
  Moves (bag ↔ storage ↔ equip), sell to NPC, craft (F10 fills recipes),
  discard. Every later step adds action kinds here.
- Limits: bag 36 slots (grows with Wind Rank), storage chests on the Home
  Isle, per-skill rate limits (actions per minute) to stop scripted floods.
- Frontend `game/inventory/`: `Inventory` model with `predict(action)` and
  `reconcile(results, rev)`, an outbox persisted in localStorage (as the
  pickup outbox) and flushed every 2 s or on sheet close.
- The adventure economy (crystals, orbs, coins) keeps working: coins move
  into `inventory` as item `coin` behind the same balance API, migrated
  once (`meta` key `inventory_v1`).

**Tests (pytest):** idempotency (same action twice = once), concurrency (two
batches at once never go negative), migration from today's profiles, rate
limits, a fuzz test of random action sequences keeping invariants (no
negative counts, total items conserved by moves).
**Tests (node):** prediction then reconciliation converges; outbox survives
reload.

**Done when:** an item can be granted (dev endpoint, test only), moved,
sold and the totals match after a reload and a replayed outbox.

### F4. Wind Rank and skill XP ✅ 2026-10-15

**Goal:** every activity feeds skill XP and the profile level (renamed in
the UI "Wind Rank"), with level-up moments that feel great.
**Needs:** F3. **Size:** 2 days.

**Build:**
- Skills: `farming, foraging, mining, fishing, enchanting, alchemy,
  taming, carpentry, runecrafting, purification` (combat) and `windspire`
  (dungeons). Curves in `skills.json` (level 1–50; runecrafting 25).
- Each skill level gives a small stat (farming +2 harvest fortune…) and,
  every 5 levels, an unlock (a recipe, a region, a tool tier).
- Server: XP is granted only as part of an action's result (harvest gives
  XP); `wisdom` adds percent. Wind Rank XP = a fraction of all skill XP plus
  collections and Lost Lights; the existing `level_progress` stays.
- UI: a **skill toast** top-left (icon, `+12 Farming`, a thin arc filling);
  on level-up a **level-up card**: a ring of light expands from the pilot,
  the skill's emblem draws itself in gold strokes, a harp arpeggio,
  unlocks listed; dismisses itself after 3 s or on tap; never blocks
  flight.
- Journal: a Skills page (`components/world/SkillsView.tsx`): ten emblems
  in a constellation layout, each with its level ring; tap opens the
  rewards ladder.

**Looks and sound:** each skill has an emblem drawn as an SVG constellation
(nodes and lines, like the landing page's emblems) and a colour.

**Tests:** XP curves monotonic; server and client levels agree from the
same XP; wisdom applied once.

**Done when:** a dev grant of XP shows the toast, the level-up card and the
updated Skills page, at desktop and 844×390.

### F5. Perch: landing, walking and take-off

**Goal:** in the Reaches and the Gathering, the pilot can land gently on
walkable ground, hop-walk a few metres, use stations and take off.
**Needs:** nothing (F6 uses it). **Size:** 4 days.

**Read first:** `flight.ts` (`touching`, `hitboxWorld`, `FlightMods`),
`landCollider.ts`, `avatar.ts` (`stance`), `camera.ts`, Zen's crash
handling in `Game.ts`.

**Build:**
- `game/perch.ts`: a state machine `flying → landing → perched →
  takingOff → flying`. Landing happens when the hitbox touches land with
  speed < `PERCH.landSpeed` (8 m/s) and the surface normal's up > 0.7;
  faster or steeper is today's crash (Reaches: gentle Zen-like respawn).
- Perched movement: capsule-free *ground follow*: position snaps to
  `LandCollider` height under the feet each step (raycast down), speed 3.2
  m/s, a slope limit; no physics bodies. Jump = take off (an upward impulse
  into `Flight` with the nose raised, wings snap open).
- Plumbed through `WorldMods.perch: true` from the session; `Game.step`
  calls `perch.step` *instead of* flight when perched. Races never pass it,
  so their step is byte-identical (check `__raceHashes()` and a ghost
  replay).
- Camera: a closer, lower `CAMERA.perch` rig with a gentle orbit (mouse
  drag / right stick / two-finger drag on touch).
- Avatar: a `perched` stance: folded wings, cape settling, hop-walk cycle
  driven by ground speed, idle fidgets (looks around, adjusts scarf), a
  landing squash with a dust-and-feather puff, take-off crouch and wing
  snap.
- Input: on touch the boost button becomes **Jump/Fly** when perched;
  keyboard Space; gamepad A.

**Looks and sound:** soft footfalls (grass, stone, wood, snow by surface
material id from the terrain shader's material), a wing-fold rustle, a
take-off whoosh with a gust ring decal.

**Budget:** perch step < 0.1 ms; no new draw calls except the decal family.

**Tests:** a race step replay is unchanged (hash a 30 s scripted input with
and without the perch module loaded); landing thresholds; never perched on
water or steep rock.

**Check by hand:** land on a Verdant meadow in `/?explore=verdant`, walk,
jump, crash into a cliff at speed (still a crash), on touch at 844×390.

**Done when:** landing feels soft and intentional, walking is cute, take-off
is instant, races unchanged.

### F6. Interaction

**Goal:** one consistent way to use anything: a prompt, a key/tap, a hold.
**Needs:** F5 (for stations; nodes work in flight). **Size:** 2 days.

**Build:**
- `game/interact.ts`: interactables register `{ id, position, radius,
  verb, hold?: seconds, flight?: boolean, perched?: boolean, priority }` in
  a `SpatialHash`; each step picks the best one in front of the pilot
  (angle and distance score); none allocated per frame.
- Prompt: a small glass pill in the centre-low zone with the verb and the
  key glyph (`components/keys.ts`), a hold ring that fills; on touch the
  right-thumb **Use** button glows and shows the verb.
- In-flight interactables (fruit, nodes along a swathe) don't need a press:
  `auto: true` collects on contact, and the prompt never shows.
- Multiple close choices → a radial (`RadialMenu`, F7).

**Tests:** scoring picks the facing object; registry add/remove in cells.

**Done when:** a test station in `/?reaches` (or Explore for now) can be
used by keyboard, mouse, gamepad and touch.

### F7. UI primitives ✅ 2026-10-15

**Goal:** the responsive building blocks every sheet uses.
**Needs:** nothing. **Size:** 4 days.

**Build** in `components/ui/`:
- `Sheet` (side/centre/bottom by container size, drag handle, one scroll,
  Escape/Back closes, focus trap, `inert` behind it);
- `Grid` + `Slot` (item icon, count, rarity frame, cooldown sweep,
  drag-and-drop with pointer events; touch: long-press to pick up, tap to
  inspect; keyboard: arrows and Enter);
- `Tooltip` (desktop hover card with stats and lore; touch bottom card);
- `RadialMenu` (stick, mouse or thumb; 4–8 wedges);
- `HoldButton`, `Tabs`, `Counter` (animated number), `Toast` queue.
- Styles from the existing glass language (soft panels, rounded, gentle
  motion), CSS variables from `theme.ts` (`--ink`, `--tint`, `data-sky`).
- A `/?ui` dev page showing every primitive at each breakpoint
  (screenshots per breakpoint in `docs/screenshots/ui/`).

**Tests:** node tests for the grid's keyboard model and drag logic (pure
functions), lint for a11y (labels, roles).

**Done when:** every primitive works with mouse, touch, keyboard and gamepad
(gamepad: focus moves with the D-pad, A selects, B backs).

**As built (2026-10-15):** all in `components/ui/` (pure logic in `nav.ts`, `dnd.ts`,
`toastQueue.ts`, `motion.ts`, tested in `tests/ui.test.mjs`); gamepad navigation is a stack of layers
(`gamepad.ts`: D-pad/stick move the focus, A presses, B backs, LB/RB turn tabs). Item icons fall back to
the item kind's sign (`components/world/itemIcons.tsx`) until F8. The `/?ui` page draws itself again in
an iframe at each breakpoint; the screenshots in `docs/screenshots/ui/` were not saved (the browser
tool can't write files there): the page itself is the reference.

### F8. Item icons from models

**Goal:** every item's icon is a render of its 3D model, consistent and
crisp, without hand-drawing hundreds of icons.
**Needs:** F1. **Size:** 2 days.

**Build:** a build-time script (`frontend/scripts/icons.mjs`) that runs a
headless WebGL page (Playwright or Puppeteer, dev dependency) rendering each
catalog model with the toon material, a three-quarter view, rim light and
ink outline, into a 128 px atlas (`public/icons/atlas-<n>.webp` +
`atlas.json`). `Slot` shows the atlas cell. Missing icons fall back to a
rarity-coloured silhouette. Re-run only when models change (hash cache).

**Check by hand:** the atlas page at `/?ui`; icons read at 44 px.

**Done when:** `npm run icons` updates the atlas; CI doesn't need a GPU
(atlas committed).

### F9. Audio buses, voice pool and samples ✅ 2026-10-15

**Goal:** many more sounds without clutter or cost.
**Needs:** nothing. **Size:** 3 days.

**Build** in `game/audio/`:
- Buses: `music`, `ambience`, `world`, `combat`, `ui`, `voice`, each with
  gain and a settings slider; the existing `audio.ts` routes into `world`.
- `VoicePool`: max voices per family (e.g. pluck 6, chime 8, combat 12),
  oldest/quietest stolen; random pitch/volume per play.
- `SpatialPool`: 16 pooled `PannerNode`s (HRTF at Quality 2, equal-power
  below), distance culling at 80 m.
- `SampleBank`: lazy-loads per mode (`gathering.ogg`, `combat.ogg` sprite
  sheets with JSON offsets), decoded once; synth fallback when not yet
  loaded.
- Ambience beds per region (looped, crossfaded by region weight), and a
  `duck(bus, dB, seconds)` helper.

**Budget:** ≤ 24 active voices at once; ≤ 3 MB decoded audio per mode.

**Done when:** a dev page plays every family through the pool; settings
sliders work; no clicks at loop points.

**As built (2026-10-15):** `game/audio/`: `buses.ts` (in every game: the existing effects and music
feed `world` and `music`), and an engine loaded on demand (`GameAudio.loadEngine()`, so races don't
carry it): `pool.ts` (limits per family, 24 voices, weakest stolen, quieter newcomers dropped),
`families.ts` (synthesized recipes for every family), `spatial.ts` (16 panners, HRTF at Quality 2,
culled at 80 m), `samples.ts` (sheet format and loader; **no sample sheets ship yet**, the recipes
play), `ambience.ts` (five synthesized beds mixed by region weight, click-free loops, ~1.4 MB
decoded). The mixer's four new sliders sit folded under Sound in the settings. The dev page is the
sound half of `/?ui`.

### F10. Crafting and recipes

**Goal:** a recipe book and crafting at stations (the workbench, the loom,
the kettle, the smith, the rune pedestal all reuse this).
**Needs:** F3, F7. **Size:** 3 days.

**Build:** `recipes.json` (`station`, `inputs`, `output`, `time`,
`unlock`); server action `craft` (checks unlock, inputs, takes, gives);
`components/world/CraftSheet.tsx` (recipe list filtered by station, search,
"can make n", queue for timed crafts which finish while away). Craft
animation: the station's own (each station step defines it), the item flies
into the bag icon with a rarity-coloured trail.

**Done when:** a workbench recipe crafts end-to-end, idempotent, and timed
crafts complete offline.

### F11. Lazy chunks and the performance harness ✅ 2026-10-15

**Goal:** new modes never slow races or first load, and every step can
measure itself.
**Needs:** nothing. **Size:** 2 days.

**Build:**
- Vite manual chunks: `reaches`, `combat`, `windspire`, `social`; loaded
  with `import()` from the sessions; a bundle-size check in `npm test`
  (the race entry chunk mustn't grow by more than 2 kB per step).
- `__bench` gains scenes: `__bench(q, "reaches-farm")`, `"windspire-room"`,
  `"gathering-30"` (30 fake remote pilots), printing draw calls, triangles,
  particles, step ms, frame ms p50/p95, heap delta.
- A **perf overlay** `?perf` (draw calls, tris, particles, enemies, nodes,
  voices, net kB/s) in a small corner panel.

**Done when:** the bench scenes exist (empty at first) and the bundle check
runs in CI.

**As built (2026-10-15):** chunk groups `reaches`, `combat`, `windspire`, `social` in
`vite.config.ts` (`codeSplitting.groups`; they match nothing until those folders exist).
`scripts/bundle-check.mjs` runs at the end of `npm run build` and in `tests/bundle.test.mjs` (skipped
without a build): the entry and its static imports, gzipped, against `frontend/bundle-budget.json`
plus 2 kB; `npm run bundle:accept` moves the baseline on purpose. There is no CI config in the repo:
the Docker build runs `npm run build`, so it fails there too. `?perf` is `game/perf.ts` (loaded only
with the flag) and `components/PerfOverlay.tsx`; systems report counts with `perf.count(name, n)`.

### F12. The new landing page and mode pages ✅ 2026-10-15

**Goal:** the menu shows four modes: Racing, Adventure, Explore, Gathering
(and Zen, see D1).
**Needs:** nothing (pages can say "coming soon" until each phase lands).
**Size:** 2 days.

**Read first:** `components/Menu.tsx`, `Menu.css`, `MenuMotes.tsx`, the
2026-10-13/14 change log entry.

**Build:** four emblems (Explore: a leaf-and-compass constellation;
Gathering: a ring of linked lanterns), each with its page
(`view === "explore" | "gathering"`), keeping the breathing halo, motes and
the quarter turn on hover. Zen's emblem stays where the team decides (D1).
At 390×760 the emblems become a 2×2 grid; at 844×390 a row of four, smaller.

**Done when:** the four (or five) emblems look balanced on light and dark
maps and on phones.

**As built (2026-10-15):** D1 taken: four emblems (Racing, Adventure, Explore, Gathering); Zen is
"Zen flight" on the Explore page beside the Reaches (marked coming soon); the Gathering's page lists
what's coming. Explore's sign is a leaf over a compass rose, the Gathering's a ring of five lanterns.

---

## Phase R: the Reaches (Explore)

The Reaches are one fixed world (world seed `WORLD_SEED`, the same for
everyone, so the Gathering can share it): **Lanternhaven** in the middle,
the player's **Home Isle** reached through a personal wind gate, and a ring
of **regions**, one per biome, each with its own skill focus.

| Region (biome) | Main skills | Signature place |
| :--- | :--- | :--- |
| Meadow Rise (Verdant Highlands) | Farming, foraging (orchards) | The Windmill Terraces, the Barn Fair |
| Lantern Wood (Twilight Forest) | Foraging, alchemy | The Elder Canopy (giant trees to perch in), glowcap groves |
| Frostspine (Glacier Peaks) | Mining | The Ice Galleries, entrance to the Deeps |
| The Hollow Deeps (under Glacier/Ember) | Mining (commissions), gems | Crystal caverns, the Forgekeepers' hall |
| Cinder Steps (Ember Wastes) | Mining, alchemy (fire herbs) | Lava-lit obsidian terraces, the Smith |
| Shellshore (Coral Lagoon) | Fishing | The Pier, tide pools, the Lighthouse |
| The Drowned Garden (Sunken Reef) | Fishing (deep), runecrafting | Glowing reef arches, the Rune Pedestal |
| Cloudsea Isles (Sky Archipelago) | Sky fishing, foraging (feathers) | Cloud sea docks, sky-whale migrations |
| Starfall Summit (Aurora Summit) | Enchanting | The Observatory and the Star Loom |
| Old Isles (Sky Isles) | Lost Lights, lore | See D3: Sky Isles' race generator is frozen |

### R1. The world map and regions

**Goal:** one seamless world: regions around a hub, borders that blend.
**Needs:** F11. **Size:** 6 days.

**Read first:** `world/open.ts`, `ZenSession.ts`, `biomes/index.ts`
(`zenLevel`), `world/terrain/` (`TerrainField`, `LandStreamer`),
`docs/infinite-mode-prototype.md` (biome crossfading, floating origin).

**Build:**
- `game/reaches/regions.ts`: a region map on a coarse grid (one sample per
  cell, `CELL` = 1024 m): a Voronoi of hand-placed region centres in
  `regions.json` (positions, biome, radius) with noise-warped borders; a
  `regionWeights(x, z)` returning the two nearest regions and a blend.
- A `reachesLevel()` like `zenLevel` but with a *field of biomes*: terrain
  recipes evaluated per region and blended across a 300 m border band
  (heights by weighted blend, materials by dithered choice, palette and
  atmosphere lerped by the camera's weights). Builds on Zen's cell
  streaming (`world/open.ts`).
- **Floating origin:** recentre the world every 2 km (the Reaches are ~12 km
  across); everything with world positions takes an `origin` offset.
- Lanternhaven and the Home Isle gate are *hand-authored set pieces*
  (R3, R4) placed on flattened land masks so the generator leaves room.
- The map: `components/world/MapSheet.tsx`, a painted-style map rendered
  once per session from the region map (a 512 px canvas: watercolour
  region fills, ink coastlines from the height field, icons for discovered
  places), fog over undiscovered cells, the pilot's arrow, waypoints.
  Discovering a region plays a title card (the existing level title style).

**Looks and sound:** the ambience bed and music crossfade by region weight;
the sky and haze lerp smoothly (no pop at borders).

**Budget:** cell generation stays in workers; a border cell costs at most
1.5× a normal cell; draw calls as Zen's.

**Tests:** `__worldHashes()` (new, in `docs/dev-snippets.js`) for 9 sample
cells (stable world); `regionWeights` sums to 1; floating origin keeps
`LandCollider` hits identical to 1 mm.

**Check by hand:** fly from Meadow Rise into Lantern Wood at dusk; no
visible seams, no hitch at recentring (focused window).

**Done when:** `/?reaches` flies the whole ring with smooth borders and the
map fills as you discover it.

**As built, part 1 (2026-10-17):** the region map, the map and discovery; the world itself is still to do.
- `regions.json` gained `seed` (the world seed, 1015) and `borders` (`band` 300, `hubBand` 200, `warp` 280,
  `warpScale` 1100), with the schema and `backend/catalog.py`.
- `game/reaches/regions.ts`: `regionWeights(x, z)` returns up to **three** places (two regions near their
  border, plus Lanternhaven or the open sky past `worldRadius` taking a smooth share on top), most first, weights
  summing to 1, and the distance to the nearest line where places meet; `regionAt`, `warp`. A Voronoi of the
  surface regions' centres (the Hollow Deeps are `deep`, never on the surface map) warped by seeded value noise.
  Only + − × ÷, floor, sqrt and a 32-bit integer hash, so `backend/regions.py` (`RegionMap`) matches it bit for
  bit: both run `shared/catalog/tests/region-vectors.json` (regenerate with `make-region-vectors.mjs` when the map
  changes on purpose). Three regions can meet at a point; only the two nearest blend (a corner's third gets 0).
- `reaches/discovery.ts` (`Discovery`: a place is found where it owns ≥ 70% of the land; localStorage
  `windrider.reaches.discovered.v1` until R20 moves it to the profile), `reaches/mapPaint.ts` (the watercolour:
  washes per biome blended as the land is, paper grain, ink borders, cloud over unfound places),
  `components/world/MapSheet.tsx` (the map in a `Sheet`, labels, waypoints, the pilot's arrow) and `RegionTitle`
  (the run's title card). `/?ui` shows them (a pilot circling, places found one by one) until the Reaches fly.
- **Still to do for R1:** `reachesLevel()` and the field of biomes (each region's terrain recipe evaluated and
  blended over the band: heights by weight, materials dithered, palette/atmosphere/music lerped by the camera's
  weights; the mesher workers need a key for it), the floating origin (recentre every 2 km), the flattened masks
  for Lanternhaven and the Home Isle gate, ink coastlines from the height field on the map, `/?reaches` (a session
  on Zen's cell streaming, never changing `ZenSession`), `__worldHashes()`, the ambience/music crossfade by region,
  and the by-hand check (Meadow Rise into Lantern Wood at dusk, no seams, no hitch at recentring).

### R2. Resource nodes (the shared system)

**Goal:** every gatherable thing (crops, fruit, trees, crystal veins, fish
schools, feathers, herbs) is a *node* with one system for placement,
drawing, interaction, respawn and server checks.
**Needs:** R1, F3, F6. **Size:** 5 days.

**Build:**
- `game/reaches/nodes.ts`: node kinds from `items.json`/`nodes.json`
  (`kind`, `model`, `region`, `density`, `respawn`, `skill`, `tier`,
  `yield` loot table, `interaction: "contact" | "hold" | "minigame"`).
  Placement per cell with `makeRng(WORLD_SEED, "nodes/<cx>,<cz>")`, using
  the terrain field (slope, height, moisture, near water) and clearance
  (`itemClearance.ts`); node id = `"<kind>/<cx>,<cz>/<index>"`.
- **Server checks without storing every node:** port the placement to
  Python is costly; instead the client sends the node id and position, and
  the server re-derives the *candidate count and kind* per cell from a
  precomputed table: a build-time script (`frontend/scripts/nodes-table.mjs`)
  runs the placement for every cell of the finite Reaches (~150 cells) and
  writes `shared/catalog/generated/nodes.json` (id → kind, position,
  tier), ~1–3 MB, loaded by the backend. The server then knows every node
  exactly. Re-generated when the generator changes (a hash check in tests).
- Per-player node state: `node_harvests(user_id, node_id, at)` (only touched
  nodes are stored), so each player's world has its own regrowth (like
  Survival's per-island crops; shared nodes in the Gathering are G-phase).
- Drawing: one `InstancedMesh` per kind × LOD, per-instance attributes for
  growth stage, colour jitter, sway phase; harvested nodes shrink/fade via
  an attribute (no rebuild); impostors past 140 m share the tree impostor
  path.
- Interaction plugs into `interact.ts`; contact nodes test the pilot's
  hitbox against node spheres through the spatial hash in `step`.

**Looks:** each node has idle sway (shader), a "ripe" glint when ready
(subtle sparkle, under the bloom threshold), a harvest reaction (pop, squash,
leaves fly), and regrowth that animates from sprout to ripe.

**Budget:** ≤ 1 draw call per kind × LOD; ≤ 0.3 ms per step for contact
tests with 3 000 nodes in range.

**Tests:** placement deterministic across workers; the generated table
matches the client's placement (hash); server rejects unknown ids, unripe
nodes and positions out of reach (> 40 m from the last reported position).

**Done when:** a test node kind can be gathered in flight and by hold,
regrows, and the server agrees.

### R3. Lanternhaven (the hub)

**Goal:** a beautiful lantern town: the heart of the Reaches and of the
Gathering.
**Needs:** R1, F5, F6. **Size:** 8 days.

**Build:**
- A set piece in `game/reaches/hub/`: five terraced floating isles linked
  by rope bridges and wind currents (gentle updraft columns you can ride
  up): the Market terrace (R/G market halls), the Craft terrace (smith,
  workbench, kettle, loom entrance), the Garden terrace (seed shop, Home
  Isle gate), the Harbour (fishing NPC, boats), the Lantern Plaza (notice
  board, festival stage, a great lantern tree).
- Built with `structures/` pieces (21 kinds exist) plus new ones: lantern
  strings (instanced, one draw), paper lanterns, tiled roofs with upturned
  eaves (Liyue/Mondstadt mix), wind chimes, banners that ripple in the
  vertex shader, a central clock tower whose hands show the world time.
- **Updraft columns:** a visible spiral of motes and ribbons; flying in
  lifts the pilot (a `WorldMods` force, Reaches/Gathering only).
- Day/night: lanterns light at dusk (emissive ramps above the bloom
  threshold only at night), windows glow, fireflies over the Garden.
- NPCs (R13) populate it.

**Budget:** the hub is the densest place: ≤ 220 draw calls at Quality 2
looking across the plaza; ≤ 600 k triangles; static batching of the
authored geometry into a few merged meshes per material at load.

**Check by hand:** golden hour and night shots with `__shot`, 844×390, a
focused-window bench on the plaza.

**Done when:** the hub is navigable perched and flying, every station has a
spot, and it looks like a place you'd want to stand around in.

### R4. The Home Isle

**Goal:** your own floating island: plots, sprites, furniture, storage.
**Needs:** R2, F3, F10. **Size:** 6 days.

**Build:**
- A personal instance reached through the Home Isle gate (a ring of wind on
  the Garden terrace) and from the menu: `/?reaches=home`.
- Starts as a small grassy isle with a cottage, a mailbox (offline sprite
  yields, gifts), a storage chest, 6 garden plots, 2 sprite pedestals, one
  tree. Expands by levels (Wind Rank + coins): more area (the island mesh
  regenerated from an SDF with more lobes), plots, pedestals, a pond
  (fishing at home), a mineshaft rock.
- **Building:** a grid-snapped placement mode (perched, `RadialMenu`
  "Build"): ghost preview tinted green/red, rotate 45°, move, store; data
  `home(user_id, layout JSON, rev)`; server validates footprint and owned
  items.
- Visits come in the Gathering (G9); the layout is public-readable.

**Looks:** a cosy cottage with smoke from the chimney, a weather vane that
follows the wind, a welcome mat, a lantern by the door; placing an item
plays a soft "puff of petals".

**Done when:** a player can plant, place furniture, store items, leave and
find it the same.

### R5. Farming: sky gardens

**Goal:** grow crops on the Home Isle and the Meadow Rise terraces; harvest
by flying low through ripe rows.
**Needs:** R2, R4, F4. **Size:** 6 days.

**Build:**
- Crops (start with 8): Moonwheat, Sunberry, Cloudcotton, Skypumpkin,
  Glowcap (Lantern Wood), Frostmint (Frostspine), Emberroot (Cinder Steps),
  Pearlrice (Shellshore). Growth stages 4, real time (server timestamps),
  watering halves time (a *rain cloud* tool: fly over plots, a little cloud
  follows and rains).
- **Sowing:** perched at a plot (hold) or flying low with a seed pouch
  selected (contact sows the furrows you pass over).
- **Harvesting:** ripe crops in the swathe under the pilot (width from the
  tool: sickle 2 m, scythe 4 m, *Wind Reaper* 7 m) are harvested on
  contact below 6 m height. A combo counter rises while you keep
  harvesting without a gap (+fortune per stack, capped), the satisfying loop.
- **Public fields** in Meadow Rise: wide terraces of wild crops (shared
  layout, per-player regrowth) for harvesting runs; a daily *Harvest
  Contest* (Survival's Jacob's contests): one crop, 10 minutes, medals by
  percentile of collected amount (bronze/silver/gold), medals buy farming
  gear at the Barn Fair.
- Garden **visitors** (Survival): NPCs who come to your Home Isle with a
  request (items) for rewards (copper → farming upgrades).
- Tools: sickle → scythe → Wind Reaper (+ enchants, R10).

**Looks and sound:** crops sway in the wind (vertex shader, phase per
instance); harvest pops each plant with a squash and a burst of its colour
(wheat chaff, berry juice beads, cotton puffs); a rising pitch "pluck"
cascade that climbs with the combo; a soft whoosh trail behind the pilot
bending the crops (a shader displacement from the pilot's last 1 s path,
passed as 8 uniforms).

**Budget:** 2 000 crop instances in view (Quality 2), 1 draw call per crop
kind; the bending is uniforms only.

**Tests:** growth math on server and client match; contest scoring;
harvest swathe geometry (pure function).

**Done when:** a harvesting run across the terraces feels like surfing.

### R6. Foraging: canopies and giant trees

**Goal:** pluck fruit and feathers through canopies; fell trees perched.
**Needs:** R2, F5. **Size:** 5 days.

**Build:**
- **Canopy plucks** (contact): fruit clusters (Sky Apples, Lantern Plums,
  Ember Figs), seed pods and drifting feathers in tree crowns; flying
  through a crown collects them (leaves part around the pilot, a shader
  push like crops).
- **Felling** (perched on a branch or at the trunk): a rhythm chop: a ring
  closes on a target; press when it overlaps the gold band; 3–6 chops per
  tree by tier; perfect timing = bonus logs and a "clean cut". The tree
  then *gently folds into a sapling* (no falling trunks) and regrows; logs
  float up into the bag.
- **The Elder Canopy** (Lantern Wood): huge trees you perch inside; rare
  woods (Moonbark, Glowheart), nests with rare feathers, a hidden Lost
  Light in each.
- Woods: Ashwind, Birchlight, Moonbark, Cinderwood, Glowheart, Coralwood.

**Looks and sound:** wood chips and leaves on each chop, the axe trailing a
wind swirl; a satisfying "tok" with pitch rising on each successful chop;
fruit plucks are "pop" with a sparkle.

**Done when:** foraging is good both as a fast flight loop and a calm
perched rhythm.

### R7. Mining: veins, the Ice Galleries and the Hollow Deeps

**Goal:** mine crystal veins by resonance; explore caves with commissions.
**Needs:** R2, F5. **Size:** 8 days.

**Build:**
- **Veins** on cliffs (Frostspine, Cinder Steps): ore crystals growing out
  of rock (Quartzlight, Copperbloom, Skyiron, Frostglass, Emberstone,
  Starsilver). **Resonate:** hover near or perch, hold Use: a tone rises
  and the vein glows from its base; release in the *sweet spot* (the
  vein's own pitch, shown as a pulsing ring) to break it cleanly (more
  yield); too late and it cracks (less). Mining speed from the pick tier.
- **The Hollow Deeps:** a cave region entered through the Ice Galleries:
  big caverns with glowing crystals and underground rivers (the terrain
  generator's SDF caves; enclosed, so cheap to draw and great at night).
  **Commissions** (Survival's Dwarven Mines): 4 rotating tasks from the
  Forgekeepers ("Mine 60 Frostglass", "Find 2 geodes"), rewards: mithril-like
  *Skyiron powder* for a **Heart of the Deeps** perk tree (mining speed,
  fortune, a pick ability like *Echo Pulse* that reveals veins).
- **Gems** (Ruby-like *Sunstones*, Jade, Aquamarine…) in geodes; gems go
  into gear sockets (A14).
- Dark caves: the pilot's lantern (a point light, one only, and an emissive
  halo) lights nearby rock; crystals light themselves.

**Looks and sound:** prismatic sparks on resonance, a crystal ring decal on
the rock, shards that tinkle as they float to the bag; cave ambience hum,
water drips (spatial).

**Budget:** caves: one point light only (the pilot's); everything else
emissive. Deeps sections stream like cells.

**Done when:** a commission can be done start to finish and the perk tree
works.

### R8. Fishing: tide, cloud and deep

**Goal:** a relaxing, skilful fishing loop with collectible fish.
**Needs:** R2, F5, F7. **Size:** 7 days.

**Build:**
- **Cast** (perched at water or cloud sea, or hovering low with the rod):
  hold to charge distance, release; the line arcs as a light-thread
  (a `trail.ts` ribbon), the bobber lands with ripple rings.
- **Bite:** wait 5–20 s (shorter with angling); fish shadows (instanced,
  under the surface, shader-animated) approach and nibble; a "!" chime.
- **Reel minigame:** a vertical gauge with the fish (a glowing koi icon)
  darting; keep the catch band over it with **pitch** (the same axis you fly
  with: mouse, stick, touch stick). Band size from the rod; fish behaviour
  from the fish (darter, floater, sinker). Fill the meter to land it.
  Accessibility: an "assist" setting widens the band.
- **Skim fishing:** fly low over a school with a net (contact gather).
- **Legendary fish:** a rare catch becomes a *chase*: the fish leaps out and
  swims through the air; follow it through a few rings of light to land it.
- **Cloud fishing** in Cloudsea Isles: fish of the clouds (cloud rays,
  star minnows); **sky whales** pass by on a schedule (a huge, slow,
  instanced creature with singing), whale scales from their wake.
- Fish (start with 24 across regions, times of day and weather), a
  **fish guide** page with sizes and records, trophies at the Lighthouse.
- Treasure catches: bottles with Lost Light hints, runes, enchant books.

**Looks and sound:** water rings and splash beads; the fish flips in the
air on landing with a sparkle; a reel ratchet that speeds up with tension;
a little fanfare for a new species.

**Done when:** fishing in Shellshore at sunset is relaxing, the minigame
reads clearly on a phone, and the guide fills.

### R9. Collections and the Field Guide

**Goal:** gathering milestones unlock recipes and lore.
**Needs:** F4, R5–R8. **Size:** 3 days.

**Build:** per resource tiers (e.g. 50, 100, 250, 1 000, 5 000, 25 000, …);
server-side totals (`collections`); each tier unlocks a recipe, a sprite
tier, or a lore page. The existing `FieldGuide.tsx` gets a Collections tab
(by skill, with the model turning in a small preview on wide screens).

**Done when:** a tier unlock shows a toast and the recipe appears.

### R10. Enchanting: the Star Loom

**Goal:** enchant tools and gear by weaving constellations.
**Needs:** F3, F4, F10. **Size:** 6 days.

**Build:**
- **Starlight** (enchanting's currency, like Survival's XP levels) gathered
  from star motes that fall on clear nights across the Reaches (contact
  nodes) and from every skill's level-ups.
- **The Star Loom** at the Starfall Observatory: place an item, see
  available enchantments by item kind (from `enchants.json`): tools
  (Efficiency, Harvesting, Fortune-like *Bounty*, *Gentle Touch*), weapons
  (*Gale Edge*, *Lightfall*, *First Breath*…), mantles (*Ward*, *Lantern
  Heart*). Choosing one draws its constellation: you **trace it** (drag or
  stick through the stars in order); a clean trace gives the full level,
  a messy one a level lower (never failure).
- **Experiments** (Survival's): constellation memory games once a day
  (repeat a growing sequence of stars, chimes per star) for rewards.
- **Books** and the **anvil** (*Mending Bench*): combine books, apply books.

**Looks and sound:** the observatory dome opens to a night sky; traced
lines are gold, glowing above the bloom threshold; each star has a note of a
pentatonic scale so traces make little melodies; the enchanted item gets a
subtle glint shader (a moving sheen band, Quality ≥ 1).

**Done when:** an enchant is traced and shows on the tool's stats and look.

### R11. Runecrafting: wind runes

**Goal:** cosmetic runes that add effects to trails, landings and hits.
**Needs:** F3, F10. **Size:** 4 days.

**Build:** runes drop from all activities (rare); a **Rune Pedestal** in
the Drowned Garden fuses three of a kind into a higher tier (I → II → III),
with runecrafting XP. Apply to a wing (trail effect: petals, snow, embers,
music notes, bubbles), to a tool (gather effect) or to a weapon (hit
effect). **Purely visual** (rule 6): `pilotfx.ts` reads the rune and adds
an emitter; never touches gameplay.

**Looks:** each rune is a small glyph stone with a glowing inlay; fusion
spins the three around the pedestal, they merge in a flash.

**Budget:** rune effects share the pilot's particle budget; Quality 0
halves them.

**Done when:** three runes fuse and the new trail shows in flight, for the
owner and (later, G2) for others.

### R12. Alchemy: tea brewing

**Goal:** brew teas for timed buffs.
**Needs:** F10, F2. **Size:** 3 days.

**Build:** a kettle (Craft terrace; one on the Home Isle later): leaves +
water + a modifier (honey extends, ember spice strengthens). Brewing takes
real seconds while a little steam animation and a bubbling loop play;
**tea buffs** (stats from F2) for 10–30 min: Meadow Tea +harvest fortune,
Ember Tea +might (adventure), Starleaf +wisdom. Buffs persist across
sessions on the server (`buffs(user_id, id, until)`). Adventure only
accepts teas flagged `combat` (rule 6, through `CombatMods`).

**Done when:** a brewed tea shows its buff icon and stat change.

### R13. NPCs, dialogue and quests

**Goal:** a cast of charming townsfolk with requests and small stories.
**Needs:** R3, F6. **Size:** 6 days.

**Build:**
- NPC models: chibi villagers built with the avatar's parts (head, cape,
  hats from cosmetics, a few new outfits), 12 to start: the Gardener, the
  Smith, the Angler, the Forgekeeper, the Stargazer, the Tea Master, the
  Rune Sage, the Carpenter, the Banker, the Market Keeper, the Courier, the
  Lamplighter (lights lanterns at dusk, walks a route).
- Dialogue: `npcs.json` with lines and branching choices, played in a
  bottom dialogue card (portrait from the model, typewriter text with a
  babble voice pitched per NPC, choice buttons). The camera eases to a
  two-shot when perched next to them.
- Quests (`quests.json`): fetch, gather, deliver, explore, catch; a quest
  log in the journal; quest markers as soft light pillars, never cluttered
  (max 3 pinned).
- Daily requests on the notice board.

**Looks:** NPCs idle with personality (the Smith hammers, the Angler naps
with a rod, the Lamplighter carries a pole), turn to face you, wave.

**Done when:** a chain of three quests can be done from the board.

### R14. Sprites (minions)

**Goal:** little helpers that gather while you're away.
**Needs:** R4, R9. **Size:** 4 days.

**Build:** sprite kinds per resource (a Wheat Sprite, a Crystal Sprite…),
crafted from collections; placed on pedestals on the Home Isle; yield =
f(tier, time away), computed by the server on claim (capped by storage,
upgradable with a *satchel*); fuel items (teas!) speed them up.
`claim` action returns the yield; the mailbox shows it.

**Looks and sound:** each sprite is a round wisp with a tiny tool, busy
animations (swings a sickle at a miniature crop, taps a tiny crystal),
cheers when you arrive; full storage = it sits and sighs (a little "…"
bubble).

**Budget:** sprites are one instanced family with a shader-driven work
loop.

**Tests:** server yield math, caps, clock skew (client time ignored).

**Done when:** leave for an hour, come back, claim the right amount.

### R15. Taming: companion bonds

**Goal:** the twelve pets level up and gain perks.
**Needs:** F4, F2. **Size:** 3 days.

**Build:** pets gain XP from skill XP while equipped (a share by pet
affinity: the koi likes fishing); levels 1–100; perks scale (`skills.json`
pet tables); a pet's look grows with level (more glow, a colour variant at
50, a flourish at 100; reuse `pets/` models and `companion.ts`). This also
covers `docs/feature-ideas.md` idea 4 (companion bonds).

**Done when:** an equipped pet levels while farming and its perk applies.

### R16. Hearthcraft (carpentry)

**Goal:** furniture and decor crafted from gathered materials.
**Needs:** R4, F10. **Size:** 4 days.

**Build:** ~40 furniture pieces in sets (Meadow cottage, Lantern Wood,
Coral, Starfall), crafted at the workbench; carpentry XP; some pieces are
functional (a better storage chest, a home kettle, a home loom). All
instanced per piece kind on the island.

**Done when:** a furniture set can be crafted and placed.

### R17. Lost Lights

**Goal:** 120 hidden lights across the Reaches, rewarding curiosity.
**Needs:** R1. **Size:** 3 days.

**Build:** hand-placed positions in `regions.json` (some in hard flying
spots: under arches, inside the Elder Canopy, behind waterfalls); each is a
small spirit flame that hums when near (spatial sound), collected on
contact with a chime and a memory line (feature-ideas idea 3: spirit
memories). Every 5 raise max Light (+2) and Wind Rank XP; the Lamplighter
exchanges them.

**Done when:** collecting lights updates the count on server and map.

### R18. Day, night, weather and seasons

**Goal:** a living world clock that drives looks and gameplay variety.
**Needs:** R1. **Size:** 4 days.

**Build:** world time from the server clock (`net/clock.ts`): a 48 min day
(golden hour and moonlit moods); weather per region (clear, rain, snow,
cloudsea fog, aurora) on a seeded schedule; seasons per real week (crops
and fish availability, decorations). Moods already exist per palette: the
clock lerps between them (the "continuous time of day" item from Next up).

**Done when:** the hub goes from day to night smoothly and fish/crops
respond to time and weather.

### R19. The Reaches HUD and journal

**Goal:** one calm HUD for exploring and gathering; the journal grows.
**Needs:** F7, R2. **Size:** 4 days.

**Build:** `components/world/ReachesHud.tsx` in the zones of §5: Light ring
(top-left), region name and time (top-left under it), skill toasts, a
compact minimap (a circle, toggleable; off by default on compact), the
hotbar, prompts, the bag button; Hold Tab (or the bag button) opens the
inventory sheet. Journal gains Skills, Collections, Quests, Map tabs.
Idle UI fades like the race HUD (`useIdleUi`) while flying.

**Done when:** the HUD reads at every breakpoint and never covers the
pilot.

### R20. The Reaches session and saving

**Goal:** tie everything into `ReachesSession`.
**Needs:** R1–R19 as they land (start with R1, grow). **Size:** 3 days
(initial) + integration per step.

**Build:** `session/ReachesSession.ts`: creates `Game` with the Reaches
level and `WorldMods` (perch, updrafts, gentle crash), the
`WorldController`, the inventory outbox, autosave of position and time
(server `world_state(user_id, x, y, z, region, at)`); resumes where you
left. Offline play: actions queue and replay; the server's answers win.
Test mode: `/?reaches&test` grants tools and items, teleports to regions
(Shift+1…9), fast-forwards time (Shift+T), spawns any node (Shift+N).

**Done when:** you can play an hour, reload, and continue exactly.

---

## Phase A: Adventure combat and the Windspire

**The run stays a run.** Eight levels, portals, upgrades and items between
them, lives, the finale. What changes is what happens *in* a level:

| Level | Today | After phase A |
| :--- | :--- | :--- |
| 1, 2, 3 | A course on a map, gates, portal | A **Skyway**: the course plus Murk encounters along the line (gates still count, purifying adds score and loot) |
| 4 | Same | A **Windspire floor**: a dungeon tower (rooms, puzzles, a keeper boss) |
| 5, 6, 7 | Same | Skyways, harder Murk, elites and a mid-level ambush |
| 8 | Same + finale | The **Windspire summit**: the floor's keeper, then the finale and victory lap |

A run starts by choosing a **calling** (class) and the **Windspire floor**
(F1–F7, unlocked in order; *Master* floors later, A17). Persistent gear
from the profile sets the baseline; run upgrades and items still shape
each run (a roguelike on top of a progression game, like Survival's dungeon
loop wrapped in Wind Rider's run).

### A1. Combat core: Light, hits and determinism

**Goal:** the rules of combat, deterministic, in `Game.step`, adventure
only.
**Needs:** F2. **Size:** 5 days.

**Read first:** `run/controller.ts` (`step`, `crashed`, `revive`,
`perkSave`, lives), `flight.ts` (`FlightMods`, hitbox), `Game.ts` `step`.

**Build:**
- `game/combat/combat.ts`: `CombatController` owned by `RunController`
  (only when the run's options say `combat: true`; old saves/URLs without
  it play as today). State: Light (max from stats), Focus (ability
  resource), invulnerability windows, status effects (chill, ink, gust).
- Damage formula from F2 stats, in one place: `damage = (base + might) ×
  (1 + crit roll × critPower) × multipliers − ward mitigation` (crit rolls
  from `makeRng(seed, "combat/<level>/crit")`, never `Math.random`).
- Light at 0 → today's crash path (`RunController.crashed`), so lives,
  revive items and the charm keep working. Taking a hit is never a crash on
  its own.
- `CombatMods` (like `FlightMods`): what upgrades, items, teas and gear
  change; the controller builds it each level.
- A **combat log** ring buffer (for tests and A19 verification).

**Tests:** determinism (a scripted 60 s fight gives the same log twice and
on a second machine/worker); Light 0 → crash → life lost; races run with
the combat module not even loaded (bundle check, F11).

**Done when:** a dummy target can be hit and can hit back, all through
`Game.step`, with no change to time trials (hashes, ghost replay).

### A2. Enemy simulation and rendering

**Goal:** dozens of enemies cheaply: data-oriented sim, instanced drawing,
shader animation.
**Needs:** A1. **Size:** 5 days.

**Build:**
- `game/combat/enemies.ts`: struct-of-arrays (`Float32Array` positions,
  velocities, hp, state, timers, kind, phase) for up to 64; spawn/despawn
  without allocation; a `SpatialHash` for hits and separation.
- AI at 30 Hz (`ai/` behaviours as small pure functions: `drift`, `orbit`,
  `chase`, `strafe`, `guard`, `dive`, `swarm` with boids), positions
  integrated at 120 Hz, rendering interpolated.
- Rendering: one `InstancedMesh` per enemy kind (rigid parts merged; a
  vertex attribute marks part ids: wings, tail, body) animated in the
  vertex shader by per-instance phase/state (flap, bob, wind-up, stagger,
  dissolve). Purification dissolve: a noise-threshold dissolve in the
  fragment shader with a bright edge, then the freed spirit model pops out.
- LOD: beyond 120 m, a single quad impostor per instance (a shared atlas of
  each kind's silhouette).

**Budget:** 64 enemies = ≤ 6 draw calls (by kind), AI ≤ 0.4 ms at 30 Hz,
zero allocations.

**Tests:** spawn/despawn stress (10 000 cycles, no growth), boids stability,
determinism of AI with seeded streams.

**Done when:** `__combat.spawn("wisp", 40)` renders a lively swarm at 60
fps on the bench scene.

### A3. The player's verbs: Wind Strike, darts, Gale Burst, perfect dodge

**Goal:** combat that is *flying*: the best attack is a well-flown line.
**Needs:** A1, A2. **Size:** 6 days.

**Build:**
- **Wind Strike (contact):** flying through an enemy at speed purifies or
  damages it; damage scales with speed (rewarding dives) and with a
  *strike chain* (each hit within 2 s adds +10%, max ×2). Hitting an
  armoured enemy without breaking its ward bounces you gently (a nudge, not
  a crash).
- **Feather Darts (auto-aim, Fire key / right trigger / touch button):** a
  burst of 3 homing feathers at the best target in a forward cone (lock-on
  reticle: a soft gold ring around the target); cooldown.
- **Gale Burst (charged, hold Fire):** a spherical wind wave that staggers
  and pushes Murk; costs Focus.
- **Perfect dodge:** the existing dodge (8 m sidestep) *through* an attack's
  telegraph within 0.15 s of impact grants a **Windstep**: invulnerable,
  the next Wind Strike is a guaranteed crit, and a visual-only slow-motion
  look (the camera and post-effect slow; the *physics clock does not*,
  rule 6) with a ring of light.
- **Calling ability** (A7) on its own key.
- Touch: a Fire button (tap darts, hold burst) and the calling button in the
  right-thumb cluster; aim is automatic, flying is aiming.

**Looks and sound:** strikes leave a bright cut-line of wind across the
enemy, a radial burst of light, Murk smoke inverting to white; darts are
glowing feathers with ribbon trails; Gale Burst is a translucent sphere
with a refraction-like shimmer (Quality 2) or a ring (Quality 0); sounds:
a soft "thwip" for darts, a deep "whomp" for bursts, a bright chime for
purifications climbing in pitch with the strike chain. A tiny camera kick
and a 2-frame white flash on crits (visual only, settings toggle).

**Tests:** strike damage vs speed curve; auto-aim picks the right target;
perfect-dodge timing window.

**Done when:** purifying a swarm by diving through it feels like the best
thing in the game.

### A4. Murk families and their telegraphs

**Goal:** a readable, varied bestiary that fits the style.
**Needs:** A2, A3. **Size:** 8 days (2 per two families, plus polish).

Ten families (start with the first five), each with a clear silhouette, a
colour accent per biome palette, a telegraph (always visible ≥ 0.6 s
before damage), and a freed-spirit form:

| Murk | Behaviour | Telegraph | Freed as |
| :--- | :--- | :--- | :--- |
| Wisp | Swarm (boids), touches drain Light | Flickers brighter | A tiny light mote with eyes |
| Thornbat | Dives at you from cliffs | Folds wings, a screech | A little bat with a flower |
| Stone Sentinel | Turret on islands, slow orbs | A rune ring charges | Moss creature that waves |
| Murk Eel | Patrols in loops; a searchlight cone | Cone turns red-violet | A ribbon fish |
| Storm Hawk | Chases at your speed, pecks | Screech and a wing flare | A white hawk circling away |
| Ink Jelly | Floats; bursts into ink clouds (blurs view slightly) | Pulses | A clear jelly glowing |
| Shield Golem | Ward must be broken by a Gale Burst | Raises shield | A pebble spirit |
| Lantern Thief | Steals an item if it touches you, flees | Grabs, giggles | A child-like spirit returning the item |
| Gloom Weaver | Spins webs between rocks (a gate blocker) | Threads glow | A spider-like spirit weaving flowers |
| Elite variants | Any family with a crown, more HP, one trick | Gold aura | Drops essence |

Each: model (`combat/models.ts`), shader animation states, AI behaviour,
telegraph FX, hit/purify/freed sounds, an entry in the Field Guide's
bestiary (seen, purified count, lore).

**Done when:** each family is readable in a dark map at Quality 0 and on a
phone, and the bestiary fills.

### A5. Skyway encounters

**Goal:** Murk placed along the run's course as designed encounters, not
random noise.
**Needs:** A4. **Size:** 4 days.

**Build:** encounter templates (`encounters.json`: a swarm across the line,
a sentinel nest on an island near a gate, an eel patrol under a bridge, a
hawk ambush in a canyon) placed by seed along the course
(`course.ts` distance and the gate list), density from
`LevelKey.difficulty`; an **ambush** mid-level on 5–7 (a ring of wind locks
the camera loosely; purify all to break it; no walls, flying away just
loses the reward). Purifying adds to the run score and drops orbs and loot
lanterns (picked up by contact).

**Done when:** a level has 4–8 encounters that each feel distinct.

### A6. Persistent combat gear

**Goal:** weapons, mantles and charms that persist and set the baseline.
**Needs:** F3, F2, A3. **Size:** 6 days.

**Build:**
- Slots: **weapon** (Wing Blades → strike damage; Feather Bows → darts;
  Wind Fans → bursts and Focus), **mantle** (Light and ward; a *cape*
  in looks), **circlet**, **boots** (swiftness, run-only flight bonus,
  capped), **charm string** (A14), **pet** (existing).
- Gear looks: gear is a *stat item*; cosmetics stay the look (the
  existing wardrobe). A "Show gear" toggle per slot shows the gear's model
  instead (Genshin-style weapons appear in hand when attacking, then
  dissolve into motes).
- Weapon models are hero pieces (5–10k tris, LOD): blades with wind-steel
  edges and gold guards, bows with feather limbs and a light string, fans
  with painted silk panels; each weapon has a summon/dismiss effect and an
  attack trail colour.
- Weapon abilities (Survival's item abilities): e.g. *Gale Lunge* (a forward
  dash with i-frames), *Lightfall* (darts rain on the lock target).
- Equipment sheet in the journal; comparison tooltips.

**Done when:** equipping a better weapon changes damage and looks right in
hand and in the gallery.

### A7. Callings (classes)

**Goal:** five roles for solo variety and parties (G7).
**Needs:** A3, A6. **Size:** 6 days.

| Calling | Role | Passive | Ability (key / touch button) | Ultimate (charged by purifying) |
| :--- | :--- | :--- | :--- | :--- |
| Gale | Melee striker | Strike chain lasts 3 s | *Cyclone Dash*: a dash that hits everything on its path | *Tempest*: 6 s of chained dashes |
| Warden | Tank | Takes 30% less, draws Murk aggro | *Aegis Bloom*: a shield dome for nearby allies | *Bastion*: invulnerable 4 s, taunts all |
| Lantern | Healer | Purifications heal allies | *Lantern Light*: heal pulse | *Dawn*: revive a fallen ally / save a life solo |
| Archer | Ranged | Darts pierce | *Volley*: 12 darts | *Starfall*: a rain of arrows on a zone |
| Sage | Mage | Focus regen ×2 | *Gale Orb*: a slow orb that pulls Murk in | *Aurora Wave*: a screen-wide stagger |

Calling levels (XP per run, 1–50) give small passives. Solo play is
balanced per calling (Lantern solo heals itself). Each calling has its own
pilot aura colour and ability VFX; abilities reuse the abilities' FX
patterns in `game/abilities/`.

**Done when:** all five are fun solo on Windspire F1.

### A8. Windspire layout generation

**Goal:** a seeded dungeon floor: a grid of rooms linked by airy corridors.
**Needs:** A1. **Size:** 6 days.

**Read first:** `world/terrain/` (SDF shapes, surface nets meshing),
`mesher.ts` workers.

**Build:**
- `windspire/layout.ts`: per floor a 6×6 (F1 4×4 … F7 6×6) grid; rooms
  1×1 to 2×2 and L shapes; a spanning tree with a few loops; the Entrance,
  the **Lantern Room** (Survival's blood room) far away, the Keeper's hall
  behind it, puzzle rooms, a few secrets; **wind keys** lock some doors.
- Rooms are **interiors in the sky**: a hollow tower of carved stone and
  gold-trim arches with open sides to the clouds (so it's never
  claustrophobic, Sky's temples). Built from authored room *kits*
  (`windspire/rooms/*.ts`: floors, arches, pillars, banners, wind
  channels) assembled by the layout; corridors are tubes of wind (a
  visible current you ride, gentle steering).
- Meshes built in workers per room, streamed: the current room + neighbours
  at full detail, others as simple shells, far ones not at all.
- A **dungeon map** in the HUD corner: rooms reveal as visited, puzzle and
  secret icons.

**Budget:** a room ≤ 60 draw calls with its contents; floor load ≤ 1.5 s
(in the glide-in, `glidein.ts`).

**Tests:** every layout connected; keys before their doors; the Lantern
room reachable; hash of 20 seeds' layouts stable.

**Done when:** F1–F7 layouts generate and can be flown through.

### A9. Room kinds

**Goal:** rooms that each play differently.
**Needs:** A8, A4. **Size:** 6 days.

Kinds: **Gauntlet** (waves of Murk, doors open when purified), **Updraft
Shaft** (a vertical climb through wind columns with sentinels), **Hall of
Bells** (enemies only hurtable while a bell rings), **Mirror Hall** (eels'
searchlights; stay out of the light), **Garden Court** (calm room with a
Lost Light and a healing fountain), **Collapse** (platforms crumble into
petals behind you; fly out fast), **Trap rooms** (wind blades swinging,
gentle knockback). Each with a model kit variant per floor theme
(F1 Verdant stone, F3 Ember, F5 Glacier, F7 Aurora).

**Done when:** each kind has one polished variant.

### A10. Puzzles

**Goal:** short, flight-based puzzles (Survival has 10 dungeon puzzles).
**Needs:** A8. **Size:** 6 days.

Ten puzzles: **Ring Sequence** (fly through rings in the order lit),
**Light Mirrors** (rotate mirrors by striking them to route a beam to a
crystal), **Bell Memory** (repeat a chime melody by hitting bells),
**Wind Weights** (push floating stones onto pads with Gale Burst),
**Lantern Lighting** (light all lanterns in one flight without touching the
dark ones), **Constellation** (connect stars, the loom's trace), **Echo
Path** (follow a fading trail), **Twin Switches** (two plates at once:
co-op, or solo with a decoy from the Sage), **Riddle Statues** (three
statues, one tells the truth), **Feather Race** (beat a ghost bird to the
end). Each: seeded variation, a failure that resets gently, solved =
chest + score.

**Done when:** every puzzle is solvable solo and on touch.

### A11. Keepers (bosses)

**Goal:** one memorable boss per floor (Survival's floor bosses), in style.
**Needs:** A3, A4, A8. **Size:** 3 days per keeper (seven).

| Floor | Keeper | Fight |
| :--- | :--- | :--- |
| F1 | The Hollow Kite, a giant tangled kite | Cut its strings (strike lines), three phases |
| F2 | Twin Lanterns | Two bosses sharing Light; purify both within 10 s |
| F3 | The Ember Drake | Fire breath sweeps (telegraphed lanes), perches to rest (strike window) |
| F4 | The Mirror Warden | Copies your calling; mirrors puzzle mid-fight |
| F5 | The Frost Leviathan | A huge whale-like Murk circling a glacier hall; ride its wake |
| F6 | The Weaver Queen | Webs reshape the arena; free trapped spirits for buffs |
| F7 | The Hollow Wind | The source of the Murk: a storm with a heart; final phase is flying up through the eye into the dawn (ties into the finale) |

Each: a hero model (8–15k tris, emissive core, ink outline), phase
transitions with a short camera moment (≤ 3 s, skippable after first view),
telegraphs readable at Quality 0, a boss bar (top-centre, a ribbon with the
name in the title font), its own music track or stem, a purification
ending (it unravels into light and a huge freed spirit bows to you).

**Done when:** each keeper is beatable by every calling solo with F-tier
gear and has been playtested 5+ times.

### A12. Scoring and reward lanterns

**Goal:** the dungeon score and end-of-floor rewards.
**Needs:** A8–A11. **Size:** 3 days.

**Build:** score from *Purity* (enemies purified), *Discovery* (rooms,
secrets), *Swiftness* (time), *Grace* (Light lost, falls) → grade D to S+.
Reward lanterns (Survival's chests): Paper, Bronze, Silver, Gold, Jade,
Starlight; higher grades open more; opening a lantern beyond the first
costs coins or a *lantern key*. Lanterns float up from the floor in a row;
opening one unfolds it into a flower of light and the item rises with a
rarity beam (legendary: a pillar and a choir swell).

**Done when:** the grade feels earned and the lantern opening is a thrill.

### A13. Essence and stars

**Goal:** dungeon gear upgrades (Survival's essence and stars).
**Needs:** A12, A6. **Size:** 2 days.

Wind Essence from purifying elites and lanterns; star a dungeon item (1–5
stars, +10% stats each in the Windspire) at the Smith; stars show as gold
pips on the icon and a faint aura on the model.

### A14. Tempering, crystal sockets and the charm string

**Goal:** Survival's reforges, gemstones and accessory bag.
**Needs:** A6, R7. **Size:** 5 days.

- **Tempering** at the Smith: apply a *temper* (Swift, Keen, Sturdy,
  Radiant… from tempering stones found in mining/fishing) for a stat
  profile; the item's name gains the prefix.
- **Sockets:** gear has 0–3 crystal sockets; gems from the Deeps add stats;
  socketed gems glow on the model.
- **Charm string:** a bag of charms (talismans; stats only, one per family),
  total *Resonance* (Survival's magical power) unlocks power tunings.
  Today's run *charm* (`run/charm.ts`) stays the run's own mechanic.

**Done when:** a tempered, socketed weapon with a charm string shows the
right totals on server and client.

### A15. Tempest Hunts (slayer)

**Goal:** boss contracts per Murk family (Survival's slayer quests).
**Needs:** A4, A11. **Size:** 4 days.

Start a hunt at the Hunters' Lodge (Lanternhaven); during runs, purifying
that family fills a meter; full = a **Tempest** of that family appears in
the next level (a huge elite with mechanics: a Wisp Tempest splits; a Hawk
Tempest drafts you into a chase). Hunt levels unlock recipes (family
weapons and charms). Tiers I–V.

### A16. Run upgrades and items, revisited

**Goal:** the existing 31 upgrades and 26 items get combat versions.
**Needs:** A3. **Size:** 4 days.

Review every upgrade and item (`run/upgrades.ts`, `run/items.ts`): add
combat effects where they fit (Guardian Gale also blocks a hit; the String
of Firecrackers staggers Murk; the Oil-Paper Umbrella deflects orbs). Add
10 combat upgrades (Chain Lightning strikes, Feather Storm darts, Vampire
Light…) and 6 combat items. Keep the pick screen's look.

### A17. Master Windspire and run modifiers

**Goal:** endgame difficulty (Survival's Master Mode) and variety.
**Needs:** A11. **Size:** 3 days.

Master floors M1–M7 (harder Murk, new keeper tricks, better lanterns),
plus *Gusts*: optional run modifiers (more elites, no darts, double speed
Murk) that raise rewards; a weekly seeded **Windspire Challenge** with a
shared seed and a leaderboard.

### A18. Party runs

**Goal:** 2–4 players in one adventure.
**Needs:** G1, G7, A7. **Size:** 8 days.

**Build:** the run is simulated by each client for its own pilot; enemies
and room state are owned by the **party host** (authoritative for AI and
spawns, sends enemy snapshots at 15 Hz; others interpolate and send
*hit claims* that the host validates and applies). Puzzles sync state
events. Host migration on leave. Lives become a shared pool (+1 per extra
member); a fallen pilot becomes a light-spirit that can be revived by the
Lantern or at the next room. Rewards rolled by the server per player.
Scaling: Murk Light × (1 + 0.6 per extra player).

**Done when:** four players clear F3 with each calling, on a 150 ms link
(test with Chrome's throttling).

### A19. Server verification and loot

**Goal:** dungeon rewards that can't be faked cheaply.
**Needs:** A12, F3. **Size:** 4 days.

**Build:** `/api/runs/start` already exists: extend it to issue the run's
seeds; at the end the client sends a summary (per room: time, purified
counts, damage dealt, Light lost, puzzle solves, the combat log digest);
the server checks plausibility (no room faster than its minimum, damage
within max DPS × time for the gear, purified ≤ spawned by the seeded
layout) and then rolls the lanterns. Failing checks: rewards capped, the
run flagged, no error shown to the player (no tells for cheaters).

**Tests:** pytest with honest and forged summaries.

### A20. Adventure HUD for combat

**Goal:** add combat to `RunHud` without clutter.
**Needs:** A3, A7. **Size:** 4 days.

**Build:** the Light ring around the existing feathers (lives) pill; Focus
as a thin arc under it; the calling ability and ultimate as round buttons
(right thumb on touch, bottom-right on desktop) with cooldown sweeps; the
lock-on reticle in world space; boss ribbon top-centre; the dungeon
minimap top-right under the buttons (collapsible); damage numbers off by
default on compact. Follows `RunLayout.css` zones; checked at 844×390.

**Done when:** a full Windspire floor is playable on a phone at 844×390
with everything readable.

---

## Phase G: the Gathering (social)

The Gathering is **Lanternhaven and the Reaches, live, with other players**:
you see others fly, perch, fish and craft; you wave, call, hold hands, chat,
trade, form parties and flocks, visit islands, and gather at festivals.
It's the calm counterpart to races: Sky's togetherness first, Survival's
trade and parties second.

### G1. Shards over WebSocket

**Goal:** a live, scalable transport for many players in one place.
**Needs:** F3. **Size:** 6 days.

**Read first:** `backend/rooms.py` (tick loop, snapshots, timeouts),
`net/RoomClient.ts`, `net/clock.ts`.

**Build:**
- `backend/shards.py`: a shard = one instance of a place (Lanternhaven,
  a region, a Home Isle visit) with up to **40 players** (`MAX_SHARD`); new
  arrivals fill the fullest non-full shard of their place (friends and
  party members are placed together). Ticks at 15 Hz.
- FastAPI WebSocket endpoint `/api/shard/ws` (binary frames). Race rooms
  keep SSE (rule: races unchanged).
- **Binary protocol** (`shared/protocol.md` + `net/protocol.ts` +
  `backend/protocol.py`, tested with shared vectors): per player state 20
  bytes (quantized position relative to the shard origin: 3×int16 at 5 cm
  over ±1.6 km; quaternion smallest-three 4 bytes; speed, flags (perched,
  boosting, emote id, holding hands), action id); snapshots carry only
  players within the receiver's **interest radius** (250 m, nearest 24
  first), deltas against the last acked snapshot.
- Reliable messages (chat, trades, party) as typed JSON frames on the same
  socket with sequence numbers.
- Reconnect with session resume (a token, 30 s grace), heartbeats.
- Caddy: WebSocket upgrade route.

**Budget:** ≤ 8 kB/s down per client at 24 visible players; server ≤ 2 ms
per shard tick at 40 players (Python; measure with a load script).

**Tests:** protocol vectors; a load test `backend/tests/load_shards.py`
(40 bots × 10 shards, random walks), interest filtering, resume.

**Done when:** 40 bots fly around Lanternhaven in a browser at 60 fps and
the server stays within budget.

### G2. The Gathering session and remote pilots

**Goal:** see others, beautifully and cheaply.
**Needs:** G1, R3, F5. **Size:** 6 days.

**Build:**
- `session/GatheringSession.ts`: the Reaches session plus `ShardClient`;
  joins Lanternhaven's shard; moving between places (hub → region → home)
  switches shards behind the glide-in.
- `game/social/avatars.ts` (growing out of `pilots.ts`): remote pilots with
  **appearance** (cosmetics, style, pet, rune trail, equipped gear look),
  sent once on join and on change (an `appearance` message; fixes the known
  gap "Remote pilots and ghosts: no cosmetics").
- **LOD tiers:** near (≤ 40 m, up to 12 at Quality 2): the full avatar with
  cloth and wings; mid (≤ 120 m): a simplified avatar (no cloth sim, wings
  rigid, animated every other frame, the "animate distant remote pilots
  every other frame" idea from Next up); far: an instanced impostor glow
  with a name tag; beyond 250 m: a light mote only.
- Name tags: soft text above, fading by distance; friends in gold, flock
  members with their banner colour; can be hidden.
- Interpolation 100 ms behind, extrapolation ≤ 250 ms, then freeze.

**Budget:** 30 remote pilots on screen ≤ 40 extra draw calls at Quality 2,
≤ 15 at Quality 0.

**Done when:** `__bench(2, "gathering-30")` holds 60 fps on the integrated
GPU and remote pilots look as good as yours up close.

### G3. Calls and emotes

**Goal:** wordless social language (feature-ideas idea 2, extended).
**Needs:** G2. **Size:** 4 days.

**Build:** an **emote wheel** (`RadialMenu`: hold Q / the touch emote
button): wave, bow, clap, spin, sit, dance, point, laugh, cry, "follow me",
plus emotes unlocked by Lost Lights' memories; the **call** (Sky's honk):
tap for a short call, hold for a long one; your call's colour and voice
from settings; calling near another pilot makes their pilot glow briefly,
and both cut a little ring of light. Pets answer calls. Sent as one byte in
the state.

**Looks and sound:** each emote is a procedural stance with springs; calls
are synthesized voices with a per-player timbre and reverb tail; emote
light rings via `RingQuads`.

**Done when:** a "call and answer" between two players feels warm.

### G4. Holding hands

**Goal:** fly together hand in hand (feature-ideas idea 1).
**Needs:** G2, G3. **Size:** 5 days.

**Build:** two pilots within 6 m: one offers a hand (a prompt), the other
accepts; the follower's input is ignored and it is placed beside the leader
each step (like `Autopilot.place`, offset by the leader's right axis), the
leader's flight is unchanged; perched, they walk together. Server marks the
pair; anyone can let go instantly. A ribbon of light between the hands
(`trail.ts`), both arms posed (`Avatar.armPose`). Chains up to 4.

**Done when:** a pair can fly the hub together with no jitter at 150 ms
latency (the follower is placed from the leader's interpolated state).

### G5. Friends, parties and presence

**Goal:** find each other and play together.
**Needs:** G1. **Size:** 5 days.

**Build:** friend requests by public id or from a name tag; a friends list
with presence (online, place, mode); **parties** up to 4 (invite, accept,
leader, kick, leave), shared across modes: a party can enter the Windspire
together (A18), visit an island, or join the same shard. Party pilots show
on the minimap and with a coloured halo. Server: `friends`, `parties`
tables, presence from shard connections.

**Done when:** a party of two goes from the hub into a Windspire run
together.

### G6. Chat

**Goal:** talk safely.
**Needs:** G1. **Size:** 4 days.

**Build:** channels: nearby (speech bubbles above pilots, 40 m), party,
flock, whisper; **quick phrases** (a wheel of friendly phrases, works for
everyone, safe for kids and touch); typed chat opt-in (settings), with a
server-side filter (word list + rate limits + length), block and report
(G16). Bubbles are soft glass with a tail, fade after 6 s, stack up to 3.
On touch: the quick-phrase wheel first; typing opens the native keyboard in
a bottom sheet, the game pauses input but not the world.

**Done when:** chat works on desktop and phone, filtered, rate limited.

### G7. Island visits and co-op islands

**Goal:** show off your Home Isle; share one with friends.
**Needs:** R4, G1. **Size:** 4 days.

**Build:** visit a player's Home Isle (their gate in the hub lists
"Open/Friends/Closed"); guests see the layout, can sit, emote, use public
stations, fish the pond, harvest *with permission* (the host's settings);
the visit shard is the host's. **Co-op islands** (Survival's co-ops): up to
4 friends share one isle (shared plots, sprites, chest; each keeps their own
skills and bag); server-side ownership checks per action.

### G8. Trading

**Goal:** safe player-to-player trades.
**Needs:** F3, G5. **Size:** 3 days.

**Build:** request a trade within 10 m; a two-panel trade sheet (both
offers, coins); both press Ready, a 3 s countdown, then Accept; any change
resets readiness; the server swaps atomically and logs the trade. Items
bound by rules (keeper-only drops can be `soulbound`) can't be offered.

**Tests:** atomicity under disconnects, no duplication when both
reconnect, offer changes during countdown.

### G9. The Bazaar (Market hall I)

**Goal:** an order book for materials (Survival's Bazaar).
**Needs:** F3. **Size:** 5 days.

**Build:** `backend/market.py`: buy orders and sell offers per material,
instant buy/sell against the best order, fill matching in one transaction,
a small tax (coin sink), order limits per player; price history (hourly
candles). UI: the Lantern Market's first hall: categories by skill, an item
page with a small price chart (`dataviz` guidance), instant buttons and
order forms, my orders. NPCs flog fallback prices for brand new markets
(liquidity floor).

**Tests:** matching engine properties (no coin or item created; partial
fills; cancellation refunds), concurrency.

### G10. The Auction Hall (Market hall II)

**Goal:** auctions for unique gear (Survival's Auction House).
**Needs:** F3, A6. **Size:** 4 days.

**Build:** BIN (buy it now) and timed bids, item escrow at listing, outbid
refunds, fees; search by name, kind, rarity, stars, tempers, enchants.
Each listing shows the 3D preview (`preview3d.ts`).

### G11. Flocks (guilds)

**Goal:** lasting groups with identity.
**Needs:** G5, G6. **Size:** 4 days.

**Build:** create a flock (name, banner from parts: shape, emblem,
colours), up to 50 members, ranks, a flock chat, weekly flock goals
(gather together N of something), a **flock nest** in Lanternhaven's sky
(a small shared island everyone can decorate, R16's furniture).

### G12. Shared world events

**Goal:** moments that pull players together.
**Needs:** G2, R18. **Size:** 6 days.

**Build:** scheduled events on the world clock, announced by a lantern
signal: **Sky-whale migration** (follow the pod; their wake gives scales;
more players = bigger pod), **Starfall Night** (falling stars to catch
together; a shared meter fills to light the great lantern tree), **Kite
Festival** (a cooperative kite-flying ring course), **Lantern Release**
(everyone releases a lantern with a written wish; the sky fills). Shared
nodes during events are server-owned (first touch wins; rewards to all
contributors).

### G13. Concerts and the Wind Council

**Goal:** Sky-style performance and a Survival-style seasonal vote.
**Needs:** G2, G12. **Size:** 5 days.

**Build:** **instruments** (a flute, a harp, a drum) playable with keys
1–8 / a touch keyboard on a pentatonic scale, heard by nearby players
(notes sent as events, synthesized locally); a stage in the plaza.
**The Wind Council:** every season, players vote for one of three
candidates (NPCs from R13) each with perks for the season (+fishing
festival, cheaper tempering, a special event); results shape the next
season.

### G14. Party finder and the Windspire lobby

**Goal:** easy groups for dungeons.
**Needs:** G5, A18. **Size:** 3 days.

A board at the Hunters' Lodge: list a party (floor, callings needed, note),
join with one tap; a short lobby (ready checks, calling choice) that
launches the run for all.

### G15. Moderation, safety and privacy

**Goal:** a kind place, safe for everyone.
**Needs:** G6. **Size:** 4 days.

**Build:** block (hide their tags, chat, emotes toward you), report (with
the last chat lines and the shard snapshot reference), mute; server
moderation tools (an admin page behind auth: mute, kick, ban, review
reports), rate limits everywhere, typed chat off by default for new
accounts until Wind Rank 5, privacy settings (who can visit, trade, invite,
see presence). No personal data shared beyond the public id and display
name.

### G16. Social HUD and menus

**Goal:** the social UI that fits small screens.
**Needs:** G3–G8. **Size:** 3 days.

**Build:** a social button (top-right) opening a sheet with tabs: Nearby,
Friends, Party, Flock, Chat; tapping a player opens a card (wave, call,
trade, invite, visit, block); the emote and quick-phrase wheels on the
right-thumb cluster on touch. Checked at every breakpoint.

---

## Phase P: polish, balance and live operation

### P1. Economy simulation

A script (`docs/prototypes/economy/sim.mjs`) that simulates 1 000 players
with play-time profiles (casual, regular, grinder) over 60 days using the
catalog numbers: coins in/out, item supply per hour, bazaar prices, time to
each milestone. Targets: first Windspire F3 clear by hour 8, a full
starting farming set by hour 6, inflation < 2%/week with sinks (taxes,
tempering, star upgrades, lantern keys). Re-run on every catalog change
(a test asserts the targets loosely).

### P2. Combat balance

A headless combat sim (the combat module runs in node, as tests do today)
that pits each calling and gear tier against each room kind and keeper:
time to clear, Light lost; targets per floor in `docs/balance.md`.

### P3. Onboarding

Extend the tutorial (`Coach`): a first visit to the Reaches that teaches
perch, harvest swathe, cast, resonate, the bag, and leads to the Home Isle;
a first Windspire F1 run with a guide spirit; the Gathering's first visit
shows emote and call. Each lesson ≤ 30 s, skippable.

### P4. Accessibility

Colour-blind palettes for rarity and telegraphs (shape and pattern cues
too), assist options (wider reel band, longer telegraphs, auto-darts,
slower Murk), remappable everything (`bindings.ts`), subtitles for NPC
babble and sound captions for important cues, reduced motion.

### P5. Performance passes

Per phase end: `__bench` all scenes at Q0–Q2 in a focused window,
Chrome performance profiles saved to `docs/perf/`, fix the top three costs.
Then batch land draw calls (the known "~180 of ~260" item) since the
Reaches multiply it.

### P6. Phones and tablets

Real-device passes (Android Chrome, iOS Safari, iPad): touch clusters, sheet
gestures, the reel minigame, chat keyboard, wake lock, thermal throttling
over 20 minutes (frame time drift), memory (iOS kills tabs > ~1.5 GB).

### P7. Sound and music mix

A mixing pass per region and per combat intensity; loudness targets
(−16 LUFS music, UI never above the world), loop points, ducking.

### P8. Visual consistency review

A review page `/?gallery` with every new model, node, enemy, NPC and
station side by side in three lights (day, golden hour, night) and three
biomes; fix anything that breaks the toon language (outline thickness,
band count, saturation, gold trims).

### P9. Save migrations and backups

Every table change has a migration with a `meta` version; nightly SQLite
backups on the VM (`.backup` to a dated file, keep 14); a restore drill.

### P10. Live operation

Feature flags per phase (`/api/flags`), a maintenance banner, metrics
(players per shard, actions per minute, error rates) on a simple admin
page, a changelog screen for players.

---

## Testing playbook

**Automated (every step):**

1. `cd frontend && npm run build && npm run lint && npm test`; `cd backend
   && pytest`. All pass, counts reported in the change log.
2. **Race safety:** `__raceHashes()` unchanged; a recorded ghost replays to
   the same time; the race chunk size check (F11) passes.
3. **Determinism:** world hashes (`__worldHashes()`, R1), node table hash
   (R2), dungeon layout hashes (A8), combat log replay (A1).
4. **Shared vectors:** stats (F2), protocol (G1), growth math (R5), sprite
   yields (R14) give the same results in TypeScript and Python.
5. **Server invariants:** idempotent actions, no negative counts, item
   conservation in moves/trades/market, rate limits; a fuzz test per step
   that adds action kinds.
6. **Load:** `load_shards.py` for anything touching the Gathering.

**By hand (every step with looks or UI):**

1. Dev server, a focused browser window. `/?reaches&test`,
   `/?run=<seed>&test` (combat test tools added in A1: `__combat.spawn`,
   `__combat.god`, `__windspire.room(kind)`), `/?gathering` with a second
   window or `__social.bots(n)`.
2. Stills with `__shot` at day, golden hour, night; on a light and a dark
   map; saved to `docs/screenshots/<step>/`.
3. Breakpoints: 1280×720, 1024×768, 844×390, 667×375, 390×760, with
   `html.touch` forced for the last three; a real phone when the step
   touches touch input.
4. Input: keyboard, mouse, gamepad, touch for every new action.
5. Performance: `__bench(q, scene)` at Q2, Q1, Q0; compare to the budget;
   watch the `?perf` overlay for 5 minutes for heap growth.
6. Sound: listen at low and high volume; no clipping, no clicks, nothing
   repeating annoyingly over 2 minutes of play.
7. Write what wasn't checked in the change log, honestly (rule 5).

## Enhancement playbook

After a step works, one **polish pass** before calling it done, then
later passes from playtests. A polish pass goes through this list:

1. **Anticipation and follow-through:** does every action have a wind-up,
   an impact, and a settle? Add one frame of squash, one of stretch.
2. **Secondary motion:** capes, scarves, leaves, hair, ribbons, ropes,
   lanterns: does something sway in response?
3. **Juice ladder:** small success (a sparkle and a tick), medium (a ring
   and a chime), big (bloom, a chord, a gentle camera move), huge (a title,
   a music sting, motes rising). Is each event at the right rung?
4. **Light guides the eye:** is the thing to look at the brightest? Is
   anything bright that shouldn't be?
5. **Sound layers:** a transient, a body, a tail; randomized; spatial.
6. **Readability at Quality 0 and on a phone:** silhouettes, telegraphs,
   text sizes.
7. **Idle life:** what does the thing do when nothing happens?
8. **Feedback timing:** feedback within one frame of the input (prediction),
   server corrections invisible.
9. **Cost check:** what did the polish add to draw calls, particles, ms?
10. **Style check:** "would this fit in Genshin or Sky?" Show it next to the
    existing pilot in `/?gallery`.

Playtest loop: 5 players, 20 minutes, watch silently, note where they
hesitate, smile or get lost; fix the top three; repeat. Keep notes in
`docs/playtests/<date>.md`.

## Decisions to take before starting

- **D1. Zen's place.** ✅ Decided 2026-10-15: on the Explore page as "Zen
  flight" beside the Reaches (four emblems on the landing page). `ZenSession`
  is not changed.
- **D2. Explore's URL and the dev flyer.** Proposed: the new mode is
  `/?reaches` and the menu's "Explore"; today's `/?explore=<biome>` stays a
  dev tool. Alternatively rename the dev tool to `/?fly=<biome>`.
- **D3. Sky Isles in the Reaches.** Its race generator is frozen, and Zen
  skips it for that reason. The Reaches can either skip it too, or use a
  *copy* of its look (decor and palette) on generator v2 for the Old Isles,
  never touching `skyIsles.ts`.
- **D4. One world or many.** This plan uses one fixed world seed for all
  players (needed for shared places and the node table). Personal seeds
  would be possible only for the Home Isle.
- **D5. Accounts.** Trading and markets make accounts worth stealing:
  decide whether today's profile identity is enough or a login (email link
  or OAuth) comes first (before G8).
- **D6. Server scale.** Python + SQLite is enough for a hackathon and a
  few hundred players. Beyond that: shards in a separate process (or Go/Node)
  and Postgres. The protocol (G1) is written so the shard server can be
  swapped.
- **D7. Combat in Adventure by default?** Proposed: yes for new runs, with a
  "Classic run" toggle that keeps today's adventure exactly (good for
  players who came for flying, and for comparing balance).
- **D8. Free-to-play economy.** No real-money purchases are planned; keep it
  that way (no pay-to-win in a game with trading).

## Suggested order

1. F1–F4, F7, F9, F11 (foundations), F12 (menu).
2. R1, R2, R3, F5, F6, R19, R20 (an explorable world with a hub).
3. R5, R6, R7, R8 (the four gathering skills), R9, R4, R14.
4. A1–A5, A20 (combat in Skyways), A6, A7.
5. A8–A12 (the Windspire), A13–A17, A19.
6. G1–G6, G16 (live hub), G8–G10 (trading and markets), G7, G11–G15.
7. R10–R13, R15–R18 (enchanting, runes, teas, NPCs, taming, carpentry,
   lights, time).
8. A18, G14 (party dungeons).
9. P1–P10 throughout, P5/P6 at the end of every phase.

---

## Appendix: Survival feature map

| Survival | Here | Step |
| :--- | :--- | :--- |
| Private Island | Home Isle | R4 |
| Hub, villages | Lanternhaven | R3 |
| Farming, Jacob's contests, Garden visitors | Sky gardens, Harvest Contest, visitors | R5 |
| Foraging, Park | Canopy foraging, Lantern Wood | R6 |
| Mining, Dwarven Mines, Crystal Hollows, HotM, gemstones | Veins, the Hollow Deeps, Heart of the Deeps, gems | R7, A14 |
| Fishing, sea creatures, trophy fish | Tide/cloud/deep fishing, legendary chases, trophies | R8 |
| Collections | Field Guide collections | R9 |
| Enchanting, experiments, anvil | Star Loom, constellation memory, Mending Bench | R10 |
| Runecrafting | Wind runes | R11 |
| Alchemy, potions | Tea brewing | R12 |
| NPCs, quests | Townsfolk, notice board | R13 |
| Minions | Sprites | R14 |
| Taming, pets | Companion bonds | R15 |
| Carpentry | Hearthcraft | R16 |
| Fairy souls | Lost Lights | R17 |
| Seasons, calendar | World clock, weather, seasons | R18 |
| Combat skill, mobs | Purification, Murk | A1–A5 |
| Weapons, armour, item abilities | Weapons, mantles, abilities | A6 |
| Dungeon classes | Callings | A7 |
| Catacombs, rooms, puzzles, blood room | The Windspire, room kinds, puzzles, Lantern Room | A8–A10 |
| Floor bosses | Keepers | A11 |
| Dungeon score, reward chests | Grade, reward lanterns | A12 |
| Essence, stars | Wind Essence, stars | A13 |
| Reforges, accessories, magical power | Tempering, charm string, Resonance | A14 |
| Slayer | Tempest Hunts | A15 |
| Master Mode | Master Windspire | A17 |
| Dungeon parties | Party runs, party finder | A18, G14 |
| Bazaar | Market hall I | G9 |
| Auction House | Market hall II | G10 |
| Trading | Trades | G8 |
| Guilds | Flocks | G11 |
| Co-op islands, visiting | Co-op isles, visits | G7 |
| Mayors and elections | Wind Council | G13 |
| Events (Spooky, Jerry's, etc.) | Whale migration, Starfall Night, Kite Festival, Lantern Release | G12 |
| Survival level | Wind Rank | F4 |
