# CLAUDE.md: read this first, every session

This file is Claude's memory for Wind Rider. Claude Code loads it
automatically at the start of every session in this repository. Read it all
before touching code, and keep it true.

It is a **summary**. The full previous version (detailed architecture rows,
every change-log entry up to 2026-10-12, the long follow-up list, the design
plans) is archived in [`docs/archive/CLAUDE-2026-10-13.md`](docs/archive/CLAUDE-2026-10-13.md),
called "the archive" below. Look there when you need the detail behind a
summary line; add new things here.

## The most important point: Genshin Impact and Sky (光遇)

**Wind Rider is a Genshin Impact and Sky: Children of the Light styled game.**
Every model, animation, effect, screen and piece of UI goes in that
direction. When in doubt, ask "would this fit in Genshin or in Sky?", and if
not, change it.

- **Models:** cel-shaded (`toonMaterial`: three light bands, rim light, ink
  outlines), chibi-to-anime proportions, soft rounded silhouettes, warm
  saturated colors with gold trims, capes, scarves, feathers. No realistic or
  gritty assets, no photo textures.
- **Animation:** floaty and expressive (Sky's gliding, Genshin's wind glider):
  springy leans, flowing cloth, wingbeats with anticipation and
  follow-through, cute reactions. Even crashes stay gentle and end in light.
- **Aesthetics:** painted skies, light motes, bloom on what matters,
  golden-hour and moonlit moods, vast peaceful spaces. Light and color guide
  the player.
- **UI:** soft glass panels, rounded shapes, gentle motion; never cluttered.

## Rules for working on this project

1. **Read this file first**, then the files the task touches. The README
   covers players and deployment; this file covers how the code fits together.
