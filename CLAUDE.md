# CLAUDE.md: read this first, every session

This file is Claude's memory for Wingrace. Claude Code loads it automatically
at the start of every session in this repository. Read all of it before
touching code, and keep it true.

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
multiplayer races. Every course is a seeded canyon (same seed, same map) with
gates (rings), pillars, floating rocks and arches. Built for the VIScon
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
- In dev, `window.__game`, `window.__fxTime` and `window.__tuning` are exposed
  for poking at the game from the console.
- Node 22+ works locally (the VM uses 24). Python 3.14 on the VM.

### Architecture map (frontend/src)

| Path | What it does |
| :--- | :--- |
| `game/Game.ts` | The game: frame loop, fixed 120 Hz physics steps, race state, ring checks, HUD data, effects wiring (gate bursts, skim spray, gate motes), rendering with optional bloom, adaptive quality, the `?tune` panel |
| `game/flight.ts` | Arcade, energy-based flight model (`FLIGHT` constants). Physics only |
| `game/avatar.ts` | The pilot: a cel-shaded chibi flyer built from primitives (merged per body part, vertex-colored), a procedural cape and scarf (`Cloth`), two-segment feathered wings, and all its animation: bank lead spring, barrel rolls, flapping driven by effort, bobbing, cloth ripples, limb reactions. Also `createLabel` and `glowTexture` |
| `game/toon.ts` | Toon material (3-band gradient and rim light) and the inverted-hull ink outline |
| `game/pilotfx.ts` | Per-pilot effects: wingtip and cape ribbons, light motes, downstroke puffs, barrel-roll star spiral. Shared by you, other players and ghosts |
| `game/particles.ts` | One GPU particle system (ring buffer, physics in the vertex shader). Kinds: Glow, Star, Shard, Wisp. `fxTime` is the shared shader clock |
| `game/trail.ts` | Glowing additive ribbon (shader: soft edges, light pulses, fades near the camera) |
| `game/speedlines.ts` | Wind streaks that hang in the air and rush past at speed |
| `game/camera.ts` | Chase camera (`CAMERA` tuning): lag, partial horizon roll, FOV with speed, FOV kick on gates, shake when skimming |
| `game/tuning.ts` | `ANIM`, `FX`, `RINGS`, `CAMERA`: every look constant, slider ranges, localStorage persistence |
| `game/input.ts` | Keyboard, pointer-lock mouse and gamepad, merged into pitch and roll, plus actions (respawn, mute, barrel rolls) |
| `game/pilots.ts` | Remote players and ghosts: interpolated samples driving an `Avatar` and `PilotFx` |
| `game/ghost.ts` | Recording and decoding ghost runs (15 Hz) |
| `game/effects.ts` | Crash debris (instanced tetrahedra) |
| `game/audio.ts` | Synthesized wind and event sounds |
| `game/webgl.ts` | WebGL 2 availability check; `GameScreen` shows help if it's missing |
| `game/world/World.ts` | Everything a seed decides: terrain, course, obstacles, palette. No rendering |
| `game/world/terrain.ts` | Heightmap canyon from simplex noise; distance queries for collisions |
| `game/world/course.ts` | Racing line, ring placement, obstacle placement |
| `game/world/obstacles.ts` | Pillars, rocks, arches as signed distance functions, plus a grid for lookups |
| `game/world/palette.ts` | Six color themes (Dusk, Glacier, Jungle, Desert, Nightshade, Lagoon) |
| `game/world/WorldView.ts` | Meshes for a World: streamed terrain chunks, obstacles, sky, sun, gates |
| `game/world/crystals.ts` | Crystal gates: instanced crystals (bob, spin, pass flare and burst in the shader), veil discs with the pass shockwave |
| `session/` | Solo and room sessions wiring a `Game` to the network and UI |
| `net/` | Server clock sync and the room connection (SSE down, POST up) |
| `components/` | React screens: menu, HUD, lobby, results, controls |

Backend (`backend/`): `app.py` endpoints, `rooms.py` race state machine and
15 Hz SSE relay, `store.py` SQLite runs and ghosts, `models.py` Pydantic models.
Players never collide, so the server only relays positions.

### Key mechanics

- **Flight:** the nose points where you go. Gravity along the flight path
  speeds you up or slows you down, drag caps speed, bank turns you, too slow
  and the nose drops. Skimming terrain (proximity) adds style points, a
  multiplier and acceleration. Crash means respawn at the last ring, with the
  clock still running.
- **Rendering:** `Game.loop` interpolates between physics states, animates
  the avatar on top, updates effects, then renders. High quality uses an
  `EffectComposer` (RenderPass → UnrealBloomPass → OutputPass) with HDR
  half-float targets. Only colors above `FX.bloomThreshold` (1.3) bloom, so
  effects that should glow write colors above 1.
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

## Change log

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

## Next up

- Measure real frame times at High quality on an integrated GPU, in a focused
  window. If bloom is too costly, lower `COMPOSER_PIXEL_RATIO` or MSAA samples.
- The free-flight respawn and the start grid don't do any pilot entrance
  animation; a "wings unfold" intro would be nice.
- Remote pilots each cost about 0.7 ms of CPU for animation. With many
  players, animate distant pilots every other frame.
- `RINGS.crystals` only applies to the next map (gates are built once per
  world).
- The ponytail and hair are hand-placed; a proper hair cap mesh would look
  better from the front.

## Roadmap

The long-term direction: turn Wingrace from a single-canyon racer into a
**roguelike flying adventure across procedurally generated biomes**, while
keeping races and time trials on top of the same world generator.
Everything has to be aesthetically excellent: a coherent painted look
(Genshin / Sky / Journey), readable silhouettes, light and color that tell you
where to go.

### Terrain: procedural worlds

Today: one heightmap canyon, three obstacle shapes, flat palettes. Goal:
varied, layered, living landscapes generated from a seed.

- **Landforms:** move from one canyon function to a composable generator:
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

To be written after the lighting and shader pass (see the next change log
entry).
