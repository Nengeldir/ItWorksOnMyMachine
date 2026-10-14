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
   and pushes are made as the user's own git identity.
10. **Credit other people's work, in git.** Zen mode is Stella's
   (`stella-sy-x`, PR #51): its commit is authored as her, and
   [CREDITS.md](CREDITS.md) says so. Moving it to another branch, keep her as
   the commit's author and keep CREDITS.md; a pull request that includes it
   says Zen is her work. The credit lives in git (authorship, CREDITS.md, PR
   text, source headers), not in the game's UI: no "by Stella" lines on screen.

## The project

**Wind Rider** (renamed from Wingrace on 2026-10-10, storage keys included;
the landing logo reads "WindRider") is a browser wingsuit racer in the style
of Superflight, grown into a roguelike flying adventure. Every course is a
seeded racing line through floating islands or a biome's landscape, with
crystal gates. Modes: Racing (time trials, multiplayer race rooms), the
eight-level Adventure (runs) with upgrades, items, lives and a persistent
profile/economy, and Zen (one open, endless map; Stella's, see rule 10). Built for the VIScon hackathon: React + Three.js frontend,
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
| `game/pilotfx.ts`, `particles.ts`, `trail.ts`, `speedlines.ts`, `effects.ts` | Pilot ribbons/motes/puffs, the one GPU particle system, trails, wind streaks, crash feathers |
| `game/camera.ts` | Chase camera and the crash fall camera (`CAMERA`) |
| `game/tuning.ts` | Every look constant, slider ranges, localStorage persistence |
| `game/input.ts`, `bindings.ts`, `touch.ts` | Keyboard (layout-aware), mouse, gamepad, touch stick/buttons; bindings; phones' touch mode |
| `game/autopilot.ts`, `glidein.ts`, `hold.ts` | On-rails flight along the racing line; glide-in while land loads; overlays that pause the game |
| `game/death.ts` | Crash classification and rigid-body tumble (looks only) |
| `game/audio.ts`, `music.ts` | Synthesized sounds, wingbeat sample, per-biome music crossfade |
| `game/pilots.ts`, `ghost.ts` | Remote players and ghosts; ghost recording (15 Hz) |
| `game/run/` | The roguelike: `run.ts` (order, scoring, lives), `controller.ts` (levels, portals, lives, HUD), `upgrades.ts` (31 upgrades), `abilities.ts` (abilities' rules), `items.ts`/`pickups.ts` (26 items, bag, seeded pickups), `charm.ts`, `orbs.ts`, `collection.ts`, `portal.ts` (portal, wormhole), `finale.ts` |
| `game/abilities/` | Looks of the 20 abilities (`models.ts`/`fx.ts` for 1–10, `models2.ts`/`fx2.ts` for 11–20) |
| `game/items/` | Item models, equipment slots, gallery, item/relic FX, pickup rendering |
| `game/collection/`, `cosmetics/`, `pets/` | Rarity palette, powers (`POWERS`), collection FX and sounds; capes/hats/shoes/wings (each wing has a `rig` and `size`); twelve pets, their companion orbit and rare pets' flourish |
| `game/world/open.ts` | Zen's open world (Stella's): the endless field a Zen map streams |
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
| `components/` | React screens: menu (three mode emblems, a page per mode; `MenuMotes` canvas of light motes), `MapSelect`, HUD, `RunHud` (laid out by `RunLayout.css`: touch layout, pause blur), journal (`ProfilePanel` with `FieldGuide` and `AchievementsView`; `AchievementToast`), market, Hall of Winds, settings, help, tutorial (`Coach`), previews, test mode's `TestCollectionPanel` |
| `theme.ts`, `route.ts`, `media.ts`, `staleBuild.ts` | UI colors per map (`--ink`, `--tint`, and `data-sky` light/dark from `darkSky`), URL ↔ screen, media toggles, reload after redeploy |

**Backend** (`backend/`): `app.py` endpoints, `rooms.py` race state machine
and 15 Hz SSE relay (host restarts; race called 60 s after first finish),
`store.py` SQLite runs and ghosts, `profiles.py` profiles/economy/market,
`models.py`. Players never collide; the server only relays positions.

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

## Change log

Add new entries at the top, dated.

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
- Zen skips Sky Isles (frozen generator; Stella's `dc7b07f` not ported).
- `AGENTS.md` is a drifting copy of the old CLAUDE.md: decide whether to keep it.

**Ideas and design decisions pending:**
- Restyle upgrade picker, title card and finish screen in the Solo look; pick
  inks per biome palette (and Sky Isles' Starlight).
- Bring back the in-game glass the team needs; wait for Enter after a crash?
- Structures still missing (rope/chain bridges, treehouses, lantern tree,
  sailboats, Sky Isles' drawn-only dressing); Sunken Reef extras (bubble
  trail, muffled wind, own music).
- Menu music, a finale track, stingers; a "wings unfold" respawn intro;
  continuous time of day; animate distant remote pilots every other frame.
