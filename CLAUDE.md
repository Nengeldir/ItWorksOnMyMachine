# CLAUDE.md: read this first, every session

This file is Claude's memory for Wind Rider. Claude Code loads it automatically
at the start of every session in this repository. Read all of it before
touching code, and keep it true.

## The most important point: Genshin Impact and Sky (光遇)

**Wind Rider is a Genshin Impact and Sky: Children of the Light (光遇) styled
game.** Every model, animation, effect, screen and piece of UI goes in that
direction. When in doubt, ask "would this fit in Genshin or in Sky?", and if
not, change it.

- **Models:** cel-shaded (`toonMaterial`, three light bands, rim light, ink
  outlines), chibi-to-anime proportions, soft rounded silhouettes, readable
  shapes, warm saturated colors with gold trims, capes, scarves and feathers.
  No realistic or gritty assets, no photo textures.
- **Animation:** floaty, graceful and expressive, like Sky's gliding and
  Genshin's wind glider: springy leans, flowing cloth, wingbeats with
  anticipation and follow-through, cute reactions (dizzy stars, squash and
  stretch). Even failure (crashes) stays gentle and charming, and ends in
  light, not gore.
- **Aesthetics:** painted skies, light motes and glowing particles, bloom on
  the things that matter, golden-hour and moonlit moods, vast and peaceful
  spaces (Sky's Isle of Dawn, Genshin's Teyvat vistas). Light and color guide
  the player.
- **UI:** soft glass panels, rounded shapes, gentle motion; elegant, never
  cluttered.

Everything below (rules, performance, determinism) still applies; this
decides how things should look and feel.

## Rules for working on this project

1. **Read this file first.** Before planning or editing, read this file, then
   the files the task touches. The README covers players and deployment; this
   file covers how the code fits together and where it's going.