2. **Always record what you changed**: a dated [Change log](#change-log) entry
   (what, why, which files, how verified; note what you couldn't verify).
3. **Always record what is still to do** in [Next up](#next-up) or the
   plans. Remove items when done and say so in the log.
4. **Keep docs in step with code**: new modules, controls, tuning knobs or
   endpoints update the README tables and the [architecture map](#architecture-map-frontendsrc)
   in the same change.
5. **Verify before you claim**: `npm run build` and `npm run lint` in
   `frontend/` (plus `npm test`), `pytest` in `backend/` when it changes. Look
   at visuals in a browser ([Checking visuals](#checking-visuals)). Report
   failures as they are.
6. **Looks never change gameplay.** Animation, particles, shaders and camera
   must not change the flight model, collisions, ring checks or timing
   (leaderboards and ghosts depend on it). Gameplay changes go through
   `flight.ts`, `World` and `Game.step`, deliberately. Adventure-only rules
   reach the flight only through `FlightMods` / the run controller.
7. **Performance budget:** 60 fps on an integrated laptop GPU at High.
   Instancing, one draw call per effect family, work in shaders, no per-frame
   allocations. Heavy things need a quality level (`QUALITY` in `Game.ts`)
   and respect `particles.budget`.
8. **Everything tunable** goes in `tuning.ts` (looks) or `FLIGHT` in
   `flight.ts` (physics), so it shows in the `?tune` panel.
9. **Git: always as the user, never as Claude.** Never commit or push as
   Claude, and never list Claude as an author, co-author, contributor or
   collaborator anywhere in git (no `Co-Authored-By: Claude` trailers, no
   "Generated with Claude Code" lines in commits or pull requests). Commits
   and pushes are made as the user's own git identity, unless it is taken from
   someone else, in which case see below.
10. **Credit other people's work, in git.** Moving peoples work to another 
   branches need to keep the original author as the commit's author.

## The project

**Wind Rider** (renamed from Wingrace on 2026-10-10, storage keys included;
the landing logo reads "WindRider") is a browser wingsuit racer in the style
of Superflight, grown into a roguelike flying adventure. Every course is a
seeded racing line through floating islands or a biome's landscape, with
crystal gates. Modes: Racing (time trials, multiplayer race rooms), the
eight-level Adventure (runs) with upgrades, items, lives and a persistent
profile/economy, and Zen (one open, endless map). Built for the VIScon hackathon: React + Three.js frontend,
FastAPI backend behind Caddy, all in `docker compose`.

### Running it

```bash
docker compose up --build            # http://localhost:8080
# development:
cd backend && python app.py           # :8000
cd frontend && npm install && npm run dev   # http://localhost:5173, proxies /api
```

| URL | What |
| :--- | :--- |
| `/?seed=42` (`&tune`) | Time trial on seed 42 (with the tuning panel) |
| `/?run=<seed>` | An adventure run |
| `/?explore=<biome>&seed=<n>` | Fly any biome freely, nothing saved |
| `/?zen=<seed>` | Zen: the seed's map as an endless open world (never Sky Isles) |
| `/?test` (or `&test` on any single-player URL) | Test mode: the real adventure screen (`RunScreen` + `RunSession` with `test`), endless lives, a fitting room and an item/ability shop; Shift+P portal, Shift+O victory, Shift+S half speed, Shift+I items; nothing saved (`docs/debug-mode.md`) |
| `/?gallery` | Every item model and the pilot's item animations |
| `/?ui` | The UI primitives and sound families (F7, F9), with phone/laptop frames and light/dark maps |
| `?perf` on any game URL | The performance corner panel (F11) |
| `/?tutorial` | Ask the newcomer question anyway |

- **One map pool for every mode:** a seed stands for one map (`seedMap`:
  biome and mood; `seedLevel(seed)`), the same in time trials, rooms and runs.
  A run flies eight different maps (`runOrder`); every mode picks in
  `MapSelect`.
- **Sky Isles' generator is frozen:** `__raceHashes()` (`docs/dev-snippets.js`)
  must keep returning the listed tree/dist/ring hashes. Other biomes may
  still change.
- Dev builds expose `window.__game`, `__fxTime`, `__tuning`, plus the
  devtools in `game/devtools.ts` (`__shot`, `__bench`, `__run`, `__crash`,
  `__portal`, `__itemShot`, `__game.grant(id)`).
- Node 22+ locally (22.14 needs an async `module.register` resolver for
  tests; see the archive's change log), Node 24 and Python 3.14 on the VM.

### Architecture map (frontend/src)

One line per area. The archive's "Architecture map" has the full rows (what
each module exposes, its tuning groups, its quirks).

| Path | What it does |
| :--- | :--- |
| `game/Game.ts` | Frame loop, fixed 120 Hz physics, race state, ring checks, HUD data, effects wiring, rendering (bloom/FXAA), adaptive quality, `?tune` |
| `game/flight.ts` | Arcade energy-based flight (`FLIGHT`), the pilot hitbox (`touching`, `hitboxWorld`), run-only `FlightMods` and abilities' flight hooks |
| `game/avatar.ts`, `toon.ts` | The cel-shaded chibi pilot, cloth, wings, face, two styles (`setStyle`), all its animation; the toon material and ink outline |
| `game/wingRig.ts` | How wings move, by rig (`feather` bird-like skinned primaries, `sail` flexing membrane, `jointed` servo plates, `rigid` one piece): `articulate(rig, parts, side, drive)`; climbing beats harder, diving folds |
| `game/achievements.ts` | 37 achievements (once / progressive tiers / hidden), the per-browser tracker (`achievements.record/best/unlock`), fed by `Game`, `RunController` and the sessions when `GameOptions.track` |
| `game/pilotfx.ts`, `particles.ts`, `trail.ts`, `speedlines.ts`, `effects.ts` | Pilot ribbons/motes/puffs, the one GPU particle system (soft kinds plus crisp shapes: feather, snowflake, petal, sparkle, ring, cog, triangle, hex, scale, maple, star, confetti), trails (Catmull-Rom ribbons), wind streaks, crash feathers |
| `game/camera.ts` | Chase camera and the crash fall camera (`CAMERA`) |
| `game/tuning.ts` | Every look constant, slider ranges, localStorage persistence |
| `game/input.ts`, `bindings.ts`, `touch.ts` | Keyboard (layout-aware), mouse, gamepad, touch stick/buttons; bindings; phones' touch mode |
| `game/autopilot.ts`, `glidein.ts`, `hold.ts` | On-rails flight along the racing line; glide-in while land loads; overlays that pause the game |
| `game/death.ts` | Crash classification and rigid-body tumble (looks only) |
| `game/audio.ts`, `music.ts` | Synthesized sounds, wingbeat sample, per-biome music crossfade |
| `game/pilots.ts`, `ghost.ts` | Remote players and ghosts; ghost recording (15 Hz) |
| `game/run/` | The roguelike: `run.ts` (order, scoring, lives), `controller.ts` (levels, portals, lives, HUD), `upgrades.ts` (31 upgrades), `abilities.ts` (abilities' rules), `items.ts`/`pickups.ts` (26 items, bag, seeded pickups), `charm.ts`, `orbs.ts`, `collection.ts`, `portal.ts` (portal, wormhole), `finale.ts` |
| `game/abilities/` | Looks of the 20 abilities (`models.ts`/`fx.ts` for 1–10, `models2.ts`/`fx2.ts` for 11–20) |
| `game/items/` | Item models, equipment slots, gallery, item/relic FX, pickup rendering; `clearance.ts` (lazy chunk): carried items as solid voxel grids (`Clearance`) and the back item's front for cloth (`FrontMap`); `Equipment` reports settled items to `Avatar.carry`, whose `clearWings` turns each wing at the shoulder out of them |
| `game/collection/`, `cosmetics/`, `pets/` | Rarity palette, powers (`POWERS`), collection FX and sounds; capes/hats/shoes/wings (each wing has a `rig`, `size` and `rarity`; `cosmetics/wingParticles.ts` holds each pair's particle layers, richer by rarity); particle jars (`JARS` in `catalog.ts`; `jars.ts`, a lazy chunk via `jarLoader.ts`: recipes, `JarMotes` aura/in-jar swarm on the shared `SHAPES_GLSL`, `buildJar`; `PilotFx` draws the worn jar's aura and trail); twelve pets, their companion orbit and rare pets' flourish |
| `game/world/open.ts` | Zen's open world: the endless field a Zen map streams |
| `game/world/World.ts`, `WorldView.ts` | A level's course, rock, trees, palette and distance queries; its meshes, streaming, sky, gates |
| `game/world/biomes/` | Biomes as data; `MAPS`, `seedMap`, `seedLevel`, `runLevel`, `featuredSeed`, `skyIslesLevel`; `skyIsles.ts` (frozen), `reef.ts` |
| `game/world/terrain/` | Generator v2: noise, SDF shapes, ground, river steps, `TerrainField`, recipes, surface-nets meshing, LOD `LandStreamer`, terrain shader |
| `game/world/islands.ts`, `mesher.ts`, `meshCleanup.ts` | Sky Isles' rock field and workers; worker-side mesh cleanup |
| `game/world/landCollider.ts` | Collisions with exactly the land drawn |
| `game/world/flora/`, `structures/`, `trees.ts`, `itemClearance.ts` | Vegetation, 21 structure kinds, colliders, adventure pickup groves |
| `game/world/atmosphere.ts`, `palette.ts`, `water.ts`, `deep.ts`, `clouds.ts`, `crystals.ts`, `course.ts` | Sky/haze shaders, moods, water, underwater life, clouds, crystal gates, the racing line |
| `game/testPlayback.ts`, `devtools.ts`, `webgl.ts` | Test-mode time scaling, dev helpers, WebGL check |
| `session/`, `net/` | Solo, room, explore, run (and test: `RunSession` with `test`) and Zen sessions; server clock and room connection |
| `profile/` | Profile client, balances, pickup and run-report outboxes, market, wheel, public pages |
| `components/` | React screens: menu (four mode emblems: Racing, Adventure, Explore with Zen flight, Gathering; a page per mode; `MenuMotes` canvas of light motes), `MapSelect`, HUD, `RunHud` (laid out by `RunLayout.css`: touch layout, pause blur), journal (`ProfilePanel` with `FieldGuide` and `AchievementsView`; `AchievementToast`), market, Hall of Winds, settings, help, tutorial (`Coach`), previews, test mode's `TestCollectionPanel` |
| `catalog.ts`, `catalog.gen.ts`, `worldUi.ts` | The open world's shared catalog (`shared/catalog/*.json`, plan F1) with types generated from its schemas (`npm run catalog`); `worldUi` tells App when to load the open world's overlays (lazily: races never carry them) |
| `game/stats.ts`, `game/skills.ts` | Stat math (F2: bases/caps in `stats.json`, sums in exact 1/10 000 units) and skill levels, wisdom, Wind Rank (F4); mirrored by `backend/stats.py`/`skills.py`, both run `shared/catalog/tests/*-vectors.json` |
| `game/inventory/` | The persistent inventory's client (F3): `model.ts` (shapes, stack rules, `predict`), `outbox.ts` (`InventoryClient`: predict, localStorage outbox, flush every 2 s, reconcile; `inventoryClient()`), `dev.ts` (`__inv.grant/xp`) |
| `components/world/` | Open-world UI: `StatSheet`, `SkillEmblem` (+ `emblems.ts`), `SkillToast`, `LevelUpCard`, `SkillsView` (journal page), `WorldOverlays`, `ItemCard`, `itemIcons` (kind signs until F8), `MapSheet` + `RegionTitle` (R1) |
| `game/reaches/` | The Reaches (plan R1, part 1): `regions.ts` (`regionWeights`: up to three places sharing a point, mirrored bit for bit by `backend/regions.py`, shared `region-vectors.json`), `discovery.ts`, `mapPaint.ts` (the map's watercolour) |
| `components/ui/` | UI primitives (F7): `Sheet` (side/centre/bottom by `breakpoint`), `Grid` + `Slot` (pointer drag, touch long-press, keyboard lift/put, cross-grid), `Tooltip` (`TipCard`/`TipBottom`), `RadialMenu` (a modal dialog), `HoldButton`, `Tabs`, `Counter`, `ToastHost` + `toastQueue`; `gamepad.ts` (layered pad navigation), `nav.ts`/`dnd.ts`/`motion.ts` (pure, tested), `strings.ts`; `dev/UiGallery` + `SoundLab` = `/?ui` |
| `game/audio/` | F9: `buses.ts` (six buses, `duck`; made by `GameAudio` in every game), `engine.ts` (`AudioEngine`, `pageAudio`, `busVolumes`; loaded on demand by `GameAudio.loadEngine()`), `pool.ts`, `families.ts` (synth recipes by family), `spatial.ts`, `samples.ts` (sheet loader; no sheets yet), `ambience.ts` (beds per region) |
| `game/perf.ts`, `perfFlag.ts`, `benchScenes.ts` | `?perf` meter (loaded only with the flag; `perf.count(name, n)` for systems), the bench's named scenes (placeholders until R5, A8/A9, G2) |
| `theme.ts`, `route.ts`, `media.ts`, `staleBuild.ts` | UI colors per map (`--ink`, `--tint`, and `data-sky` light/dark from `darkSky`), URL ↔ screen, media toggles, reload after redeploy |

**Backend** (`backend/`): `app.py` endpoints, `rooms.py` race state machine
and 15 Hz SSE relay (host restarts; race called 60 s after first finish),
`store.py` SQLite runs and ghosts, `profiles.py` profiles/economy/market,
`models.py`; for the open world `catalog.py` (loads and checks `shared/catalog`
at startup), `inventory.py` (stacks, gear, the crystals' wallet, idempotent
actions, `/api/inv`), `stats.py`, `skills.py`. `DEV_TOOLS=1` allows granting.
Players never collide; the server only relays positions. Both Docker images
build from the repo root so they can copy `shared/`.

### Key mechanics

Summaries; the archive's "Key mechanics" has the details.

- **Flight:** nose points where you go; gravity along the path trades speed;
  drag caps it; bank turns; skimming rock scores style. Crash = respawn at the
  last ring (clock running). Boost/brake are universal; dodge is an 8 m sidestep.
- **Collisions:** body ball + two wing rectangles (`FLIGHT.hit*`) against the
  land **as drawn** (`LandCollider`, with sweeps); trees, water, sea by
  distance field; the field stands in where land isn't on screen.
- **Rendering:** physics interpolated, avatar animated on top. High = bloom
  (HDR, no MSAA, FXAA after; only colors above `FX.bloomThreshold` 1.3 bloom).
  Shaders precompiled for the actual target (`Game.compileShaders`).
- **Biome light:** `ATMOSPHERE`, `TOON_LIGHT`, `FX_LIGHT.boost` are set per
  palette. New lit materials hook into these, never hard-coded colors.
- **Shader safety:** never `pow()` something that can go negative, never
  divide by something that can reach zero. One NaN blacks out the bloomed frame.
- **Adventures only (rule 6):** collection powers, the charm, stamina orbs (no
  natural boost recharge in runs), unlock levels, harder levels
  (`LevelKey.difficulty`). Races never see any of it.
- **Quality levels:** 2 = bloom; 1 = no bloom, ≤1.5× DPR, MSAA; 0 = 1× DPR,
  40% particles. `adaptQuality` only steps down.
- **Arriving land** fades in out of the haze (`TERRAIN.fadeIn`); LOD swaps don't.

### Checking visuals

No visual tests: run the dev server and look. Automation tabs are hidden and
throttled, so frame rates there mean nothing; measure in a focused window.
Use `__shot(view, ms)` for reproducible stills (`0` behind the start, `1`
above it, or `{along, height, side, ahead}`) and `__raceHashes()` to check the
race map hasn't moved. Details in the archive's "Checking visuals".

## Items and abilities

The design list (given 2026-10-10): 20 items and 20 abilities, **all done**,
run mode only. Full tables with each one's description are in the archive's
"Items and abilities (the design list)". Items are carried in a three-slot
bag (`run/items.ts`); abilities are portal upgrades (`run/upgrades.ts`,
`run/abilities.ts`). Added 2026-10-14 beyond the list: six items (Wind-Drinking
Gourd, Jade Foresight Talisman, Oil-Paper Umbrella, Golden Koi Charm, Paper
Crane Guide, String of Firecrackers) and three upgrades (Guardian Gale, Gourd
Breath, Cloud Cushion); the foresight/guard steers through `Autopilot` in
`Game` for `ITEM.guardTime`.

## Plans (summaries)

- **Roguelike milestones 1–5:** all done (biome format, terrain v2, Verdant
  and every biome, the run loop, polish). See the archive's "Roguelike milestones".
- **Roadmap:** procedural worlds (landforms, water, vegetation, materials,
  clouds, streaming), deeper flight (thermals, wind currents, boost rings,
  slipstream), the roguelike loop with sidequests and a meta layer. See the
  archive's "Roadmap".
- **Biomes:** Sky Isles, Verdant Highlands, Glacier Peaks, Sky Archipelago,
  Coral Lagoon, Twilight Forest, Ember Wastes, Sunken Reef, Aurora Summit, all
  built. Signature landmarks/structures per biome: steps 1–3 done, step 4
  (night lights, moving parts, day/night check) partly. See the archive's
  "Biome proposals and construction plan" and "Structures per biome".
- **Parked:** feathers-as-sidequests and the sidequest framework live on
  branch `Pengyue-feathers-sidequests`. More ideas: `docs/feature-ideas.md`,
  `docs/infinite-mode-prototype.md`; the economy: `docs/adventure-profile.md`.
- **Open world (planned 2026-10-15; F1–F4, F7, F9, F11, F12 done 2026-10-15; D1 decided):**
  [`docs/open-world-plan.md`](docs/open-world-plan.md). (Its reference game
  is now written "Survival" throughout, as asked.) Explore becomes the
  Reaches (a persistent world with farming, foraging, mining, fishing,
  enchanting, runes, teas, sprites); Adventure keeps its run and gains combat
  (Murk purification, callings, the Windspire dungeon, keepers); a fourth
  mode, the Gathering, is live social play (shards, emotes, hands, trading,
  markets, flocks). Phases F, R, A, G, P in steps meant to be picked up
  cold. D1 decided: Zen is "Zen flight" on the Explore page; D2–D8 open.

## Change log

Add new entries at the top, dated.

### 2026-10-17: Open world: R1 part 1, the Reaches' region map, the map sheet and discovery (Claude)

Asked for: carry on with the open world after the jars. Next in the plan's order is R1 (six days: the region map,
a world blending every region's biome, a floating origin, the map). Done now, whole and tested: the region map
both sides, discovery and the painted map. Not done: the blended world, the floating origin and `/?reaches`
(listed under R1's "As built" in the plan and in Next up). That part reworks the generator (one biome per level
today: ground spec, shapes, palette uniforms, flora, water level, worker keys), so it was left for a session of
its own rather than rushed.

- `shared/catalog/regions.json`: `seed` (the world seed) and `borders` (band 300 m, hub band 200 m, warp 280 m
  over 1100 m), schema and `backend/catalog.py` updated; `catalog.ts` exports `WORLD_SEED`, `REGION_BORDERS`.
- `game/reaches/regions.ts` + `backend/regions.py`: `regionWeights` (two nearest surface regions blending over
  the band, Lanternhaven or the open sky taking a smooth share on top: up to three places, weights summing to 1,
  continuous everywhere: no weight moves more than 0.08 over 7 m anywhere in the world). Bit-for-bit equal in
  both languages by construction (no trig; integer hash; IEEE + − × ÷ floor sqrt): `region-vectors.json`
  (68 points and 4 hashes) generated by `shared/catalog/tests/make-region-vectors.mjs`.
- `reaches/discovery.ts`, `reaches/mapPaint.ts`, `components/world/MapSheet.tsx` (+ css; labels sized to the
  paper with container units, a taller paper on short screens) and `RegionTitle`; a map section in `/?ui`.

Files: `shared/catalog/{regions.json,schema/regions.schema.json,tests/region-vectors.json,
tests/make-region-vectors.mjs}`, `backend/{catalog,regions}.py`, `backend/tests/test_regions.py`,
`frontend/src/{catalog.ts,catalog.gen.ts}`, `game/reaches/*`, `components/world/{MapSheet.tsx,MapSheet.css}`,
`components/ui/dev/{UiGallery.tsx,UiGallery.css}`, `tests/regions.test.mjs`, README, the plan (R1 "As built").

Verified: `npm run build` (first load +0.0 kB: it all lands in the lazy `reaches` chunk), `npm run lint`,
`npm test` (214 pass), backend `pytest` (202 pass: 73 new). In Chrome, `/?ui`: the discovery card, the map at
1512×835 and in the 844×390 frame (labels overlapped there at first; fixed). Not verified: the map on a real
phone or with a gamepad, and on a dark map (the paper is always light).

### 2026-10-17: Particle jars, carried items clear of cape and wings, 30% more wing particles (Claude)

Asked for: (1) a special particle cosmetics class shown as different particles in jars, each jar one unique
type, equipping it adds an aura and a trail behind the player, glowing or not by rarity (Minecraft's particle
variety as the reference); (2) carried items (e.g. the rocket) must not clip through cape or wings; (3) 30% more
wing particles; then carry on with the open world.

- **Jars** (new kind and slot `jar`, emptiable like pets): `JARS` (17: 4 common, 4 uncommon, 5 rare, 4
  legendary) in `cosmetics/catalog.ts`, `Appearance.jar` (`JarSlot`, default `none`), backend catalog entries
  (`kind`/`slot` `jar`, `CLEARABLE`, `COSMETIC_KINDS` in treasure pools, the equip slot regex). `cosmetics/jars.ts`:
  each jar's recipe (one particle kind and palette, a motion: drift, rise, fall, orbit, inward, spiral, jitter,
  hang; trail rate/size/life/gravity), `jarLook` (glow from rarity 2; aura motes 10/14/20/28; trail ×1–2.2;
  legendary "hero" pieces), `JarMotes` (one `THREE.Points`, positions worked out in its shader from the time,
  in its parent's frame; pixel scale from the view in `onBeforeRender`), `buildJar` (toon glass painted by
  `Builder`, cork, gold rim, inked glass foot, ribbon bow, the swarm inside, a soft lamp in glowing jars).
  `PilotFx` puts the aura on `avatar.group` and streams the trail (solid jars into the alpha-blended system,
  glowing ones as added light × `JAR_FX.glow`). Nine new crisp particle kinds in `particles.ts` (Heart, Note,
  Flame, Drop, Cloud, Bolt, Glyph, Swirl, Soul; they sway instead of spinning or tumbling); the shape code is
  now `SHAPES_GLSL`, shared by the particles and the jars. `JAR_FX` in `?tune`. Journal (Jars sub-tab, "Put the
  jar away"), fitting room, field guide, icons, sandbox, collection model (built lazily, an invisible box keeps
  its size for fitting).
- **Clearance:** `items/clearance.ts` voxelises a carried item (2.5 cm cells, flood-filled solid, one cell of
  margin, cached per item id). `Avatar.carry(slot, id, group)` (Equipment calls it each frame with what has
  settled in the back and hand slots) keeps: the cape and scarf in front of the back item (`FrontMap`, a softened
  front surface in the chest's frame, applied after the legs' push and again after the scarf is lifted over the
  cape); and the wings out of every carried item (`clearWings`: ~3 cm samples per wing on their parts or dominant
  feather bones, a world-space turn at the shoulder about the axis that lifts the wing off the back, searched
  from last frame's angle, either way; ~0.1–0.25 ms a frame measured in node). The rocket sits 6 cm further back
  (`HOLD.back`). Looks only; the hitbox is untouched.
- **Wing particles +30%:** `COSMETIC_FX.wingParticles` 22 → 28.6, downstroke fans 6/14 → 8/18.
- Fixed on the way: every collection preview's canvas grew past its 190 px box (a grid row sized to the canvas'
  own pixel height), cropping tall models; it is pinned to the box now.
- Bundle: jars (4.2 kB) and clearance (2.0 kB) are lazy chunks; the first load still grew 5 kB gzipped (the jar
  catalog, the shapes in the shared particle shader, the solver), accepted with `npm run bundle:accept` (513.6 kB).

Files: `frontend/src/game/{avatar,pilotfx,particles,tuning}.ts`, `game/cosmetics/{catalog,storage,sandbox,jars,
jarLoader,wingParticles}.ts`, `game/items/{clearance,equip}.ts`, `game/run/collection.ts`, `game/collection/icons.ts`,
`profile/{client,types}.ts`, `components/{ProfilePanel.tsx,ProfilePanel.css,CollectionPreview.tsx,
TestCollectionPanel.tsx,FieldGuide.tsx,kindIcons.tsx}`, `bundle-budget.json`, `tests/{clearance,jars}.test.mjs` (new),
`tests/{appearance,pilotfx,wardrobe,itemfx}.test.mjs`, `backend/{profiles,models}.py`, `backend/tests/test_profiles.py`,
README.

Verified: `npm run build` (bundle check after accepting), `npm run lint`, `npm test` (209 pass, was 203), backend
`pytest` (129 pass, was 128). A node harness (scratch, not committed) flew all 17 wings through 16 poses at two
speeds with the rocket on: before, the cape went 7–10 cm and the wings 2–10 cm into it; after, nothing touched
but a few grazes of up to ~2 cm (by a rough measure) in the run-only climb and sing stances (astral, frost, storm,
cardboard); every hand item against classic, seraph,
butterfly and wyrm wings: clear (17 touched the butterfly wings with the solver off). In Chrome (`/?test`): every
shader program compiles and runs with all 17 jars worn (both materials, all nine new shapes); a contact sheet
of the rocket on the back in eight poses from above and the side (classic, seraph); the fitting room's jars
(after fixing a black glass and the cropped preview); hearts (solid), totem and souls (glowing) auras and trails
in flight. Not verified: the journal with a real profile (no backend running), every jar's look by night and in
motion at speed, frame rates in a focused window, phones.

### 2026-10-15: Open world: F7 UI primitives, F9 audio buses, F11 lazy chunks and perf harness, F12 four-mode menu (Claude)

Asked for: continue the open-world plan. Asked D1 first: Zen goes on the Explore page. Then the
suggested order's remaining foundations:

- **F7 UI primitives** (`components/ui/`): `Sheet` (a modal `<dialog>`, so focus trap and `inert`
  come free; side sheet on wide, centred on medium, bottom sheet with a drag-to-close handle on compact
  and short; one scroll; Escape/B/close/backdrop; holds the game), `Grid`/`Slot` (rarity frames,
  counts, cooldown sweep, lock; mouse drag after 6 px, touch long-press 350 ms then drag with scrolling
  blocked, tap for a bottom card, keyboard arrows + Enter lift/put + Escape, across grids), `Tooltip`,
  `RadialMenu` (4–8 wedges; pointer, thumb release, arrows, 1–8, right stick, A/B), `HoldButton`,
  `Tabs`, `Counter`, toast queue. `gamepad.ts`: a stack of nav layers, D-pad/stick offered first as
  arrow keys, else spatial focus (`nextFocus`). Strings in `ui/strings.ts`. `components/world/ItemCard`
  and kind-sign icons until F8. `/?ui` (route `ui`, lazy): every primitive, frames at 1280×720 …
  390×760 (iframes, touch on), light/dark map.
- **F9 audio** (`game/audio/`): six buses with ducking; `GameAudio` now routes effects → `world`,
  music → `music` (their own volume nodes unchanged), the four new buses take the settings' new
  **Mixer** sliders (`ambienceVolume`, `uiVolume`, `combatVolume`, `voiceVolume`, shares of effects;
  menu chimes follow `uiVolume`). The engine (pool, recipes, panners, sample bank, ambience) is a lazy
  chunk (`GameAudio.loadEngine()`), so races carry only the buses. No sample files exist yet: every
  family plays its synthesized recipe. Spatial quality follows `Game.setQuality`.
- **F11**: `codeSplitting` groups for the four future mode folders; `build.manifest`;
  `scripts/bundle-check.mjs` at the end of `npm run build` + `tests/bundle.test.mjs`;
  `bundle-budget.json` baseline 507.7 kB gzipped taken after F7/F9/F11 (their first-load growth was
  estimated from a source map at well under 2 kB: `buses.ts` 0.7 kB minified plus small edits; the perf
  meter was moved out of the main chunk to keep it so). `?perf` overlay (fps, frame/step ms, calls and
  triangles over the whole frame against §4's budget, particles via `Particles.alive()`, voices,
  network kB/s from finished requests, heap). `__bench(q, scene)` with three placeholder scenes; it now
  also reports step ms, particles and heap growth.
- **F12**: four emblems (new Explore sign: leaf over a compass rose; Gathering: a ring of five
  lanterns), Explore's page (Zen flight → the old Zen page, whose Back now returns to Explore; the
  Reaches marked coming soon), the Gathering's page (coming soon, what's coming, a link to race with
  friends). 2 × 2 grid under 560 px wide, a smaller row of four on short screens. Enter on Explore
  opens Zen flight. F12 grew the first load by 0.9 kB gzipped (checked by the new bundle check).

Fixed on the way (found in the browser): a quick drag-and-release lost the drop (state read before
React drew the drag); 9 columns overflowed the side sheet; grids didn't shrink on a 390 px phone;
scripted pointers made `setPointerCapture` throw (now `capture()`); short screens' bottom sheet gave
the body little room (no badge/eyebrow there now); radial wedges too see-through.

Files: `components/ui/**`, `components/world/{ItemCard.tsx,ItemCard.css,itemIcons.tsx}`,
`components/{PerfOverlay.tsx,PerfOverlay.css,Menu.tsx,Menu.css,SettingsPanel.tsx,SettingsPanel.css,
GameScreen.tsx}`, `game/audio/**`, `game/{audio.ts,Game.ts,particles.ts,input.ts,perf.ts,perfFlag.ts,
benchScenes.ts,devtools.ts}`, `game/collection/sounds.ts`, `App.tsx`, `route.ts`, `storage.ts`,
`vite.config.ts`, `package.json`, `scripts/bundle-check.mjs`, `bundle-budget.json`,
`tests/{ui,audio,bundle}.test.mjs`, README, the plan (ticks, as-built notes, D1).

Verified: `npm run build` (bundle check +0.9 kB of 2), `npm run lint`, `npm test` (203 pass, was
180). Backend untouched (no pytest run). In Chrome (dev server): the landing page at 1512×798 and in
390×760 / 844×390 iframes (four emblems, no scroll, corners clear), Explore → Zen flight → Back →
Explore, the Gathering page; `/?ui`: mouse drag bag → storage, keyboard lift/put, hover card, side
sheet + Escape, radial pick by pointer, hold (a tap does nothing, a hold fires), counter, toasts, a
touch long-press drag and the bottom sheet in the 844×390 frame, the 390×760 frame on a dark map;
`/?seed=42&perf`: overlay (60 fps, 191 calls), audio context running through the buses,
`loadEngine()` + a chime counted as a voice, `__bench(2, "reaches-farm", 60)`, `__raceHashes()`
trees/dist/rings unchanged for seeds 1, 7, 42. Not verified: anything by ear, a real gamepad, real
phones, screen readers, frame rates in a focused window, 1024×768 and 667×375 frames.

### 2026-10-15: Open world started: plan wording, F1 catalog, F2 stats, F3 inventory, F4 skills (Claude)

Asked for: start implementing `docs/open-world-plan.md`, changing only the gamemode's name from
SkyBlock to Survival. Asked which mode: only the plan's wording, so every "SkyBlock" in the plan
now reads "Survival" (the appendix anchor too); nothing else in the plan changed but the ticks. Then
the suggested order's first steps, F1 to F4:

- **F1 catalog:** `shared/catalog/` with `items`, `recipes`, `skills`, `loot`, `enemies`, `regions`
  (the plan's ten regions on a ring around Lanternhaven), `npcs` (all twelve), `quests` (a three-quest
  board chain and two more), each with a JSON Schema in `schema/`. `check.mjs` validates shape (a small
  draft 2020-12 subset, no new dependency) then meaning (ids, references, loot weights, recipe and quest
  loops, telegraphs ≥ 0.6 s...); `types.mjs` generates `frontend/src/catalog.gen.ts` (types and id
  unions). `backend/catalog.py` does the same checks with pydantic; the meaning messages are word for
  word the same, and both suites run `tests/invalid.json` (28 broken catalogs; all 26 original cases
  gave identical error lists in both languages). The backend refuses to start on a broken catalog.
  `npm run build` runs `npm run catalog` first. Docker: both images build from the repo root (one root
  `.dockerignore`; the per-folder ones removed).
- **F2 stats:** `stats.json` (bases, caps, units, the runs-only swiftness top-speed cap of +8%; added to
  the catalog so neither side copies numbers), `game/stats.ts` / `backend/stats.py`, shared
  `stats-vectors.json`. The shuffle property test caught that float sums depend on order at a rounding
  edge: every amount now counts in whole 1/10 000 units, so order can't matter. `StatSheet` (unused
  yet, as the plan says).
- **F3 inventory:** tables `inventory` (stacks by location), `gear`, `storage_slots`, `actions`,
  `skills`, `collections`, `inventory_rev`; actions `move`/`sell`/`discard` (+ dev `grant`) each in one
  transaction, failures rolled back and recorded, replays answered from the record, per-kind rate limits;
  bag 36 slots, storage 27. The plan's "coins move into inventory as item `coin`": the game's only
  currency is crystals, so it became item `crystal` (kind `currency`) in a `wallet` location; the
  profile's balance reads and writes it, migrated once (`meta` `inventory_v1`) and lazily for stragglers.
  Client: `game/inventory/` (predict, outbox, reconcile). Craft is left for F10 as the plan says.
- **F4 skills:** `windRankShare` 0.1 in `skills.json`; `skills.py` / `game/skills.ts` (levels, wisdom
  once, Wind Rank by share of the running total), shared `skill-vectors.json`; dev action `grant_xp`
  through the real path; `Profiles.add_rank_xp`. UI: eleven constellation emblems, the skill toast (top
  left, gains add up), the level-up card (ring of light, emblem traced in gold, harp chime, unlocks; 3 s
  or a tap; compact on short screens), the journal's Skills page (a constellation; a grid when narrow or
  short) with each skill's rewards ladder. Two chimes (`skill`, `levelUp`) in `collection/sounds.ts`.
  The overlays and the Skills page load lazily; the catalog stays out of the main chunk (checked in the
  build output; it grew ~2 kB minified for the flag and lazy hooks).

Files: `shared/catalog/**`, `backend/{catalog,inventory,stats,skills}.py`, `profiles.py` (wallet,
`add_rank_xp`), `app.py`, `models.py`, `backend/tests/{test_catalog,test_stats,test_inventory,
test_skills}.py`, `conftest.py` (`DEV_TOOLS=1`), `frontend/src/{catalog.ts,catalog.gen.ts,worldUi.ts,
App.tsx}`, `game/{stats,skills}.ts`, `game/inventory/*`, `components/world/*`, `ProfilePanel.tsx`,
`collection/sounds.ts`, `tsconfig.app.json` (`resolveJsonModule`), `vite.config.ts` (`fs.allow`),
`package.json`, Dockerfiles, `docker-compose.yml`, `.dockerignore`, README, the plan (ticks, status).

Verified: `npm run build`, `npm run lint`, `npm test` (180 pass, was 158), backend `pytest` (128 pass,
was 53); `docker compose build` and the backend image loads the catalog. In Chrome (dev server, a
throwaway DB): `__inv.xp` showed the toast and the level-up card with its unlock, Wind Rank rose, the
journal's Skills page and a ladder read right at 1710×981; at 844×390 (an iframe with `html.touch`; the
window wouldn't resize) the Skills page didn't fit, so short screens now use the grid and a compact
card, then both checked again. Not verified: real phones, a dark map behind the card, the chimes by
ear, gamepad focus in the Skills page, `__raceHashes()` (no race code was touched).


### 2026-10-15: Glowing wings, glowing particle layers, wing particles by sky (Claude)

Asked for: a glow on some epic (the game's "rare", rarity 2) and all legendary wings, some of their
particles glowing, and wing particles slightly more saturated on dark maps and much more on light maps
(day Sky Isles barely showed them), same particle counts, not overdone.

- **Wing glow:** `cosmetics/wings.ts` `AURA` gives frost, ember, storm (rare) and astral, seraph
  (legendary) a toon material with `aura` (`toon.ts`, define `TOON_AURA`): the surface softly lit in a
  mix of its color and the aura color, glowing trims (`glow` attribute) burning enough to bloom, a
  bright rim at grazing angles, a slow breath, stronger at night. `TOON_LIGHT.aura` =
  `COSMETIC_FX.wingGlow`, set each frame in `Game`. `paintedModel`/`skinnedModel` take a material.
- **Glowing layers:** `WingLayer.glow` on 8 layers of those five pairs (frost and storm sparkles, ember's
  petals/sparkles and motes, astral's twinkles and hero stars, seraph's sparkles and rings): always
  added light, × `COSMETIC_FX.glowParticles`.
- **By sky:** `skyIsDark` moved into `world/palette.ts` (`theme.ts` `darkSky` is now it); `Game` sets
  `FX_LIGHT.dark`. `skyTint` (wingParticles.ts) multiplies saturation and pulls pale tints towards mid
  lightness (whites stay white): dark 1.15/0.08, light 1.6/0.34. On light skies the non-glowing layers
  go into the alpha-blended `softParticles` (`PilotFxOptions.solid`) at full color, since added light
  vanishes on a bright sky. Counts unchanged. `particles.ts`: a shape's face shading now tints its color
  in the alpha-blended system (opaque where it covers) instead of thinning its alpha (also affects the
  biomes' blended snow/leaves slightly); added light is as before.
- Knobs in `COSMETIC_FX` (`?tune`), README updated.

Verified: `npm run build`, `npm run lint`, `npm test` (158 pass). In Chrome every shader program
compiled and is runnable (the aura toon program, the particles), no errors. Not verified: the look
itself (the automation tab draws no frames): the aura's strength by day and night (watch seraph's
white bloom), solid particles on day Sky Isles, colors on dark maps, finale tunnel.

### 2026-10-15: Wing particles by rarity, softer wings, smooth rolls, calm wingtip ribbons, centred landing emblems (Claude)

Asked for: (1) richer wing particles the rarer the wings, with very varied colors and crisp, flaky
shapes (no blurred balls); (2) every wing not stiff by design flexible and sensual; (3) no hitch when
barrel rolling, every flight animation smooth; (4) the wingtip light band that turns into a half
hexagon on fast flaps (in flight and the finale tunnel) made natural; (5) the landing page's three
emblems centred on every device.

- **Particles:** `particles.ts` gained twelve crisp kinds (`Kind.Feather` … `Kind.Confetti`) drawn
  as signed-distance shapes with a ~1 px anti-aliased edge, turning, flat ones tumbling (one axis
  shrinks as they flip, the back a shade darker), keeping their size and fading late. Bubble/firefly
  range checks in the shaders tightened so the new kinds don't fall into them.
  `cosmetics/wingParticles.ts` replaces `WING_GRAIN`/`WING_FLOURISH`: each of the 17 pairs has its
  own layers (shapes, palette, rate, size, life, rise/fall, scatter); common 1 layer, uncommon 2,
  rare 3 plus a 6-piece downstroke fan, legendary 4 (incl. big slow "hero" stars/feathers) plus a
  14-piece fan. The classic pair now sheds a light feather sprinkle. Rates and sizes are multiples of
  `COSMETIC_FX.wingParticles`/`wingParticleSize` (still in `?tune`). Wings got `rarity` in
  `cosmetics/catalog.ts` (same as `backend/profiles.py`).
- **Ribbons:** the "half hexagon" was aliasing: points are stored every ~1.3 m, and a fast flap
  is a wave ~8 m long, so each half wave was three straight segments. `Trail` now draws a
  Catmull-Rom curve (4 vertices per stored segment), and `PilotFx` hands it a *settled* tip: the
  flap low-passed (`RIBBON_CALM` 0.07 s) in the body's rolled frame (`Avatar.rigMatrix`), so the
  newest end stays on the tip, fast beats leave a gentle wave and a barrel roll's spiral is exact.
- **Smoothness:** the flap rate no longer jumps 1.6× at the start and end of a roll (it eases with
  the roll); `Game.renderDodge` interpolates the roll's phase between physics steps like the body
  (a finished roll runs on to 1 instead of unwinding), and the camera's dodge correction is
  interpolated too (`renderDodgeVelocity`); boost no longer resets the wing phase to 0 nor sets
  effort to 1 in one frame (`Avatar.kick` swells it); the pose's boost/brake ease (the flight's drop
  to zero in one step on brake/exhaustion). Physics untouched (rule 6).
- **Wings:** `wingRig.ts` feather wings: the hand whips a beat behind the arm, the primaries take
  the beat as a wave (each later than the last), and gliding wings breathe slowly; sail wings: a
  stronger trailing whip, the beat travelling panel by panel, a slow billow when gliding. Jointed and
  rigid wings stay stiff by design.
- **Landing page:** `.menu-modes` uses `margin-block: auto`, centred between the title and the
  bottom row; short screens keep it (their `margin-top: 0` removed) and reserve less at the bottom.
- Tests: `pilotfx.test.mjs` mock gets `rigMatrix`, the astral test checks the new shaped grains;
  `adventure-intro.test.mjs` stub gets `prevDodgeVelocity`.

Verified: `npm run build`, `npm run lint`, `npm test` (158 pass). Landing page measured in Chrome
(emblem art centre vs viewport centre): 1710×981 514/490, 1280×720 380/360, 1440×900 472/450,
1024×1366 711/683, 390×844 452/422, 375×667 364/333; gaps above and below the row balance (216/218
px at 1710×981). Not verified: the browser extension dropped before the landscape re-measure (by
arithmetic 844×390 now fits; 667×375 may still scroll ~10 px, as before) and before any in-game
look, so the new particle shapes (the GLSL was checked by hand only, no validator here), the
ribbons, the roll and the wing motion have **not been looked at**; frame cost of the shape shader.

### 2026-10-15: Zen credit notices removed (Claude)

Asked for: remove the "Zen mode is Stella's" notices across the project,
since the git history already records who wrote it (new rule 10). Removed
the credit headers from `world/open.ts`, `session/ZenSession.ts` and
`tests/zen.test.mjs`, and the mentions in this file, `AGENTS.md` (its rule 10
now matches this file's) and `docs/open-world-plan.md` (ground rule 2 and
D1 reworded). The archives in `docs/archive/` were left as they are. Comments and docs
only. Verified: `npm run lint`, `npm test`.

### 2026-10-15: Open-world plan written (Claude)

Asked for: design ideas and an implementation guide to grow Adventure
(combat and dungeons, keeping the roguelike run) and Explore (casual skills)
into a SkyBlock-like open world, plus a fourth social mode, with performance
and small screens in mind, split into steps that can be implemented cold,
with testing and enhancement instructions. Wrote
`docs/open-world-plan.md`: art/animation/VFX/sound bible, a performance
budget per quality level, layout breakpoints, then phases F (foundations:
shared catalog, stats, server inventory with idempotent actions, skills,
perch, interaction, UI primitives, icons, audio buses, crafting, lazy chunks,
menu), R (the Reaches: regions on Zen's cell streaming, nodes, the
Lanternhaven hub, Home Isle and every gathering skill), A (combat core,
Murk families, callings, the Windspire generator, puzzles, keepers, loot,
party runs, server checks), G (WebSocket shards, remote pilots with
appearance and LOD, emotes, hands, friends, chat, trading, bazaar, auctions,
flocks, events, moderation) and P (economy and combat sims, onboarding,
accessibility, perf and phone passes), a testing playbook, an enhancement
playbook, open decisions D1–D8 and a SkyBlock feature map. Plans and Next up
updated here. Docs only: no code changed, nothing to build or test.

### 2026-10-13/14: Zen ported, wings rigged, many new items and cosmetics, journal guide and achievements, new landing page (Claude)

Asked for (18 items, then corrections and a landing-page brief):

- **Zen (PR #51)** squash-merged as commit `5f6f0f7`, keeping its original
  author; `dc7b07f` ("Move Sky Isles to the shared generator") left out, since
  Sky Isles' race generator is frozen. Rule 9: git always as the user.
- **Wings:** `game/wingRig.ts` with four rigs; `items/builder.ts` `bone(n)`
  skin weights; `cosmetics/wings.ts` rewritten (inner/outer, bones, anchors);
  every wing has `rig` and `size`; nine new wings (sparrow, cardboard, paper,
  butterfly, maple, clockwork, ruin, wyrm, seraph). `avatar.ts`: classic wing
  rebuilt with skinned primaries; wings swap in place; climbing beats harder,
  diving folds (item 18). Rare wings' and pets' flourishes in `pilotfx.ts`,
  `pets/models.ts`, `companion.ts`.
- **Finale:** wing particles drift as in flight (`Trail.drift`, `PilotFx` wind).
- **Items/abilities/cosmetics/pets:** 6 items, 3 upgrades (see "Items and
  abilities"), 8 hats, 3 shoes, 4 capes, 4 pets (manta, rabbit, jelly, koi);
  powers for them; backend catalog to 99 entries with unlock levels.
- **Models unified:** fruit and candy models redone in `items/models.ts`
  (veined leaves, curved stems, gold ties; no faces).
- **Dodge:** 8 m over 0.5 s (`FLIGHT.dodgeDistance/Duration`), shear 14 m; the
  "rubber band" was the chase camera following the dodge's sideways velocity
  (`Flight.dodgeVelocity` is now left out of the camera's lead).
- **Sky Isles looks:** mesher colors (grass patches, rock strata), a decor
  array (tufts, bushes, flowers) drawn by `WorldView` with a 5-tier pine.
  Race tree/dist/ring hashes unchanged; mesh hashes updated in
  `tests/items2.test.mjs` and `docs/dev-snippets.js`.
- **Journal:** Guide (`FieldGuide.tsx`) and Achievements
  (`AchievementsView.tsx`, `game/achievements.ts`, `AchievementToast.tsx`)
  buttons with Back and close; cosmetics sub-tabs; big translucent locks;
  padded cards; one scroll for the whole sheet on small screens; the
  figurine and preview re-dress in place.
- **Adventure:** the touch Resume button removed (Restart covers it).
- **Test mode** is now the real adventure screen: `RunScreen` with `test`,
  `RunSession(seed, settings, test)` (no profile, endless lives, every item
  open), a test panel with Fitting room and Get items & abilities
  (`TestCollectionPanel`, rarity-bordered boxes). `ExploreSession` lost its
  test code; `tests/wardrobe.test.mjs` uses `RunSession`.
- **Landing page:** three equal emblems (Racing, Adventure, Zen; SVG diamond,
  constellation nodes, breathing halo, a quarter turn on hover); Adventure's
  details moved to its own page (`view === "adventure"`); pale-gold shimmering
  title with a white glow; Market, Hall of Winds, "?", settings, Today's best
  and the pilot are `menu-ghost` rings and words on soft light pools instead of
  glass pills; a top/bottom shade; `MenuMotes.tsx` (one 2D canvas, a fixed
  pool: ambient motes, motes gathering into each emblem, motes and trailing
  stars out of a hovered one; off with reduced motion); `theme.ts` sets
  `data-sky` (`darkSky`: night ≥ 0.5 or sky lightness < 0.45) and dark maps
  switch the page to white and pale gold.

Verified: `npm run build`, `npm run lint`, `npm test` (158 pass), backend
`pytest` (53 pass). Looked in the browser: every wing via `__wingShot`, fruit
in the gallery, Sky Isles decor, the journal at desktop and 844×390, the
landing page on a light map, forced dark (`data-sky="dark"` over a darkened
backdrop), hover motes, 844×390 and 390×760 frames, the Adventure page, `/?test`
(take off, shop, an item into the bag, an ability granted), `/?zen=42` loads.
Not verified: a real dark map on the landing page (the daily map was light),
real phones, focused-window frame rates (skinned wings, Sky Isles decor draw
calls, the motes canvas over the backdrop), the finale's particles in motion,
item/ability balance, the guard's look-ahead in tight canyons, every
achievement's trigger in play.

### 2026-10-13: Adventure HUD: always shown, touch layout, restart, pause blur (Claude)

Asked for: (1) every adventure panel always shown; (2) on touch screens hide
the "Reach the portal" objective and put a compact boost panel there (no
speed, no style line), score top centre with the level title shrunk to stop
short of it, "?" and Settings top right, Resume under the pause card; (3) a
restart button beside them (desktop too) with a confirmation; (4) a slight
blur while paused. `RunScreen` no longer uses `useIdleUi` and carries
`run-layout`/`is-paused`; new `components/RunLayout.css` holds the touch
layout (`html.touch .game.run-layout`, CSS variables for the top row) and the
`.pause-veil` blur. `Hud` takes `onResume` and wraps the pause card in
`.hud-pause-stack` (positioning moved there; `Touch.css` follows);
`RunSession.resume()`. `RestartButton` in `GameScreen.tsx` reuses `Overlay`/
`Title` (now exported from `Help.tsx`, `.overlay-note` added) and calls
`session.again()`; shown in every stage so the top row never has a gap. The
score's "Level x / y" got a `.run-score-level` class so touch hides it (the
title shows the level). Under 760 px wide, Respawn/Pause drop under the
corner buttons; the compass hides while paused on touch (it hit the card).
Touch layout applies to tablets too (`html.touch`). README updated. Verified:
build, lint, `npm test` (148 pass); looked at 844×390 and 667×375 frames
with `html.touch` forced (flying, paused, restart card, restart → level 1)
and 1280×720 desktop. Not checked: real phones/iPad, notches, left-handed
touch (adventures never had it), a lives-less run (the boost panel assumes
the feathers pill above it).

### 2026-10-13: CLAUDE.md summarised, the old one archived (Claude)

Asked for: a new CLAUDE.md summarising the old one, with the old one
archived. `CLAUDE.md` moved (with `git mv`) to
`docs/archive/CLAUDE-2026-10-13.md` with an "archived" note on top; this file
keeps the art direction and rules, and summarises the project, architecture,
mechanics, plans, history and open work, pointing to the archive's sections.
Code comments citing "CLAUDE.md rule 6" and "CLAUDE.md, Items and abilities"
still resolve here. `AGENTS.md` untouched. Docs only; nothing to build.

### Before 2026-10-13 (archived)

Every entry from 2026-10-10 to 2026-10-12 is in the archive's "Change log".
The main threads, newest first:

- **2026-10-12** `pengyue-new`: main plus PengyueW's open PR #55
  (adventure economy) cherry-picked; journal merged by hand.
- **2026-10-11** Collection powers, the charm, economy, Lantern Market and
  wheel, Hall of Winds, stamina orbs, harder levels; race rooms with a host
  and a grace after the first finish; audit fixes; PRs #43/#47 merged; compact
  race HUD and left-handed touch; performance pass (bloom without MSAA,
  shader precompile, land fade-in); unified glass sheets and the journal;
  in-game glass hidden until the mouse moves; pets that gallop and orbit;
  pilot face and two styles; crystals-only pickups; opening autopilot.
- **2026-10-10** The roguelike's foundations and most content: biome format,
  terrain v2, all biomes, flora, water, structures, the run loop, portals and
  the wormhole, the finale and victory lap, crash animations, glide-in, all
  20 items and 20 abilities, lives, the shared map pool and `MapSelect`, test
  mode, settings and rebinding, touch controls (tilt later removed), the
  tutorial, the rename to Wind Rider, speed controls and dodge, the pilot
  hitbox and land-as-drawn collisions, mesh cleanup and LODs, music, Sunken
  Reef, profiles and the collection.

## Next up

Condensed from the archive's "Next up" (which has the full notes per item).

**Playtest / verify by hand** (mostly never looked at in a focused window or
on real hardware):
- The merged journal (figurine, rarity tiles, phones) and the Market/Hall
  pills; delete `cosmetics/sparkles.ts` if `CollectionFx` stays.
- A two-player race through finish, 60 s grace and host restart; tune
  `FINISH_GRACE_MS`; decide if Start/Change map become host-only.
- Economy balance (orbs, crystals per run vs prices, unlock levels, wheel
  odds, difficulty 0.5–1), item and ability balance, lives (3 may be harsh).
- Sounds: pets, keepsakes, abilities, items, music mix and loop points.
- Real phones (Android Chrome, iOS Safari): Boost/Brake hold, fullscreen,
  wake lock, notches, market wheel, figurine drag.
- Night and bloom looks: abilities, pets' trails, rare cosmetics, crystals,
  portal crossings, titles on dark maps; structures' moving parts in motion.
- Focused-window frame times: `__bench(2/1/0)`, wormhole and finale shaders,
  the 3 m LOD tier, full outfits and companions.
- Gamepad and physical keyboards (AZERTY/QWERTZ/Dvorak), test-mode shortcuts.
- A full eight-level adventure through the finale and victory lap.

- 2026-10-14 work: the landing page on a real dark map and on phones; the
  `MenuMotes` cost next to the backdrop; skinned wings and Sky Isles decor
  frame times; new items' and abilities' balance (Foresight/Guardian Gale may
  be strong); achievements' triggers in real play; the finale's drifting
  particles.

- 2026-10-15 work, all unseen in a browser (the shaders do compile, checked later that day): the
  shape particles read well at distance, each wing's recipe and colors (night and day),
  the calmed ribbons in flight and the finale tunnel, the roll and boost transitions, the new wing
  whip/wave/breathing (watch for over-bending on large wings, e.g. seraph), and 667×375 landing scroll.
- 2026-10-15 glow work, unseen: the five glowing wings by day and night (aura too strong? seraph's
  white may bloom wide), solid wing particles on light maps and saturation on dark ones; tune
  `COSMETIC_FX.wingGlow`, `glowParticles`, `saturation*`/`deepen*` by eye.

- 2026-10-17 jars and clearance, unseen: each jar's aura and trail at speed, by night and on light maps (are the
  solid ones readable on bright skies? the glowing ones too strong?), the aura when the pilot turns hard (it
  rides with the pilot, the trail stays behind); the wings' upstroke stopping at the rocket (does it read as
  natural?), the remaining grazes (up to ~2 cm) in the climb and sing stances; tune `JAR_FX` by eye. Remote
  pilots never show jars (rooms send no appearance).

**Known bugs and gaps:**
- Adventure touch HUD (2026-10-13): check on real phones and an iPad; the
  boost panel's top assumes the feathers pill; decide whether Respawn/Pause
  should become round icon buttons to fit one row on narrow phones.
- The first 1.4 s after a portal: level clock, gates and abilities are off
  until the blur clears (`RunController.step`); fix needs a timing decision.
- Remote pilots and ghosts: no cosmetics, pilot style, powers' particles or
  crash animations (rooms send no appearance).
- Proximity, skim spray and glide-in still read the distance field (undrawn
  rock can give style points, never a crash); the crash tumble can clip
  briefly in narrow slots.
- Mixed-LOD seams use overlap, not true stitching; impostors don't glow at
  night; trees pop at the 140 m impostor ring.
- Land is ~180 of ~260 draw calls: batching it is the next CPU win.
- Gamepad can't press Enter or pause; Backspace abandons a time trial
  silently; misclick protection undecided.
- Runs keep scores in localStorage only (no daily-run leaderboard backend).
- Achievements are per browser (localStorage), not on the profile server.
- Zen skips Sky Isles (frozen generator; `dc7b07f` not ported).
- `AGENTS.md` is a drifting copy of the old CLAUDE.md: decide whether to keep it.

**Ideas and design decisions pending:**
- The open-world plan (`docs/open-world-plan.md`): phase F's suggested part done (F1–F4, F7, F9,
  F11, F12), and R1 part 1 (the region map, discovery, the map sheet). Next: R1 part 2 (the field of biomes,
  the floating origin, `/?reaches`: the plan's R1 "As built" lists it), then R2, R3, F5, F6, R19, R20 (an
  explorable world with a hub); F8 (icons) and F10 (crafting) are free to pick up. Decisions D2–D8 still open (D2 URLs, D3
  Sky Isles in the Reaches, D5 accounts before trading...).
- 2026-10-15 F7/F9/F11/F12 work: real phones (bottom-sheet drag, long-press drag, radial with a
  thumb), a real gamepad (only scripted key events were tried), screen readers; the sound families,
  ambience beds and ducking by ear (nothing was listened to); sample sheets to record or pick
  (`public/audio/sheets/`, format in `samples.ts`); `?perf` and `__bench` in a focused window; the
  landing page's four emblems on a real dark map and at 667×375. The main chunk is ~1.69 MB minified,
  past Vite's 1200 kB warning (it was before this work too).
- 2026-10-15 open-world work, unseen: the level-up card on a dark map and on
  real phones; the `skill`/`levelUp` chimes by ear; the Skills page with a
  gamepad (F7 brings focus handling). The plan's "ring of light from the
  pilot" on level-up is a UI ring for now: the 3D one comes with the Reaches.
  The journal's skill ladder has two back buttons (header and "Skills").
- Restyle upgrade picker, title card and finish screen in the Solo look; pick
  inks per biome palette (and Sky Isles' Starlight).
- Bring back the in-game glass the team needs; wait for Enter after a crash?
- Structures still missing (rope/chain bridges, treehouses, lantern tree,
  sailboats, Sky Isles' drawn-only dressing); Sunken Reef extras (bubble
  trail, muffled wind, own music).
- Menu music, a finale track, stingers; a "wings unfold" respawn intro;
  continuous time of day; animate distant remote pilots every other frame.
