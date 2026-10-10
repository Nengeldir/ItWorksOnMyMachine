# CLAUDE.md: read this first, every session

This file is Claude's memory for Wingrace. Claude Code loads it automatically
at the start of every session in this repository. Read all of it before
touching code, and keep it true.

## The most important point: Genshin Impact and Sky (光遇)

**Wingrace is a Genshin Impact and Sky: Children of the Light (光遇) styled
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

Wingrace is a browser wingsuit racer in the style of Superflight, with
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
- `/?explore=<biome>&seed=<n>` flies a run level of any biome freely (no
  clock, nothing saved), e.g. `/?explore=verdant&seed=2` (Morning) or `&seed=3`
  (Moonlit).
- Races and time trials always fly **Sky Isles** (`raceLevel(seed)`). Its
  generator is frozen: recorded ghosts and leaderboards depend on every
  collision surface staying put. `docs/dev-snippets.js` has `__raceHashes()`,
  which must keep returning the hashes listed there for trees, distances and
  rings. New biomes are for the roguelike run only.
- In dev, `window.__game`, `window.__fxTime` and `window.__tuning` are exposed
  for poking at the game from the console.
- Node 22+ works locally (the VM uses 24). Python 3.14 on the VM.

### Architecture map (frontend/src)

| Path | What it does |
| :--- | :--- |
| `game/Game.ts` | The game: frame loop, fixed 120 Hz physics steps, race state, ring checks, HUD data, effects wiring (gate bursts, skim spray, gate motes), rendering with optional bloom, adaptive quality, the `?tune` panel |
| `game/flight.ts` | Arcade, energy-based flight model (`FLIGHT` constants). Physics only. `FlightMods` (run upgrades: drag, sink, stall, proximity boost, dash boost, thermal lift, hover, glide lock) are only ever passed in run mode; `flap()` is a run ability |
| `game/avatar.ts` | The pilot: a cel-shaded chibi flyer built from primitives (merged per body part, vertex-colored), a procedural cape and scarf (`Cloth`), two-segment feathered wings, and all its animation: bank lead spring, barrel rolls, flapping driven by effort, bobbing, cloth ripples, limb reactions. Also `createLabel` and `glowTexture` |
| `game/toon.ts` | Toon material (3-band gradient, rim light tinted by the biome's sun, self-lit `glow` vertex attribute for trims and wingtips) and the inverted-hull ink outline. `TOON_LIGHT` is set per biome |
| `game/pilotfx.ts` | Per-pilot effects: wingtip and cape ribbons, light motes, downstroke puffs, barrel-roll star spiral. Shared by you, other players and ghosts |
| `game/particles.ts` | One GPU particle system (ring buffer, physics in the vertex shader). Kinds: Glow, Star, Shard, Wisp. `fxTime` is the shared shader clock; `FX_LIGHT.boost` scales all glowing effects per biome |
| `game/trail.ts` | Glowing additive ribbon (shader: soft edges, light pulses, fades near the camera) |
| `game/speedlines.ts` | Wind streaks that hang in the air and rush past at speed |
| `game/camera.ts` | Chase camera (`CAMERA` tuning): lag, partial horizon roll, FOV with speed, FOV kick on gates, shake when skimming |
| `game/tuning.ts` | `ANIM`, `FX`, `RINGS`, `CAMERA`: every look constant, slider ranges, localStorage persistence |
| `game/input.ts` | Keyboard, pointer-lock mouse and gamepad, merged into pitch and roll, plus actions (respawn, mute, barrel rolls) |
| `game/pilots.ts` | Remote players and ghosts: interpolated samples driving an `Avatar` and `PilotFx` |
| `game/ghost.ts` | Recording and decoding ghost runs (15 Hz) |
| `game/glidein.ts` | `GlideIn`: while the land near you is loading (free flight, runs, explore; never races), the pilot glides in on rails instead of hanging frozen: no input, no physics step, no scoring; at most 70 m and never within 30 m of the next gate, slowing before rock; control comes back at `START_SPEED` when the land is ready, and a run's level clock keeps running meanwhile |
| `game/death.ts` | Crash animations, looks only: `classifyCrash` picks headfirst (into a wall: bounce and tumble), slide (glancing ground: roll down the slope), wing (a wing clipped: spin down) or fall (below the islands); `DeathFall` is a small rigid-body tumble kept out of the rock by the distance field. The avatar plays `die(kind)`, the camera `follow`s, the body dissolves into light at `DISSOLVE_AT`, all inside `RESPAWN_DELAY` |
| `game/effects.ts` | Crash debris: feathers knocked loose that flutter down (instanced) |
| `game/audio.ts` | Synthesized wind and event sounds, run stingers (portal, upgrade, dash; sidequest and item are unused for now), the wingbeat sample (`public/audio/sfx/wingbeat.mp3`, pitch-randomized, played on each of your downstrokes and on the Wingbeat ability) and the `MusicPlayer` |
| `game/music.ts` | `MusicPlayer`: one looping track per biome from `public/audio/music/<biome>_<title>.mp3`, crossfaded on biome change (`TRACK_OF` maps biomes to tracks; similar biomes share one). Night dims and muffles the same track. Loaded lazily, decoded with Web Audio, no music if a file fails |
| `game/webgl.ts` | WebGL 2 availability check; `GameScreen` shows help if it's missing |
| `game/run/` | The roguelike run. `run.ts`: run length, biome order from the run seed, portal destinations, scoring constants, `RunHud`. `upgrades.ts`: nine data-defined upgrades and the 3-of-N offer. `controller.ts`: `RunController` (levels, gates and chains, abilities as `FlightMods`, the portal, upgrade pick, tunnel and palette cross-fade, HUD data). `portal.ts`: portal (ring, swirling veil, beam) and the tunnel |
| `game/devtools.ts` | Dev builds only: `__shot(view)` (freeze, stream the land around a fixed camera, render once), `__raceHashes()` (the race map's determinism check), `__run(s)`, `__bench(q)` and `__crash(kind, after)` (flies into rock near the start and stops `after` s into the crash animation) on `window` |
| `game/math.ts` | `clamp`, `smoothstep`, `smin` (smooth minimum for distance fields) |
| `game/world/terrain/` | Generator v2 (every biome but Sky Isles). `noise.ts`: seeded fbm, ridged multifractal, domain-warped ridges, terraces. `shapes.ts`: distance-field primitives with boxes, surface ids and grain (Island, NoiseIsland from 3D noise with tunnels, Mesa with ledges, Spire between two points, Slab, RockRing, Cap). `ground.ts`: the heightfield following the line (valley, hills, warped ridged mountains, terraces, crevasses, carved river channel, overhang noise on cliffs). `river.ts`: `Steps`, a valley floor stepping down in pools and falls, and the river in it (water distance for collisions). `field.ts`: `TerrainField`, ground + shapes as one field, `fill()` for whole blocks (same arithmetic as `distance()`). `recipes.ts`: gates and scenery from a biome's `LandRecipe`. `mesh.ts`: surface nets per LOD node, faces painted for the shader. `streamer.ts`: `LandStreamer`, the LOD octree (384/192/96 m nodes, 16 cells each). `material.ts`: the terrain shader |
| `game/world/biomes/` | Biomes as data (`types.ts`: `Biome`, `Level`, `LevelKey`). `index.ts`: the registry, `raceLevel(seed)` (races and time trials: always Sky Isles) and `runLevel(runSeed, index, biome)` (roguelike levels, deterministic from the run seed and level number). `skyIsles.ts`: the race map, frozen |
| `game/world/World.ts` | Everything a level decides: course, rock field, trees, palette; built from a `Level` (biome + seed + mood). `distance()` for collisions, `lost()` below the islands. No rendering |
| `game/world/islands.ts` | `RockField`: the floating islands as one signed distance field (shapes melted with `smin`, roughened, a tube carved along the racing line) |
| `game/world/mesher.ts`, `mesher.worker.ts` | Cuts chunks of the rock field into flat-shaded meshes in Web Workers, and places trees. Workers rebuild the World from a `LevelKey` |
| `game/world/trees.ts` | Tree colliders and their lookup index |
| `game/world/course.ts` | The racing line (a descending curve in z) and the gates along it |
| `game/world/palette.ts` | The `Palette` type: a lighting mood (colors, sun elevation and azimuth, night factor, mist, effect glow), and `sunDirection(palette)`. Each biome lists its moods |
| `game/world/atmosphere.ts` | `ATMOSPHERE` light uniforms shared per biome; `atmospheric()` patches Lambert materials (sun-tinted haze matching the sky, valley mist, backlit rims, rock strata); `skyMaterial()` (gradient, HDR sun or moon disc and halo, painted clouds, twinkling stars at night) |
| `game/world/WorldView.ts` | Meshes for a World, as its biome describes them: land streamed from the workers (Sky Isles' chunks, or a `LandStreamer` for v2 land), pines, the sea of clouds and cloud puffs, sky, gates. `ready` is false until the land near you has arrived |
| `game/world/crystals.ts` | Crystal gates: instanced crystals (bob, spin, pass flare and burst in the shader), veil discs with the pass shockwave, light pillars over the next gate and the finish |
| `session/` | Solo, room, explore and run sessions wiring a `Game` to the network and UI. `ExploreSession`: free flight through any biome (`/?explore=verdant&seed=2`), nothing saved. `RunSession`: a roguelike run (`/?run=<seed>`), best score per run seed in localStorage |
| `net/` | Server clock sync and the room connection (SSE down, POST up) |
| `staleBuild.ts` | After a redeploy, an open tab's lazy chunks (bloom, `?tune`) and mesher worker are 404s: `reloadForNewBuild` reloads the page once (at most every 30 s, production only) |
| `components/` | React screens: menu (with the Adventure card), HUD, lobby, results, controls, and the run's HUD, title card and upgrade picker (`RunHud.tsx`) |

Backend (`backend/`): `app.py` endpoints, `rooms.py` race state machine and
15 Hz SSE relay, `store.py` SQLite runs and ghosts, `models.py` Pydantic models.
Players never collide, so the server only relays positions.

### Key mechanics

- **Flight:** the nose points where you go. Gravity along the flight path
  speeds you up or slows you down, drag caps speed, bank turns you, too slow
  and the nose drops. Skimming rock (proximity) adds style points, a
  multiplier and acceleration. Crash means respawn at the last ring, with the
  clock still running.
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

**Resume here:** the five roguelike milestones are done. What's open:

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
- The UI theme (`useUiTheme`) follows the map in time trials and rooms only;
  runs and explore keep the menu's colors. Theme by the level's palette.
- Restyle the run HUD, upgrade picker and run summary for the glass look
  (only the tokens were mapped).
- **Feathers and sidequests are parked on `Pengyue-feathers-sidequests`**
  (see the change log). To bring them back, merge that branch's
  `run/quests.ts`, the biome `sidequests` and `portals.secret` data, lives in
  `RunController`, the Spare feather upgrade and their HUD and screens.
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

The long-term direction: turn Wingrace from a single-map racer into a
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
| 8 | **Aurora Summit** (finale) | A spire above the clouds, ring of ancient crystal gates | Night, aurora, stars, moon glare | Aurora ribbons, starfall, every gate a light pillar | The final ascent: a gauntlet of every gate type |

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