2. **Always record what you changed.** Every session that changes code adds a
   dated entry to the [Change log](#change-log): what changed, why, which files,
   and how it was verified (build, lint, tests, browser). Note anything you
   could not verify.
3. **Always record what is still to do.** Unfinished work, known bugs, ideas
   you postponed and follow-ups go into [Next up](#next-up), the
   [Roadmap](#roadmap) or the biome plan. Remove an item when it's done, and
   mention that in the change log.
4. **Keep the docs in step with the code.** When you add a module, a control,
   a tuning knob or an endpoint, update the README tables and this file's
   architecture map in the same change.
5. **Verify before you claim.** Run `npm run build` and `npm run lint` in
   `frontend/`, and `pytest` in `backend/` when the backend changes. For
   anything visual, look at it in a browser (see [Checking visuals](#checking-visuals)).
   Report results as they are, including failures.
6. **Looks never change gameplay.** Animation, particles, shaders and camera
   effects must not change the flight model, collisions, ring checks or
   timing. Leaderboards and ghosts depend on that. Gameplay changes go through
   `flight.ts`, `World` and `Game.step`, and need a deliberate decision.
7. **Performance budget.** Target 60 fps on an integrated laptop GPU at High
   quality. Prefer instancing, one draw call per effect family, work done in
   shaders, and no allocations in per-frame code. Anything heavy needs a
   quality level (see `QUALITY` in `Game.ts`) and should respect
   `particles.budget`.
8. **Everything tunable goes in `tuning.ts`** (looks) or `FLIGHT` in
   `flight.ts` (physics), so it shows up in the `?tune` panel.
9. Don't add Claude as a co-author or contributor on commits.

## The project

The game is called **Wind Rider** (named 2026-10-10; it was Wingrace, renamed
everywhere, storage keys included; the landing page's logo reads "WindRider").

Wind Rider is a browser wingsuit racer in the style of Superflight, with
multiplayer races. Every course is a seeded racing line through floating
islands (same seed, same map) with crystal gates, pine forests and a sea of
clouds below. Built for the VIScon
hackathon: React + Three.js frontend, FastAPI backend behind Caddy, everything
in `docker compose`.

### Running it

```bash
docker compose up --build            # http://localhost:8080
# or, for development:
cd backend && python app.py           # :8000
cd frontend && npm install && npm run dev   # http://localhost:5173, proxies /api
```

- `/?seed=42` opens a time trial on seed 42. Add `&tune` for the tuning panel.
- `/?test` (optionally `?test=verdant&seed=2`, or `&test` added to any
  single-player URL: `?explore=verdant&test`, `?seed=42&test`, `?run=5&test`)
  opens the explore-style test sandbox (`docs/debug-mode.md`): Shift+P spawns a portal ahead, Shift+O previews victory, Shift+S
  toggles simulation and all visual animations between half and normal speed.
  Nothing is saved; world/light controls and N/B/V switching are explore-only.
  Included in the standard production build; no Docker changes or debug flags.
- `/?gallery` shows every item model and the pilot's item animations.
- `/?explore=<biome>&seed=<n>` flies a run level of any biome freely (no
  clock, nothing saved), e.g. `/?explore=verdant&seed=2` (Morning) or `&seed=3`
  (Moonlit).
- **One map pool for every mode:** a seed stands for one map (`seedMap`:
  which biome, which mood), the same in time trials, rooms and runs
  (`seedLevel(seed)`; a run's level picks a seed that stands for its biome).
  A run starts on its own seed's map and flies eight different maps
  (`runOrder`). Every mode picks its map in the same map select
  (`MapSelect`): rooms send the seed to the backend.
  Sky Isles' generator stays frozen: `docs/dev-snippets.js` has
  `__raceHashes()`, which must keep returning the hashes listed there for
  trees, distances and rings (on `skyIslesLevel(seed)`). The other biomes are
  still being worked on, so their seeds' maps can change; nothing is live.
- In dev, `window.__game`, `window.__fxTime` and `window.__tuning` are exposed
  for poking at the game from the console.
- Node 22+ works locally (the VM uses 24). Python 3.14 on the VM.

### Architecture map (frontend/src)

| Path | What it does |
| :--- | :--- |
| `game/Game.ts` | The game: frame loop, fixed 120 Hz physics steps, race state, ring checks, HUD data, effects wiring (gate bursts, skim spray, gate motes), rendering with optional bloom, adaptive quality, test-only shared time scaling, the `?tune` panel |
| `game/flight.ts` | Arcade, energy-based flight model (`FLIGHT` constants). Physics only. `touching()` is the pilot's hitbox (`FLIGHT.hit*`): a ball for the body and a rectangle per wing, tilted up at a dihedral, fixed in the flight frame (never the animated pose), sampled against the distance field with early-outs; `hitboxWorld()` is the same hitbox in world space, which `Game.step` tests against the land drawn (`LandCollider`). `FlightMods` (run upgrades: drag, sink, stall, proximity boost, dash boost, thermal lift, hover, glide lock, `thrust`, a plunge's `dive`, Hover-Stall's `hang`, `turn` for stances and Aero-Braking, Zenith's `climb`, Ascension's `ascend`, a rise on rails in `ascendStep`) are only ever passed in run mode; `flap()`, `launch()`, `deflect()`, `surge()` and a forced `dodge()` are run abilities |
| `game/avatar.ts` | The pilot: a cel-shaded chibi flyer built from primitives (merged per body part, vertex-colored), a procedural cape and scarf (`Cloth`), two-segment feathered wings, and all its animation: bank lead spring, barrel rolls, flapping driven by effort, bobbing, cloth ripples, limb reactions. Also `createLabel` and `glowTexture` |
| `game/toon.ts` | Toon material (3-band gradient, rim light tinted by the biome's sun, self-lit `glow` vertex attribute for trims and wingtips) and the inverted-hull ink outline. `TOON_LIGHT` is set per biome |
| `game/pilotfx.ts` | Per-pilot effects: wingtip and cape ribbons, light motes, downstroke puffs, barrel-roll star spiral. Shared by you, other players and ghosts |
| `game/particles.ts` | One GPU particle system (ring buffer, physics in the vertex shader). Kinds: Glow, Star, Shard, Wisp, Firefly, Bubble. `fxTime` is the shared shader clock; `FX_LIGHT.boost` scales all glowing effects per biome |
| `game/trail.ts` | Glowing additive ribbon (shader: soft edges, light pulses, fades near the camera) |
| `game/speedlines.ts` | Wind streaks that hang in the air and rush past at speed |
| `game/camera.ts` | Chase camera (`CAMERA` tuning): lag, partial horizon roll, FOV with speed, FOV kick on gates, shake when skimming; after a crash (`startFall`, `fall`) it arcs up over the pilot and looks down on the fall (`CAMERA.fall*`) |
| `game/tuning.ts` | `ANIM`, `FX`, `RINGS`, `CAMERA`: every look constant, slider ranges, localStorage persistence |
| `game/testPlayback.ts` | Test-only playback rate: the frame loop scales its delta, CSS animations/transitions follow through the Web Animations API, and a scoped observer handles new overlays; cleanup restores normal playback |
| `game/input.ts` | Keyboard, pointer-lock mouse and gamepad. Items: Y/right mouse button use, U/wheel cycle; d-pad right/left. Test Shift+I gives items in design-list order; Shift+P/O/S retain portal, victory and playback controls. |

| `game/input.ts` | Test-only Shift+P/O/S chords are consumed before ordinary bindings; keyboard, pointer-lock mouse, gamepad, the touch stick and buttons and tilt, merged into pitch and roll, plus actions (respawn, mute, barrel rolls). `observe` reports the merged flight input and actions to the tutorial via the session |
| `game/touch.ts` | Phones and tablets. `watchTouchMode()` keeps `html.touch` on while the player uses a finger (CSS shows touch UI and hides key hints by it: `.touch-only`, `.no-touch`). `TouchControls` (built by `Game`, plain DOM in the game view, styled in `components/Touch.css`): a stick that appears under the thumb anywhere on the canvas, Boost / Brake / dodge / Flap / Hover / Plunge / Gale buttons, Tilt / Respawn / Pause pills; it only writes `Input.touch*` and calls `Input.dispatchAction`. On the first finished tap it goes full screen and locks landscape (Android), and takes a screen wake lock |
| `game/tilt.ts` | `tilt`, the one device-orientation sensor: `tiltAngles()` gets roll and lean from the direction of gravity (no jumps where the event's angles flip), `enable()` asks iOS for permission (from a tap), `recenter()` makes the current hold level flight. On/off is kept in `wingrace.tilt`, outside `Settings` (the in-game button owns it). `Input.sample` adds it to pitch and roll (`TILT_*` in `input.ts`) |
| `game/pilots.ts` | Remote players and ghosts: interpolated samples driving an `Avatar` and `PilotFx` |
| `game/ghost.ts` | Recording and decoding ghost runs (15 Hz) |
| `game/autopilot.ts` | `Autopilot`: while nobody plays (the menu's `chase` backdrop, the victory lap) the pilot flies the racing line on rails (`Flight.place`), through the middle of every gate and inside the 11 m tube the land is carved away from; speed from the slope against drag, bank from the line's curve (`AUTOPILOT` in `tuning.ts`). Never scored; Game loops it 40 m past the finish |
| `game/glidein.ts` | `GlideIn`: while the land near you is loading (free flight, runs, explore; never races), the pilot glides in on rails instead of hanging frozen: no input, no physics step, no scoring; at most 70 m and never within 30 m of the next gate, slowing before rock; control comes back at `START_SPEED` when the land is ready, and a run's level clock keeps running meanwhile |
| `game/hold.ts` | `holdGame()`: an overlay over the game (How to fly, the newcomer's question) pauses it while open; `Game.hold` resumes only a pause it made, and the HUD shows no "Paused" for it |
| `game/items/` | Toon item models (`models.ts`, `relics.ts`, shared `builder.ts`), equipment on hand/head/back/feet (`equip.ts`), the gallery, and looks-only `ItemFx` / `RelicFx`. `auras.ts` draws faceted light shells. Rules stay in `run/items.ts`; `ITEMS_FX` controls looks. |
| `game/abilities/` | The run abilities' looks (rules: `run/abilities.ts`; looks only). `models.ts`: down feathers, the spirit manta (`buildManta`: toon primitives, flapping two-part wings, a whip of a tail), `RingQuads` (instanced rings of light: gate markers through rock, wind halos, shockwaves), wind blades, the Gale Force tunnel, the Hover-Stall sigil and chevrons, the recovery helix. `lanes.ts`: `CloudLanes`, the cloud rivers drawn as soft puffs fitted clear of the rock. `fx.ts`: `AbilityFx`, which reads `Abilities` every frame and animates all of it, sets `Avatar.stance` (tuck, hover, cast, surf) and plays `GameAudio.ability` sounds. The design list's abilities 11 to 20 have their own pair: `models2.ts` (`Swarm`: creatures of light in one instanced draw call each, wings beating in the vertex shader and painted in the fragment shader: moths, butterflies, the spirit falcon; `funnelMesh`: wind funnels for Zenith's updraft, the Draft-Weaving tornado and Ascension's column; `songMesh`, `cushionMesh`; `Ribbon`: CPU-built glowing ribbons for the ley line and the Echo-Trail) and `fx2.ts` (`AbilityFx2`: their animations, `Avatar.stance` climb, sing, flare, falcon, butterfly, `GameAudio.ability2` sounds, and turning Resonance's gates through `CrystalGates.orient`). Additive light is kept for small things: big shapes (sigil, tunnel, blades, funnels, the song, the cushion) are painted with normal blending, or they white out a bright day sky under bloom; even a thin additive ring, if large and bright, fills with bloom (`RingQuads` styles 3 and 4 have no glow inside) |
| `game/death.ts` | Crash animations, looks only: `classifyCrash` picks headfirst (into a wall: bounce and tumble), slide (glancing ground: roll down the slope), wing (a wing clipped: spin down) or fall (below the islands); `DeathFall` is a small rigid-body tumble (impulses at contact points: balls for head, hips and feet, five points per wing from the live pose via `Avatar.wingPoints`; a few position passes per step) kept out of the land drawn by `Game.contact`; a wing still wedged (`wedged`) is folded in by `Avatar.foldWings`. The avatar plays `die(kind)`, the camera arcs up overhead (`startFall`, `fall`), the body dissolves into light at `DISSOLVE_AT`, all inside `RESPAWN_DELAY` |
| `game/effects.ts` | Crash debris: feathers knocked loose that flutter down (instanced) |
| `game/audio.ts` | Synthesized wind and event sounds, run stingers (portal, upgrade, dash; sidequest and item are unused for now), the wingbeat sample (`public/audio/sfx/wingbeat.mp3`, pitch-randomized, played on each of your downstrokes and on the Wingbeat ability) and the `MusicPlayer` |
| `game/music.ts` | `MusicPlayer`: one looping track per biome from `public/audio/music/<biome>_<title>.mp3`, crossfaded on biome change (`TRACK_OF` maps biomes to tracks; similar biomes share one). Night dims and muffles the same track. Loaded lazily, decoded with Web Audio, no music if a file fails |
| `game/webgl.ts` | WebGL 2 availability check; `GameScreen` shows help if it's missing |
| `game/run/` | The roguelike run. `run.ts`: run length, the run's eight maps (`runOrder`: the run seed's own map first, then seven of the other eight shuffled by the seed), portal destinations (`destination`: the first map of the order not flown yet), scoring constants, `RunHud`. `START_LIVES` (3). `upgrades.ts`: twenty-eight data-defined upgrades (seven of the original, Spare feather for a life, the design list's twenty abilities) and the 3-of-N offer. `abilities.ts`: `Abilities`, the twenty abilities' rules (`ABILITY` constants, in `?tune` as "Run abilities", not saved): cooldowns, Gale Force's energy and tunnel, cloud lanes (`laneAt`), the spirit manta's path, the slipstream, Wind-Shear's dodge params, Resonance's turned gates (`attuned`, `gateNormal`), the ley line's chain, the stances' multipliers, Draft-Weaving's tornado and the saves (`save`, `saved`: Acrobatic Recovery or the tornado), Ascension, the Echo-Trail's ribbon samples and wind ring; it answers each step with `FlightMods` and boost refills, and counts one-off moments (`cue`) for the looks. `controller.ts`: `RunController` (levels, gates and chains, lives: a crash costs one and the last one's crash ends the run in phase `lost`, abilities as `FlightMods`, the portal transition: blur in, the next level built under the blur (`buildNext`), wormhole and upgrade pick while it streams, blur out with the palette cross-fade; HUD data). `finale.ts`: `Finale`, the last portal's cutscene (space under a world-fixed Milky Way with dust lanes and its core overhead, the camera's scripted pan beneath the pilot and back, then white light; Enter skips). `portal.ts`: the portal (ring, a flat disk like a window onto night, beam), the `Wormhole` (a camera-centred shell mapping the view onto an endless twisting tube of lensed stars and nebula with the exit glowing ahead, spirit motes, its own lights) and `screenSparkle`. Game's `veil(k)` (the `.portal-veil` DOM blur and sparkles) and `insideWormhole(on)` (hides the level: land, sky, soft particles, speed lines, ambient, gate effects) serve it |
| `game/devtools.ts` | Dev builds only: `__shot(view)` (freeze, stream the land around a fixed camera, render once), `__raceHashes()` (the race map's determinism check), `__run(s)`, `__bench(q)` and `__crash(kind, after)` (flies into rock near the start and stops `after` s into the crash animation) on `window` |
| `game/math.ts` | `clamp`, `smoothstep`, `smin` (smooth minimum for distance fields) |
| `game/world/terrain/` | Generator v2 (every biome but Sky Isles). `noise.ts`: seeded fbm, ridged multifractal, domain-warped ridges, terraces. `shapes.ts`: distance-field primitives (spires and rock rings never thinner than `MIN_RADIUS`, 4.5 m, what the 6 m meshing grid always holds) with boxes, surface ids and grain (Island, NoiseIsland from 3D noise with tunnels, Mesa with ledges, Spire between two points, Slab, RockRing, Cap, Bridge: a humped stone bridge with one arch). `ground.ts`: the heightfield following the line (valley, hills, warped ridged mountains, terraces, crevasses, carved river channel, overhang noise on cliffs). `river.ts`: `Steps`, a valley floor stepping down in pools and falls, and the river in it (water distance for collisions). `field.ts`: `TerrainField`, ground + shapes as one field, `fill()` for whole blocks (same arithmetic as `distance()`). `recipes.ts`: gates and scenery from a biome's `LandRecipe`. `mesh.ts`: surface nets per LOD node, faces painted for the shader. `streamer.ts`: `LandStreamer`, the LOD octree (384/192/96 m nodes, 16 cells each), with 48 m merge hysteresis and a bounded 48 MiB hidden-mesh cache (estimated CPU + GPU buffers, at most 256 entries). `material.ts`: the terrain shader |
| `game/world/biomes/` | Biomes as data (`types.ts`: `Biome`, `Level`, `LevelKey`). `index.ts`: the registry, `MAPS` (the pool every mode shares), `seedMap(seed)` / `seedLevel(seed)` (the map a seed stands for, in every mode), `runLevel(runSeed, index, biome)` (roguelike levels: a seed from the run seed and level number that stands for that biome), `featuredSeed(biome)` (its showcase course) and `skyIslesLevel(seed)` (Sky Isles on any seed, for the frozen-map check). `skyIsles.ts`: the race map, frozen. `reef.ts`: Sunken Reef, the level under the sea (`SkySpec.underwater`) |
| `game/world/World.ts` | Everything a level decides: course, rock field, trees, palette; built from a `Level` (biome + seed + mood). `distance()` (rock, trees, water) for proximity, the camera and the fallback collisions; `otherDistance()` is everything but the rock (the rock collides as drawn, see `landCollider.ts`); `lost()` below the islands. No rendering |
| `game/world/islands.ts` | `RockField`: the floating islands as one signed distance field (shapes melted with `smin`, roughened, a tube carved along the racing line) |
| `game/world/mesher.ts`, `mesher.worker.ts` | Cuts chunks of the rock field into flat-shaded meshes in Web Workers, and places trees (from the grid's own vertices, so the race map's tree colliders never move; `treeSink` stretches a trunk down to snapped rock, drawn only). Workers rebuild the World from a `LevelKey` |
| `game/world/meshCleanup.ts` | Worker-side exact-welded component cleanup for both meshers: discard small closed thin shells, shorten narrow tips with per-face winding checks, subdivide compact stones once and retain their bounds. Open/non-manifold edges and a one-cell chunk collar are protected. Flat material attributes follow source faces. `MESH_CLEANUP` source constants in tuning.ts require worker reload; no per-frame work |
| `game/world/landCollider.ts` | `LandCollider`: collisions with exactly the land drawn. Every land mesh on screen (Sky Isles chunks, shown v2 nodes, added and removed with them) as triangles in a lazily built grid per mesh; exact tests: ball, segment (sweeps between steps), convex quad (separating axes) and signed `nearest` (the crash tumble). Rock that is in the field but not drawn (thinner than the 6 m grid) is never hit |
| `game/world/trees.ts` | Tree colliders and their lookup index. `Plant` is the collider of generator-v2 plants and structures: a tapered trunk, an optional canopy ellipsoid, an optional upright disc (a windmill's sails) an optional gate (two posts and a bar, open in between) and an optional hall (a long box: the ETH building's wings) |
| `game/world/flora/` | Generator-v2 vegetation: `species.ts` (sizes, colliders), `meshes.ts` (models from primitives), `placement.ts` (`placeFlora`, run in the mesher workers: structures first, then plants keeping clear of them, then grass), `view.ts` (`FloraView`: one instanced pool per kind, impostor atlas, grass), `pool.ts` |
| `game/world/structures/` | Built things (21 kinds: towers, lanterns, windmills, a monastery, a lighthouse, shrine gates…) riding the flora pipeline as extra kinds after a biome's species. `kinds.ts`: `StructureId`, `STRUCTURE_INFO` (collider, footprint, plinth depth, spinning parts), `kindInfo(biome, kind)`. `models.ts`: `structureGeometry` (1 m tall, true proportions, vertex color / sway / glow / spin). A biome lists them in `Biome.structures` (`StructureSpec`: spacing, chance, height, colors, `landmark` for one per stretch of the course, `where` site rules: above, lateral, wet, `water` depth, forest, hilltop, `on` ground or rock, facing the line). Species plus structures must fit the impostor atlas (16). Run biomes only; they collide |
| `game/world/course.ts` | The racing line (a descending curve in z) and the gates along it |
| `game/world/palette.ts` | The `Palette` type: a lighting mood (colors, sun elevation and azimuth, night factor, mist, effect glow), and `sunDirection(palette)`. Each biome lists its moods |
| `game/world/atmosphere.ts` | `ATMOSPHERE` light uniforms shared per biome; `atmospheric()` patches Lambert materials (sun-tinted haze matching the sky, valley mist, backlit rims, rock strata); `skyMaterial()` (gradient, HDR sun or moon disc and halo, painted clouds, twinkling stars at night). Under the sea (`ATMOSPHERE.underwater`, set from `SkySpec.underwater`): `atmospheric()` adds caustics, and the sky is the water's surface seen from below (`ATMOSPHERE.surface`) |
| `game/world/deep.ts` | Under the sea, looks only: `LightShafts` (shafts of light from the surface, a world-fixed grid of them round the camera) and `SeaLife` (schools of fish, jellyfish), each one instanced draw call animated in the vertex shader. `DEEP` in `tuning.ts` |
| `game/world/water.ts` | River pools, waterfall curtains and seas. River pools write depth so the later waterfall draw cannot paint foam over the upstream surface; dry banks are discarded. River shading continues to the edge, with narrow animated lip foam (`WATER.lipFoam`, `lipFoamWidth`, per-pixel distance) and a short `WATER.fallBlend` join below it (0.2 m). Both river and island curtains advect foam downward through a fixed travel coordinate, accelerating with the drop (`WATER.fallSpeed`); elapsed time never reverses the flow. Rendering only; water collisions still use `Steps` |
| `game/world/WorldView.ts` | Meshes for a World, as its biome describes them: land streamed from the workers (Sky Isles' chunks, or a `LandStreamer` for v2 land), pines, the sea of clouds and cloud puffs, sky, gates. `ready` is false until the land near you has arrived. `collider` (a `LandCollider`) holds the land on screen; `covers(x, y, z)` says whether the land at a point is on screen (or there is none), else collisions there fall back to the distance field. `park()` / `resume(scene)`: set aside with its workers stopped (the menu's backdrop keeps a few maps) and back on screen with its light, fog and workers |
| `game/world/crystals.ts` | Crystal gates: instanced crystals (bob, spin, pass flare and burst in the shader), veil discs with the pass shockwave, light pillars over the next gate and the finish. `orient(index, normal)` turns one gate (Resonance; looks only) |
| `session/` | Solo, room, explore and run sessions wiring a `Game` to the network and UI. `ExploreSession`: free flight through any biome (`/?explore=verdant&seed=2`), nothing saved; `?test` reuses it with a RunController for real portals/upgrades and unsaved victory previews, showing only test shortcuts rather than biome/light controls. `RunSession`: a roguelike run (`/?run=<seed>`), best score per run seed in localStorage |
| `net/` | Server clock sync and the room connection (SSE down, POST up) |
| `staleBuild.ts` | After a redeploy, an open tab's lazy chunks (bloom, `?tune`) and mesher worker are 404s: `reloadForNewBuild` reloads the page once (at most every 30 s, production only) |
| `components/` | React screens: menu (with the Adventure card), HUD, lobby, results, controls, and the run's HUD, title card and upgrade picker (`RunHud.tsx`). The menu's live course behind the glass is `MenuBackdrop` (a `Game` in `drift` attract mode, which switches courses with `setSeed`, keeps a few it showed parked (`ATTRACT_KEEP` besides its own) so going back is instant, snapshots each one for card art and reports when one is all in (`onShown`)); today's best folds into a flag (`TodaysBest`). `MapSelect` is the map select of every mode (`solo`, `run`, `room`: a carousel of today's card, one per map (`featuredSeed`) and a random one, art in `public/maps/`; a run's card shows your best on it, never the maps after the first; over a room's lobby it opens as `RoomMapSelect`, holding the game; on the landing page, a course the backdrop is still building is covered by its picture (`.map-veil`), which fades into the live view once it's in). Before a race, `GameScreen`'s `ReadyCard` sits where the timer will be; its `Panel` (results) folds to its heading and main buttons on narrow screens. `Help` is the "?" with its How to fly card and the newcomer's "First flight?" (`keys.ts`: the keys as the player bound them). `Coach` is the tutorial: one control at a time, watched on keys, mouse and gamepad |
| `components/Feather.tsx` | The golden feather (inline SVG: cream-to-gold vane, ink outline, glint; `spent` for an outline only): the run's lives on the HUD and the Spare feather upgrade's icon |
| `theme.ts` | The UI's colors per map: `useUiTheme(seed)` sets `--ink` (picked per palette name, else derived from the sky) and `--tint` (the horizon); every other shade comes from those two with `color-mix()`; `usePaletteTheme(palette)` does the same for any level (runs, explore, the map select) |
| `route.ts` | The URL ↔ screen mapping (`screenFromSearch`, `urlFor`, `Screen`), pure so it's tested; `test` is honored on every single-player URL |
| `media.ts` | `useMediaToggle(query)`: an open/closed toggle that starts open where a media query matches and follows the screen when it changes |

Backend (`backend/`): `app.py` endpoints, `rooms.py` race state machine and
15 Hz SSE relay, `store.py` SQLite runs and ghosts, `models.py` Pydantic models.
Players never collide, so the server only relays positions.

### Key mechanics

- **Flight:** the nose points where you go. Gravity along the flight path
  speeds you up or slows you down, drag caps speed, bank turns you, too slow
  and the nose drops. Skimming rock (proximity) adds style points, a
  multiplier and acceleration. Crash means respawn at the last ring, with the
  clock still running.
- **Collisions:** the pilot's hitbox (a ball and two wing rectangles,
  `FLIGHT.hit*`) collides with the land **as drawn** (`LandCollider`: the
  triangles on screen, plus sweeps so nothing slips through between steps),
  and with trees, water and the sea by their distance fields. Where the land
  isn't on screen yet, the rock's distance field stands in. Proximity, skim
  spray, the camera and the glide-in still read the distance field. The race
  map's field (`__raceHashes()` dist) never changes; only what you crash on
  follows the mesh.
- **Rendering:** `Game.loop` interpolates between physics states, animates
  the avatar on top, updates effects, then renders. High quality uses an
  `EffectComposer` (RenderPass → UnrealBloomPass → OutputPass) with HDR
  half-float targets. Only colors above `FX.bloomThreshold` (1.3) bloom, so
  effects that should glow write colors above 1.
- **Biome light:** `WorldView` sets `ATMOSPHERE` from the palette, and
  `Game.setSeed` sets `TOON_LIGHT` (rim color, trim glow: 0.15 by day up to
  1.45 at night) and `FX_LIGHT.boost` (`palette.glow`). Bloom strength scales
  with `1 + night * 0.6`. When you add a lit material, hook it into these
  instead of hard-coding colors.
- **Shader safety:** never call `pow()` on something that can go negative
  (clamp first), and never divide by something that can reach zero. One NaN
  pixel turns the whole bloomed frame black. This happened with the light
  pillars; see the change log.
- **Quality levels:** 2 = bloom at up to 2× DPR (composer capped at 1.5×),
  1 = no bloom, 0 = 1× DPR and 40% particles. `adaptQuality` steps down after
  sustained frames over 25 ms, and never back up.

### Checking visuals

There are no visual tests. Run the dev server and look:

```js
// In the console (dev build): freeze the loop and orbit the camera around the pilot
const g = __game; cancelAnimationFrame(g.frame);
const cam = g.rig.camera; /* position cam, cam.lookAt(g.avatar.group.position) */
g.render();
```

Frame rates measured in a background or automated browser tab are throttled
and meaningless. Measure in a focused window.

The automation tab is usually hidden, so `requestAnimationFrame` doesn't run
and timers fire about once a second. Dev builds put `__shot(view, ms)` on
`window` (`game/devtools.ts`): it freezes the loop, streams the land around a
fixed camera (yielding through `MessageChannel`, which isn't throttled) and
renders once, for reproducible screenshots. Views: `0` behind the start, `1`
above the start looking down the course, `{along, height, side, ahead}` along
the course. `__raceHashes()` checks the race map hasn't moved.

## Change log

### 2026-10-10: Adventure items (continued)

Item 10 completes the first milestone: three air steps, paired feathered boots, rings and downward puffs. Items 5–9 add lantern ghost gates, conch breadcrumbs, an automatic Phoenix revive, 10-second ribbon handling and collectible attraction. Build/lint pass; 66 tests pass, including bag/charge rejection, timed effects, revive, swept gates/collectibles and finite geometry. Browser gallery inspected; fixed clipping by fitting all models into four rows. Detailed effect balance, audible mix and focused-window GPU performance remain unverified. Item 11–20 and world pickups are the next milestone.

### 2026-10-10: Adventure items (continued)

Resumed the existing item commits (1–3) and completed item 4, Comet Tail Firework: quick back equip, fuse, roaring flame and sparks, stiff bucking steering. Rules stay in run/items.ts; ItemFx only reads them. TypeScript checked; build/lint and complete milestone tests follow. Remaining: items 5–20, deterministic island pickups, two PRs, browser and balance checks.

### 2026-10-10: Crashes on the way out of a portal count; lives rebased onto main (Claude)

From the review of the lives PR (PengyueW, P2), then a rebase onto main
(`d92001e`: one map pool, abilities 11 to 20).
- **The bug** (`run/controller.ts`): on the way out of a portal the game is
  unfrozen once the blur peaks (`BLUR_OUT`), but the phase stays `portal`
  for another `RUN.tunnelFade` s (1.4) while the blur clears. Flight and
  collisions run in that time, and `crashed()`'s new phase guard dropped
  those crashes: no life lost, no crash counted, the chain kept, and a pilot
  on the last feather lived on. Before the lives work they were counted.
- **The fix**: `crashed()` also counts while leaving (`portal`, `exiting`
  and `unfrozen`). When that crash is the last life's, it ends the
  transition first (veil to 0, the sky fully the new biome's), because the
  `lost` phase returns before the code that clears them. Crashes inside the
  wormhole (frozen) still don't count. The respawn needed no change: it waits
  for the phase to reach `arrive`. Runs only (rule 6).
- **Rebase**: conflicts in this file (the `game/run/` and `components/`
  rows, the change log: both sides kept) and `run.ts` (main's description of
  the run order, plus the line about lives). Main's `destination(seed, path)`
  and its 27 upgrades merged cleanly; with the Spare feather there are 28.
- Verified: build and lint pass; 87 frontend tests (3 new in
  `tests/lives.test.mjs`: a crash while leaving costs a life, the last
  life's ends the run with the veil cleared, a crash inside the wormhole
  doesn't count; the first two fail without the fix). **Not looked at in a
  browser**: the last feather lost under the clearing blur. Backend untouched.

### 2026-10-10: Lives in the adventure (Claude)

Asked for: a run could be crashed in for ever; give it a life system: three
lives at the start, more as an ability, a crash costs one, and the end
screen's stats to match. A deliberate gameplay change in **runs only**
(rule 6): races, time trials and ghosts never see it.
- **Rules** (`run/run.ts`, `run/controller.ts`): `START_LIVES` = 3. A crash
  costs a life, respawns you at the last gate and breaks the chain, with a
  toast ("2 feathers left", "Last feather!"). The crash on the last life ends the
  run: phase `lost`, no respawn, the crash animation plays, the view fades
  into white light from 1 s to 1.9 s, then the summary and the same autopilot
  lap as after a win. That level's style and flying time still count; there is
  no level bonus. A lost run's score is saved as a best like any other.
- **Spare feather** (`run/upgrades.ts`, passive, up to three): one more
  life, added when it is picked (also through `__game.grant("spareFeather")`).
  It joins the pool the portals draw from, so the offers per run seed changed.
- **HUD** (`RunHud.tsx`, `RunHud.css`, `Hud.tsx`): lives are golden
  feathers in the pilot's style (`Feather.tsx`, asked for in review instead
  of heart emoji: a drawn SVG with a cream-to-gold vane, ink outline, gold
  quill and a glint, glowing), on a glass pill at the top left. Feathers
  lost stay as ink outlines (`RunHud.maxLives`), the pill pops when the count
  changes, the last feather breathes with "last feather" beside it. The
  upgrade's card and icons use the same drawing. The crash note reads "Out
  of feathers · The journey ends here" on the last crash.
- **Overlap fixed** (reported from a screenshot): the feather pill at
  4.2rem ran into the objectives at 6.2rem. Both now stack in one column
  (`.run-side`, from 4.4rem, 0.5rem apart), so neither is placed by a fixed
  offset; without feathers (test mode) the objectives start at 4.4rem.
- **Finish screen**: `RunSummary` has `completed` and `livesLeft`. A lost
  run is headed "Out of feathers", "fell in <biome>". Stats: Flying time, Biomes
  cleared (levels behind you, of 8), Gates, Best chain, Style, and Feathers left
  for a finished run or Crashes for a lost one.
- **Test mode** has endless lives (`Game.startRun(…, Infinity)`): no hearts,
  the old "Gate chain lost" toast, Crashes on its finish screen.
- Rebased onto main's Adventure restyle (`469a434`): the run's intro is now
  just the Take off pill, so the lives are explained in the README and by the
  hearts only; the crash note keeps main's "Back to gate N".
- `controller.ts` imports `../world/biomes/index` so the test resolver can
  load it.
- Not brought back from `Pengyue-feathers-sidequests`: its feathers allowed
  one crash more (the run ended below zero) and came with sidequests.
- Verified: build and lint pass; 68 frontend tests (4 new in
  `tests/lives.test.mjs`: three lives, the last crash ending the run after
  its fade, the Spare feather, the sandbox's endless lives). The feather
  drawing was rendered on its own in headless Chrome (day, night and dusk
  backgrounds, full and spent). **Not looked at in the game**: the
  feathers' place next to the top bar and objectives, the fade
  into white after the last crash, and the lost finish screen are unchecked.
  Backend untouched.

### 2026-10-10: The map select without islands popping in (Claude)

Reported by the UX group: the map select's backdrop is expensive and its
islands pop in one by one. Asked for: a cache, or a silent preload once the
landing page has loaded. The landing page's live backdrop stays (it's
affordable). UI and rendering only: no gameplay change.

- **Measured first** (the app's browser on her machine, dev server, the
  backdrop's drift view): a map's nearby land is in after 1.0 s (Sky
  Archipelago) to 1.7 to 2.4 s (Verdant, Reef, Twilight, Glacier), and its
  drawn geometry is 10 MB (Archipelago) to 33 to 55 MB (the v2 maps),
  without the streamer's hidden-mesh cache and the three mesher workers a
  map runs. Building all nine ahead would hold about 400 MB and 27 workers,
  so only the pictures are fetched ahead.
- **Pictures first** (`MapSelect`, `.map-veil`): while the backdrop builds
  the course in the middle, that course's picture covers it, a little
  blurred, and fades into the live view once its land is all in (ready,
  plus 1.5 s for the far islands). Cards follow at once; the backdrop
  follows a card after 0.45 s (was 0.3), so flipping fast builds nothing.
  Cards without their own picture (today's, a random seed, the run's) show
  their map's picture until the backdrop takes one (before: only the sky
  gradient), in rooms too. The nine pictures are fetched 1.5 s after the
  landing page opens (`Menu.tsx`, 0.8 MB).
- **Maps kept** (`Game.setLevel` in attract mode, `WorldView.park` /
  `resume`, `LandStreamer.park`): the backdrop keeps the landing page's own
  course and the last `ATTRACT_KEEP` (2) others it showed, parked: workers
  terminated, requests in flight forgotten (asked again on return), hidden
  meshes dropped, what's on screen kept. Going back to one swaps it in with
  its light, fog and background in about 0.5 s (the card delay); Back to the
  landing page is instant. `MenuBackdrop` reports `onShown` at once for a
  kept course, and snapshots each course once. Games other than the
  backdrop keep nothing, as before.
- Verified: tsc, lint, build and 64 frontend tests pass. In the app's
  browser on the dev server: the picture over Verdant, then its live view
  3.8 s later; back to today's card in 0.55 s from the kept map; Glacier,
  Archipelago and Lagoon in 3.3 to 4.2 s each; at most the landing's course
  plus two kept, all with stopped workers; background and fog colors right
  after every swap. Not measured: frame time and memory in a focused
  window over a long session, a slow machine (the picture just stays up
  longer).
- Rebased onto `main` (`251d430`: touch controls, the design list's
  abilities 11 to 20, waterfalls); README and this file conflicted, both
  sides kept. On the rebased branch: tsc, lint, build, 80 frontend tests
  (Node 24) and 24 backend tests pass; the landing page and its map select
  load with no new console errors.

### 2026-10-10: One map pool for all three modes (Claude)

Asked for by the UX group, on `fix-map-pool` (from `main`): the team took the
maps to be shared by every mode, but time trials and rooms only ever flew
Sky Isles; the other eight biomes were the adventure's alone. The goal: any
map in any mode, and one seed always the same map. Nothing is live, so no
old times or ghosts had to be kept. A deliberate gameplay change (rule 6).

- **A seed stands for a map** (`world/biomes/index.ts`): `seedMap(seed)`
  picks the biome (`MAPS`, every biome in `BIOMES`, from the seed's `map`
  stream) and its mood (the `palette` stream); `seedLevel(seed)` builds it.
  Time trials, rooms, today's course, the menu's backdrop and the victory lap
  all go through it (`Game.setSeed`, `useUiTheme`), so the rooms' backend,
  which only sends a seed, didn't change. Seeds 1 to 9000 spread evenly,
  about 1000 per map. Adding a biome reshuffles most seeds.
- **Runs** (`runLevel`, `run.ts`): a level's seed is the first of a short
  series that stands for its biome, so each adventure level is exactly the
  map a time trial on that seed flies; level 1 is the run seed itself. The
  order (`runOrder`, decided with the UX group): the run seed's own map
  first (the card picked), then seven of the other eight maps shuffled by
  the seed, so a run flies eight different maps; there is no fixed first
  map or Aurora finale any more (the finale's cutscene still plays after
  level 8). `destination(seed, path)` is the first map of the order not
  flown yet. Today's run has a seed of its own (`dailyRunSeed`, from the
  date like `dailySeed`), so it starts on another map than today's course.
  Every run's levels changed. The Easter eggs moved with them:
  ETH stands in Verdant levels `/?explore=verdant&seed=` 4, 9, 21, 28, the
  Einstein bust in 5, 8, 11, 16, 23, 28 (the structures tests use 2 and 28).
- `skyIslesLevel(seed)` is the old `raceLevel`: Sky Isles' generator is still
  frozen, and `__raceHashes()` (and the autopilot and mesh tests) check it
  on Sky Isles seeds as before.
- **One map select** (`MapSelect.tsx`, `MapSelect.css`, replacing
  `CourseSelect` and `BiomeSelect`), in three modes with their own words:
  today's card, one course per map (`featuredSeed`: the lowest seed that
  stands for it: Sky Isles 16, Verdant 5, Glacier 14, Archipelago 1,
  Lagoon 6, Twilight 3, Ember 12, Aurora 4, Reef 13) and the random card
  (roll, or type a seed); cards show the map, its mood, the seed and gates.
  Picking a card plays exactly it: Solo flies it, Adventure starts the run
  on it (the card shows your best on that run; the maps after the first
  stay a surprise, by the UX group's call), With friends creates a room on it. Its keys are taken
  in the capture phase, so over a game they never reach the flight or the
  lobby. Their art is one picture per map,
  `public/maps/<biome>.jpg` (drift view, z = 400 or 900, software GL); the
  old `public/courses/` and `public/biomes/` are gone. The landing card and
  the top bars name the map and its mood; the Adventure card names today's
  run's first map.
- **Rooms on a seed** (backend `rooms.py`, `models.py`, `app.py`; frontend
  `RoomClient`, `RoomSession`, `route.ts`): `POST /api/rooms/{code}/join`
  takes an optional `seed` (used only when it creates the room), and
  `POST /api/rooms/{code}/map` an optional `seed` (else random, as before).
  In the lobby, Change map (`N`) opens the map select over the game
  (`RoomMapSelect`, held paused); the pick switches the room for everyone.
  It closes if the race starts meanwhile. Deploy frontend and backend
  together (old frontends still work: the seed is optional).
- **Start waits for the land** (`GameScreen.tsx`): v2 maps take longer to
  build than Sky Isles, and in races nothing glides in, so a time trial's
  Start (and `Enter`) waits until the land around you is in, reading
  "Loading the map…". In a room, your own Start does too; someone else can
  still start, and the 5 s countdown is all the land gets.
- **Run top bar** (`GameScreen.tsx`): "Level 1/8 · map · mood", without the
  run's seed (it was "Run #seed · level 1/8 · …"); test mode keeps its seed
  and also says "Level".
- Verified: lint, build and 64 frontend tests pass (Node 24; the run test
  checks every level's seed stands for its map, eight different maps, runs
  starting on every map); 24 backend tests (one new: a room created and
  switched on a given seed). In the app's browser on the dev server with
  this branch's backend: a room created from the Glacier card (#14), `N`
  in its lobby, the Reef card, Enter: the room on #13 and still in the
  lobby; `Esc` closes it unchanged; the Adventure card for today's run,
  the Reef card, a run started on it (`?run=13`, level 1 the Reef).
  In headless
  Chromium on the dev server (software GL): time trials on Sky Isles (16),
  the Reef (13), Glacier (14), Lagoon (6) and Ember (12): an early `Enter`
  is ignored, Start comes back after 3 s (Sky Isles) to 20 to 32 s (the
  others, software GL), and GO always finds the land ready. In the app's
  browser: the landing card and all 11 course cards. Not checked: load times
  on a real GPU, a two-player room on a v2 map (the map switch reaching a
  second pilot), every map's race by hand, a run through a portal to its
  second map by hand (the test checks the order).

### 2026-10-10: Keep the coat's scarf ribbons above its moving surface

- Fixed a remaining cloth overlap after the feet/cape repair: the cape and
  scarf tails cleared the legs independently, allowing a raised cape ripple
  to pass through a ribbon or leave the two surfaces at the same depth.
- `frontend/src/game/avatar.ts`: after shaping the cape and each ribbon,
  compare their triangles in chest space. Enclosed corners and projected edge
  crossings determine the required lift across each entire ribbon triangle;
  shared vertices receive the largest neighboring correction. This preserves
  the ribbon's flutter while maintaining a 0.02 model-unit gap above the coat,
  including between mesh vertices. Reuse triangle/vector/buffer storage, retain
  the distant-pilot detail cutoff and add no draw calls. Gameplay is unchanged.
- `frontend/tests/avatar.test.mjs`: added 11 ribbon-interior regression scenarios
  covering low speed, braking turns, boost, hover, surf, flare, butterfly,
  falcon, maximum ripples, ghosts and crashes. These and the eight existing boot
  scenarios pass; the regression file fails with the pre-ribbon-fix avatar.
- Production build and lint pass, with the existing bundle-size warning.
  Full frontend test run: 13 files pass; the same seven pre-existing untracked
  camera/debug/flight-realism/input/terrain test files fail. Backend untouched.
- Headless Firefox: inspected matching before/after rear and side screenshots,
  day/night lighting and ability/crash poses. Across ten sampled views, no
  ribbon/coat overlaps remain and the minimum gap is about 0.02 model units;
  no JavaScript errors. A local Node CPU microbenchmark measured roughly
  0.36 ms added per detailed avatar update; this is not a focused-window FPS
  measurement. Manual gameplay and integrated-GPU performance remain unverified.

### 2026-10-10: Keep the feet beneath the cape at low speed

- Traced the glitch to geometry overlap: stronger low-speed cape ripples and
  bent knees let the boots pass through cloth animated independently of the legs.
- `frontend/src/game/avatar.ts`: reuse bounds of the animated thighs and boots
  in chest space, and smoothly push overlapping cape and scarf vertices behind
  them. Clearance includes ink outlines and spacing between cloth samples, so
  the connecting triangles also cover the boots. Bounds and matrices are reused;
  flight physics, gameplay collisions, timing and scoring are unchanged.
- Added `frontend/tests/avatar.test.mjs`: eight regression scenarios covering
  stationary/slow climbing, braking turns, hover, surf, fast boost, ghosts and
  crashes. The regression file fails with the original avatar code and passes
  with the fix.
- Verified frontend production build and lint; the build retains its existing
  bundle-size warning. Full test run: 12 test files pass, seven pre-existing
  untracked test files fail (camera, debug, flight-realism, input, terrain-arches,
  terrain-audit and terrain-minimum). Confirmed those same seven failures with
  the original avatar code; some import missing modules. Backend untouched.
- Headless Firefox: overlap in 399 of 600 low-speed frames before the fix,
  none afterward across 604,800 sampled boot positions. Inspected the isolated
  pilot from rear/side views, in day/night lighting and ability/crash poses;
  no JavaScript errors. Manual gameplay and focused-window performance remain
  unverified.

### 2026-10-10: Review PR #33 against current main

- Resolved the change-log conflict with main, preserving the Adventure UX
  entry and the newer terrain/streaming entries in `CLAUDE.md`.
- GitHub required the asynchronous stack merge API; the other stack PR (#31)
  was already merged. Automatic rebase failed, so replayed the two PR commits
  directly onto main, preserving their authors, with the same reviewed source.
- Reviewed biome previews, theme updates, checkpoint labels and the settings
  overlay's pause/input handling. The PR's game changes expose HUD data only.
- `RunHud.css`: give toast notifications a minimum top offset of 14rem so
  they stay below the compass moved to 10rem. `GameScreen.css`: move the
  narrow test panel below it too. This corrects overlapping positions on
  short screens; inferred from CSS, not visually confirmed.
- Verified frontend production build, lint and all 64 tests. On local Node
  22.14, tests use `--experimental-strip-types` and an equivalent asynchronous
  `module.register` resolver (the checked-in hook needs Node 22.15 or newer).
  The build succeeds with its existing bundle-size warning. Backend untouched.
- Browser verification unavailable: Chrome connected, but the control tool
  rejects the API-key session with `unsupported Codex auth method: apikey`.
  Follow-up: inspect toasts, compass and the test panel at laptop and phone
  sizes, plus the three menu tabs, all nine biome previews and in-game settings.

### 2026-10-10: Mobile playtest fixes for PR #32

- Restored every change-log entry from main and removed the orphan duplicate heading.
- `Input.observe` feeds the tutorial the same merged pitch, roll, boost, brake
  and one-off actions as flight. Solo, room and run sessions subscribe it;
  all six steps work with touch and tilt, with instructions that honor inversion.
- Added Plunge and Gale buttons for acquired abilities; corrected Hover-Stall
  press instructions and replaced picker key hints with touch button names.
- Signed gravity-based lean distinguishes both sides of a flat hold; enabling,
  resuming and screen rotation calibrate both pitch and roll. Bank alone no
  longer changes pitch in landscape. No flight-model changes.
- Short-screen picker clears the top bar; score and compass clear each other;
  the run intro hides the flight panel and scrolls by touch; the stick draws
  above the read-only HUD. Phone/tablet test controls are buttons above the
  left thumb area. Help and test-mode finale skipping work by touch.
- Rebased onto main (no merge commits); the 68 count below was measured before the rebase.
- Build and lint pass; 68 frontend tests including signed tilt, calibration,
  inversion and observer cleanup. Headless Chrome: six touch tutorial steps,
  keyboard tutorial, acquired ability actions, pause/resume, picker and layouts
  at 844 × 390, 667 × 375 and 1024 × 768; simulated sensor and touch help,
  portrait rotation, intro scrolling, victory preview and finale skipping.
- Real Android/iOS sensor signs, permissions, landscape lock, wake lock,
  notches, control feel and focused-window performance still need devices.

### 2026-10-10: Adventure in the Solo look, a map select for every biome (Claude)

Asked for by the UX group, on `shiyu-unify-ui` (from `shiyu-tutorial`): the
landing page's other tabs and the adventure's screens in the style of Solo,
and a map select that shows off every biome (wished for by the roguelike
designer). UI only: runs play as before.

- **Landing tabs** (`Menu.tsx`, `Menu.css`): With friends and Adventure get
  Solo's layout: a card (label, title, chips), the big button, a row of small
  links. Adventure: "Today's run · #seed" / "Eight biomes", chips for your
  best and "New in", Start today's run (`Enter` works on this tab too),
  Choose a map, New random run. With friends: "Race room" / "Same map, same
  time" / "Up to 12 pilots", Create a room, and a quieter join row (rounded
  field, light button).
- **Choose a map** (`BiomeSelect.tsx`, on `CourseSelect.css`): the course
  select's carousel, a card per biome in run order (Sky Isles, Verdant, the
  middle six, Aurora): its place in a run, name, tagline, moods, and art
  from `public/biomes/<id>.jpg`. The backdrop flies the biome's showcase
  level (`runLevel(2, 1, biome)`, what `/?explore=<id>&seed=2` flies;
  `MenuBackdrop`'s new `level` prop) and the UI takes its colors. Start
  today's run (`Enter`) starts a normal run: the chosen biome doesn't change
  where a run starts (that would be a gameplay change, for the run's
  designer).
- **In a run** (`GameScreen.tsx`, `RunHud.tsx`, `RunHud.css`): the intro
  panel is now the time trial's start pill (Take off); the score sits in a
  glass pill like the race timer, with "Level N / 8" and the chain under it;
  the compass under the pill, its label white with an ink edge; objectives
  (hidden when empty), abilities and toasts on glass; done objectives in
  ink. The intro's text and Controls fold-out are gone (How to fly and the
  settings have them).
- **Colors follow the level** in runs and explore (`usePaletteTheme`,
  `HudState.palette`); before, they kept the menu's. The landing page takes
  the colors of whatever its backdrop shows.
- **Crash note in runs:** "Back to gate N" (the run's last gate,
  `RunHud.checkpoint`) instead of "Back to the start".
- **Settings in game:** a gear at the top right, after the "?", as on the
  landing page (`SettingsButton` in `GameScreen.tsx`, the `TopBar`'s
  `controls`): it opens the settings with the game held paused
  (`holdGame`). The pause box lost its Settings button and sits in the
  middle of the screen.
- Biome card art rendered in headless Chromium (software GL, so no bloom)
  from the backdrop's drift view at z = 400 or 900.
- Verified: build, lint and the frontend tests pass. In the app's browser
  on the Docker build: the three tabs, the map select through all nine
  biomes (labels, moods, colors), `Esc` back to today's colors, a run's start
  pill, score pill, compass and colors. Not looked at: the upgrade picker,
  title card and finish screen (unchanged), phones.
### 2026-10-10 — Natural river-to-waterfall transitions

- Fixed waterfall foam drawing over the upstream river: pool surfaces now
  write depth, so the later curtain draw is correctly occluded. Dry padded
  banks are discarded before writing depth (`game/world/water.ts`).
- Joined curtains to the exact upstream cross-section, carrying the river's
  depth tint, flow, foam and surface normal across the lip. Curtains arc
  downstream and downward; river shading blends into falling foam over the
  first 0.2 m of drop. Both river and island waterfalls animate foam downward
  through a fixed travel coordinate, accelerating with the drop without
  reversing as elapsed time grows.
- Added subtle, broken animated foam at the lip, fading within 0.9 m upstream.
  Its width is evaluated per pixel so coarse river vertices cannot spread it
  upstream. Exposed `WATER.fallBlend`, `fallSpeed`, `lipFoam` and `lipFoamWidth`
  in `game/tuning.ts` and `?tune`; updated README and the architecture map.
  These are rendering changes only; seeded generation and collisions are unchanged.
- Added `frontend/tests/water.test.mjs` to check pool/curtain continuity and
  downstream-only geometry across five biomes and three seeds. Frontend build,
  lint and the water regression test pass; build retains the bundle-size
  warning. Browser checks covered morning and moonlit upstream/downstream
  views, falling animation and lip foam, with no JavaScript errors. Hiding
  the curtain left the upstream river pixels identical after the depth fix.
  The full test run remains blocked by failures in seven pre-existing
  untracked test files with missing modules or stale expectations.

### 2026-10-10 — Rebase mesh fixes for review

- Rebased onto main at `9f3d70c`, preserving both sides of documentation
  conflicts and the upstream biome, adventure and terrain changes.
- Squashed the completed mesh-fixes work for review. Verified the combined
  tree with frontend build, lint and all 64 tests; build reports a bundle-size
  warning but succeeds.

### 2026-10-10 — Approach detail and crystal facets (`mesh-fixes`)

- Removed the new contour/vein shader lines. Glow now follows facets at a
  restrained 0.18 multiplier, with bounded per-face variation in the mesher.
  This applies to crystal and volcanic terrain; no random full-bright faces.
- Added crystal-only optical shading via a per-vertex `crystal` tag, transferred
  by workers, remapped through cleanup and bound by the streamer. Aurora's
  crystal surface opts in; ordinary stone does not. Tinted cores, pale edges
  and restrained view-dependent highlights fake translucency without alpha
  blending, refraction passes or changed collision geometry.
- Mountains gain bounded medium-scale heightfield relief (`TERRAIN_DETAIL`):
  amplitude is biome roughness × 3, only within the mountain mask. This adjusts
  local heights and ground-based placement by a few metres; large forms and
  course parameters remain. Detail is attached to the heightfield at every LOD.
- Selected coherent patches receive small tangential cell-vertex offsets,
  capped at 0.8 m and contained in their source cells. Shared global cell
  coordinates reproduce exact border positions. Comparable healthy quad
  diagonals vary deterministically to break up the square lattice. No extra
  triangles are added by this variation; calm patches remain calmer.
- Added a fourth v2 LOD: 3 m voxels in 48 m nodes, then the previous 6/12/24 m
  sampling in 96/192/384 m nodes. Root footprint is unchanged. `lodDetail=140`
  requests finest terrain based on distance to node bounds in every direction,
  including mountains off the course. `lodNear=300` and `lodFar=700` retain the
  previous outer tiers. Finest-cell size is smaller than the 4.2 m collision
  wingspan; it is not a 3 m activation distance.
- Game passes flight velocity through WorldView to LandStreamer. Requests
  consider both the camera and a two-second predicted position, capped at
  240 m, retaining nearby terrain behind/to the sides. Prediction changes
  trigger updates even without camera movement. Tunables are in TERRAIN and
  the tuning panel. Nearby missing terrain retains priority; existing visible
  meshes stay until replacement workers finish. Existing LOD hysteresis and
  bounded cache remain. Full flora and tree colliders now use 48 m finest nodes.
- Loading readiness now accepts visible ancestor or complete descendant coverage.
  LOD upgrades/downgrades no longer trigger auto-gliding while usable terrain
  remains; genuinely missing terrain retains the safety fallback. Regression
  tests cover both replacements and incomplete coverage.
- Kept bounded ground noise, shared sample coordinates, closed-fragment cleanup
  and conservative border protection. Mixed-LOD joins retain overlapping cells;
  this does not introduce true adaptive stitching or geometric crossfading.
- Verified build, lint and 47 frontend tests, including finer sphere geometry
  with scattered vertices and closed joins/collider hits, crystal-only tagging,
  all four sampling levels, approaching a node
  960 m off-axis, speed cap, turning away and nearby stationary detail. Aurora
  dawn/night and a fixed side-mountain view inspected in browser: irregular facets,
  crystal optics, no painted crystal lines or shader
  errors. Performance on integrated GPUs and flight-speed transition playtests
  remain open; additional close-range geometry costs more than the old finest tier.

### 2026-10-10 — Fix glowing faces and floating mountain sheets (`mesh-fixes`)

- Traced the mountain fragments to ground detail, not just LOD or mesh cleanup:
  `(y - height)` was divided by the slope magnitude, then overhang and roughness
  noise were added without that scale. At steep ridges, metre-sized noise could
  create solid samples hundreds of metres above the ground. `Ground.sample`
  now shares the slope scale with `TerrainField.distance`; `shape` applies it
  to overhangs and `fill` applies identical arithmetic to cached-column roughness.
  Mountain heights/recipes and explicit rock shapes are unchanged. Near-surface
  geometry and v2 proximity distances do change; collisions follow drawn meshes.
- Ground-only survey, seed 2, lateral 350..1000 m by 25, z 0..900 by 30,
  height +24..240 by 12: stray solid samples Ember 170 -> 0, Glacier 227 -> 0,
  Verdant 94 -> 0 (15,903 queries each). Old noise created rock up to 204 m
  above Ember/Glacier height, 180 m in Verdant. Regression also checks below
  the mountains and exact Float32 agreement between block/point queries at
  voxel spacings 6/12/24 m. Shared coordinates remain deterministic across chunks.
- Fixed terrain emission: the mesher previously chose near-full emission for
  occasional whole faces from a centroid noise sample. `Surface.glow` is now
  emission strength, and the material draws continuous world-space veins with
  subpixel fading. This fixes the effect at all LODs, independent of crashes or
  player distance. Terrain geometry, gate glow and lava material are unaffected
  by this lighting change.
- Validation: build, lint, 44 frontend tests; same-camera neutral-light mountain
  comparison at near and distant detail, and Ember dusk gameplay shader check
  with no logged errors. In the fixed 384 m mountain region, near triangles
  79,614 -> 55,968 and distant triangles 20,734 -> 16,662. These are geometry
  counts, not FPS. Base peaks remain sharp; mixed-LOD stitching, additional
  seeds and integrated-GPU frame profiling remain follow-ups.

### 2026-10-10 — Keep floating stones, remove shards (`mesh-fixes`)

- Removed face-centre displacement/refinement (`snap.ts`) from both meshers:
  it still produced small pyramids and amplified the appearance of fragments.
  New `meshCleanup.ts` welds exact positions and measures closed components by
  3V/A thickness and physical extent, rather than throwing away low-poly rocks.
- Thin detached shells under 36 m are removed. Compact stones under 24 m with
  at most 80 faces get one Loop subdivision at full detail, rescaled to preserve
  their bounds. Most land is untouched. Narrow attached tips can shorten by up
  to 3 m, with all incident triangle windings checked before moving a vertex.
  These thresholds live in `MESH_CLEANUP` in `tuning.ts` (worker source settings).
- Preserve every open/non-manifold edge and a one-cell chunk-border collar;
  never remove individual triangles to fix a shard. Border-crossing fragments
  deliberately remain. Mixed-LOD overlap/stitching remains as before. Paint is
  remapped per original face; colliders consume the final output triangles.
  Distant v2 nodes retain their previous geometry/cost; cleanup runs at full
  detail. Race tree placement, density fields, course seeds and rings stay unchanged.
- Survey: 105 fine chunks across seven biomes, seeds 2/7/42, at course-start
  z + 100/250/400/650/900 and x + 100. Before/after triangle totals by biome:
  Glacier 28,788/13,548; Verdant 32,806/16,708; Ember 32,942/16,178;
  Archipelago 10,824/4,420; Lagoon 18,314/10,262; Twilight 27,678/14,624;
  Aurora 31,924/15,572. Single local survey generation time was 1,027/794 ms;
  order/JIT dependent, not a frame-rate benchmark. Stone refinement was rare
  (three preserved components gained 36 faces each); closed slivers were removed
  in nine sampled chunks. Most savings come from removing centre fans.
- Validation: build, lint and 41 frontend tests; regression coverage includes
  compact stone bounds/watertightness, sliver removal, border/open-shell
  preservation, attached-tip winding, 105 seeded chunks, closed adjacent chunk
  joins and collision rays. Race seeds 1/7/42 match documented tree/density/ring
  hashes. Browser inspected before/after Verdant stone from two angles, Ember
  cliff and Glacier fragments under neutral light, plus Verdant gameplay with
  no rendering errors. Full seed coverage and integrated-GPU profiling remain.

### 2026-10-10: Mobile playtest fixes for PR #32

- Restored every change-log entry from main and removed the orphan duplicate heading.
- `Input.observe` feeds the tutorial the same merged pitch, roll, boost, brake
  and one-off actions as flight. Solo, room and run sessions subscribe it;
  all six steps work with touch and tilt, with instructions that honor inversion.
- Added Plunge and Gale buttons for acquired abilities; corrected Hover-Stall
  press instructions and replaced picker key hints with touch button names.
- Signed gravity-based lean distinguishes both sides of a flat hold; enabling,
  resuming and screen rotation calibrate both pitch and roll. Bank alone no
  longer changes pitch in landscape. No flight-model changes.
- Short-screen picker clears the top bar; score and compass clear each other;
  the run intro hides the flight panel and scrolls by touch; the stick draws
  above the read-only HUD. Phone/tablet test controls are buttons above the
  left thumb area. Help and test-mode finale skipping work by touch.
- Build and lint pass; 52 frontend tests including signed tilt, calibration,
  inversion and observer cleanup. Headless Chrome: six touch tutorial steps,
  keyboard tutorial, acquired ability actions, pause/resume, picker and layouts
  at 844 × 390, 667 × 375 and 1024 × 768; simulated sensor and touch help.
- Real Android/iOS sensor signs, permissions, landscape lock, wake lock,
  notches, control feel and focused-window performance still need devices.

### 2026-10-10: Touch controls rebased onto main (Claude)

PR #32 conflicted with `main` (Pengyue adventure, tutorial). The original rebase lost earlier change-log entries; the follow-up restores them. Main made Hover-Stall a one-off press (`hover` action, upgrade id
`hoverStall`), so the touch Hover button now taps like Flap (`Input.touchHover`
and `Input.hovering` are gone) and `Game.hud` shows it for `hoverStall`. Plunge and Gale Force buttons were added in the playtest follow-up. Verified: build, lint and 49
frontend tests pass. Not tried on a device.

### 2026-10-10: Phones and tablets: landscape, touch controls, tilt steering (Claude)

Asked for: support mobile, in the sense that it should be horizontal, and
the tilt sensor if possible. There was no touch input at all before.
- **Landscape**: held upright on a touch device, every game screen shows
  "Turn your device sideways to fly" (CSS only, `Touch.css`; the Menu button
  stays in reach). The first finished tap in a game goes full screen and
  asks for a landscape lock, which Android honors (it turns the screen even
  with rotation locked); iOS has neither API, so there the prompt is all.
  Full screen is left again when the game screen closes. The menu is not
  forced sideways. `manifest.webmanifest` (landscape, fullscreen) for a page
  added to the home screen; `viewport-fit=cover` and safe-area insets for
  notches.
- **Touch controls** (`game/touch.ts`, `TouchControls`): drag anywhere on
  the view for a stick under your thumb (56 px for full deflection), hold
  Boost or Brake, `‹` `›` dodge, Flap and Hover once a run has them,
  Respawn and Pause (Resume while paused). They feed `Input` (`touchX/Y`,
  `touchBoost/Brake`, `onAction`), so the flight model sees the same
  `FlightInput` as from keys (rule 6: no gameplay change). Hidden while
  there is nothing to steer (a run's start panel, the wormhole, the victory
  lap). Like keys, held buttons are let go by a respawn.
- **Tilt** (`game/tilt.ts`): the Tilt pill turns it on (iOS asks for
  permission then). Turning the device like a wheel banks (29° for full),
  leaning its top away dives (21° for full), 2° dead zone; level is the hold
  when it is turned on or when you resume from pause. Angles come from the
  direction of gravity and `screen.orientation.angle`, so both landscapes
  work and nothing jumps near upright. The stick still works on top of it.
  Browsers only give the sensor to https pages (or localhost). A screen wake
  lock keeps the phone awake.
- **Settings**: "Touch and tilt": tilt sensitivity (0.4 to 2.5) and "Invert
  touch and tilt up / down" (`tiltSensitivity`, `invertTouch`).
- **Touch mode in the UI** (`html.touch`): key caps and the mouse hint are
  hidden, the pause card says "Tap Resume", the run intro explains the touch
  controls, the finale's skip is a button, the run's ability meters move to
  the left corner, the top bar leaves room for the pills.
- **Short screens** (`max-height: 520px`): top bar, timer, ready card,
  panels, countdown and the flight panel are more compact.
- Fixed on the way: `requestPointerLock` doesn't exist on iOS Safari, so a
  tap on the view threw; taps no longer ask for a pointer lock at all.
- Verified: build and lint pass; 34 frontend tests (new: the touch stick and
  buttons through `Input`, and `tiltAngles` flat, upright, in both
  landscapes and past upright). In headless Chrome with a coarse pointer
  (software GL): a time trial at 844 × 390 (pills, ready card, flight panel
  and buttons don't overlap) and the sideways prompt in portrait.
- **Not verified: nothing was tried on a real phone.** The stick and
  buttons under real fingers, tilt (the sign of each axis on a real sensor,
  the iOS permission prompt, the feel of the ranges), full screen and the
  landscape lock on Android, the wake lock, notches, and a run's screens
  (upgrade picker, finish screen) on a short screen are all untested.

### 2026-10-10: The design list's abilities 11 to 20 (Claude)

Asked for: the second ten abilities, each with models and animations in the
game's style, adapting descriptions that don't fit the game. A deliberate
gameplay change in **runs only** (rule 6): everything reaches the flight
through `FlightMods` (new `turn`, `climb`, `ascend`; all no-ops at their
defaults, tested) or run-only `Flight` methods (`surge`, `ascendStep`);
races, time trials and ghosts fly the plain model.
- **Rules** (`run/abilities.ts`, `ABILITY` in `?tune`):
  - Moth's Attraction: a gate passed near its heart surges you up to 14 m/s
    (none above 100 m/s); inside a quarter of the radius is a bullseye
    ("Through the heart").
  - Zenith Climber: on steep climbs gravity pulls back 1/1.2 as hard, so a
    climb straight up keeps its speed about 17% longer (drag still acts;
    tested between 12 and 22%).
  - Resonance (T): a wave rolls out 260 m in a 42° cone; every gate it
    reaches turns to face where you were (`attuned`), for the gate test
    (`gateNormal`) and the crystals (`CrystalGates.orient`). For the level; 6 s
    cooldown.
  - Ley-Line Surger: five gates each within 7 s of the last wake a ley line:
    the boost never runs out while gates keep coming (9 s), a crash ends it.
  - Aero-Braking: there is already a held brake, so the upgrade turns its
    press into a flare (0.55 s of hard braking down to 20 m/s, then steering
    ×2.3 fading over 1.3 s), every 3 s.
  - Draft-Weaving: 270° of tight turning in any direction, or two barrel
    rolls, spins up a tornado (14 s); it shields one glancing hit (body or
    wing, at most cos 0.55 into the surface); head-on still crashes.
    `Game.recover` became `Game.rescue`, which asks `Abilities.save`.
  - Ascension (G): 0.4 s on rails swinging the nose straight up and the speed
    to 75% of what it was (32 to 58 m/s); then gravity takes over. 8 s.
  - Falcon and Butterfly (H; with both, it cycles off → falcon → butterfly):
    blended multipliers over 0.45 s. Falcon: sink ×2.4, drag ×0.62, steering
    ×0.55. Butterfly: sink ×0.3, drag ×2.2, steering ×1.75, stall ×0.6.
  - Echo-Trail: the last 9 s of the path are kept (12 samples a second); when
    you come back within 6 m of it after 320° of turning and 45 m of flight
    (a loop, a circle), it becomes a wind ring: +12 m/s and a push for 1.4 s,
    and the ring hangs where you drew it for 6 s (fly it again for more).
    Turning on the spot in a hover-stall doesn't count (a test caught it).
- **Looks** (`abilities/models2.ts`, `abilities/fx2.ts`; `ABILITIES_FX`
  moths, wind, song, ley, echo in `?tune`): spirit moths dancing round the
  next gate's heart and swirling round you after it; Zenith's updraft funnel
  and gold feathers, a star at the apex; Resonance's call, three rings and a
  cap of ripples and notes, gates swinging round like weathervanes with a
  ring of notes; ley pips (one per gate of the chain), the ley line as a
  golden thread of runes from you through the next gates, violet wingtip
  ribbons; the air cushion and spilling wisps of the flare; the tornado with
  leaves; Ascension's wind column (Genshin's wind currents) and a ground
  ring; a falcon of light swooping onto you, a great butterfly unfolding
  behind you, contrails (falcon), small butterflies and pollen (butterfly);
  the Echo-Trail ribbon and its wind ring. Poses (`Avatar.stance`): climb,
  sing, flare, falcon, butterfly (the cape fans wide for the butterfly and
  is thrown forward in the flare; `updateCloth` takes a spread). Sounds:
  `GameAudio.ability2`.
- **Controls**: T Resonance, G Ascension, H stance (gamepad: left stick
  click, d-pad up, d-pad down); Aero-Braking is on the brake. Saved bindings
  that already use a new action's default key no longer throw every binding
  away: the new action gets a spare key (`storage.ts`). Controls list,
  README and HUD keys updated.
- Also: `RingQuads` styles 3 (a clean ring) and 4 (ticks), with no glow
  inside: bloom filled big bright rings into white discs on a day sky.
  `AbilityFx` and `AbilityFx2` stay hidden inside a wormhole (`inWormhole`):
  `update()` used to show the group again every frame.
- Verified: build and lint pass; 60 frontend tests (Node 22.14 with a
  `module.register` resolver; new `tests/abilities2.test.mjs`, 11 tests, and
  a settings test). In Chrome on the dev server (`/?test&seed=7`, all ten
  granted with `__game.grant`, frames stepped by hand in a hidden tab, the
  camera placed by script): moths at a gate and swirling, Resonance's rings
  and a gate turned (19°), the ley pips and line, the flare, the tornado, the
  wind column, the falcon spirit, the butterfly spirit and stance, a real
  loop closing the Echo-Trail (radius 10.8 m) and its ring, a Zenith climb;
  Verdant Moonlit with several at once. Fixed on the way: the call's glare
  and the echo ribbon streaming white past the camera, the flare's particles
  (white diamonds up close), pips that bloomed to white, the filled rings.
  `__bench` (hidden tab, so relative only): about +0.2 ms CPU a frame with
  everything active, GPU within noise; no console errors.
- Not checked: sounds (not listened to), feel with a mouse or gamepad,
  balance, most effects at night, a bullseye or ley line or tornado save in
  real play (triggered by hand), frame time in a focused window. Rebased
  onto `main` (`9f3d70c`) for its pull request: only this file conflicted;
  `RunHud`'s `ABILITY_ACTIONS` now maps the new abilities to their keys.

### 2026-10-10: Rebased onto main's Pengyue adventure (Claude)

PR #31 conflicted with `main` (`e374fef`); rebased (no merge commits allowed).
Conflicts in `CLAUDE.md`, `README.md` (both sides kept) and `App.tsx` (main's
`route.ts` imports plus the tutorial's storage imports). Main renamed Hover to
`hoverStall` and added `plunge` and `galeForce`, so `RunHud`'s
`ABILITY_ACTIONS` maps them to the bound keys. Verified: build, lint and 48
frontend tests pass. Not checked in a browser.

### 2026-10-10: Merged `main` (Sunken Reef, Lagoon sea, portal rework, Wind Rider) into `Pengyue` (Claude)

For PR #30. Conflicts, both sides kept: `audio.ts` has the abilities'
`whoosh`/`glide`/`ability` and main's `sweep`/`portalHum`; `tuning.ts` has
`AUTOPILOT`, `ABILITIES_FX` and main's `DEEP`; README and this file merged
by hand (run order with the Reef, abilities in the upgrade blurb).
Verified: build and lint pass, 48 frontend tests (Node 22.14 with a
`module.register` resolver). In Chrome: `?test=reef&seed=2` flies the Reef
with the test panel and run HUD; Shift+P, Shift+S, Shift+O, a granted
ability and a portal into the picker work; no console errors.

### 2026-10-10: Autopilot on the racing line, orbiting camera in the wormhole (Claude)

Asked for: an autopilot that never hits the terrain, always flies through
the middle of every gate and keeps a safe distance from the land; and a
cinematic camera in the wormhole that circles the pilot in every direction
so the pilot always seems to fly forwards.
- **Why it crashed**: `Game.autopilot()` steered the flight model towards
  the line 35 m ahead in z, so it cut corners and sank on the way. Headless
  simulation (same flight model and hitbox, against the distance field):
  3 to 7 crashes per Sky Isles course, seeds 1 to 42.
- **`game/autopilot.ts`** (new): flies the racing line on rails. The line
  goes through every gate's centre, and both generators carve an 11 m tube
  around it that rock, trees and structures keep out of. The speed follows
  the slope against `FLIGHT.drag` (31 to 43 m/s), the bank follows the
  line's curvature like a coordinated turn (`AUTOPILOT.railBank`, banking
  `railLead` s early), and a start off the line settles onto it over
  1.2 s. `Flight.place` sets the state without the flight model. `Game`:
  `autopilotStep` replaces the physics step while self-flying (no crash
  test, no glide-in; gates still shine); the old `autopilot()` is gone.
  It now loops 40 m past the finish instead of 100: on Coral Lagoon the line
  reaches the sea about 90 m past the finish. Looks only (rule 6): nobody
  plays, nothing is scored or saved.
- **Wormhole** (`run/portal.ts`, `run/controller.ts`): `WormholeCamera`
  takes the chase view on the way in and eases, over 4 s, into an orbit
  around the pilot: once round every `RUN.orbitLap` s (26), swinging
  `RUN.orbitTilt` rad above and below, at about `RUN.orbitRadius` m, with a
  slight crane roll. On the way out it swings the shortest way back to the
  chase pose, which it reaches as the blur peaks (no cut). The tube is now
  fixed to the pilot's heading, not the camera's view: spirits stream past
  the pilot, the shell stays centred on the camera. The shell's stars and
  nebula used to drift into the far end (looked like flying backwards);
  they now stream out of it. `RUN.wormholeFlow` sets the speed (spirits are
  about twice as fast as before).
- Verified: build and lint pass; 44 frontend tests (new
  `tests/autopilot.test.mjs`: Sky Isles 42 and 7, Lagoon, Ember: every gate
  passed within 0.5 m of its centre, hitbox more than 6 m from the land).
  Simulation over 12 Sky Isles seeds and 3 seeds of each run biome: zero
  contacts, every ring passed at its centre, at least 8.8 m between any
  hitbox point and the land's distance field. In Chrome (dev server):
  victory lap on Sky Isles seed 42 for a full lap and its loop, no crash,
  at most 0.01 m off the line; run 7 through the portal, the camera went
  from behind-above to in front-below over 12 s, the pick, and the way
  out arriving 10 m behind the pilot; no console errors. Clearance was
  measured against the distance field, not the drawn mesh (off by about
  1 m at most). Frames were stepped by hand in a hidden tab, so the orbit's
  smoothness and the feel of the 0.4 s swing back weren't watched in real
  time.

### 2026-10-10: Test mode brought onto `Pengyue` (Claude)

Asked for: move every test-mode function and the test panel from
`claudia-debug` onto `Pengyue`, so it stays while `Pengyue` moves on.
- Cherry-picked `4acb722` (test mode) and `2819fc0` (its fixes: `route.ts`,
  `&test` on any single-player URL, run HUD and panel layout, docs, tests).
  Not merged: `claudia-debug`'s merges of `main` stay out.
- Conflicts with the abilities work: `input.ts` keeps the new actions
  (hover, plunge, burst) and adds `TestAction`; `Game.loop` keeps the
  non-negative frame clamp and scales it by the test playback rate
  (adaptive quality reads the unscaled time). Docs: both sides kept.
- Verified: build and lint pass; 45 frontend tests (Node 22.14 with a
  `module.register` resolver). In Chrome: `?explore=verdant&seed=2&test`
  opens Verdant as `?seed=2&test=verdant`, the panel and run HUD show,
  Shift+P puts the portal 40 m ahead, Shift+S halves the rate and relabels
  the panel, `__game.grant` still works in a test run, a portal opens the
  picker and leads to level 2, Shift+O shows "Test #2 · complete"; no
  console errors. Keys sent as script events, not typed.
- The `?debug` variant on `origin/claudia-test_mode` (buttons, portal
  distance setting) is a different implementation and was not brought over.

### 2026-10-10: The design list's first ten abilities (Claude)

Asked for: write the items and abilities list into this file (the new
section "Items and abilities"), then build only the first ten abilities,
with models and animations in the game's style, adapting descriptions that
don't fit the game. A deliberate gameplay change in **runs only** (rule 6):
everything reaches the flight through `FlightMods` and the run controller;
races, time trials and ghosts fly the plain model (tested: default mods
change nothing).
- **As upgrades** (`run/upgrades.ts`): ten new cards offered at portals.
  Featherfalling replaces Featherweight (same idea, stronger: sink ×0.55,
  stall ×0.8, drag ×0.92 per stack) and Hover-Stall replaces the old hold-F
  Featherfall hover; saved run summaries with those ids just show a dot.
  The offers per run seed changed.
- **Rules** (`run/abilities.ts`, `ABILITY` in `?tune`): Skim-Booster refills
  the boost with proximity ("thrill"). Cloud-Surfing: no cloud in the game is
  reachable from the line (puffs float 160 m up, the cloud sea is below the
  abyss), so the ability gathers three or four rivers of cloud along the line,
  5 m under it; surfing up to 7 m over one pushes you (to 62 m/s), refills boost
  and wingbeats and doubles cooldowns. Plunging Attack (X): the nose is hauled to
  62° down with a push; a gate passed mid-plunge is a strike (300 × chain,
  half the cooldown back); pulling up ends it. Wind-Shear Dash: Q/E become a
  9 m blink in 0.16 s, every 0.8 s. Thermal Vision is information only: warm
  rings over every gate ahead and the portal, through fog and rock, rising warm
  air along the line, the manta and lanes glowing from afar (there are no
  updrafts or boost rings yet; gates stand in). Slipstream Rider: there are no
  moving things in runs, so the ability brings one: a spirit manta that glides
  the racing line ahead of you (inside the tube), waits when you fall behind,
  surges when you close in, comes back ahead if lost; within 34 m behind it
  you're pushed (to 74 m/s). Gale Force (Z): energy from gates, skimming and
  time; a 320 m tunnel ahead for 4 s, pushing you inside it, gates inside get
  6 m more radius. Acrobatic Recovery: a wing (never the body) touching rock
  glances off (`Flight.deflect`, 92% speed kept) and barrel rolls away, every 4 s;
  if it can't be got clear, it's a crash after all. Hover-Stall (F): 2 s with the
  flight model off (`Flight.hangStep`): the speed bleeds away, steering turns
  you on the spot, then (or on F again) you launch at 80% of the speed you came
  in with (at least 28 m/s); 7 s cooldown.
- **Looks** (`game/abilities/`, see the architecture map; `ABILITIES_FX` in
  `?tune`): halo of down feathers, thrill flares and ribbons, cloud rivers with a
  surf wake, a comet tail and a strike shockwave, afterimage and wind blades,
  warm gate markers, the spirit manta (with ribbons and a wake), the Gale Force
  tunnel and wind halos, a recovery spiral, the hover sigil with its timer and
  chevrons. Poses (`Avatar.stance`): tuck, hover, cast, surf. Sounds:
  `GameAudio.ability`.
- **Controls**: X plunge, Z Gale Force (gamepad X, right stick click), F
  hover-stall is now a press (gamepad B). Settings saved before these
  actions existed keep their keys and get the defaults for the new ones
  (`storage.ts`). Controls list and README updated.
- Also: `Game.loop` never takes a negative frame time (hand-stepped dev frames
  could interleave with the browser's and run the easing backwards).
- Dev: `__game.grant(id)` gives the running run an upgrade.
- Verified: build and lint pass; 43 frontend tests (Node 24 in Docker; 12 new
  for the abilities and saved bindings). In Chrome (run 7, Sky Isles by day,
  hand-stepped): the manta in flight, the plunge's tuck, the hover pose and
  sigil, Gale Force's tunnel, the blink's leaves and afterimage, a cloud lane
  with the surfing pose, thrill flares, the recovery spiral, a strike's
  shockwave, Thermal Vision's rings. Several were too bright under bloom on a
  white day sky at first (the sigil, tunnel and blades now use normal blending,
  the comet and lanes were dimmed). Not checked: any night biome, a real
  strike or recovery in play (both were triggered by hand), the sounds (not
  listened to), frame time, gamepad. The work was done in a worktree
  (`../ItWorksOnMyMachine-abilities`, on `Pengyue`): the checkout switched
  branches mid-task.

### 2026-10-10: `docker compose up --build` looked stuck at `npm ci` (Claude)

Reported: the build hangs at `Step 4/10 : RUN npm ci`. Not reproduced: on
this machine (Colima, 4 CPUs, 4 GiB) the step finished in 1 to 2 min and
the stack served `/` and `/api/time`. DNS and connect take milliseconds, but
downloads from npm run at about 0.5 MB/s (single tarballs 50 to 120 s), and
without `docker buildx` Compose falls back to the classic builder, which
prints nothing until a step ends.
- `frontend/Dockerfile`: `npm ci --no-audit --no-fund --loglevel=http`, so
  every download is logged and a slow build is distinguishable from a hung
  one.
- Verified: `docker compose build --no-cache frontend` and
  `docker compose up --build -d`; `/` returns 200. The user's own hang is
  not diagnosed yet (needs their log). Installing `docker-buildx` would add
  live progress and npm cache mounts.

### 2026-10-10: Test mode: `&test` on any URL, run HUD, panel layout (Claude)

Asked for: verify what's wrong with test mode, fix it, and make sure the
debug panel works as intended.
- **URL** (new `route.ts`, out of `App.tsx`): `test` only counted as
  `test=<world>`, so `?explore=verdant&test` and `?test&explore=ember` opened
  Sky Isles, and `?run=5&test` opened a normal, saved run. Now `test` wins
  over run, explore and solo URLs (world from `test=` or `explore=`, seed from
  `seed=` or `run=`); rooms and the gallery ignore it. `ExploreSession` drops
  the leftover `explore`/`run` params when it rewrites the URL. Removed
  `ExploreSession.valid` (now `validBiome` in `route.ts`).
- **Screen** (`GameScreen.tsx`, `GameScreen.css`): test mode flies a run but
  showed none of it; it now has the run HUD (score, chain, "Reach the portal"
  with its distance, compass), style points, and `level n/8 · world · mood` in
  the top bar. The panel is a short list whose Shift+S line says what it
  will do (half or normal speed). It overlapped the flight panel below about
  1100 px wide; now compact, and below 840 px it sits on the right under the
  compass.
- **Docs**: `docs/debug-mode.md` described the other branch's `?debug` mode
  (`VITE_ENABLE_DEBUG`, `__PLAYTEST__`, a portal-distance setting) and is
  rewritten for `?test`. README: the `&test` URLs; removed a `Shift+V`
  quarter-speed explore slow motion that doesn't exist in the code.
- **Correction** to the entry below: `tests/test-mode.test.mjs` was never
  committed, and the four failing untracked test files it mentions aren't in
  this checkout. The file exists now: URL parsing (15 URLs) and the chords
  (consumed before pause/boost/pitch, once per press).
- Verified: on a clean worktree of `4acb722` plus these files, build and lint
  pass, and all 33 frontend tests pass (Node 22.14, run with a
  `module.register` resolver: `tests/register.mjs` needs 22.15). In Chrome
  (dev server): every URL above lands in the right world and seed; Shift+P
  moves the objective to 45 m; Shift+S flips the panel's label; Shift+O shows
  "Test #n · complete", nothing in localStorage; Enter flies again; explore
  still switches worlds with N. Panel bounds checked at 390, 700, 840, 900,
  1000 and 1440 px against the flight panel, score, compass, objectives and
  abilities: no overlap. Shortcuts were sent as script events, not typed.
- Not done: the main working tree has another session's uncommitted
  abilities work (`Game.ts`, `audio.ts`, `avatar.ts`, `run/controller.ts`,
  `tuning.ts`, `game/abilities/`) that doesn't compile yet; it was left
  untouched, and these changes were verified without it.

### 2026-10-10: Confirm test mode works with the existing Docker build

- Verified that the URL selects test mode in the normal frontend bundle;
  it has no development-only or debug-build guard. Both Dockerfiles and
  the standard Compose configuration remain unchanged.
- README now documents `docker compose up --build` followed by
  `http://localhost:8080/?test`, without build arguments or debug overrides.
  The pre-existing untracked `docker-compose.debug.yml` is not required.
- Verification: frontend production build and lint pass. Firefox on Vite
  preview confirms test UI in the production bundle (no `__game` dev hook),
  Shift+S at 0.5×, Shift+O opening victory, its CSS animation at 0.5×, and
  saved bests unchanged. Screenshot inspected. No Docker image was built.


### 2026-10-10: Remove biome controls from test mode

- `GameScreen.tsx`: hide the world/light selectors and music diagnostics in
  test mode, and disable its N/B/V world/light shortcuts. Keep the compact
  Shift+P/O/S hints. Explore retains its existing controls.
- `RunHud.tsx`: test victory offers replay and menu, without the next-world
  action. The URL can still select an initial biome; portals still advance
  through the adventure. README and architecture notes updated.
- Verification: frontend build and lint pass. In Firefox, test mode shows
  only Shift+P/O/S hints, with zero world/light buttons; N/B/V leave the URL
  unchanged. Explore still shows both selectors and V changes the light.
  Test panel visually checked. No new tests needed for this UI-only change.


### 2026-10-10: URL test mode with portal, victory and half-speed shortcuts

- `App.tsx`, `ExploreSession.ts`, `GameScreen.tsx`: `/?test` (or
  `?test=<biome>&seed=<n>`) reuses explore's worlds/lights panel and starts
  immediately. Test runs use the existing adventure controller, picker and
  finish screen (`RunHud.tsx`), with explicit unsaved-result text. They never
  call the score-saving RunSession or server APIs. World switches retain
  `?test` and other query flags; invalid biome names fall back to Sky Isles.
- `input.ts`: Shift+P places a usable portal ahead along the pilot's heading;
  Shift+O shows victory with the current stats and autopilot; Shift+S toggles
  normal/half speed. Chords are consumed before pause, pitch and held boost;
  repeats, text fields and open settings dialogs cannot trigger them.
- `run/controller.ts`: accepts the sandbox's starting biome/mood, can replace
  its exit with a nearby portal, and can finish immediately through the real
  summary event. `Game.ts` resets the run cleanly after victory/world changes.
- `Game.ts`, new `game/testPlayback.ts`: scale the shared frame delta before
  fixed-step accumulation and shader time, slowing flight, cooldowns, crash
  recovery, camera, scenery, particles, equipment, portal/finale transitions
  and the victory lap together. CSS animations/transitions (including newly
  mounted picker/finish overlays) get the same playback rate without restarting.
  Adaptive graphics quality still measures real frame time. Rate persists
  across biome changes; leaving the test session restores normal playback.
- Verification: frontend build and lint pass. New `tests/test-mode.test.mjs`
  covers chord isolation/repeats/editing, oriented portal placement and actual
  upgrade entry, initial biome/mood, one victory event with stats, and CSS
  playback/cleanup. Browser: Firefox with an isolated temporary profile,
  test UI and portal visually checked; picker and victory both at 0.5 playback
  rate, saved bests unchanged. One second of manual frame stepping advanced
  game/avatar/portal clocks by 1 s normally and 0.5 s when slowed, with 119/60
  fixed physics steps (fractional accumulator accounts for the first count).
- Full `npm test`: the six existing tracked test files and the new test file
  pass; four pre-existing untracked test files fail (`camera`, `debug`,
  `flight-realism`, `input`). The debug test imports missing `debugMode.ts`;
  those unrelated files were left intact. Backend unchanged. Real gamepad,
  audible mix and focused-window performance were not tested.
### 2026-10-10: The interactive tutorial (Claude)

Asked for by the UX group, on `shiyu-tutorial`: if a newcomer says yes to
the tutorial, a short practice flight before the first level, a prompt for
each main control, moving on once it's used; under 30 seconds, skippable.

- **`Coach`** (`Coach.tsx`, `Coach.css`): a card where the start button
  goes asks for one control at a time, with the player's own keys: Turn,
  Dive, Climb, Boost, Brake, Dodge (Dive and Climb swap under "Invert
  pitch"). Using it counts: the bound keys, the mouse while it steers (80 px
  that way), the gamepad's left stick, RT, LT or the shoulders. The keys
  press down into ink with a tick, the next step comes 0.65 s later, then
  "You're ready!" for 1.4 s. Progress dots; Skip (or `Esc` with the mouse
  free) any time. It only watches the controls: the game flies on.
- **Where:** "Start with a tutorial" sets it going (`App.tsx`, the screens'
  `tutorial` prop). Time trial: in the warm-up, with the start button (and
  Enter) held back until it's over. Room: in the lobby; if the race starts
  first, it ends. Adventure: no free flight before the start, so in the
  first level's opening seconds, ending if the level does. Leaving the game
  ends it. Replaces the stand-in (How to fly) behind "Start with a tutorial".
- Verified: build and lint pass. In the app's browser on the Docker build,
  a time trial through all six steps by script (about 7 s), the start button
  after "You're ready!". Not tried: a room, an adventure, a real gamepad, a
  person's timing (aim: under 30 s).

### 2026-10-10: Wind Rider, Cinzel and Philosopher, a quieter start (Claude)

Asked for by the UX group, on `shiyu-tutorial`.

- **Name:** the game is Wind Rider (title, tab, no-WebGL page, README, this
  file); the landing page's title is the logo and reads "WindRider". Internal
  names too, since nothing was live: localStorage `windrider.*`, shader cache
  keys, the dev log prefix. Browsers start fresh (a new guest id, default
  settings, the newcomer question again). This replaces the rename entry
  below, which kept the `wingrace` keys (decided by the UX group: never in
  production, so nothing to keep).
- **Fonts** (`main.tsx`, `index.css`): headings (`h1`, `h2`) in Cinzel
  (`--font-display`, carved capitals, a little open tracking), everything
  else in Philosopher (`--font-body`; it only has 400 and 700, so 500 shows
  as 400 and 600 or more as 700). Numbers that change as you watch keep Plus
  Jakarta Sans (`--font-numbers`): Philosopher's digits differ in width even
  with `tabular-nums` (1111 is 52 px, 8888 92 px), so clocks would jitter.
  That's the race timer, speed, the countdown, standings, the ring marker's
  distance, the "New in" countdowns, times on boards and results, the run's
  score and stats. All bundled with `@fontsource`.
- **Start button** (`ReadyCard`): only the button(s), on a glass pill, 6.5rem
  from the top. The start button breathes a halo and a light sweeps across it
  now and then (CSS only, off under reduced motion). The time trial's line of
  text and the room's pilot count are gone.
- **Mouse hint** removed (How to fly has Mouse control).
- **Countdown, GO, Crashed** in the middle of the screen, in the theme's ink
  (GO was green, Crashed red).
- Tried and reverted: waiting for Enter after a crash. It changes gameplay
  (the race clock keeps running while you wait), so it's for the team.
- Verified: build, lint and the frontend tests (31) pass. In the app's
  browser: the fonts in use (computed families, Philosopher loaded). A
  comparison of six body fonts rendered in headless Chromium. Not checked:
  phones.

### 2026-10-10: Key guide, newcomer question, overlays pause the game (Claude)

Asked for by the UX group, on `shiyu-tutorial`: a "?" left of the settings
gear (landing) and at the top right in game that shows the keys, a "First
flight?" question for newcomers, and the game paused behind both.

- **How to fly** (`Help.tsx`, `Help.css`): the "?" opens a card with every
  key and what it does, in two equal panels: Dive, Climb, Turn left, Turn
  right, Boost, Brake, Dodge | Respawn, Pause, Mute, Mouse control (click /
  `Esc`). Keys come from the player's bindings (`components/keys.ts`,
  `boundKeys`): both slots (`W` / `↑`), either Shift as one, Dive and Climb
  swapped under "Invert pitch". Wingbeat and Hover are left out (adventure
  upgrades; the run HUD shows them once you have them).
- **First flight?** (`FirstFlight` in `App.tsx`): asked once on entering a
  time trial, room or run, when the server has no finished run for the
  player (`/api/me` now returns `has_played`: by login, or by browser id for
  guests via `?client_id=`) and nothing was started or skipped in this
  browser (`windrider.tutorial` in localStorage, per user id). "Start with a
  tutorial" opens How to fly for now (the interactive tutorial is next),
  "Skip tutorial" ends it. `/?tutorial` asks anyway, for demos.
- **Overlays pause the game** (`game/hold.ts`, `Game.hold`): an open overlay
  holds the game paused and resumes only a pause it made; the HUD shows no
  "Paused" for it. Enter and `Esc` go to the overlay first (Enter would start
  the run behind it). Race clocks keep running, as with `P`.
- **Run HUD:** the ability keys on the HUD and the upgrade cards follow the
  bindings (they were fixed "C", "F", "Shift").
- Backend: `Store.has_played`, an index on `runs.user_id`, the `Me` model.
  Deploy frontend and backend together.
- Verified: build, lint, frontend tests (31), backend tests (23, one new).
  In the app's browser on the Docker build: the question and its keys, the
  guide's rows from the bindings, the game frozen behind both overlays and
  running again after, no "Paused" over them. Not checked: gamepad, phones,
  a real portal login.

### 2026-10-10: Renamed the game to Wind Rider (Claude)

Asked for: change the game's name to "Wind Rider".
- Visible name changed in `README.md`, `frontend/index.html` (title), the menu heading, the game's top bar and WebGL help text, and the dev console message. This file now says Wind Rider too.
- **Left as `wingrace`** on purpose: localStorage keys (`wingrace.settings`, `.client`, `.runs`, `.tuning...`, `wingrace:stale-reload`) so players keep settings and best scores, and shader program cache keys (internal).
- Not verified in a browser; no build or lint run yet.

### 2026-10-10: Sunken Reef, an underwater biome (Claude)

Asked for: an underwater world; it could replace one of the worlds already
seen (with different lighting) in adventure mode.
- **New biome `reef`, "Sunken Reef"** (`world/biomes/reef.ts`), two moods:
  Sunlit shallows and Moonlit deep. A valley in the seabed between reef
  walls: coral arches, table corals (the giant mushrooms' shapes in coral),
  reef pillars, brain-coral domes, terraced reef mesas, trenches. You fly it
  like any other level: the flight model is untouched (rule 6), the water
  only changes what you see.
- **In the run** (`run/run.ts`): still eight levels. The reef is in every
  run; it takes the place of one of the five middle biomes (Glacier,
  Archipelago, Lagoon, Twilight, Ember), which sits out that run. Which one,
  and where the reef comes (third to seventh), is drawn from the run seed.
  The first four middle biomes of a run seed are in the same order as
  before; best scores saved per run seed were flown on the old order.
- **The underwater look** (`SkySpec.underwater`, `SkySpec.fog`; data, so
  another biome can use it):
  - `skyMaterial()` shows the water's surface from below instead of a sky:
    a real plane `surface` metres over the racing line (it follows the line
    down), rippling, bright inside Snell's window overhead with the sun a
    blaze through it, mirroring the deep outside it, lost in the haze
    towards the horizon.
  - `atmospheric()` adds caustics (ripples of light cast along the sun's
    rays) to the land, plants and structures, fading with distance.
    Skipped by a uniform branch everywhere else, so other biomes cost and
    look the same.
  - `world/deep.ts` (new): `LightShafts` (one instanced draw call: a shaft
    per 64 m cell of the world in a 7 × 7 patch round the camera, turned to
    face it in the vertex shader) and `SeaLife` (schools of fish circling,
    jellyfish pulsing and drifting; two instanced draw calls, all motion in
    the vertex shader, placed from the level seed in open water). No
    colliders: you fly through them.
  - Fog from 30 to 640 m instead of 250 to 1300, and the mood's mist as
    deeper blue gathering towards the seabed.
- **Plants** (`flora/species.ts`, `flora/meshes.ts`): kelp (forests), staghorn
  coral in two colors, sea fans, anemones, tube sponges; seagrass with glowing
  blooms. Built lean (three-sided limbs without caps: `limb(..., open)`).
- **Structures**: new `shipwreck` (a galleon bow up on a reef mound, lit stern
  windows and lantern, torn sails that sway, a spilled chest of gold) as the
  landmark; its collider is a hall along the hull plus the mast leaning back
  with the pitch (`WRECK_PITCH`). Drowned columns, shrine gates, guardian
  statues and stone lanterns are the existing models in new colors.
- **Particles**: new `Kind.Bubble` (a rim and a glint; the firefly branches
  of the particle shader now test `kind < 4.5` too) and the ambient kind
  `bubbles`, rising from the seabed.
- **Tuning**: new `DEEP` group ("Underwater" in `?tune`): `caustics`,
  `shafts`, `surface`, `life`.
- Music: the reef plays Dewdrop Stream (`TRACK_OF`), until it has its own.
- Dev: `__shot` and `__run` hide the explore debug panel too.
- **Found on the way**: the first version drew 2.2 million triangles (Verdant:
  0.6 million); kelp and anemones were to blame. After slimming the meshes
  and thinning the kelp: 0.8 million.
- Verified: build and lint pass; 33 frontend tests (new: the wreck's
  collider; every run has the reef, eight different biomes, each middle
  biome sits out some runs, portals follow the order; `reef` added to the
  landmark and level-of-detail test). `__raceHashes()` matches
  `docs/dev-snippets.js` for seeds 1, 7 and 42 (mesh, trees, dist, rings).
  In headless Chrome on a real GPU (Intel UHD, `/?explore=reef&seed=2`):
  both moods from the start, a coral arch, a table-coral gate in flight, the
  surface from below, both wrecks; Sky Isles seed 42 still looks as before;
  no console errors but the missing backend's 502
  (`docs/screenshots/reef/`). `__bench` there, 1280 × 720: Medium GPU 8 ms
  (Verdant 6), High GPU 12 ms (Verdant 13).
- Not verified: not flown by hand and not seen in motion (fish, jellyfish,
  kelp sway, shafts and bubbles were only seen in still frames; bubbles are
  hard to make out in them). Not reached through a portal in a real run.
  Frame times not measured in a focused window. Backend untouched.

### 2026-10-10: Coral Lagoon's sea follows the racing line (Claude)

Reported: the water is below the world border, so the structures standing in
it are never seen.
- **Cause**: the sea was one flat plane at the last gate's height (-24 m),
  but the line drops about 480 m over a level. Most of the flight the water
  was 100 to 500 m below you, and `World.lost` ends the flight 240 m under
  the line. The sandy floor (`ground.level`) was flat for the same reason.
- **Fix**: `World.seaAt(z)` replaces `seaLevel`: the line's height, averaged
  over ±200 m so it doesn't undulate, plus the biome's `sea.level`. The sea
  mesh, collisions, skim spray, beaches, plant and structure sites, stacks'
  wave-cut notches, islets and valley mist all read it per z. Lagoon's ground
  now follows the line (`level: null`, `depth: 36`) instead of a flat floor.
  A gameplay change in runs (rule 6): you now fly 24 m over water all level.
  Races (Sky Isles, no sea) are untouched.
- Verified: lint and 31 frontend tests pass. `tsc` reports only the `reef`
  biome missing from `music.ts` and `biomes/index.ts`; that was there before
  this change. **Not looked at in a browser**: check `/?explore=lagoon&seed=1`
  (water slope, depth over the floor, structures in sight, sea stacks'
  notches, lighthouse sites needing `water: [-40, -1]`).

- Checked later, with the Sunken Reef in the tree (same pull request): `tsc`,
  lint, the build and 33 frontend tests pass. In headless Chrome
  (`/?explore=lagoon&seed=1`, Tropical noon): the sea is 23 to 25 m under the
  line at z = 0, 1100 and 2200, and in sight from the start and mid-level,
  with stacks and islets standing in it; no console errors. Still not
  looked at: the structures in the water, the notches, the night mood, and
  flying it by hand.

### 2026-10-10: Portal ring upright, portal audio (Claude)

- **Ring**: the portal took the course's tangent as its normal, which points
  down with the descent, so the ring leaned back like a floor light. `Portal`
  now flattens the normal to horizontal (`run/portal.ts`), so ring, veil and
  crossing test stand upright. Run mode only; races are untouched.
- **Audio**: entering a portal now plays a rising whoosh plus a louder,
  longer chord with a low drone (`GameAudio.stinger("portal")`). New
  `GameAudio.portalHum(near)`: a drone that swells and rises in pitch within
  500 m of an open portal and goes silent in the wormhole. Wired through
  `RunHost.portalHum` and `Game.portalHum`; `RunController` calls it per frame.
- **Run sounds**: runs never called the race's `audio.ring()` and
  `audio.finish()` (only `checkRing` does), so gates and portals were silent.
  `RunHost.stinger` now also takes `"gate"` (chime per gate) and `"finish"`
  (fanfare on entering a portal).
- **Beam**: the portal's light beam started at the veil's centre, a hollow tube
  with a hard base through the veil. It now rises from the top of the ring and
  fades in over its first 60 m.
- Verified: build and lint pass. Not heard or seen in a browser; the ring tilt
  was inferred from the code (the normal's y), so check it by eye.

### 2026-10-10 — Mesh artefact repair and streaming performance (`mesh-fixes`)

- Replaced aggressive surface snapping and recursive subdivision in `snap.ts`
  with bounded, face-interior refinement. Shared net edges stay fixed; thin
  faces cannot sprout tall centre fans, and failed refinement no longer deletes
  triangles. This repairs measured internal gaps and same-resolution seams.
- `terrain/mesh.ts` chooses the better-shaped quad diagonal when possible,
  with an orientation check. Sky Isles retains its original diagonal, colors
  and tree placement. No density fields, terrain recipes, shaders, palettes,
  structure placement or flight controls changed. The repaired triangles are
  also the collision surface, so local contact geometry does change.
- `terrain/streamer.ts` retains hidden nodes in a bounded cache, adds LOD
  hysteresis, discards obsolete worker results before uploads, and preserves
  the existing visible terrain until its replacement is complete. New
  `TERRAIN.cacheMiB` and `lodHysteresis` knobs live in the tuning panel.
  `WorldView.ts` no longer rescans/sorts the legacy chunk queue every idle frame.
- Before/after diagnostic: seed 2, three fine chunks per biome at course-start
  z + 100/250/400, x = course.x(z) + 100, y = ground height. Glacier triangles
  8,887 -> 6,252; Verdant 7,064 -> 5,836; Ember 11,024 -> 7,464. Open interior
  edges (excluding a boundary margin) 128/179/465 -> 0/0/0. Refinement distance
  calls 83,331/64,807/106,389 -> 7,901/7,234/9,443. These are deterministic
  geometry/work counts, not an FPS benchmark. Narrow base-grid slivers can
  still exist (Ember's extreme-aspect triangles fell from 5 to 3 in the sample).
- Verified build, lint, 38 frontend tests, including seven new mesh/collision/
  cache/transition regressions; exact closed joins on synthetic spheres across
  chunks and negative coordinates; no open interior edges in 21 sampled chunks
  across all seven v2 biomes. Sky Isles seeds 1/7/42 still match documented
  tree, distance-field and ring hashes. Browser inspected Glacier day/night
  and Ember with no logged rendering errors.
- Remaining: mixed-resolution boundaries retain the old overlapping-cell
  approach, not watertight adaptive stitching. Focused GPU/frame-time profiling,
  all-seed visual coverage and a full race contact/ghost playtest remain open.


### 2026-10-10: Collisions with the land exactly as drawn (Claude)

Asked for: make absolutely sure the terrain's hitbox matches the visuals,
even for thin islands; where needed, change the generation so thin isles
like the poles in some maps become unlikely. A deliberate gameplay change
(rule 6): crashes now follow the mesh, in races too.
- **Why the field couldn't do it**: the land is meshed on a 6 m grid, so
  anything thinner (needle tips, thin rings, slivers of noise) is in the
  distance field but drawn broken or not at all. On Sky Isles (seed 42),
  about 2% of points within 2 m of the rock were "rock the field has, but
  nothing drawn there"; the old hitbox crashed on every one of them.
- **`world/landCollider.ts`** (new): the triangles of every land mesh on
  screen, added and removed with them (Sky Isles chunks in `WorldView`,
  shown nodes in `LandStreamer`), each in a grid built the first time
  something comes near. Exact tests: ball against triangles, segments
  (Möller–Trumbore), convex quads (separating axes), signed `nearest`.
- **`Game.step`**: the body ball and both wing rectangles where they are
  now, plus the paths of the ball and both wingtips since the last step (so
  nothing slips through a thin sheet between steps), against the land drawn
  (`landTouched`). Trees, water and the sea still collide by their fields
  (`World.otherDistance`). Where the land around you isn't on screen yet
  (`WorldView.covers`), the rock's distance field stands in. The crash's
  normal is the face's. Measured: 0.02 ms per step right next to rock,
  0.03 ms on average over 21 s of autopilot flight on Sky Isles (grids
  built as the land streams in included). The racing-line autopilot crashed
  once in those 21 s (a wing, z ≈ 395); with the distance field alone it
  crashed too (the body, z ≈ 233): it was never crash-proof.
  Of 12 "invisible rock" points, the mesh hitbox touched 2 (the wings
  reaching real rock nearby), the old one all 12.
- **Meshes made honest**: snapping (previous entry) folded about 4% of
  faces over, back to front: never drawn (back faces are culled), but there
  to hit. Vertices now stay inside their own cell, edge midpoints move only
  across their edge (at most 30% of its length), a face's middle only along
  its normal, and any piece still facing into the rock is dropped (seen from
  outside it was never visible). Face centres are a little further from the
  field than before (mean 0.40 m, p95 1.35 m on Sky Isles).
- **Tumble** (`death.ts`): contacts through `Game.contact` (the land drawn
  where it's shown), looking up to 3 m behind a face so a point that started
  deep (a wingtip in the rock at the crash) is still pushed out; the pose is
  animated before the contacts so what's drawn is resolved; up to four
  position passes per step; a wing still wedged (under an overhang, in a
  slot) is folded in (`Avatar.foldWings`). In the last 10 test crashes on
  Sky Isles, two still had a point in the rock for a moment (0.3 m for 4
  frames, 0.8 m for 9 frames, in the same slot); four more runs at that
  spot were clean.
- **Generation** (v2 biomes; Sky Isles is frozen): `MIN_RADIUS` (4.5 m) in
  `shapes.ts`: a spire's tapering end stops (rounded) where it would get
  thinner than the grid holds, a sea stack's notch stops short of it, a
  spire thin all along shrinks to a stub, and rock rings' tubes are at least
  that thick. Shards start from 6 m (Ember, Glacier, Aurora). Needles and
  spikes keep about the height that was drawn before. Ember seed 1: 0.5% of
  near-rock points are field-only rock (Sky Isles: 2%). Runs' levels change
  a little.
- **Crash camera under overhangs**: when the sky over the pilot is blocked,
  the fall camera now lowers its arc (70°, then 50, 30, 12) to the first
  angle with a clear view instead of being pulled in against the pilot
  (`CameraRig.fall`, `FALL_ANGLES`).
- Race hashes: trees, dist and rings unchanged; mesh changed (new values in
  `docs/dev-snippets.js`).
- Rebased onto `main` (`30f2d85`: the rebased Pengyue work and the new
  flight controls) and merged into `Pengyue`; collisions keep the
  `speed-control-v3` rules tag (not bumped: that would hide every v3 time).
  The 20 frontend tests pass (run on Node 22.14 with an equivalent
  `module.register` resolver; `tests/register.mjs` needs Node ≥ 22.15).
- Verified: build and lint pass. In Chrome: crashes of every kind on Sky
  Isles through the mesh path (`land: true`), the measurements above,
  Glacier and Ember after the generation change; no console errors. Not
  measured in a focused window; not played with a mouse.

### 2026-10-10: Rebase settings onto the latest UX changes

- Rebased again onto `37ed067` after the structures PR merged. Preserved both
  branches’ change logs and follow-ups; only this file conflicted. Production
  build, lint and all 31 frontend tests pass on the combined branch.
- Rebased settings onto main `35aa2d2`, preserving the redesigned flight HUD,
  ready cards, course selector, course snapshots and persistent menu backdrop.
  Settings stays available from the menu and pause screen; the new HUD keeps
  its uncluttered bars instead of restoring the removed boost-key line.
- Verified production build, lint and all 24 frontend tests after rebase.
  Browser smoke checks: menu Settings, course selector, pause Settings, and
  closing the dialog leaves gameplay paused. Real-gamepad/audio checks remain
  outstanding as listed below.

### 2026-10-10: Shared settings menu and configurable controls

- New `settings` branch from current main. Added a shared, scrollable native
  settings dialog in the menu and pause HUD (solo, rooms, explore and runs).
  Focus stays inside the modal; Escape cancels rebinding or closes it, and
  closing returns to pause. Keyboard/gamepad actions are blocked while open.
- `bindings.ts`, `input.ts`: primary/alternate keyboard bindings with conflict
  detection and reserved navigation keys; independent mouse/gamepad/keyboard
  pitch inversion; adjustable stick dead zone. HUD, control sheet and adventure
  ability hints follow bindings. Default mouse sensitivity is 2 (previously 1).
- `storage.ts`: validates saved data, migrates legacy shared inversion, preserves
  existing sensitivity, and falls back safely when storage is unavailable.
- Added music/effects/wind volumes and mute, automatic/fixed graphics quality,
  and reduced camera shake/FOV effects. Preferences also update the menu backdrop.
- Verified frontend build/lint and 24 tests, including storage migration,
  rebinding, input isolation, inversion and reduced camera motion. Browser:
  menu entry, narrow layout, conflict rejection, saved boost binding in a new
  session, pause rebinding P→O, updated hints, close stays paused and O resumes.
  Real-gamepad feel and listening checks remain outstanding.

### 2026-10-10: A bust of Einstein as a second Easter egg (Claude)

Asked for: an Einstein bust as an Easter egg too.
- **`einsteinBust`** (`structures/models.ts`): a bronze bust on a stone
  pedestal with a gold plaque, 6 to 7 m tall so it reads from the air: wild
  white hair in tufts, the moustache, bushy eyebrows. Built from primitives.
- **Where**: Verdant Highlands only, a landmark with `chance: 0.3`, on the
  valley floor 25 to 140 m from the racing line, facing it. Few sites pass
  there, so it is rarer than the chance suggests: at `chance: 0.15`, 3 of
  explore seeds 1 to 60 had one (6, 24, 59); the chance was then doubled and
  not counted again. `/?explore=verdant&seed=6` has both the bust (near
  z = 1574) and the ETH building.
- It is second in Verdant's list, after ETH, so Verdant's other structures
  moved once more.
- Verified: build and lint pass; 27 frontend tests (new: seed 2 has no
  bust, seed 6 has one, within its lateral range). Seen by day in headless
  Chrome (`docs/screenshots/structures-biomes/einstein-morning.png`). Not
  seen at night, not flown by hand.

### 2026-10-10: The ETH main building as a rare Easter egg; structures, step 4 so far (Claude)

Asked for: ETH as a rare Easter egg, with a link to a Sketchfab model of the
Hauptgebäude; and to go on with step 4 (the day and night check).
- **ETH main building** (`ethMainBuilding`): built from primitives in the
  game's style, not imported. The Sketchfab model (by HMQ AG, a laser-scan
  CAD model, 13.3 million triangles) shows no license and no download, and a
  scan would break the art direction (no realistic assets) and the triangle
  budget. Ours: the long sandstone hall on a rusticated ground floor, end
  pavilions, the rotunda with its columns, the drum and the green ribbed
  dome, two storeys of lit windows, banners in ETH blue. About 32 m tall and
  70 m long.
- **Where**: Verdant Highlands only, a landmark with `chance: 0.1` per
  stretch: 8 of explore seeds 1 to 60 have one (5, 6, 13, 27, 41, 43, 49,
  50). `/?explore=verdant&seed=6` (Morning) and `seed=27` (Moonlit) show it.
  Landmarks now honor `chance`.
- **Collider** (`trees.ts`): `ColliderShape.hall`, a box along the model's x
  axis, so the wings collide along their whole length.
- Adding it first in Verdant's list moved Verdant's other structures (their
  draws depend on their place in the list).
- **Step 4, checked so far** (headless Chrome, `__shot`): the kinds not yet
  looked at (obelisk, brazier, ruined columns, pylon, star altar), and second
  moods: Lagoon by day, Archipelago and Aurora at night, Ember by day.
  Fixes: the pylon's crystal and the star altar's star were blown out to
  white at night (glow down from about 2 to under 1); Ember's stone was too
  dark to read against its ground (lighter stone for the temple, obelisks
  and columns); the lighthouse's beam was a white blob (thinner, dimmer).
- A warning for whoever takes screenshots: `__shot` needs about 7 s of
  streaming before a structure near the camera is drawn in full detail;
  at 3.5 s some shots show bare ground where the structure stands.
- Verified: build and lint pass; 26 frontend tests (new: the hall collider,
  turned by its yaw; seeds 2 and 3 have no ETH, seed 6 has one). ETH seen by
  day and night (`docs/screenshots/structures-biomes/`). Not flown by hand.

### 2026-10-10: Structures, step 3: a landmark and scattered kinds in every run biome (Claude)

Asked for: step 3 of the structures plan. Every biome but Sky Isles now has
structures. Solid, in runs only (rule 6); races are untouched.
- **Landmarks** (`StructureSpec.landmark`, `flora/placement.ts`): at most one
  per so many metres of the course (1100 everywhere, so two or three a
  level): of every candidate within `where.lateral` of the line that can
  stand, the one with the lowest draw. Worked out once per world and cached,
  so every node agrees. List landmarks first.
- **New site rules**: `on: "rock" | "any"` (on top of islands, islets, sea
  stacks and mesas: the site is found by marching down the distance field,
  never on `bare` surfaces), `water: [min, max]` (standing in the sea on
  ground that deep: stilts, sunken ruins; negative depths are dry land above
  it), `facing` (the front turned to the racing line).
- **Colliders** (`trees.ts`): `ColliderShape.gate`, two posts and a bar, so
  shrine gates can be flown through.
- **Shader** (`flora/view.ts`): `spin.upright` turns parts about the model's
  own upright axis (the lighthouse's beam, the observatory's rings).
- **Fifteen new models** (`structures/models.ts`): monastery, bell pavilion,
  stone hut, prayer-flag pole, lighthouse, stilt hut, ruined columns, shrine
  gate, fox spirit statue, forge-temple, rune obelisk, brazier, observatory,
  crystal pylon, star altar. Roofs take snow where a biome gives a `snow`
  color.
- **Per biome** (landmark first): Glacier Peaks: monastery, prayer poles,
  bell pavilions, stone huts. Sky Archipelago (on its islands): a temple (the
  monastery in white, blue and gold), ruined columns, prayer poles, lanterns.
  Coral Lagoon: lighthouse on a stack or islet, stilt huts in the shallows,
  drowned columns, lanterns on islets. Twilight Forest: a great spirit gate,
  smaller gates, fox statues, lanterns, all lit cyan. Ember Wastes:
  forge-temple with lava channels, rune obelisks, braziers, ruined columns.
  Aurora Summit: observatory, crystal pylons, star altars, lanterns. Verdant
  also got shrine gates.
- Small structures stand on deeper plinths (`sink` up to 0.5 of the height):
  the snowy and volcanic biomes have very little level ground.
- Verified: build and lint pass; 25 frontend tests (new: the gate's collider;
  every biome has one to three landmarks, more than 15 structures in the
  sampled stretch, the same at coarse and full detail, and fits the impostor
  atlas). In headless Chrome with `__shot`, one of every kind in every biome
  on seed 2, Glacier also by day (seed 1): no console errors
  (`docs/screenshots/structures-biomes/`). Looked at closely: all six
  landmarks, the stilt hut, prayer pole, bell pavilion, stone hut, spirit
  statue. Not looked at closely: obelisk, brazier, pylon, star altar, ruined
  columns, Verdant's gates. Each biome was seen in one mood only (Glacier in
  two). Not flown by hand; frame time not measured.

### 2026-10-10: Structures, step 2: Verdant's stone bridges (Claude)

Asked for: step 2 of the structures plan, the arched stone bridge over the
river at a fall, as the first structure in the distance field.
- **`Bridge`** (`terrain/shapes.ts`): a humped deck rising to a crown over
  one arch, cut out of the block as an ellipse standing on the water. Part of
  the land's distance field, so the stone drawn and the stone you hit are the
  same surface. Chunky on purpose (deck 12 m wide, 6 m thick at the crown):
  the land is meshed on a 6 m grid.
- **Feature `bridges`** (`terrain/recipes.ts`, `biomes/types.ts`): for some
  falls (`chance`), a bridge 44 to 92 m upstream, across the river's flow,
  where the river is under 34 m wide, no gate is within 22 m and the crown
  stays at least 18 m under the racing line. The arch spans the river plus
  3.5 m each side and rises 13 m above the water: you fly over it on the
  line, or dive under it. Listed last among the features, so the land's other
  random draws are unchanged.
- **Verdant**: surface 2, worked stone (pale courses, paved top, nothing
  grows on it), and `{ kind: "bridges", chance: 0.8 }`. Two to four bridges a
  level. A gameplay change in runs only (rule 6): new rock to hit near the
  river; races are untouched.
- Verified: build and lint pass; 23 frontend tests (new: on three levels,
  every bridge's arch is open over the water, its crown is solid and it stays
  out of the racing tube). In headless Chrome with `__shot`
  (`/?explore=verdant`, seeds 2 Morning and 3 Moonlit): the bridge from
  upstream, from the side, from under the arch and from the line; no console
  errors (`docs/screenshots/structures-verdant/`). Not flown by hand.

### 2026-10-10: Structures, step 1: the format, and Verdant's first three (Claude)

Asked for: a plan of which structures to add to which biome, then to proceed
with it. The plan is in "Structures per biome" under the biome plan. This is
its step 1. Structures are solid, a gameplay change in runs only (rule 6);
Sky Isles and races are untouched.
- **Format** (`world/structures/`, `StructureSpec` in `biomes/types.ts`):
  structures ride the flora pipeline as extra kinds after a biome's species,
  so they get worker placement, instancing, impostors and colliders for free.
  `Biome.structures` lists them with a spacing, a chance, a height range,
  colors and site rules (`where`: above the line, lateral, wet, forest,
  hilltop).
- **Placement** (`flora/placement.ts`): each kind has its own sparse jittered
  grid. A site needs ground with no rock shape over it, level enough for its
  plinth (`STRUCTURE_INFO.sink`), out of the water, clear of the racing tube
  and the start. A site depends only on where it is, never on the node's box,
  so a tower is in the same spot at every level of detail (tested). Plants
  keep 3 m clear of a structure and grass doesn't grow through its floor.
- **Models** (`structures/models.ts`): watchtower (lantern room, gallery,
  cone roof, banner that sways), stone lantern, windmill (round cap, four
  cloth sails). Windows, lanterns and gold finials carry glow: dim by day,
  blooming at night.
- **Shader** (`flora/view.ts`): `plantMaterial` takes a structure variant:
  lights scaled by `STRUCTURES.lights`, and `spin` vertices turning about the
  hub in the vertex shader (`STRUCTURES.sails`). No collider moves.
- **Colliders** (`trees.ts`): `ColliderShape.disc`, the disc a windmill's
  sails sweep, turned by the yaw.
- **Verdant Highlands**: windmills on the shoulders of hills, watchtowers
  above the valley, stone lanterns along the river. Per level, within 500 m
  of the line: about 10 windmills, 20 towers, 70 to 100 lanterns.
- **Tuning**: new `STRUCTURES` group in `?tune` (`lights`, `sails`).
- Dev: `__shot` now levels the camera (the chase camera's own up vector
  rolled the shots).
- Verified: build and lint pass; 22 frontend tests (two new: the windmill's
  collider, and placement matching across levels of detail and staying clear
  of the line). In headless Chrome with `__shot` (`/?explore=verdant`, seeds 2
  Morning and 3 Moonlit): all three kinds by day and night, lights blooming at
  night, no console errors but the missing backend's 502s
  (`docs/screenshots/structures-verdant/`). Not flown by hand: crashing into
  a structure, the sails in motion and the frame time weren't checked in a
  focused window. Backend untouched.

### 2026-10-10: In-game UI simplified, map select (Claude)

Asked for by the UX group, on `shiyu-ux`: take text off the game screen to
make room for a tutorial, a map select in the style of the "E" mockup that
shows off the maps, and a landing backdrop that doesn't flash on tab switches.

- **Before a race:** the time trial's course panel and the room lobby panel
  are gone. A small card at the top centre, where the race timer appears,
  holds one line and the start buttons (`ReadyCard` in `GameScreen.tsx`):
  "20 gates · warm up as long as you like" with Start the run (`Enter`), or
  "Race room · N pilots" with Start race (`Enter`) and New map (`N`). The
  time trial's best times and controls fold-out left that screen (the map
  select shows best times; controls go to the planned settings overlay). The
  room's invite link (the code is in the top bar and the URL), pilot list
  and last race went too. A ready state for rooms was considered and
  dropped: anyone can still start, with the 5 s countdown.
- **Flight panel** (`Hud.tsx`, `Hud.css`): no more key hint line, Ready
  label or "m to the rock" line. Two labelled bars, then the speed: boost
  (blue: Boost ready, Boosting, Boost charging) and skimming (orange:
  "Gaining N points/s" in runs, from `Game.step`'s style formula; "Gaining N
  km/h per second" in races, from `FLIGHT.proximityBoost`; "Skim the rock
  for …" when far). Style points show in runs only (`showStyle`), where
  they score. The panel's height follows its content and the mouse hint
  stacks on top of it (`.hud-bottom`).
- **Mouse hint:** only while the mouse moves over the unlocked game view, gone
  2.5 s after it stops (`useMouseHint`); keyboard and gamepad players never
  see it. The ghost note moved under the race timer (it overlapped the
  flight panel).
- **Map select** (`CourseSelect.tsx`, `CourseSelect.css`): "Choose a
  course" on the landing's Solo tab replaces the random course link and the
  seed field. A carousel (arrows, `A`/`D`, `←`/`→`, `Esc` back, `Enter`
  flies) of today's course, one course per Sky Isles mood (the lowest seed
  with it: Alpine 2, Misty pines 5, Autumn 12, Dusk 3, Winter 1, Starlight 8)
  and a random card (roll, or type a seed). Cards have a picture, name, seed
  and gates; the middle one the top three and your best. The backdrop flies
  over the course in the middle (after 0.3 s) and the UI takes its colors.
- **Card art:** the featured courses' pictures are
  `frontend/public/courses/<seed>.jpg`, rendered in headless Chromium
  (software GL, so no bloom) from the backdrop's drift view at z = 400 or
  900. Today's and random courses get a snapshot of the backdrop once its
  land is in (`Game.landReady`, `Game.snapshot(width, aspect)`,
  `MenuBackdrop`'s `onSnapshot`); until then, a gradient of the course's sky.
- **Backdrop:** `MenuBackdrop` keeps one `Game` and calls `setSeed` for
  another course. It's sized by the viewport (`100vw` × `100lvh`), not the
  page: the scrollbar coming and going with the Solo tab's height resized
  the canvas, which blanks it for a frame (a grey flash on tab switches).
- Gameplay untouched: `Game.ts` only gained the two read-only members above;
  the race map's code wasn't changed.
- Verified: `npm run build`, `npm run lint` and the frontend tests (Node 24)
  pass. In the app's browser on the Docker build: the ready cards, both
  bars' labels, the mouse hint appearing and hiding, every map-select card
  and its theme, roll, keys after clicking an arrow, `Esc`, the backdrop
  canvas keeping its size across tab switches, no console errors. Not
  checked: phones and touch, a room with two players, the snapshot timing on
  a slow machine.

### 2026-10-10: UX fixes from playtesting (Claude)

Asked for by the UX group: fix the problems found while playtesting, on
`shiyu-ux`, then `origin/main` merged in. Six fixes stay; a seventh (Menu
asking before it throws a run away) was reverted the same day, because the
in-game UI isn't settled and misclicks should be judged on the new one.

- **Landing page:** the `?backdrop=` switch is gone; the backdrop always
  drifts (`chase` stays in `Game` for a results screen). A page left open past
  UTC midnight now switches to the new daily course: the countdown tick also
  re-reads `dailySeed()` (`Menu.tsx`).
- **Narrow screens:** below 700 px the course, results and lobby panels fold to
  their heading and main buttons; a chevron opens the rest (`Panel` in
  `GameScreen.tsx`). `useMediaToggle` (`media.ts`) is shared with the
  landing's `TodaysBest`. The centred hint and banners no longer squeeze into
  half the screen width.
- **Ring marker:** clamped by its own measured size, `MARKER_EDGE` (8 px) from
  each edge (`Game.updateMarker`), so the distance label never hangs off the
  screen.
- **Crash feedback:** while crashed, the HUD's speed and proximity read 0, the
  clearance line hides, the flight panel dims, and "Crashed!" says where you
  respawn: "Back to ring N" or "Back to the start" (`Game.hud`, `Hud.tsx`,
  `Hud.css`).
- **Start heading (a gameplay change, decided by the UX group):**
  `World.startDirection` aims at the first ring, 4 m above its centre, when
  the straight line there has 3 m of air; otherwise it keeps the course's old
  heading (`course.startDirection`, the line 120 m ahead). Rock, rings and
  trees are untouched, but race starts now face a little differently, so
  times from before and after aren't strictly comparable. Hands-off flights
  from the start on Sky Isles seeds 1 to 60, re-measured with main's newer
  flight model and body-and-wings hitbox: through the first ring 13 → 48
  times, median time to a crash 5.6 → 8.6 s, and no seed does worse.
- **Merging main:** `Menu.tsx` uses `raceLevel(daily).palette` and keeps the
  Adventure tab; `Game.hud` reads the avatar's position; `startHeading()` runs
  at the end of the `World(level)` constructor and works on both the legacy
  islands and v2 land.
- **Merging main again** (`30f2d85`: pause, boost, the new flight model and
  hitbox, the victory lap, the stale-build reload): while paused the HUD hides
  GO and the crash note, which keeps its "Back to ring N" line; the boost
  meter sits in the flight panel, which still dims while crashed; `Game.hud`
  reports speed 0 while crashed, next to the new boost and pause fields.
- Verified: `npm run build` and `npm run lint` pass. `__raceHashes()` matches
  `docs/dev-snippets.js` for seeds 1, 7 and 42 (trees, dist, rings). In
  headless Chromium (software GL), after the merge: panels folded on a 390 px
  phone and open at 1440 px, the marker inside the screen with the ring off to
  every side, the crash HUD, the midnight switch (fake clock) and the
  start-heading simulation. After the second merge: build, lint and the 20
  frontend tests pass (`npm test` needs Node 22 or newer; run with the build
  image's Node 24), and the crash HUD, the ring marker and the folding panels
  were checked again. Not checked: a real GPU window, touch input, and the run
  mode with these changes.

### 2026-10-10: Rebase Pengyue's newest work onto main

- Replayed the ten new feature commits from `origin/Pengyue` (`fec0aee`)
  onto `main` (`f532f3e`) on `pengyue-rebase`. Older biome work was already
  integrated in main; main's flight/pause/music commits were not replayed.
  The shared Pengyue branch was left unchanged.
- Resolved conflicts in crash/dodge animation, camera, flight hitboxes,
  loading fly-ins, portal/finale HUD, pause behavior, item gallery and docs.
  Kept 80° banking, upright recovery, boost/brake, 5 m dodges, stable camera
  orientation, fixed boost UI and biome audio. Removed obsolete dash effects
  and restored the explore biome import. Synced camera velocity interpolation
  during fly-in and handover.
- New body/wing collision rules use `speed-control-v3` in frontend and backend;
  v2 results remain stored but are excluded from current rankings. Deploy both
  together. Added tests for hitbox orientation, crash-camera respawn, glide-in
  handover and preservation/exclusion of v2 scores.
- Verified build, lint, 20 frontend tests and 22 backend tests. Browser smoke
  check: Verdant Morning/Moonlit, loading fly-in, pause overlay, crash state and
  item-gallery page load. Full portal/finale and two-client/gamepad playtests
  remain outstanding. The explore debug panel overlaps the HUD at narrow widths.

### 2026-10-10: Crash camera from above, pilot hitbox, land matching its collisions (Claude)

Asked for: after a crash the camera changes to a view from the top to see
the fall; collisions that don't visibly clip into the terrain, with the
player's hitbox a small ball for the body and two small rectangles for the
wings (a little clip is fine if it isn't obvious); then a check that the
terrain's hitbox matches what's drawn, and a fix if not. A deliberate
gameplay change (rule 6): what crashes you changed, in races too.
- **Hitbox** (`flight.ts` `touching()`, used by `Game.step`): replaces the
  0.7 m point test at the hips. A 0.5 m ball 0.4 m ahead of the hips (covers
  the head), and per wing a 0.9 m × 1.75 m rectangle from 0.35 to 2.1 m out,
  tilted up 0.15 rad like the wings mid-stroke, sampled 4 × 3. Skipped when
  the field at the hips is beyond its reach, a wing skipped when its middle
  is beyond its corners, so it costs one extra field sample a step in open
  air. Fixed in the flight frame: animation never changes what you hit.
  Proximity scoring still measures from the hips (unchanged). A wing hit
  plays the "wing" crash on that side; the crash normal and debris come
  from the contact point.
- **Tumble** (`death.ts`): rigid-body contacts with impulses and Coulomb
  friction at balls for head, hips and feet and five points per wing taken
  from the live pose each frame (`Avatar.wingPoints`, a new `trail` marker
  at the last primary's tip), substepped at 120 Hz. A wingtip catching a
  slope now spins the body. Measured over seven crashes on Sky Isles: no
  ball ever inside its radius of the rock, wing points ≥ 0.03 m off it.
- **Camera** (`camera.ts`): `startFall` at the crash, then `fall`: arcs up
  on the chase view's side to 11 m at 70° above the horizon (`CAMERA.
  fallDistance`, `fallAngle`, `fallSwing`, `fallTrack`) and looks down,
  trailing the body slightly so the drop reads; pulled in out of rock and
  trees. Replaces `follow`.
- **Land vs collisions** (new `world/snap.ts`): measured first. Drawn land
  was off the collision field by a mean 0.65 m (Verdant) to 1 m (Sky Isles),
  p95 2.3 to 3 m, worst ±10 m (surface nets on a 6 m grid put vertices at
  linear edge crossings, and 6 m faces cut across ridges and creases). Now
  vertices are snapped onto the surface, and faces that still stray more
  than 0.5 m are cut (crack-free). After: vertices mean 0.06 to 0.08 m;
  face centres mean 0.35 m, p95 1.15 m on Sky Isles (was 1.16 / 3.03 m).
  Sky Isles' trees and colors still come from the grid's vertices, so
  `__raceHashes()` keeps trees, dist and rings; only mesh changed (new
  values in `docs/dev-snippets.js`). Trees whose rock moved down get their
  drawn trunk stretched to it (`treeSink`), never their collider.
- Cost: about 4.4× the rock triangles on Sky Isles (sampled), a full-detail
  v2 node meshes in about 29 ms instead of about 22 ms (main thread, dev
  build). Not measured in a focused window.
- Verified: build and lint pass; race hashes as above. In Chrome (Sky Isles
  seed 42, `__crash` and scripted approaches with a 15 to 30 m run-up): the
  overhead view during headfirst, slide and wing crashes; with real flying
  poses, the drawn wing at a crash is a median 0.49 m clear of the rock, worst
  0.78 m into it for one frame. Not played with a mouse.

### 2026-10-10: Victory lap and the finish screen (Claude)

Asked for: after the finale's white light, the player is back in the
default sky map on autopilot, unable to control anything, under a
translucent finish screen with the stats and buttons on the side for the
next actions (return to menu, start again).
- `Game.victoryLap(seed)` (called by `RunSession` when the run ends): ends
  the run controller, builds Sky Isles on the daily seed (the menu's map)
  under the white, and sets `autopiloting`: the racing-line autopilot flies
  (respawning at the course's end, like the menu's chase), every input and
  action is ignored except mute, the pointer is released and clicking the
  view no longer locks it. The white clears over 2.2 s once the map is
  ready (or after 4 s).
- The run now counts flying time (the level clocks), gates, crashes, best
  chain and style for `RunSummary`.
- `FinishScreen` (`RunHud.tsx`): a translucent glass card on the left (run
  seed, "Journey's end", score with new best / ties / your best, six stats,
  the biomes flown, upgrade icons) and the actions on the right edge: Fly it
  again (`Enter`), New run (`N`), Return to menu (`Backspace`). The pilot
  flies on between them. It fades in once the white has mostly cleared. The
  HUD and top bar are hidden.
- Verified: build and lint pass; race hashes unchanged. In Chrome: run 7
  through one portal to Verdant, then the forced finale, the victory lap on
  Sky Isles (seed 24675), the finish screen; held W, R and Q did nothing on
  autopilot; Fly it again restarted the run; no console errors.

### 2026-10-10: The finale cutscene (Claude)

Asked for: the last portal (to victory) plays a cutscene that slowly pans
beneath the player, isometric, showing the Milky Way now present above the
player floating in empty space, then pans back to the default camera and
fades out into white light.
- `run/finale.ts`: at level 8 the portal starts `Finale` instead of the
  summary. The screen blurs and sparkles as for any portal (0.5 s); under
  the blur the land and its sky are hidden and the pilot floats in space.
  The sky is a world-fixed shell: the Milky Way's band arching overhead
  (core near the zenith, warm; pink and blue nebulae; dark dust lanes),
  pixel-sized stars, denser in the band; lit from the core and starlight.
  The camera takes over from the chase view: it pans (spherical path around
  the pilot) to 11 m beneath and to the side, looking up past the pilot at
  the galaxy (1.5 to 7 s), holds with a slow drift (to 10 s), pans back to
  the chase pose (13.5 s) and the view fades into warm white light (16 s).
  Motes drift around the pilot. `Enter` skips to the white light.
- New run phase `finale`; HUDs are hidden; Game's `whiteOut(k)` is the
  white overlay. The run is scored before the cutscene, as before.
- For now the summary panel then shows over the white (step 8 replaces it).
- Verified: build and lint pass. In Chrome (run 7 with `__game.run.level =
  8` and `__portal`): the blur in, the galaxy from beneath the pilot at
  7.5 s, the return and the white fade at 14.9 s, the summary at the end;
  no console errors.

### 2026-10-10: The next biome loads during the portal (Claude)

Asked for: load the next map during each portal transition, to save time.
- `RunController.buildNext()` builds the next level as soon as the screen
  is fully blurred on the way in (0.53 s after the portal), before the
  upgrade picker shows; the land streams while the player chooses. The pick
  no longer builds anything, so the way out usually starts the frame after
  the choice. The level doesn't depend on the upgrade, so nothing changes.
- The offer is now drawn when the portal is entered (from the same level
  number as before), so the upgrades offered are unchanged (checked: run 7
  level 1 still offers Showoff, Daredevil, Wingbeat).
- `Game.setLevel` compiles shaders before hiding the new land in the
  wormhole (`renderer.compile` skips hidden objects).
- Verified: build and lint pass. In Chrome (run 7): Verdant is built while
  the picker is up, its land became ready during the pick, and the exit
  began one frame after picking; no console errors.

### 2026-10-10: Portal transitions: blur, sparkle, the wormhole (Claude)

Asked for: transition screens through portals that feel authentic and
exotic: the screen blurs and sparkles; the portal is just a flat disk from
outside; inside, a dark wormhole with spirit-like sparkles everywhere and
sides like Interstellar's contorted space, vast and peaceful like sleeping
under the night sky.
- **The portal** (`portal.ts`): the disk now looks like a window onto deep
  night (stars swirling into the middle) inside a softer swirling rim. No
  tunnel geometry exists outside.
- **Going in**: star sparkles thrown across the view, the screen blurs and
  brightens with drifting CSS sparkles (`.portal-veil`, backdrop-filter,
  0.5 s); under the blur the level is hidden and the wormhole appears; the
  blur clears (0.8 s) and the upgrade picker fades in.
- **The wormhole** (`Wormhole`): a shell around the camera, drawn first and
  writing no depth (the pilot draws over it, lit by the wormhole's own
  moonlight and the exit's glow). Each view direction maps onto an endless
  tube (`depth = log((1 + cos θ) / (1 - cos θ))`) that twists with depth:
  three layers of pixel-sized stars, stretched along the travel near the far
  end, faint nebula bands bent around the tube, the exit glowing far ahead
  in a lensed ring, darker behind. 1100 spirits (moonlight, pale gold, rose
  motes) float on slow paths all around and drift past. Dark and calm.
- **Going out**: once the next land is ready (or after 8 s; the glide-in
  then covers the rest), the screen blurs again, the wormhole is swapped
  for the new biome, and the blur clears over `RUN.tunnelFade` while the sky
  cross-fades. The HUD stays hidden for the whole transition.
- Upgrade picker restyled for the dark: light text, translucent blurred
  cards (its text was dark on dark before).
- Dev: `__portal(after)` flies into the current level's portal and stops
  `after` s past the crossing.
- Verified: build and lint pass. In Chrome (run 7, Sky Isles → Verdant):
  the portal from outside, the blur in, the wormhole with the picker, the
  blur out, the arrival (the 8 s exit cap was hit in the throttled tab and
  the glide-in took over); no console errors. GPU cost of the shell
  (full-screen fbm) not measured in a focused window.

### 2026-10-10: Item models and animations (Claude)

Asked for: models (and animations, no mechanics yet) for a giant firework
carried on the back as a jetpack, candies, feathers, helmets and fruits.
- **`game/items/`**: 12 items built from primitives in the pilot's style
  (toon material, ink outline, glow on gold and gems): Giant firework
  (striped rocket longer than the pilot, star-tipped nose, fins, straps,
  fuse; a flickering additive flame with sparks), Berry candy, Swirl
  lollipop, Star candy (with a face), Golden feather (self-lit, Sky's winged
  light), Aviator cap (with goggles), Winged helm, Apple, Peach, Grapes,
  Cherries, Starfruit.
- **Animations** (`Equipment`): pulling the firework out of the inventory
  (it pops into the raised hand with a sparkle, swings over the shoulder in
  an arc and settles onto the back with a bounce), its thrust flame,
  helmets popping up and dropping onto the head, hand items held up and
  eaten (`use()`: to the mouth, a nibble, gone in light), putting away.
  `ItemDisplay`: a floating pickup (bob, turn, halo, sparkles). The avatar
  got `slots` (back, head, hand) and `armPose` (the right arm's override).
- **`/?gallery`**: every item with its name, buttons to put each on the
  pilot, eat, light the firework, put away; a demo loop until you click.
- In the game, `Game.equip(id)`, `useItem()`, `thrust(k)` and
  `unequip(slot)` (e.g. `__game.equip("firework")` in a dev console). Looks
  only: no flight or scoring change.
- Verified: build and lint pass. In Chrome: the gallery (all 12 models), the
  firework pull-out mid-swing and on the back with its flame, the helm on the
  head, the held apple; no console errors.

### 2026-10-10: Art direction made explicit (Claude)

Asked for: state as the most important point that the game is Genshin
Impact and Sky (光遇) oriented. New first section, "The most important
point", with what that means for models, animation, aesthetics and UI. Docs
only.

### 2026-10-10: Glide in while the land loads (Claude)

Asked for: instead of freezing the pilot until the map has loaded, fly
forward a bit, avoiding collisions, and give control only once it has
loaded; the mechanism must not be exploitable. A deliberate gameplay change
(rule 6), outside races only.
- `Game.loop`: when the land isn't ready in free flight (`raceState`
  "free": time-trial warm-up, explore, runs, the menu's chase), `glideIn`
  runs instead of the physics step; the first ready frame calls `handOver`.
  Frozen states (a run's start panel, the tunnel) still hold the pilot.
- Not exploitable, by construction: input is ignored (abilities too), the
  flight model never runs (no crash, proximity, style, gates, portal, ghost
  recording), the glide is capped at 70 m and stops 30 m short of the next
  gate ahead, it slows and stops before rock, control is handed back at
  `START_SPEED` whatever the speed before, and `RunController.wait` keeps a
  run's level clock (par bonus) running. Races keep their countdown, so the
  race clock and ghosts are untouched. (The client is not authoritative
  anyway: the server's timing checks remain the only real guard.)
- The HUD label now reads "Gliding in while the land loads…".
- Verified: build and lint pass. In Chrome, Verdant seed 2 and Glacier seed 1
  from a fresh load: the pilot glides 70 m at 18 m/s, hovers until the land
  is ready, then flies on at 32 m/s under control, no crash; no console errors.

### 2026-10-10: Crash animations (Claude)

Asked for: a death animation per kind of crash, keeping the particles.
- **`death.ts`**: at the crash, the surface normal (from the distance
  field, sampled at the last step outside the rock) and the flight
  direction pick the kind: **headfirst** (bounces back off the wall,
  tumbles head over heels; a squash on impact and a ring of "seeing stars"),
  **slide** (keeps sliding along the slope and rolls down it, kicking up
  dust), **wing** (a wing clipped the rock: thrown off balance into a flat
  spin, the hit wing bent), **fall** (below the islands: a slow tumble).
  `DeathFall` simulates the body (gravity, drag, bouncing and rolling on the
  distance field) and the avatar's `die()` pose flails, then goes limp, with
  wings crumpling and the cloth whipping. At 1.1 s the body shrinks into a
  burst of light; the respawn still comes at `RESPAWN_DELAY` (1.4 s).
- The pilot no longer vanishes on a crash. The crash burst is smaller (the
  body stays visible), debris are now feathers that flutter down, and the
  camera follows the tumble from 7 to 15 m, kept out of the rock.
- Looks only: the crash test, the respawn delay, the respawn point and the
  scoring are unchanged.
- Verified: build and lint pass. In Chrome (Sky Isles seed 42, `__crash`):
  headfirst, slide and wing each play out and are classified as aimed in most
  test spots; no console errors. Not played with a mouse in a focused window.

### 2026-10-10: Stale builds after a rebuild (Claude)

Reported: after a rebuild the game sometimes didn't load (blank page,
localhost "not connecting") until the browser cache was cleared.
- `Pengyue` was missing `main`'s Caddy fix (`e1b63df`): `index.html` was
  cached heuristically, so browsers kept asking for the previous build's
  hashed JS, and the SPA fallback answered with HTML. Merged `main`:
  `index.html` is now `no-cache`, and a missing `/assets/*` file is a 404.
- A tab left open across a rebuild still failed: the bloom chunk, the
  `?tune` panel and the mesher worker of the old build are gone, so bloom
  threw and the land never arrived. New `staleBuild.ts` reloads the page
  once when one of them fails to load (`vite:preloadError`, the bloom and
  lil-gui imports, `worker.onerror` in `WorldView`), at most once every 30 s
  so a really missing file can't cause a reload loop.
- Port 8080 is Colima's forward of the Docker port, IPv4 only (`::1` refuses).
  Browsers fall back to 127.0.0.1, so this isn't the cause.
- Verified: build and lint pass. In a test container from the new image:
  `/` and `/explore` return `no-cache`, hashed assets return `immutable`, and
  a missing asset returns 404. The reload itself wasn't triggered in a browser.

### 2026-10-10: Rebase speed controls onto current main

- Rebased onto `e20b112`, preserving pause controls, biome music, wingbeat
  samples and explore debug mode while resolving overlapping input/audio/docs.
- Kept one input reset implementation, retained the pause action, and made
  disconnected gamepad hover return false. Extended input coverage for the
  pause key, repeats and reset alongside held speed controls.
- Verified frontend build, lint and 17 tests; backend 22 tests pass. Browser
  integration and real-gamepad/two-client playtests remain outstanding.

### 2026-10-10: Upright recovery and 80° steering bank

- `flight.ts`: raised the bank cap to 80°. The unbanked pitch frame now
  gradually rolls toward world-up when pitch is released, fixing the case
  where a half loop leaves the pilot stuck on its back despite zero bank.
  Recovery preserves the nose direction, is rate-limited, and fades at the
  vertical poles. Held pitch still allows deliberate loops.
- Updated README and controls text. Added regression coverage for half loops
  in both directions at 30/60/120 Hz and neutral recovery at both poles.
- Verified frontend build, lint and all 17 tests. No browser playtest this
  session; upright recovery feel remains part of the Next up playtest.

### 2026-10-10: Increase steering bank to 75°

- Raised `FLIGHT.maxBank` from 50° to 75° so held steering can produce
  tighter coordinated turns while retaining the bank limit and auto-level.
- Updated the controls overlay, README and bank-limit regression expectation.
- Verified: frontend build, lint and all 15 tests pass. No new browser
  playtest; assessing the higher bank's feel remains in Next up.

### 2026-10-10: Bounded steering, sideways dodge and vertical camera continuity

- `flight.ts`: A/D, mouse and stick now choose a bank target capped at 50°;
  release levels the wings. Pitch uses the unbanked frame and remains unrestricted.
  Q/E and LB/RB trigger a 5 m dodge over 0.6 s, with a 1 s start-to-start cooldown.
  Its smooth displacement is integrated in the fixed step before collision/gate
  checks; dodge never changes the base orientation. Respawn clears dodge state.
- `avatar.ts`, `Game.ts`, `tuning.ts`: visual roll follows physics dodge progress;
  removed cosmetic corkscrew displacement and extra visual bank. Removed obsolete
  auto-roll/time/radius knobs; dodge timing and distance belong to `FLIGHT`.
- `camera.ts`: transport the previous view/up frame through vertical flight,
  suppress horizon correction near the poles, and bound recovery away from them.
- `Hud.tsx`, `Hud.css`: fixed panel/status/bar dimensions, stable key hint line,
  Ready/Boosting/Recharging/Braking labels, and moved the mouse hint above the panel.
- Room snapshots and ghosts carry signed dodge progress. Older ghost formats
  remain readable; v2 result filtering preserves legacy and v1 scores separately.
  Frontend and backend must deploy together.
- Verification: 15 frontend tests and 22 backend tests pass, including exact
  dodge displacement at multiple speeds/timesteps, steering limits, cooldown,
  reset, and camera continuity over loops in both directions at 30/60/144 fps.
  Production build and lint pass. In the live browser preview, Ready, Boosting,
  Braking and Recharging retain the same 245 x 50 px boost block; the mouse hint
  no longer overlaps it. Real-gamepad and two-client visual playtesting remain
  outstanding; loop continuity is covered by numeric camera tests.


### 2026-10-10: Biome music and the wingbeat sample (Claude)

Asked for: an audio controller for the generated ElevenLabs tracks, files moved
out of the repo root into a sensible place.

- **Files** moved to `frontend/public/audio/`: `music/sky-isles_soaring-above-the-clouds.mp3`,
  `music/glacier_blue-shadows-over-cold-peaks.mp3`, `music/verdant_dewdrop-stream.mp3`,
  `music/twilight_blue-hour-fireflies.mp3`, `music/ember_red-orange-embers.mp3`,
  `sfx/wingbeat.mp3`.
- **`music.ts`** (new): `MusicPlayer` crossfades between tracks when the biome
  changes. Mapping: Sky Isles and Archipelago share the Sky Isles track;
  Glacier and Aurora Summit share the Glacier track (until the finale gets
  its own); Verdant and Lagoon share Dewdrop Stream; Twilight and Ember have
  their own. A biome change that keeps the track doesn't restart it. Night
  (`palette.night`) lowers the volume and rolls off the highs of the same track.
- **`audio.ts`**: owns the player, remembers the biome until the first user
  gesture starts audio, plays the wingbeat sample (random pitch ±8%) on your
  downstrokes (quiet, scaled by effort) and for the Wingbeat ability (loud).
  Falls back to the synthesized whoosh if the sample hasn't loaded.
- **`Game.ts`**: `setLevel` calls `audio.setBiome`; your avatar's
  `onDownstroke` also plays the flap (not for the menu backdrop, which has
  no audio).
- **`tuning.ts`**: new `AUDIO` group in `?tune`: `music`, `sfx`, `crossfade`,
  `nightDim`, `nightMuffle`.
- **Explore debug mode** (`ExploreSession.ts`, `GameScreen.tsx`, `App.tsx`,
  `Menu.tsx`): open `/?explore` (or `/?explore=ember&seed=7`; in dev builds
  also "Debug: explore worlds" on the Adventure tab). A panel lists every
  world and its lighting moods; click, or press **N** next world, **B**
  previous, **V** next light. Switching rebuilds the level in place (no
  reload) and the URL follows. The panel shows the music file the world should
  play and the one actually playing, so a mismatch is visible at a glance.
  `/?explore` with no or an unknown biome starts in Sky Isles.
- Looks and sounds only: no gameplay code touched.
- Verified: `npm run build` and `npm run lint` pass. **Not run in a
  browser**: the debug panel, level switching, crossfades, loop points and mix
  levels against the wind are unchecked. A reported "world and music don't
  match" was not reproduced or diagnosed yet; the panel is there to find it.
- Branch `audio-music`, cut from `main`.

### 2026-10-10: Speed controls (`speed-control`)

- Consolidated the two speed integrations in `flight.ts`; gravity, drag,
  proximity and adventure modifiers now participate in one integration.
- Universal held Shift/RT boost (2.5 s reserve, release to recharge) and
  Space/LT brake (priority over boost, drag tapers near 22 m/s). Wingbeat
  moved to C/A; Gale boost strengthens the universal boost by 25% per stack.
- `input.ts`, `Game.ts`: reset held controls/motion at respawn, clear stale
  gamepad state, ignore unfocused input and remove double-tap stunt triggers.
- `camera.ts`, `tuning.ts`: interpolated heading and travel direction,
  restrained horizon/FOV, bounded boost feedback, segment obstruction checks
  and eased camera extension. New tuning storage namespace keeps old camera
  overrides from masking the defaults.
- `avatar.ts`, `pilotfx.ts`, `trail.ts`, `audio.ts`: swept boost/spread brake
  poses, brightened/lengthened boost trails, brake wisps, wind feedback and
  fresh animation history on respawn. Fixed trail sampling so sub-0.8 m
  movement per frame accumulates instead of repeatedly replacing one point.
- HUD charge meter and control hints; updated adventure intro and upgrades.
- `pilots.ts`, `ghost.ts`, room/API state and backend validation carry explicit
  boost/brake intensity. Old eight-field ghosts remain readable.
- Backend store preserves old scores/ghosts as `legacy`, filters all current
  results by `speed-control-v1`, and rejects outdated gameplay POSTs with a
  reload message. Deploy frontend and backend together.
- Verified: production build and lint pass; 11 frontend regression tests and
  21 backend tests pass. Browser visual playtesting
  was blocked by unavailable Chrome, an in-app webview timeout, and a stalled
  Safari control call; no visual or gamepad playtest is claimed.

### 2026-10-10: Merged main's menu and UI redesign (Claude)

`origin/main` (`e4e5732`) redesigned the menu and HUD around a live 3D
backdrop and glass panels. Merged into `Pengyue` for the PR:
- `Game.ts`: main's attract mode (`drift` camera, `chase` autopilot) on top of
  the new avatar; drift hides the avatar and its ribbons and shows no speed
  lines.
- `paletteFor(seed)` no longer exists (palettes are Sky Isles' moods), so
  `theme.ts` and `Menu.tsx` use `raceLevel(seed).palette`, which picks the
  same palette.
- Menu: Adventure is a third tab next to Solo and With friends.
- `RunHud.css` used the old tokens (`--panel`, `--muted`, `--accent`,
  `--accent-2`); now `--glass-strong`, `--ink-70`, `--warm`, `--warm-deep`.
  The run and WebGL panels got the `glass` class.
- Verified: build and lint pass. In Chrome: the menu backdrop, the Adventure
  tab, a run's intro and HUD in Sky Isles (Winter), no console errors. The
  upgrade picker and the summary were not looked at in the new style.

### 2026-10-10: Feathers and sidequests peeled off for later (Claude)

Asked for: take the feathers (run lives) and sidequests out of `Pengyue` and
keep them on a separate branch for later, then merge `main` in for the PR.

- **`Pengyue-feathers-sidequests`** is `Pengyue` as it was (`febf426`), with
  both features. Nothing else differs.
- **Removed here:** `run/quests.ts` (all eight sidequest kinds, including the
  thermals' lift), the secret portal they opened, lives (`START_LIVES`, the
  Spare feather upgrade, the HUD feathers, "Out of feathers"), the sidequest
  timer and the biome data for both (`SidequestSpec`, `sidequests`,
  `portals.secret`). `destinations()` became `destination()`; `offer()` lost
  its `secret` argument (always three cards).
- **Behavior now:** a run can't be lost. A crash respawns you at the last gate
  and breaks the gate chain (a "Gate chain lost" toast if there was one), and
  the run ends at the summit. Portals, upgrades, abilities, the tunnel and
  scoring are unchanged. Races and time trials are untouched.
- The roadmap and biome plan still describe sidequests, which are parked, not
  dropped.
- Verified: `npm run build` and `npm run lint` pass. Not played in a browser.

### 2026-10-10: Milestone 5, polish and performance (Claude)

- **Frame times** on an Apple M2 (integrated GPU), Verdant Highlands near
  the start, measured with `__bench(quality)` (`game/devtools.ts`): the loop
  stepped by hand, CPU per frame, and GPU per frame from
  `EXT_disjoint_timer_query_webgl2`. Medium: CPU ~5 ms, GPU ~4 ms. Low: CPU
  ~4.5 ms, GPU ~3 ms. High (bloom): GPU 30 to 70 ms depending on the bloom's
  resolution and MSAA, and noisy. **Caveat:** measured in the automation tab,
  which is hidden; not in a focused window as the plan asks. Run
  `__bench(2)`, `__bench(1)`, `__bench(0)` in a focused window to confirm.
- **Hotspots fixed**: the bloom (its render target was 1.5× the pixel ratio
  with 4× MSAA; now `FX.bloomResolution` 1 and `FX.bloomMsaa` 2, tunable, the
  composer rebuilt when they change; auto quality still steps a slow machine
  down to Medium); instance pools re-uploaded their whole buffers on every
  change (now only the changed range); finished land meshes all landed in one
  frame (now `TERRAIN.uploadsPerFrame`, 4, once flying); plants and grass were
  copied with array spreads (now straight into typed arrays); shaders compiled
  mid-flight (now `renderer.compile` when a level is built).
- **Knobs**: new `FX.bloomResolution`, `FX.bloomMsaa`,
  `TERRAIN.uploadsPerFrame`; `RUN.toasts` now hides the pop-ups. Every group
  (`TERRAIN`, `FLORA`, `WATER`, `RUN`) is in `?tune`.
- **Sky Isles at night**: its faceted puffs were dark discs; now moonlit,
  semi-transparent veils (looks only; the race map's colliders are the same).
- **Screenshots** of every biome by day and by night:
  `docs/screenshots/m5-biomes/` (Sky Isles seeds 2 and 8; the others
  `/?explore=<id>&seed=` 1 to 3).
- README: the adventure mode, its controls, how biomes are built.
- Verified: build and lint pass; race hashes unchanged; no console errors
  across all biomes and a run.

### 2026-10-10: Milestone 4, the run loop (Claude)

- **Runs** (`/?run=<seed>`, menu card "Adventure", daily run seed): eight
  levels, Sky Isles first, Verdant second, the five middle biomes in an order
  shuffled by the run seed, Aurora Summit last. Every level is
  `runLevel(runSeed, level, biome)`. Three feathers; a crash costs one and
  respawns you after your last gate; none left ends the run.
- **Portals** (`run/portal.ts`): the main portal at the last gate leads to the
  next biome on the run's order; a secret portal off the line opens when you
  finish a sidequest and leads to another unseen biome with four (rarer)
  choices. Each is a glowing ring, a swirling veil and a beam to steer by.
  Flying in: a tunnel of rushing light fades in, the upgrade picker shows,
  the next biome is built behind the tunnel, then the tunnel fades out while
  the sky, sun, mist and fog cross-fade from the old palette to the new one.
- **Upgrades** (`run/upgrades.ts`): ten, as data: Gale dash (Shift), Wingbeat
  (Space, Sky-style stamina that refills at gates), Featherfall hover (hold
  F), Glide lock, Daredevil (proximity boost), Gate magnet, Spare feather,
  Streamline, Featherweight, Showoff. Three are offered per portal,
  deterministic per run and level. Abilities reach the flight model only as
  `FlightMods`, which only runs pass: with none, `Flight.step` is unchanged
  (checked: the new and previous flight models agree exactly over 3000
  steps of varied input).
- **Score**: gates (100, times a chain of up to 5 gates in a row without a
  crash), style (the proximity points; upgrades raise the multiplier's cap),
  sidequest items and rewards, a level bonus plus points for every second
  under par.
- **Sidequests** (`run/quests.ts`), two per biome from its data, placed from
  the level seed, always ahead of you and below the line: beacons (cairns,
  ice bells, lanterns, ancient pillars), collect (seeds, stars, fallen
  stars), chase (spirit birds, the manta, the spirit fox: a creature flies a
  path ahead and you stay close), thread (needle tunnels, wind walls), rush
  (a timed chain: outrun the eruption), skim (seconds low over the lagoon),
  thermals (updrafts lift you in run mode), rescue (a stranded glider that
  then flies off your wing).
- **HUD**: score and chain, feathers, objectives with progress, a compass to
  the nearest open portal, ability charges, upgrades, pop-ups, the level's
  title card, the upgrade picker (keys 1 to 4) and a run summary with the
  best score on that run seed (this browser; no backend changes).
- Audio stingers for portals, upgrades, sidequests, items and dashes; a
  wingbeat whoosh. `RUN` tuning group (tunnel fade, compass size, pop-ups).
- Verified: build and lint pass; race hashes unchanged; a time trial still
  counts down; in Chrome: a run's intro, HUD and compass, a ring and a cairn
  scoring, a crash costing a feather, a portal into the tunnel, the picker,
  and the arrival in Verdant Highlands with its title card. Not yet played
  end to end by a person with a mouse.

### 2026-10-10: Milestone 3, part 2: every planned biome (Claude)

- **Six more biomes** (`world/biomes/`), each with a day and a night mood:
  Glacier Peaks (`glacier`: icefalls and frozen lakes on the steps,
  crevasses, ice spires and arches, snowy firs, snow and glitter, aurora at
  night), Sky Archipelago (`archipelago`: no ground, noise islands with
  tunnels, waterfalls pouring off their rims into the void, cloud banks
  across the line, golden hour), Coral Lagoon (`lagoon`: a turquoise sea over
  a sandy floor, limestone stacks notched by the waves, islets, coral arches,
  palms and jungle, floating jungle islands up high), Twilight Forest
  (`twilight`: giant trees and giant mushrooms as rock, root arches,
  bioluminescent streams and ponds, glowing flowers, fireflies and spores),
  Ember Wastes (`ember`: lava steps and falls, terraced basalt, obsidian
  shards, a volcano, embers and ash, light from below the horizon), Aurora
  Summit (`aurora`: the finale, peaks over a sea of clouds, frozen lakes,
  floating crystal rings, one colossal spire, starfall). Explore any of them
  at `/?explore=<id>&seed=<n>`; seeds 1 to 3 cover both moods of each.
- **Generator**: gate kinds `shards`, `mushroom`, `roots`; features `shards`,
  `trunks` (giant trees with crowns), `mushrooms`, `islets`, `rings`,
  `volcano` (new `Volcano` shape with a crater), `summit`. Pillars standing in
  a sea get a wave-cut notch at its level.
- **Sea** (`SeaSpec`): solid water at a fixed height (`World.seaLevel`, in
  `distance()`), drawn as a grid with the depth over the ground and the rock
  standing in it, beaches in the mesher, no plants below it, skim spray over
  it (`World.waterNear`).
- **Island waterfalls** (`IslandFallsSpec`): `World` finds a rim on some big
  noise islands; curtains arc off them and fade into the clouds.
- **Sky**: `Palette.aurora` (seamless curtains of green and violet) and
  `Palette.underglow` (light from below the horizon).
- **Soft clouds** (`world/clouds.ts`) for every generator-v2 biome: clusters
  of camera-facing puffs in one draw call, lit from the sun's side with a
  silver lining, moonlit veils at night, thinning out as you fly into them;
  `sky.banks` puts banks across the racing line. Sky Isles keeps its faceted
  puffs.
- Also: glowing flowers (`grass.glow`), `starfall` ambient kind, a softer ice
  glint, dimmer bioluminescent specks.
- Verified: build and lint pass; race hashes unchanged; every new biome
  looked at in Chrome (day and night for Glacier, Twilight; one mood for the
  others so far), no console errors.

### 2026-10-10: Milestone 3, part 1: Verdant Highlands' systems (Claude)

- **Vegetation** (`world/flora/`): 14 species built from primitives
  (`meshes.ts`: pine, fir, snowy fir, oak, birch, bush, palm, jungle tree,
  glowing mushroom, crystal cluster, dead tree, basalt columns, boulder,
  redwood), each vertex carrying a color, a sway weight and a glow weight.
  `species.ts` holds sizes and colliders (tapered trunk plus canopy, leaning
  for palms). `placement.ts` places plants in the workers straight from the
  distance field on a world-aligned jittered grid (so a node's plants don't
  depend on its level of detail): forest patches from noise, a tree line,
  slope and water limits, species by altitude, wetness and forest. Full
  meshes for full-detail nodes (one instanced pool per species, swaying in
  the wind in the shader), impostors from an atlas baked at load for coarse
  nodes, colliders (`Plant` in `trees.ts`) from full-detail nodes only.
- **GPU grass and flowers**: tufts placed per full-detail node, drawn within
  `FLORA.grassDistance` of the camera, swaying, shrinking away with distance.
- **Water** (`world/water.ts`): river pools as ribbons on the steps with the
  real depth over the carved ground, falls as curtains arcing off each lip.
  One shader with four kinds (water, lava, ice, glowing pools): depth tint,
  shore and fall foam, flow streaks, a capped and tinted sky reflection, sun
  glitter that blooms, dimmed by moonlight. Pools are solid (skimming counts
  for style, `Game.waterSpray` throws droplets and mist), falls can be flown
  through.
- **Valley mist**: `ATMOSPHERE.mistMode/mistHeight/mistThickness`; biomes with
  ground pool their mist over the valley floor near the camera instead of
  below the camera (Sky Isles keeps the old mode).
- **Ambient particles** (`game/ambient.ts`): per-biome emitters spawned ahead
  of you: fireflies in the shade of forests (many more at night, blinking:
  new `Kind.Firefly`), motes, petals, snow, leaves, embers, spores, ash,
  glitter; mist and spray at the foot of falls. A second `Particles` with
  ordinary blending for snow, leaves, ash and mist.
- **No per-frame allocations in emitters**: `fx(...)` in `particles.ts`
  returns one shared spec; Game and PilotFx no longer build an object per
  particle.
- Bugs fixed on the way: pool owner keys overflowed an `Int32Array`; the
  water's fog uniforms were used before their declaration; pool triangles
  faced down.
- Tuning: `FLORA` (wind, glow, grass distance) and `WATER` (glitter, glow,
  spray) groups. Dev: `__run(seconds)` steps the loop by hand.
- Verified: build and lint pass, race hashes unchanged, Verdant by day and
  night in Chrome (136 draw calls, 430k triangles on screen at High).

### 2026-10-10: Milestone 2, terrain generator v2 (Claude)

- **A composable distance field** (`world/terrain/`) for every biome except
  Sky Isles. The ground is a heightfield that follows the racing line: a
  valley floor under it, sides rising into rolling hills, domain-warped
  ridged multifractal mountains further out, soft terraces on some
  hillsides, optional crevasses and a fall-off into a sea of clouds. Its
  distance is `(y - h) / sqrt(1 + |∇h|²)`, so proximity scoring works on
  slopes; 3D noise on steep slopes carves overhangs. `Steps` makes the floor
  step down in flat pools and falls (the line always flies over the edge of
  each fall), and a river channel is carved into them (water, lava, ice or
  glowing; its surface is solid in pools, but falls can be flown through).
  Rock shapes melt into the ground with `smin`: arches, pillars, needles,
  ridges to tunnel through, overhanging shelves, terraced mesas, noise islands
  with tunnels, each roughened along its grain (lumpy, fluted, layered,
  sharp). Collisions read the same field (`TerrainField.distance`); the mesher
  samples whole blocks with the same arithmetic (`fill`, with per-column
  caches), so meshes and collisions agree.
- **LOD rings**: `LandStreamer` keeps an octree of 384, 192 and 96 m nodes,
  each 16 cells a side (24, 12, 6 m voxels), split by distance
  (`TERRAIN.lodNear`/`lodFar`). Coarse nodes overlap their neighbours by a
  cell to hide cracks, and stay on screen until all their replacements have
  arrived (and the other way round), so there are no holes or doubled land.
  Workers mesh nodes in 2 to 15 ms. Verdant at High: about 140 draw calls and
  180k triangles on screen. Sky Isles keeps its own chunk streaming: its
  trees come from full-detail meshes and must not move.
- **Terrain shader** (`terrain/material.ts`, on `atmospheric()`): every face
  arrives flat-painted (rock with strata or streaks, cover color, wetness,
  glow, snow height) and the shader blends cover, soil, rock, sand at the
  water, dark wet rock and snow by the face's slope and height, with
  triplanar painted noise on cliffs. Knobs in a new `TERRAIN` tuning group.
- **Verdant Highlands** terrain (biome data; water, trees and mist come in
  milestone 3), reachable through the new explore screen
  (`/?explore=verdant&seed=2`). Puffs over grounded biomes float higher
  (`sky.puffLift`) and never below the line (`sky.puffsBelow`).
- **Dev tools** (`game/devtools.ts`): `__shot` and `__raceHashes` are
  installed in dev builds. `__shot` reads `window.__game` when called: React's
  strict mode builds a game and drops it first, and a helper bound to that one
  renders nothing.
- Fixed on the way: `flat` is a reserved word in GLSL ES 3.
- Verified: `tsc`, lint and build pass; `__raceHashes()` unchanged; Verdant
  looked at by day and night in Chrome (`docs/screenshots/m2-terrain-v2/`), no
  console errors.

### 2026-10-10: Milestone 1, the biome format (Claude)

Asked for: the first playable slice of the roguelike (see "Roguelike
milestones" below). Milestone 1: a data-driven biome format, levels
deterministic from (runSeed, level), today's islands ported as Sky Isles with
no visible change, World and WorldView driven by a biome.

- **`world/biomes/`**: `Biome` (moods, terrain recipe, vegetation, mist and
  clouds, particle style, sidequests, portals), `LevelKey` (small enough to
  post to workers) and `Level`. `raceLevel(seed)` is what races and time trials
  use; `runLevel(runSeed, index, biome)` derives the world seed and mood from
  the run seed and level number.
- **Sky Isles** (`skyIsles.ts`): the six palettes moved here as its moods, and
  the mood is still picked from the seed's `palette` stream. Its terrain
  (`legacyIslands`) and vegetation (`legacyPines`) recipes select the existing
  code paths unchanged. Cloud sea depth and puff count now come from the
  biome's `sky`.
- `World` takes a `Level`; workers take a `LevelKey` and drop results for
  another level by id; `Game.setLevel(level)` builds any level, `setSeed(seed)`
  is `setLevel(raceLevel(seed))`. The HUD gets `biomeName`.
- Verified: `tsc`, lint and build pass. **No visible change**: screenshots of
  seeds 42 and 1 from two fixed camera poses are byte-identical before and
  after (`docs/screenshots/m1-sky-isles-port/`, same MD5s). The race maps are
  bit-identical too: hashes of rock meshes, colors, tree colliders, 4000
  collision distances and the rings of seeds 1, 7 and 42 match the pre-port
  build (`__raceHashes()` in `docs/dev-snippets.js`).

### 2026-10-10: Genshin / Sky style pilot, crystal gates, particles (Claude)

Asked for: Genshin Impact and Sky-style flight visuals, barrel-roll turns with
flapping wings, lots of particles and trails, tunable looks, crystal gates
that bob and shine when passed, and a cartoon humanoid pilot.

- **New pilot** (`avatar.ts`, `toon.ts`; deleted `wingsuit.ts`): chibi
  proportions (big head, slim limbs), cel shading with rim light and ink
  outlines, face (eyes with highlights, blush), bangs, side locks, cowlick,
  swinging ponytail, a tunic in the player's color, boots, a Sky-like cape with
  a gold hem and emblem, two scarf tails, and two-segment feathered wings. The
  player color recolors the cloth, wings and trails (`setColor`). Ghosts are
  translucent with no outlines. Outlines and cloth stop updating beyond 110 m.
- **Animation**: angular velocity is derived from the rotation each frame, so
  the same code animates you, other players and ghosts. A spring lean leads the
  bank. Barrel rolls (Q/E, double-tap A/D, gamepad LB/RB, or automatic when
  snapping hard into a steep turn) do a 360° visual roll on a corkscrew path.
  Wing effort rises with climbing, turning, rolling and low speed and drops in
  dives; flapping uses an asymmetric stroke with a lagging outer wing, and
  wings sweep back with speed. Also: gentle bob and sway, head looking into
  turns, rudder legs, squash and stretch at speed. Cape and scarf ripples scale
  with speed.
- **Effects**: GPU particle system (`particles.ts`); `PilotFx` (ribbons from
  both wingtips and the cape, light motes, downstroke puffs, barrel-roll star
  spiral); aura glow; wind streaks (`speedlines.ts`); ground spray and sparks
  when skimming; glitter around the next gate; a crash burst; a speed vignette
  and gate flash (CSS `.speed-vignette`); FOV kick on gates; a breathing camera
  at low speed.
- **Crystal gates** (`world/crystals.ts`, replaces the tori in
  `WorldView`): per gate, a crown of large crystals plus small satellites
  that bob, orbit and spin. The next gate glows in the accent color and shows
  through fog; the finish is gold. Passing a gate makes the crystals flare
  white, burst outward and dissolve, sends a shockwave across the veil, and
  bursts shards, stars and light. Gates you pass in free flight shine too, then
  regrow.
- **Rendering**: optional bloom with HDR targets, adaptive quality, the sun
  brightened so it glares.
- **Tuning**: `tuning.ts` and a reworked `?tune` panel (quality, physics,
  animation, FX, gates, camera, barrel-roll buttons, copy as JSON, reset).
  Look tweaks persist in localStorage; physics tweaks don't.
- **WebGL check** (`webgl.ts`, `GameScreen.tsx`): browsers with WebGL off
  (hardware acceleration disabled, GPU process crashed, blocklisted GPU) now
  get instructions instead of a crash. That was the "A WebGL context could
  not be created" report; it was never a hosting problem.
- Verified: `npm run build` and `npm run lint` pass. Checked in Chrome: pilot
  from behind, front and side; gate idle, highlight and pass animation;
  barrel roll; no console errors. CPU cost of avatar and FX is about 0.7 ms a
  frame per pilot. GPU frame time not reliably measured (the automation tab was
  throttled).

### 2026-10-10: Lighting and shaders per biome (Claude)

Asked for: shaders and lighting that make every biome stunning, effects that
behave well in different light, shiny catchy things, bright standouts.

- **Biome lighting profiles** (`palette.ts`): each palette now has sun
  elevation and azimuth (low suns sit ahead of the run, so Dusk is backlit),
  a night factor, valley mist color and density, cloud color, and an effect
  glow factor.
- **Sky shader** (`atmosphere.ts`): replaces the vertex-colored dome and the
  flat sun disc. Gradient, HDR sun (or moon) disc and halo that bloom, two
  layers of drifting painted clouds lit from the sun's side with silver
  linings, twinkling stars at night.
- **Atmosphere patch** for terrain and rocks: haze that
  takes the sun's glow towards the sun (matching the sky, so distant terrain
  melts into it), mist pooling on the canyon floor, backlit rims on edges seen
  against the sun, wavering rock strata. The hemisphere light now mixes in
  the zenith color.
- **Pilot light**: the toon rim takes the sun's color; gold trims, the cape
  emblem and hem, and the wingtips carry a `glow` vertex attribute that
  shimmers by day and blooms at night. The aura grows at night.
- **Effects follow the light**: `FX_LIGHT.boost` scales particles and
  trails per biome; bloom is stronger at night.
- **Catchy things shine**: light pillars rise from the next gate (accent
  color) and the finish (gold), with a flare running up the pillar on a pass.
  Random star glints flash on crystals of gates near you.
- **Bug fixed during the pass**: the pillar shader took `pow()` of a slightly
  negative number at the cylinder's top edge; the NaN made every bloomed frame
  black. Clamped there and in the crystal fresnel and the trail shader.
- Verified: build and lint pass. Looked at Glacier, Nightshade, Dusk and
  Lagoon in Chrome (stepping the loop by hand because the automation tab was
  hidden), no console errors. Jungle and Desert not looked at.

### 2026-10-10: Fixed the broken merge of the visuals onto the islands (Claude)

What went wrong: `main` gained the floating-islands rewrite (`ca3c53c`,
deleting `terrain.ts` and `obstacles.ts`) while the visuals work was written
against the old canyon. Both were then copied onto each other by hand
(`5768877` on `Pengyue`, `41c96f2` on `main`) instead of merged, so
`WorldView.ts` and `palette.ts` ended up half one version and half the other,
and the new modules still imported `world/terrain`. Neither branch compiled.
Also, `HEAD` pointed at `pengyue` (lowercase) while the branch is `Pengyue`;
macOS's case-insensitive file system hides that, but git then shows no current
branch.

The fix: a real merge of the visuals commits onto `ca3c53c`, with my code
ported to the islands world:
- `WorldView`: the islands version, plus the shader sky, the atmosphere patch
  on the rock, crystal gates instead of tori, and per-biome light uniforms.
- `palette.ts`: the islands palettes, each given a lighting mood, plus a night
  palette, **Starlight**, so stars and glowing trims show up somewhere. Adding
  a palette changes which palette a seed gets (colors only, not the map).
- `atmosphere.ts`: the mist used the canyon floor's height. It's now a haze
  that thickens below the camera, towards the sea of clouds.
- `Game.skimSpray`: sprays off the nearest rock surface (the distance field's
  gradient) instead of the canyon floor, so walls and overhangs spray too.
- Crystals scale with the ring radius (islands gates are 8 m, not 13 m), so
  the crowns stay clear of the rock tube.
- `PilotFx`: no motes while the pilot is frozen (countdown, waiting for
  islands), where they piled up into a glowing ball.
- Imports moved from `world/terrain` to `math`.
- Verified: `tsc`, lint and build pass; raced seed 42 (Misty pines) in Chrome
  through islands and gates, no console errors.

## Next up

- Item milestones: 1–10 implemented. Finish 11–20 and seeded island pickups, then verify day/night looks, audible mix, handling with mouse/gamepad and focused-window performance.

- **Lives**: look at them in a browser (the `.run-side` column under the
  top bar, narrow screens, the white fade after the last crash, the "Out of
  feathers"
  finish screen), then balance: three lives over eight levels may be harsh,
  and the Spare feather may need to come up more often than one card in
  twenty-eight. Idea: a feather back for a perfect level. A spent feather's ink
  outline is faint on night skies.
- **The first 1.4 s after a portal**: `RunController.step` returns early
  while the phase is still `portal`, so the level clock, gates and abilities
  are off until the blur has cleared (from before the lives work). The root
  fix is to enter `arrive` when control comes back and run the veil's fade
  on its own; that moves the HUD's and title card's timing, so decide first.
- Extreme flare pose: the coat can still expose a body ink outline through
  its surface (also present before the ribbon fix). Ribbon/coat and leg/cloth
  clearance do not resolve all body/coat intersections; inspect the torso
  contact before extending cloth self-collision.

- PR #33: visually verify the compass, toast and test-panel spacing on short
  screens; browser control failed during review with an API-key auth error.

- Playtest the new 3 m tier and two-second look-ahead at boost/dive speeds on
  integrated GPUs; tune the 140 m activation range against worker readiness.
  Verify mixed-detail overlap at oblique angles and all crystal/volcano moods.

- Mesh cleanup intentionally leaves fragments crossing chunk borders intact.
  Ground-noise amplification at peaks is now fixed before meshing at every LOD.
  If remaining shape fragments are distracting, build a deterministic halo/component ownership
  pass before touching their topology. Check more seeds and integrated-GPU
  frame times; the generation benchmark below is not an FPS measurement.

- Mobile: real Android Chrome and iOS Safari over https: sensor signs and feel,
  iOS permission prompt, fullscreen/orientation and wake locks, notch insets.
  Room lobby and settings should also be checked on hardware. Haptics and map
  swipes are not implemented; the explore world/light panel still needs a
  compact mobile layout. The discovered tutorial, ability, flat-tilt, picker,
  intro and HUD issues are fixed in the PR #32 follow-up above.

- Wormhole camera: watch the orbit and the 0.4 s swing back to the chase
  view in a focused window and tune `RUN.orbit*` and `wormholeFlow`; the
  pilot is held still in the wormhole, so its ribbons and motes stay off.

- **The ten abilities** (see the change log): look at them at night (the
  manta's spots and the sigil were tuned on a bright day), listen to the
  sounds, play a real plunge strike and an Acrobatic Recovery with a mouse,
  and balance the numbers in `?tune` ("Run abilities"). The Wind-Shear blink
  plays the full 360° roll in 0.16 s (a blur): maybe a shorter roll. Thermal
  Vision should also show updrafts and boost rings once they exist. Cloud lanes
  are built on the main thread when first needed (about 1500 puffs, each
  checked against the distance field).
- **Abilities 11 to 20** (see the change log): listen to the sounds, play
  them with a mouse and balance `?tune` ("Run abilities"); look at Resonance
  and the stances at night; the falcon spirit can fly through rock on its way
  in (it's a spirit, but check it doesn't look odd in a canyon). Resonance's
  gates keep their new facing for the level, even after a respawn behind
  them. The ley line follows the racing line, not the gates you'd actually
  fly next if you've skipped some. Echo-Trail loops are hard to fly inside
  narrow canyons; a horizontal circle works too, but only where there's room.
- **The rest of the design list** (items 1 to 20) is planned, not started.

- Test mode: check shortcut feel with a physical keyboard and mouse;
  browser automation verified behavior, timing and layout, not
  focused-window performance or audio.

- **Sunken Reef follow-ups**: fly it by hand and watch it move (fish,
  jellyfish, kelp, shafts, bubbles); reach it through a portal in a real
  run; measure in a focused window. Ideas not built: the pilot's own trail
  as bubbles and a muffled wind under water (both shared code: `pilotfx.ts`,
  `audio.ts`); caustics on the pilot (the toon material isn't
  `atmospheric()`); a quality level for caustics (their cost wasn't
  measured on its own; `DEEP.caustics = 0` hides them but still pays for
  them); impostors get no caustics; rays or turtles; its own music
  track; the wreck often lies on a slope with one end buried; brain-coral
  domes under about 6 m mesh as flat patches (the 6 m grid).
- Mesh-fixes: implement and validate true adaptive stitching at mixed-LOD
  boundaries if distant seams remain visible; the overlap approach remains.
  Inspect residual thin base-grid features on more seeds without smoothing
  whole landscapes. Profile focused gameplay and cache memory on integrated
  GPUs; the measured refinement savings do not establish an FPS gain.

- Playtest the settings dead zone with a real gamepad and listen to the separate
  audio levels; check mouse sensitivity 2× across different devices.

- **Structures, next steps** (plan: "Structures per biome"): step 4 is
  partly done (see the change log). Still to check: Twilight's Midnight
  bloom mood, Verdant's shrine gates, and every moving part in motion
  (sails, the lighthouse's beam, the observatory's rings, flags and flames:
  only still frames were looked at). Open from step 3: the plan's pieces that need two
  anchors or sit on other shapes aren't built (rope and chain bridges,
  prayer-flag lines between shards, treehouses on trunks, doors in mushroom
  stems, sailboats, Aurora's stair of arches, Twilight's lantern tree: a
  great gate stands in for it); Archipelago's temple is the monastery
  recolored, not its own model; the lighthouse's beam is two opaque bars of
  light, not a cone; Sky Isles' drawn-only dressing isn't started. Open from
  step 2: the bridge reads as rough-hewn rock more than masonry (6 m
  voxels, and its courses of stone are faint); it has no parapets or lanterns
  (structures don't stand on rock shapes yet); fly under an arch by hand, and
  check the ground's fillet doesn't close a narrow one. Open from step 1:
  fly into a tower, a lantern and a windmill's sails by hand; impostors don't
  glow, so distant windows are dark at night; the impostor atlas has 16 cells
  for species plus structures; Verdant's cottages and shrine gates aren't
  built; the windmill is plain up close (no balcony, few windows).

- **Hitbox and land follow-ups**: proximity (style points), skim spray and
  the glide-in still read the distance field, so rock that isn't drawn can
  still give a few style points or a puff of spray (never a crash). The
  crash tumble can still clip for a few frames when wedged in a slot
  narrower than the body (2 of 10 test crashes, briefly). About 1.7% of
  vertical rays through Sky Isles previously crossed snapped meshes
  inconsistently. The mesh-fixes pass removes that snapping and verifies closed
  chunk joins; repeat the full tumble/inside-ray survey and focused frame-time
  checks on real courses before considering this fully resolved. Remote pilots don't use the hitbox (they never crash).

- Play through the integrated portal/finale and victory lap; check multiplayer
  and gamepad controls. Make the explore debug panel usable at narrow widths
  without covering the HUD.

- `__crash` teleports the pilot 5 m from the rock: the crash often comes in
  the first frame, before the avatar's pose has updated, so that frame's wing
  points are stale. Harmless in play.

**Resume here:** the five roguelike milestones are done, and so are the
crash animations, the glide-in, items (models only), portal wormholes, the
finale and the finish screen. What's open:

- **Items need mechanics**: the giant firework's boost (`Game.thrust` only
  lights the flame), candies and fruit (`useItem` only plays the animation),
  helmets, pickups placed in levels (`ItemDisplay` is ready), an inventory
  UI. Mechanics go through `FlightMods` in run mode only.
- **Measure in a focused window** the new full-screen shaders: the wormhole
  shell and the finale's Milky Way (fbm per pixel), and the hitch of
  `buildNext` under the portal blur (hidden, but it stalls the CSS veil for
  a frame).
- Remote pilots and ghosts don't play crash animations (they have no crash
  events); the glide-in doesn't apply in races (the countdown starts even if
  the land is still loading).
- The finale can only be reached by flying all eight levels (dev:
  `__game.run.level = 8` then `__portal()`). Not watched end to end in a
  real run.

- **Music follow-ups**: listen in a browser and set the mix (music vs wind,
  `AUDIO` in `?tune`); check the loop points; the menu backdrop is silent (no
  menu music yet); Aurora Summit needs its own finale track; the portal tunnel
  and results screen could use stingers; the music doesn't duck under fast wind.
  The tracks are ~2.9 MB each, so consider lowering the bitrate if load time matters.

- Playtest `speed-control` with keyboard, mouse and gamepad: boost into a
  banked turn, brake before a narrow gate, low-speed recovery, inverted flight,
  respawn and two-player effects. Tune reserve/drag/camera in `?tune`; assess
  camera-segment query cost in a focused window at Medium and High quality.
- Check speed-control poses/trails in day and night biomes, including with
  bloom disabled; visual verification remains outstanding.

- **Measure in a focused window**: `__bench(2/1/0)` after `__shot(0)` in a
  dev build. Bloom at High was 30 to 70 ms of GPU on an M2 in a hidden tab
  (noisy); if a focused window agrees, replace the composer's full-resolution
  scene pass (render the scene to the screen and bloom a half-resolution
  copy of only the bright parts).
- Play a run by hand with a mouse: the title card animation, the portal's
  spot in every biome.
- Restyle the upgrade picker, the title card and the finish screen in the
  Solo look (the run HUD and intro are done). Biome palettes have no picked
  inks (`theme.ts`), so most derive a similar deep blue; pick some by eye.
- **Map select backdrop:** the picture and the live view are different
  shots of the same map (the live camera is wherever its drift is), so the
  fade is a cut of sorts; matching them would need the drift to start where
  the picture was taken. Preloading whole maps was left out (about 40 MB and
  three workers each); the next card to the right could be built ahead if
  wanted.
- **Map select:** re-render `public/maps/` when the maps' looks change
  (drift view on each map's `featuredSeed`). Over a room's lobby, today's
  and random cards show their map's picture, maybe in another mood (no
  backdrop to take one); runs have no finale biome any more (Aurora is one map among nine): if the
  run's designer wants a fixed last map, `runOrder` is the place.
- **Map pool follow-ups:** time how long each map takes to load on a real GPU;
  if it's long, rooms want their countdown to wait for every pilot's land (a
  backend change), and the time trial's Start could show progress.
- The run's screens don't use the folding `Panel` (the time trial's and
  rooms' results do).
- **Map select follow-ups:** the map art was rendered without bloom (software
  GL); on a real GPU it would look better. Swipe on touch screens. More cards
  (yesterday's course, a friend's seed) if wanted.
- **Tutorial follow-ups:** play it in a room and an adventure, with a gamepad,
  and time a newcomer (aim: under 30 s). Maybe a chime per step. The room's
  pilot list and last race, if missed, could go in the pause overlay.
- Decide with the team: after a crash, wait for Enter before flying on?
  Playtesters can't react to the instant respawn; the cost is race time.
- The gamepad can't press Enter (start a run, answer the overlays) or pause;
  `Backspace` abandons a running time trial at once and isn't in How to fly.
- Misclicks that throw a run away, to judge once the in-game UI is settled
  (a Menu confirmation was tried and reverted): Menu in any mode, the
  browser's Back (mouse side button, touchpad swipe, Alt+←), and Backspace,
  which abandons a running time trial and isn't in the controls list.
- `theme.ts` has no picked ink for Sky Isles' **Starlight** mood, so it gets
  the one derived from its sky; pick one by eye.
- Leaderboard times from before the 2026-10-10 start-heading change were flown
  facing the old way; decide whether that matters for the daily boards.
- **Feathers and sidequests are parked on `Pengyue-feathers-sidequests`**
  (see the change log). To bring them back, merge that branch's
  `run/quests.ts`, the biome `sidequests` and `portals.secret` data and their
  HUD and screens. Lives are back on their own (see the change log), so skip
  that branch's lives and Spare feather.
- Runs keep scores in this browser only (`RunSession`, localStorage); a
  daily-run leaderboard needs backend endpoints (not changed, by request).
- Giant mushrooms, trunks and rings are rock: they collide, as they should,
  but plants can grow on mushroom caps only if their surface isn't `bare`.
- The sea grid's depth and the island falls are computed on the main thread
  at level load (about 100 ms for the lagoon). Could move to a worker.
- Far ridged mountains are spiky at 24 m voxels; maybe smooth the ridges with
  distance or lower `sharpness`.
- The free-flight respawn and the start grid don't do any pilot entrance
  animation; a "wings unfold" intro would be nice.
- Remote pilots each cost about 0.7 ms of CPU for animation. With many
  players, animate distant pilots every other frame.
- Sky Isles' Autumn and Dusk moods haven't been looked at since the islands
  merge (Alpine, Misty pines, Winter and Starlight have). Mist density per
  biome could use a tuning pass in a real window.
- Day/night or time-of-day as a continuous parameter instead of a fixed
  night factor per palette.
- `RINGS.crystals` only applies to the next map (gates are built once per
  world).
- The ponytail and hair are hand-placed; a proper hair cap mesh would look
  better from the front.

## Roguelike milestones (the current plan)

The first playable slice of the roguelike, in order. After each: commit to
`Pengyue`, update this file, keep the game building and running.

1. **Biome format** (done): `world/biomes/`, levels from (runSeed, level),
   Sky Isles ported with no visible change, World and WorldView take a biome.
2. **Terrain generator v2** (done): a composable distance field (domain-warped ridged
   mountains, terraced mesas, carved river channels, overhangs, arches),
   meshing in workers with LOD rings, analytic deterministic collisions, a
   terrain shader blending grass, rock, snow and sand by slope and height
   (triplanar on cliffs, on top of `atmospheric()`, flat-shaded look).
3. **Verdant Highlands** (done) and the reusable systems it needs: stylized water
   (depth tint, foam, sky reflection, sun glitter, skim spray), procedural
   trees (3+ species, wind sway, instanced, impostors far away), GPU grass and
   flowers near the camera, fireflies in shade. Then every other planned biome.
4. **Run loop** (done): biome → portal → upgrade pick → next biome; portals (swirling
   veil, beam, tunnel transition cross-fading palettes); an upgrade picker (3
   of at least 6 data-defined upgrades: dash, hover, glide-lock, stamina flap,
   proximity boost, gate magnet; abilities go through the flight model behind
   a run-mode flag, so races are unaffected); run score from gates, style and
   sidequests; a sidequest framework with 2 per biome; objectives HUD and a
   compass to the portal.
5. **Polish and performance** (done, frame times measured in a hidden tab
   only): knobs in `tuning.ts` and `?tune`, audio
   stingers, frame times per quality level in a focused window, screenshots
   of every biome by day and night, README and this file.

Constraints: never break races, ghosts or leaderboards (Sky Isles stays
frozen); no per-frame allocations; clamp `pow()` and divisions in every
shader; no backend API changes; no deleting branches or force-pushing.

## Roadmap

The long-term direction: turn Wind Rider from a single-map racer into a
**roguelike flying adventure across procedurally generated biomes**, while
keeping races and time trials on top of the same world generator.
Everything has to be aesthetically excellent: a coherent painted look
(Genshin / Sky / Journey), readable silhouettes, light and color that tell you
where to go.

### Terrain: procedural worlds

Today: floating islands from one signed distance field (meshed in workers),
pines, a sea of clouds, palettes with lighting moods. Goal:
varied, layered, living landscapes generated from a seed.

- **Landforms:** grow the islands' distance field into a composable generator:
  mountain ranges (ridged multifractal), valleys carved along splines, plateaus
  and mesas (terraced noise), cliffs, arches and floating islands (a 3D density
  field meshed with surface nets or marching cubes in a worker).
- **Water:** rivers following the flow downhill (carve channels from a
  drainage map), lakes in basins, waterfalls where rivers cross cliffs, and
  sea in coastal biomes. Shaded water: depth color, foam at the shore, sky
  reflection, animated normals.
- **Vegetation:** forests placed with Poisson-disk sampling over slope,
  height and moisture maps. Detailed stylized trees (L-system or space
  colonization trunks, clustered leaf cards with wind-sway shaders), several
  species per biome, instanced, with LODs and impostors for distance. Grass
  and flowers near the ground with a GPU sway shader.
- **Snow, ice, rock and sand:** material layers driven by slope, height and
  biome, blended in a terrain shader (triplanar on cliffs) instead of vertex
  colors alone. Snow caps by height and normal.
- **Clouds and atmosphere:** volumetric-looking clouds you can fly through
  (instanced soft billboards or raymarched low-resolution layers), a sea of
  clouds below high biomes, height fog, god rays, and a sky with sun, moon,
  stars and aurora per biome.
- **Streaming:** chunks generated in Web Workers, with LOD rings (fine near,
  coarse far) and collision queries kept analytic or on a coarse grid so
  physics stays cheap and deterministic.
- **Determinism:** every generator takes the seed and its own named stream
  (`makeRng(seed, "rivers")`), so multiplayer and ghosts keep matching.

### Flight: feel and depth

- Keep the arcade core (nose points where you go, energy trade), and add
  depth: updrafts and thermals (visible as rising motes), wind currents to
  ride (ribbons of light like Sky's wind walls), boost rings, slipstream
  behind other players, and a controllable flare or dive-tuck.
- Abilities as upgrades (see below): dash, short hover, glide-lock, a
  grapple to swing around pillars, a wing-flap climb with stamina (Sky-style
  wing energy, recharged by light sources).
- Feel: camera tuned per speed band, haptics on gamepad, audio layers (wind
  pitch with speed, whoosh on near-miss, chime on gates).
- Every flight constant stays in `FLIGHT`, every look constant in
  `tuning.ts`, and both appear in `?tune`.

### User experience: roguelike gameplay

The core loop:

1. **Arrive in a biome** (a level) generated from the run seed and the level
   number.
2. **Explore and score:** fly through crystal gates for points and combos,
   skim terrain for style, and do sidequests: light shrines, chase spirit
   birds, collect scattered stars, rescue a lost glider, race a rival through
   a canyon, pop beacons in time.
3. **Find the portal(s):** each level hides one or more portals (a main
   portal and secret ones behind sidequests). Hints come from light beams,
   birds, wind currents and gates leading toward them.
4. **Choose an upgrade:** flying into a portal offers two or three
   selectable upgrades, tools or abilities, roguelike style (passive stat
   boosts, actives like dash or hover, cosmetic trail colors earned by
   challenges). The portal's color hints at the next biome.
5. **Next biome:** harder, faster, more vertical; points carry over. The run
   ends on a crash streak or a timer, depending on the mode. Score, biomes
   reached and upgrades go to a leaderboard per daily seed.

Things to build: a run state machine (biome → portal → upgrade pick → next),
an upgrade system with data-driven definitions, sidequest framework (spawn,
track, reward, HUD), portal visuals and transitions (a light tunnel, the
palette cross-fading), HUD for score, objectives and a minimap or compass,
and a meta layer (unlocks between runs). Races and time trials stay as modes
that reuse a fixed biome.

## Items and abilities (the design list)

Given on 2026-10-10. Where a description doesn't match the game as it is
(there are no "ships", no stamina bar but the boost reserve and the
wingbeat's stamina, gates are the "hoops"), follow the game's design and do
what is reasonable. Everything here is **run mode only**: it reaches the
flight model through `FlightMods` and the run controller, never races, time
trials or ghosts (rule 6). Each one gets its own models and animations in the
Genshin / Sky style.

- **Items** are things you find or carry (consumables and gadgets): pickups
  placed in levels (`ItemDisplay`), an inventory, `Game.useItem`. Some item
  models already exist in `game/items/` (the giant firework, candies,
  feathers, helmets, fruits).
- **Abilities** are the pilot's own traits and skills: run upgrades offered
  at portals (`run/upgrades.ts`). Passives change the flight or scoring;
  actives have a key and a cooldown or a charge.

Status: **done** = mechanics, models and animations in the game.

### Items

| # | Item | What it does | Status |
| :- | :- | :- | :- |
| 1 | Anemo Catcher (Bottle of Wind) | Releases a localized updraft, propelling you straight upward if you miss a high hoop | done |
| 2 | Starflake Shield | A shimmering, fragile aura that shatters on impact: protects you from one collision with terrain | done |
| 3 | Luminescent Glider Wax | For a while, no drag: hold top speed without losing altitude | done |
| 4 | Comet Tail Firework | A massive rocket strapped to your back: a terrifying, uncontrollable burst of forward speed and a trail of sparks (the giant firework model exists) | done |
| 5 | Spirit Lantern | Shows hidden, high-value "ghost hoops" that are invisible in dark or foggy areas | done |
| 6 | Echoing Conch | A sonar pulse that highlights the best path through the next three hoops | done |
| 7 | Feather of the Great Phoenix | A single-use revive: on a crash you burst into flames and respawn in mid-air, briefly invulnerable | done |
| 8 | Cloud-Spun Silk Ribbon | 10 s of much tighter turns and sharper handling, for threading canyons | done |
| 9 | Vortex Geode | Pulls nearby loose collectibles (points, energy) towards you for a short time | done |
| 10 | Aero-Boots of the Adepti | Three "mid-air jumps" (stepping on the air) to correct your altitude quickly | done |
| 11 | Stormcaller's Kite | A kite that catches high winds and tows you upward for 5 s | done |
| 12 | Glacial Prism | Freezes the timer or the combo's decay for a few seconds | done |
| 13 | Sun-Kissed Nectar | Fills the boost reserve (and stamina) at once | done |
| 14 | Tether of the Wind Spirit | A grappling hook of light to a nearby hoop or cliff, swinging you round it for a sharp turn | done |
| 15 | Illusory Moth Cape | Intangible for 3 s: fly straight through rock | done |
| 16 | Resonant Chimes | Passing a hoop while active sends a shockwave that widens the next hoop | done |
| 17 | Crystallized Updraft | A trampoline of wind dropped on a surface: bounce off it for a big vertical boost | planned |
| 18 | Dusk-Weaver's Hourglass | Slows time for the world around you while you move at normal speed | planned |
| 19 | Electro-Charged Prism | An electric aura: near misses throw chain lightning that scores bonus points | planned |
| 20 | Tear of the Dragon | A heavy teardrop: while held, a rapid dive-bomb straight down to low hoops | planned |

### Abilities (passive and active)

| # | Ability | What it does | Status |
| :- | :- | :- | :- |
| 1 | Featherfalling (passive) | Much less pull from gravity: slower descent, less drag | done |
| 2 | Skim-Booster (passive) | Near misses with the ground, walls or obstacles make "thrill energy": you can boost as long as you stay dangerously close | done |
| 3 | Cloud-Surfing (passive) | Flying right over cloud layers restores stamina and gives a slight speed buff | done |
| 4 | Plunging Attack (active) | A rapid, steep dive; hitting a hoop in it sends out a shockwave for bonus points | done |
| 5 | Wind-Shear Dash (active) | A short, instant sideways blink to dodge a cliff face or snap into a misaligned hoop | done |
| 6 | Thermal Vision (passive) | Updrafts, wind currents and boost rings glow brightly from much further away | done |
| 7 | Slipstream Rider (passive) | Flying right behind moving things (giant flying manta rays, other players) makes you much faster | done |
| 8 | Elemental Burst: Gale Force (active) | Stored energy unleashed as a huge wind tunnel ahead: faster, and every hoop in it gets a wider hitbox | done |
| 9 | Acrobatic Recovery (passive) | Clip a wall without crashing outright and you barrel roll away, keeping your momentum | done |
| 10 | Hover-Stall (active) | Stop dead and hover for 2 s, to turn and pick a new direction | done |
| 11 | Moth's Attraction (passive) | The closer to a hoop's centre you pass, the more speed you come out with | done |
| 12 | Zenith Climber (passive) | Upward momentum lasts 20% longer when flying vertically, to scale big cliffs | done |
| 13 | Resonance (active) | Sing or "honk" a wave of energy: a hoop it hits turns to face you | done |
| 14 | Ley-Line Surger (passive) | 5 hoops in quick succession start a "Ley-Line" state: endless boost until the combo breaks | done |
| 15 | Aero-Braking (active) | Throw the cape and wings forward to brake hard, for hairpin turns | done |
| 16 | Draft-Weaving (passive) | A tight corkscrew or spiral spins up a little tornado that shields you from minor impacts | done |
| 17 | Ascension (active) | Give up all horizontal momentum to shoot straight up | done |
| 18 | Gliding Stance: Falcon (toggle) | Wings tucked: falls much faster, higher top speed, very stiff steering | done |
| 19 | Gliding Stance: Butterfly (toggle) | Cape spread wide: falls slowest, turns tightest, but very slow | done |
| 20 | Echo-Trail (passive) | You leave a ribbon of light; close a full circle across it and it becomes a wind ring that speeds you up | done |

## Biome proposals and construction plan

Each biome is a **level** in the roguelike run: a generator recipe (landforms,
water, vegetation, props), a lighting mood (a palette with the fields above,
extended), signature particles and set pieces, its own sidequests, and the
portals out. Biomes share one engine. A biome is data plus a few biome-specific
modules, never a fork of the renderer.

### The biomes

| # | Biome | Landforms and set pieces | Light and mood | Signature effects | Sidequests |
| :- | :- | :- | :- | :- | :- |
| 1 | **Sky Isles** (start; today's map) | Floating islands with pine forests, rock tunnels, a sea of clouds | Clear alpine day or backlit dusk (Alpine, Dusk palettes) | Light motes, cloud wisps, pollen in the sun | Light the three cairns; thread the needle tunnels |
| 2 | **Verdant Highlands** | Rolling hills, terraced cliffs, rivers with waterfalls, dense forest with tall pines and broadleaf canopies | Soft morning sun, humid mist in valleys (Jungle) | Pollen and fireflies in shade, waterfall spray and rainbows, leaves blown off trees by your wake | Chase the spirit birds; collect seeds and plant a glowing tree |
| 3 | **Glacier Peaks** | Jagged ridges, ice cliffs, crevasses, frozen lakes, snowfields; cloud sea below | Crisp, high sun, blue shadows (Glacier) | Snow blown off ridges, ice sparkle, breath-like frost on wingtips, aurora at the summit | Ring the ice bells; rescue a stranded glider in a blizzard |
| 4 | **Sky Archipelago** | Floating islands (3D density), waterfalls into the void, vine bridges, cloud banks to dive through | Golden hour above the clouds, god rays through gaps | Cloud wisps parting around you, light motes like Sky's Isle of Dawn | Gather scattered stars; ride the wind walls between islands |
| 5 | **Coral Lagoon** | Sea stacks, shallow turquoise water, sandbars, coral arches, palm groves | Bright tropical noon, caustics (Lagoon) | Sea spray when skimming water, flying fish, gull flocks | Skim the water for a combo; race the manta through the arches |
| 6 | **Twilight Forest** | Giant mushroom and redwood forest, roots forming tunnels, glowing ponds | Blue hour, bioluminescence (Nightshade) | Fireflies, glowing spores reacting to your wingbeats, light trails brighter | Relight the lanterns; follow the spirit fox |
| 7 | **Ember Wastes** | Volcanic ridges, lava rivers, obsidian spires, ash plumes | Red-orange, underlit by lava, dark sky | Embers rising on thermals, heat haze, sparks off obsidian | Ride the thermals to the caldera; outrun the eruption |
| + | **Sunken Reef** (built; in every run in place of one of 3 to 7) | A valley in the seabed: coral arches, table corals, reef pillars, kelp forests, a shipwreck, a drowned shrine | The water's surface overhead, caustics, light shafts; sunlit shallows or a moonlit deep | Schools of fish, jellyfish, bubbles, plankton | None yet |
| 8 | **Aurora Summit** (finale) | A spire above the clouds, ring of ancient crystal gates | Night, aurora, stars, moon glare | Aurora ribbons, starfall, every gate a light pillar | The final ascent: a gauntlet of every gate type |

### Structures per biome

Agreed on 2026-10-10. Weathered pale stone, gold trims, cloth that moves, and
a light that comes on at night. Structures are solid in run biomes (skimming
a tower scores style). Sky Isles is frozen, so it only gets small dressing
that is drawn but never collides, kept well off the line.

| Biome | Signature landmark (1 or 2 per level) | Scattered structures | Night |
| :- | :- | :- | :- |
| **Sky Isles** (frozen) | None | Small cairns, prayer-flag lines and stone lanterns on island tops, drawn only | Lanterns glow |
| **Verdant Highlands** | Stone windmill on a hilltop (done); arched stone bridge over the river above a fall (done) | Watchtowers (done), stone lanterns (done), shrine gates on terraces, cottages with round roofs near the pools | Warm windows, lanterns |
| **Glacier Peaks** | Mountain monastery on a ledge, gold roof caps and banners | Ice-bell pavilions, prayer-flag lines between ice shards, snowed-in stone huts, half-buried cairns | Bells and windows glow under the aurora |
| **Sky Archipelago** | Floating temple on one big island: colonnade, dome, a broken stair into the void | Rope-and-plank bridges between islands, broken columns, wind chimes, moored cloth kites | Braziers along the colonnade |
| **Coral Lagoon** | Lighthouse on a sea stack with a slow sweeping beam | Stilt huts and jetties on islets, sunken ruin columns in the shallows, small sailboats, shell-roof pavilions | Lighthouse beam, hut lanterns on the water |
| **Twilight Forest** | Great lantern tree shrine: platforms spiralling round a giant trunk | Treehouses and hanging lanterns on trunks, doors and windows in mushroom stems, mossy spirit statues, root-bridge railings | Everything bioluminescent |
| **Ember Wastes** | Ruined forge-temple on a mesa with lava channels through it | Obsidian obelisks with glowing runes, chain bridges over lava, broken aqueduct arches, ancient braziers | Runes and braziers lit from below |
| **Aurora Summit** | Observatory with a crystal dome near the spire; a stair of gate arches up it | Ancient crystal pylons, star altars, ring fragments on stone plinths | Pylons send faint beams up |

How: scattered structures are kinds in the flora pipeline
(`world/structures/`). Landmarks are placed once per level from the level
seed, off the line. Bridges and aqueducts you fly under are rock shapes in
the distance field, so the drawn stone and the collision match. Moving parts
animate in the vertex shader and never move a collider.

Order: (1) the format, proven with Verdant's watchtower, lantern and windmill
(done); (2) Verdant's bridge, the first distance-field structure (done); (3) one
landmark and three scattered kinds per remaining biome, in run order (done,
with stand-ins noted in Next up);
(4) night lights, moving parts, and a day and night browser check per biome.

### Shared systems to build (in this order)

1. **Biome definition format** (`world/biomes/*.ts`): `{ name, palette,
   landforms, water, vegetation, props, particles, sidequests, portals }`, all
   deterministic from `(runSeed, level)`. Today's `World` becomes the
   "Sky Isles" recipe.
2. **Terrain generator v2**: a composable height function (domain-warped
   ridged noise, terraces, carved river splines), plus an optional 3D density
   field for islands and overhangs. Generate chunks in a Web Worker, with LOD
   rings. Collisions stay analytic (distance fields, as `RockField` does now).
3. **Terrain shader v2**: slope- and height-blended layers (grass, rock,
   snow, sand) with triplanar sampling on cliffs, building on `atmospheric()`.
   Keep the flat-shaded painted look; textures are subtle noise, not photos.
4. **Water**: a plane or river mesh with a stylized shader (depth tint, foam
   lines, sky reflection, sun glitter that blooms), plus spray particles when
   skimming.
5. **Vegetation**: instanced stylized trees (generated trunk and branches,
   leaf clusters as alpha cards or low-poly blobs with toon shading), placed by
   Poisson disk over moisture, slope and height; wind sway in the vertex
   shader; impostors far away. Grass and flowers as GPU-instanced blades near
   the camera.
6. **Sky and weather**: extend `skyMaterial` with layered cloud volumes you
   can fly through (soft instanced billboards), god rays (a screen-space pass
   at High quality), weather particles (snow, rain, embers, spores).
7. **Run structure**: portals (a gate variant: swirling veil, beam, a tunnel
   transition that cross-fades palettes), the upgrade picker UI, run score,
   sidequest framework, and biome order from the run seed.
8. **Per-biome audio beds** and music stingers for gates, sidequests and
   portals.

### What Claude should focus on

- **First:** the biome definition format and the terrain generator v2,
  because everything else hangs off them. Port the current islands into the
  format without changing how it looks, verify, then add Verdant Highlands
  (the first new one: it exercises rivers, forests and mist).
- **Second:** vegetation and water, as reusable systems.
- **Third:** the run loop (portals, upgrades, sidequests) on two biomes,
  before building more biomes.
- Keep every biome **beautiful at Medium quality without bloom**. Bloom is
  the cherry, not the cake.
- For every new visual system: add knobs to `tuning.ts`, make it react to the
  biome light (`ATMOSPHERE`, `TOON_LIGHT`, `FX_LIGHT`), check it in the
  browser in at least a day and a night biome, and log it here.
