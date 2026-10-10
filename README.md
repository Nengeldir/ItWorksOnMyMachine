# Wind Rider

A Superflight-style wingsuit game for the browser, with multiplayer races.
Every course is a field of low-poly floating islands generated from a seed:
the same islands, tunnels, rock walls, needles and rings for everyone on the
same seed. Every couple of seconds the racing line threads a gate. Dive for
speed, skim the rock for style points and a boost, and beat your friends to
the last ring.

- **Race friends:** create a room, share its code, everyone flies the same map
  at the same time and sees each other live.
- **Time trial:** race the clock on today's course, or choose one in the map
  select (a course for each of Sky Isles' moods, a random one or any seed),
  against the ghosts of the fastest runs. Leaderboards per seed.
- **Adventure:** a roguelike run through eight biomes linked by portals:
  Sky Isles, Verdant Highlands, then the Sunken Reef (a dive under the sea)
  and four of Glacier Peaks, Sky Archipelago, Coral Lagoon, Twilight Forest
  and Ember Wastes in an order the run's seed decides, and the Aurora Summit
  last. Chain gates, skim for style, and pick an upgrade at every portal
  (stronger boost, wingbeats, glide lock, and abilities like Hover-Stall,
  Plunging Attack, Gale Force, a spirit manta to draft behind, Resonance,
  Ascension and the falcon and butterfly gliding stances).
  A map select on the Adventure tab shows every biome.

Races and time trials always fly Sky Isles, so recorded ghosts and
leaderboards stay valid; the other biomes are for the adventure.

Built on the VIScon hackathon template: React + Three.js in the browser,
FastAPI behind Caddy on the team VM.

## Quick Start

```bash
docker compose up --build
```

Then open http://localhost:8080. API docs are at http://localhost:8080/api/docs.

No configuration is needed. A `.env` file is optional (see
[`.env.sample`](.env.sample)); it only matters if you add LLM features.

## On Your Team VM

Deploy or redeploy from the repository on the VM with:

```bash
docker compose up -d --build
```

- The portal forwards your team's address to port 8080 on the VM, where Caddy
  listens.
- Leaderboards and ghost runs live in SQLite on the `game-data` Docker volume,
  so they survive redeploys. `docker compose down -v` wipes them.
- With the portal's access control on, players are logged in and their portal
  name shows up in rooms and on leaderboards. With it disabled, anyone can play
  and picks a nickname; the browser remembers a random id for them.
- Dev servers on the VM aren't reachable from outside. Forward the port over
  SSH, e.g. `ssh -L 5173:localhost:5173 viscon@<your VM>`.

## How to Play

| Input                     | Action                                             |
| :------------------------ | :------------------------------------------------- |
| Mouse (click the view)    | Pitch and turn; bank is limited to 80°.       |
| `W` `S` / `↑` `↓`         | Dive / pull up (flight-stick style)                |
| `A` `D` / `←` `→`         | Turn left / right; maximum bank 80°.              |
| `Q` `E` | 5 m sideways dodge + roll (gamepad: `LB` `RB`)  |
| Gamepad left stick        | Pitch and turn. `Y` respawns.                      |
| `R`                       | Respawn at the last ring                           |
| `M`                       | Mute                                               |
| `P`                       | Pause / resume local gameplay                      |
| Hold `Shift` / gamepad `RT` | Boost (all modes; release to recharge)          |
| Hold `Space` / gamepad `LT` | Air brake (all modes; takes priority over boost) |
| `C` / gamepad `A`         | Wingbeat (adventure, with the upgrade)             |
| `F` / gamepad `B`         | Hover-Stall: stop and hover 2 s, steer to turn on the spot; again to launch early (adventure, with the ability) |
| `X` / gamepad `X`         | Plunging Attack: a steep dive; a gate in it is a strike for bonus points; pull up to stop (adventure) |
| `Z` / right stick click   | Gale Force, once charged by gates: a wind tunnel ahead that pushes you and widens its gates (adventure) |
| `T` / left stick click    | Resonance: a wave of song that turns the gates ahead to face you (adventure) |
| `G` / d-pad up            | Ascension: give up your forward speed to shoot straight up (adventure) |
| `H` / d-pad down          | Gliding stance: falcon (fast, stiff) or butterfly (floaty, nimble); with both, it cycles (adventure) |
| `1` to `4`                | Choose an upgrade at a portal                      |
| `Enter` in the finale     | Skip the cutscene                                  |
| `Backspace` at the end    | Back to the menu from the finish screen            |
| `Enter`                   | Start the run / the race, fly again                |
| `N`                       | New map (in a room's lobby)                        |
| `←` `→` / `A` `D`         | Switch course in the map select (`Esc` goes back)  |
| `Esc`                     | Free the mouse                                     |
| `Shift+P` in `?test`       | Spawn a usable portal ahead of the pilot            |
| `Shift+O` in `?test`       | Show the victory screen (nothing saved)             |
| `Shift+S` in `?test`       | Toggle the whole simulation and animations between ½× and 1× speed |
| `?` (top right)           | How to fly: every key and what it does             |

New players are asked once whether they want a tutorial: a short flight that
asks for each control in turn (skippable).

### Phones and tablets

The game is flown sideways (landscape). Held upright, a phone is asked to turn;
on Android the first tap goes full screen and turns the screen for you.

| Touch                     | Action                                             |
| :------------------------ | :------------------------------------------------- |
| Drag anywhere on the view | A stick appears under your thumb: pitch and turn   |
| **Tilt**                  | Steer by tilting the device instead: turn it like a wheel to bank, lean it away to dive. Level is how you hold it when you turn Tilt on or resume from pause. Needs an https page; iOS asks for permission |
| Hold **Boost** / **Brake** | Boost / air brake                                 |
| `‹` `›`                   | 5 m sideways dodge                                 |
| **Flap** / **Hover** / **Plunge** / **Gale** | Tap to use the adventure ability once you have its upgrade |
| **Respawn**, **Pause**    | As `R` and `P`                                     |

Tilt sensitivity and "Invert touch and tilt up / down" are in Settings.
The tutorial follows touch and tilt as well as keys and gamepad. Tilt works
on either side of a flat hold; enabling it or resuming calibrates both axes.
In test mode, touch buttons open a portal, preview victory and change speed.

Pitch can be inverted in the menu. Diving turns height into speed, climbing
turns speed back into height. Flying within a few metres of rock or trees fills
the orange bar: you get extra acceleration (up to 18 km/h a second), so risky
lines are faster, and in an adventure style points with a growing multiplier.
The bar's label says what skimming is earning right now. Crash, or drop into the sea of clouds
below the islands, and you respawn at your last ring, with the clock still
running. While the land around you is still loading (outside races), the
pilot glides in slowly by itself and you get control once it has arrived.

Press `P` to pause and press it again to resume. Flight, effects and adventure
timers freeze, and gameplay audio is silenced. In time trials and multiplayer,
the official race clock keeps running during a pause; other players keep racing.
Open **Settings** from the main menu or the paused screen to change controls.
Keyboard actions support a primary and an alternate key, with conflict detection
and reset-to-default controls. Escape cancels rebinding or closes Settings;
closing Settings returns to the paused screen. HUD hints reflect your bindings.
Menu/navigation keys, upgrade keys 1–4 and world-switching keys N/B/V are reserved.

Mouse, keyboard and gamepad pitch can be inverted independently. Default mouse
sensitivity is now 2× (range 0.3–6); existing saved sensitivity is preserved.
Settings also include gamepad stick dead zone, music and effects/wind levels,
mute, automatic or fixed graphics quality, and reduced camera shake/FOV effects.
Preferences are saved per browser; if storage is unavailable they still work for
this visit. Gamepad buttons retain their standard layout.

Flying into a portal blurs the view into sparkles and drops you into a
wormhole: a dark tube of twisting stars and drifting spirits, where you pick
an upgrade while the next biome is built.

The last portal opens onto empty space under the Milky Way: a short
cutscene, then white light, and you're back over the sky isles, flying by
yourself, with your run's stats and what to do next.

In an adventure there is no clock. Gates score more in a chain without a
crash, and skimming earns style points. The arrow at the top of the screen
points to the portal. A crash puts you back at the last gate and breaks your
gate chain.

Boost starts with a 2.5-second reserve and recharges in roughly 4.5 seconds
when released. The blue bar in the HUD shows the reserve, labelled Boost
ready, Boosting or Boost charging. Gamepad triggers are analog. Braking adds
drag that fades near 22 m/s, while climbing can still cause a stall. Braking
wins when both controls are held. The Gale boost upgrade strengthens the same
held boost by 25% per stack; it no longer adds a separate dash action.

The camera follows a blend of the nose and travel direction with restrained
bank and FOV, and checks the whole player-to-camera segment for rock. Automatic
and double-tap barrel rolls are disabled. A/D, the mouse and left stick target
a bank of at most 80° and level smoothly on release. Pitch remains unrestricted.
Release pitch after inverted flight to roll smoothly upright without changing
the nose direction; recovery fades near vertical flight to avoid sudden flips.
Q/E or LB/RB perform a 5 m sideways dodge over 0.6 s, with 1 s between starts.
In an adventure, the Wind-Shear Dash ability makes it a 9 m blink (0.16 s, 0.8 s
between starts).

The adventure's abilities (picked at portals, adventure only; races never
see them): Featherfalling (less sink and drag), Skim-Booster (skimming
refills the boost), Cloud-Surfing (rivers of cloud along the line refill boost
and wingbeats and push you), Plunging Attack, Wind-Shear Dash, Thermal Vision
(gates and the portal glow through fog and rock), Slipstream Rider (a spirit
manta to ride behind), Gale Force, Acrobatic Recovery (a clipped wingtip rolls
away instead of crashing, every 4 s), Hover-Stall, Moth's Attraction (pass a
gate near its heart to fly out faster), Zenith Climber (climbs keep their speed
20% longer), Resonance, Ley-Line Surger (five gates in quick succession: endless
boost until the chain breaks), Aero-Braking (pressing the brake flares hard and
tightens your turns for a moment), Draft-Weaving (tight spirals or barrel rolls
spin up a little tornado that shields one glancing hit), Ascension, the Falcon
and Butterfly stances, and Echo-Trail (close a loop across your own ribbon of
light for a wind ring that pushes you on). Their numbers are in the `?tune`
panel under "Run abilities", their looks under "Ability looks". Settings saved
before an action existed keep their keys; a new action whose default key is
taken gets a spare one.
Dodge movement uses the unbanked right axis captured at activation, passes
through normal collision checks, and leaves the forward heading unchanged.
The roll animation follows the same physics timing, including for other players
and ghosts. The camera carries its previous orientation through vertical flight
and restores the horizon gradually.

## How It Works

```
Browser (each player)                         Team VM (docker compose)
┌──────────────────────────────┐            ┌───────────────────────────────────┐
│ Three.js game loop           │ POST state │ Caddy :8080                       │
│  flight model, seeded world, │ ─15 Hz───▶ │  /        built game (compressed) │
│  collisions, rings, ghosts   │            │  /api/*   ──▶ FastAPI :8000       │
│ React: menu, lobby, HUD      │ ◀──SSE──── │           rooms, 15 Hz relay,     │
└──────────────────────────────┘ snapshots  │           leaderboards (SQLite)   │
                                            └───────────────────────────────────┘
```

**Players never collide**, so the server never simulates physics. Each browser
flies its own pilot, and the server only relays positions, like the ghosts in
Trackmania. That keeps the backend small, and it works over plain HTTP:

- **Why not WebSockets?** They don't make it through the hackathon's network
  (`502 Bad Gateway` when deployed). Server-Sent Events do.
- **Down:** each client keeps one SSE stream open
  (`GET /api/rooms/{code}/stream`). A tick loop in the backend pushes a
  snapshot of the whole room 15 times a second, plus room events (joins,
  countdown, finishes). A slow client never builds a backlog: newer snapshots
  replace unsent ones.
- **Up:** each client POSTs its position, rotation, speed and ring count every
  66 ms, skipping a send while the previous one is still in flight.
- **Smooth remote players:** clients draw others 120 ms in the past and
  interpolate between snapshots, extrapolating briefly when one is late.
- **Same start for everyone:** clients estimate the server clock from a few
  `GET /api/time` round trips, and the server sends the race start as a server
  timestamp.
- **Caddy:** compression is only on for static files. `encode` on the `/api`
  route can hold back SSE events; Caddy streams `text/event-stream` by itself.

**Seeded worlds** ([`frontend/src/game/world/`](frontend/src/game/world)): the
racing line is a 3D curve that always descends (a wingsuit can't climb for
long), with a gate every 95 to 130 m: an island to tunnel through, a wall with a
hole, a slot between two islands, a squeeze between one above and one below, a
slalom of rock needles, or a ring of stone. More islands float all around.

All the rock is one signed distance field: simple shapes (flattened domes with a
cone below, ellipsoids, needles, tori) melted together and roughened with 3D
noise. A tube of 11 m around the racing line is carved out of everything, so
every course can be flown, and wherever an island crosses the line you get a
tunnel. Collisions and proximity scoring read the distance field directly.

The meshes are cut from the same field with surface nets, in 96 m chunks on a
6 m grid, by web workers (`mesher.worker.ts`) so the game never stutters. Every
triangle gets one flat color (grass on top, rock on the sides, darker
undersides, snow on the highest islands), which gives the low-poly look. Pines
grow on flat grass, picked from the mesh itself. Each seed also picks a palette:
Alpine, Misty pines, Autumn, Dusk or Winter.

**Biomes** ([`frontend/src/game/world/biomes/`](frontend/src/game/world/biomes)):
every biome is data: lighting moods (a day and a night one), a terrain
recipe, surfaces, plants, water, mist and clouds, particles and
portals. Sky Isles is the islands above; every other biome comes from the
second terrain generator ([`world/terrain/`](frontend/src/game/world/terrain)):
a heightfield valley that follows the racing line and steps down in pools
and waterfalls, hills, domain-warped ridged mountains, terraces, crevasses,
carved river channels and overhangs, melted together with rock shapes
(arches, pillars, sea stacks, mesas, giant trees and mushrooms, a volcano).
It is meshed in workers at three levels of detail, painted by a terrain
shader that blends grass, rock, sand and snow by slope and height, and
dressed with procedural trees (instanced, swaying, impostors far away),
grass and flowers near you, stylized water (rivers, falls, seas, lava, ice,
glowing ponds), soft clouds, valley mist, auroras and ambient particles
(fireflies, snow, embers, spores, bubbles). The Sunken Reef lies under the
sea ([`world/deep.ts`](frontend/src/game/world/deep.ts)): the sky is the
water's surface seen from below, ripples of light run over the seabed, shafts
of light slant down, fish school and jellyfish drift; you fly it like any
other level. Fly any biome freely at
`/?explore=<id>&seed=<n>` (ids: `verdant`, `glacier`, `archipelago`,
`lagoon`, `twilight`, `ember`, `aurora`, `reef`).

Rivers keep their color and ripples up to the edge. Below it, waterfall foam
flows downward and accelerates with the drop. In `?tune`, Water's `fallSpeed`
controls that motion; `fallBlend` sets the short shading join below the edge
(0.2 m by default). A narrow band of animated foam softens the lip;
`lipFoam` controls its strength and `lipFoamWidth` its maximum reach upstream
(0.9 m by default).

**Test mode:** open `/?test` (or `/?test=verdant&seed=2`), or add `&test` to
any single-player URL: `/?explore=verdant&seed=2&test` tests that world,
`/?seed=42&test` and `/?run=5&test` that seed (from Sky Isles). Rooms and the
gallery ignore it. It flies a real adventure run (score, gate chain and the
compass to the portal) with a small panel of the test shortcuts; world/light
selectors and N/B/V switching stay in explore mode. Spawned portals use
adventure's wormhole and upgrade picker; victory uses its finish screen and
autopilot. Slow motion scales the shared physics/animation clock, including
scenery shaders, particles, camera motion, transitions and animated UI overlays.
Press `Shift+S` again to restore normal speed. The rate survives world changes
and resets when you leave test mode. Test results are never saved.

Test mode is included in the normal production build. Use the existing
`docker compose up --build` and open `http://localhost:8080/?test` (or add
`?test` to your deployed URL). No Dockerfile changes, build arguments,
`VITE_ENABLE_DEBUG` flag, or debug Compose override are required.

Terrain meshing preserves shared chunk edges, removes small closed slivers,
and shortens narrow attached tips without deleting faces. Compact floating
stones gain a single rounder subdivision at full detail; broad terrain keeps
its low-poly silhouette. Border-crossing fragments remain intact to protect
seams. Mountain surface noise uses the same slope scale as the ground distance,
preventing floating sheets above steep peaks at every detail level. Glowing
terrain uses restrained facet emission without painted stripes or random bright
triangles. Aurora crystals fake translucency with a tinted core, pale edges
and view-dependent highlights while remaining opaque. Selected rock patches
vary facet spacing and diagonal direction; bounded mountain relief stays
attached to the heightfield. Terrain sampling progresses through 24/12/6/3 metres: these are
cell sizes, not activation distances. The closest tier is requested within
140 metres of chunk bounds in all directions, plus two seconds of velocity
look-ahead (capped at 240 metres). The 6/12-metre tiers begin at 300/700 metres.
The existing mesh stays visible while finer replacements load. `MESH_CLEANUP` in `tuning.ts` controls thickness, size and tip thresholds
(worker settings: edit and reload, not live sliders). Recently hidden terrain is
cached, and detail-level changes use separate split/merge distances to avoid
repeated rebuilding. In the developer `?tune` panel, `Terrain` exposes
`cacheMiB` (48 by default), `lodHysteresis` (48 metres), `lodDetail`,
`lodLookAheadSeconds` and `lodLookAheadMax`. The cache is bounded
by estimated buffer memory and 256 hidden nodes. Mixed-detail terrain still
uses overlapping border cells; it is not a fully stitched adaptive mesh.

**Flight model** ([`frontend/src/game/flight.ts`](frontend/src/game/flight.ts)):
an arcade, energy-based wingsuit. The nose points where you go, gravity along
the flight path speeds you up or slows you down, drag caps the speed, and
banking turns you. Physics runs at a fixed 120 Hz. What you can hit is a small
ball for the body and a rectangle for each wing, tilted up like the wings
drawn, a little smaller than the pilot so near misses stay graceful. It
collides with the land exactly as drawn (its triangles), so you never hit rock
you can't see, nor fly through rock you can. Open the game with `?tune`
(e.g. `http://localhost:5173/?seed=42&tune`) to tune every constant live:
flight physics, the pilot's animation, trails and particles, the crystal gates,
the camera and the render quality. Look tweaks are remembered in the browser;
physics tweaks aren't, so they can't follow you into a race.
Effects exposes `wingGrainSize`, `wingGrainLight` and `wingPuffSize` for fine
wing dust and compact downstroke puffs. `bloomHalo` controls the widest glow
layers independently of bloom strength and radius, keeping light edges defined.
Cosmetics exposes `wingParticleSize` for the decorated wings' tiny accents.
Collection pickups exposes crystal size, mote rate and mote distance; Run
exposes `portalFlash` for crossing sparkles and screen brightening. Crystal
pickups have a fixed 5.2 m collection radius (treasures: 3.2 m).

**Looks** ([`frontend/src/game/avatar.ts`](frontend/src/game/avatar.ts) and
friends): the pilot is a cel-shaded little flyer with outlines, a cape, a scarf
and feathered wings, all built from primitives at runtime. Its animation sits on
top of the flight model and never changes it: the body leans into turns ahead
of the physics, the wings flap harder when climbing, turning or slow and fold
back in a dive, the cloth ripples with speed, and Q/E trigger deliberate barrel rolls. Boost sweeps the wings back;
braking spreads them into the airflow. A crash plays out on screen before you respawn: hit a wall head-on and
the pilot bounces off and tumbles head over heels; graze a slope and they roll
down it in a trail of dust; clip a wing and they spin down like a seed; then
they dissolve into light. The camera arcs up over the pilot to watch the fall
from above, and the tumbling body (head, hips, feet and both wings) stays out
of the rock. Gates are cohorts of floating crystals that flare and burst when you fly
through. One GPU particle system draws every mote, star and shard, and bright
things bloom (High quality). Each palette is a lighting mood as well: sun
position, valley mist, painted clouds, stars at night, and how brightly trims
and effects glow. The game steps its quality down by itself if the frame rate
can't keep up.

**Leaderboards and ghosts:** a finished run is uploaded with a 15 Hz recording
of the flight. Each player's best run per seed keeps its ghost; the top three
fly along in time trials. The server times runs and races too: a reported
finish time has to match its own clock within 3 s, and nothing under 25 s
counts. That stops casual cheating, not a determined cheater, since the server
doesn't fly the course itself.

## Saved adventure profile

**Profile & inventory** in the menu shows your level, XP, crystals, items,
cosmetics, wings and pets. Collect crystals near hoops and rarer discoveries farther
beside them during Adventure. Rewards save immediately to your existing login's
profile in SQLite. Pause an adventure to inspect the inventory; equip collected
cosmetics or a companion, and preview every model. Races and test mode grant no
profile rewards. [Progression, rarity distances and API](docs/adventure-profile.md)
describes spawn rates, the XP curve, duplicate conversion and persistence.

In test mode (`/?test`), **Try items, pets & cosmetics** opens an unsaved fitting
room for every model, with front/back previews, flight trials, item animations
and firework controls. All eight existing pets are included; no-companion is an
unequip action. Equipped pets lead through hoops along the autopilot rail.
Wings include feather, wind, ocean, ice, phoenix, storm and constellation designs;
capes have distinct embroidered hems.

## Project Structure

| Path                                   | Purpose                                                  |
| :------------------------------------- | :------------------------------------------------------- |
| `backend/profiles.py`                  | Persistent adventure profiles, inventory, issued rewards and XP |
| `frontend/src/profile/`               | Profile API client, types and durable pickup outbox       |
| `frontend/src/game/run/collection.ts` | Hoop-distance rarity, terrain-safe pickups and collection models |
| `frontend/src/game/cosmetics/`, `game/pets/` | Toon outfits, decorated wing fans and animated hoop guides |
| `frontend/src/components/ProfilePanel.tsx`, `CollectionPreview.tsx`, `TestCollectionPanel.tsx` | Profile, inventory, equip controls, preview and unsaved test fitting room |
| `backend/app.py`                       | API endpoints, login headers, solo runs                  |
| `backend/rooms.py`                     | Rooms, race state machine, SSE listeners, tick loop      |
| `backend/store.py`                     | SQLite runs, leaderboards and ghosts                     |
| `backend/models.py`                    | Request and response models (Pydantic)                   |
| `backend/tests/`                       | pytest tests for rooms and the API                       |
| `frontend/src/game/Game.ts`            | The game: loop, physics steps, race state, HUD data      |
| `frontend/src/game/input.ts`           | Input, actions and shared keyboard bindings (including pause) |
| `frontend/src/game/touch.ts`, `tilt.ts` | Phones and tablets: on-screen stick and buttons, tilt steering |
| `frontend/src/game/world/`             | Racing line, rock field, meshing workers, palettes, view |
| `frontend/src/game/world/meshCleanup.ts` | Preserves compact stones, removes closed slivers and trims narrow tips; protects chunk borders |
| `frontend/src/game/world/landCollider.ts` | Collisions with the land exactly as drawn             |
| `frontend/src/game/world/structures/`  | Towers, lanterns, windmills and a shipwreck in the adventure's biomes |
| `frontend/src/game/world/deep.ts`      | Under the sea: light shafts, schools of fish, jellyfish  |
| `frontend/src/game/flight.ts`          | Flight model and the pilot's hitbox                      |
| `frontend/src/game/avatar.ts`          | The pilot's model and animation                          |
| `frontend/src/game/death.ts`           | Crash animations: how a crash plays out (looks only)     |
| `frontend/src/game/items/`             | Item models and animations; `/?gallery` shows them all   |
| `frontend/src/game/run/abilities.ts`   | The adventure abilities' rules (run mode only)           |
| `frontend/src/game/abilities/`         | The abilities' models and animations (looks only)        |
| `frontend/src/game/tuning.ts`          | Every look-and-feel constant, for the `?tune` panel      |
| `frontend/src/game/pilots.ts`          | Remote players and ghosts, with interpolation            |
| `frontend/src/net/`                    | Server clock and the room connection (SSE + POST)        |
| `frontend/src/session/`                | Solo and room sessions: wire a Game to the network and UI |
| `frontend/src/components/`             | React screens: menu, map select, HUD, results            |
| `frontend/Caddyfile`                   | Static files, compression, `/api` to the backend         |

Race results now use the `speed-control-v3` flight rules. SQLite migration
preserves original rows as `legacy` and leaves v1/v2 scores intact; current
leaderboards, personal bests and ghost queries use only v3 results (body-and-wing hitboxes). Deploy frontend and backend together.
Gameplay POSTs carry `X-Flight-Rules: speed-control-v3`; stale clients receive
409 and a reload message. Ghost playback accepts both the old eight-number
samples, ten-number boost/brake samples, and new eleven-number samples
including signed dodge progress.

## API

All routes start with `/api`; interactive docs are at `/api/docs`.

| Method | Path                       | Description                                              |
| :----- | :------------------------- | :------------------------------------------------------- |
| `GET`  | `/api/me`                  | The current user (portal login or guest), `has_played`   |
| `GET`  | `/api/time`                | Server clock in ms, for clock sync                       |
| `POST` | `/api/rooms/{code}/join`   | Join (or create) a room; returns your id and token       |
| `GET`  | `/api/rooms/{code}/stream` | SSE: room events and position snapshots                  |
| `POST` | `/api/rooms/{code}/state`  | Your position, rotation, speed and rings passed          |
| `POST` | `/api/rooms/{code}/start`  | Start a race (5 s countdown)                             |
| `POST` | `/api/rooms/{code}/map`    | New random seed (lobby only)                             |
| `POST` | `/api/rooms/{code}/finish` | Report your finish time and ghost                        |
| `POST` | `/api/rooms/{code}/leave`  | Leave the room                                           |
| `GET`  | `/api/rooms/{code}`        | Room state, for debugging                                |
| `POST` | `/api/runs/start`          | Start the server's clock for a time trial                |
| `POST` | `/api/runs/finish`         | Submit a time trial with its ghost                       |
| `GET`  | `/api/leaderboard?seed=`   | Best time per player on a seed                           |
| `GET`  | `/api/ghosts?seed=`        | Ghosts of the fastest runs on a seed                     |

## Local Development (without Docker)

For hot reloading, run the backend and frontend in two terminals. The team VMs
come with the right versions (Python 3.14, Node 24).

**Backend:**

```bash
cd backend
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt -r requirements-dev.txt

python app.py      # serves on :8000, SQLite in backend/data/
pytest             # runs the tests
```

**Frontend:**

```bash
cd frontend
npm install
npm run dev        # http://localhost:5173, forwards /api to :8000
npm run lint
npm run build
npm test       # Node 22.18+; flight, camera, controls and ghost regressions
```

To test multiplayer on one machine, open the room in two different browsers
(or one on `localhost` and one on `127.0.0.1`). Without HTTP/2, a browser
allows only 6 connections per host, and several tabs with live streams use
them up. Deployed, HTTP/2 lifts the limit.

In development, the running game is available as `window.__game` in the
browser console, handy for teleporting around or poking at the race state.

## Ideas for Next Steps

- More gate types (spirals, crumbling bridges) and difficulty settings for the tube radius
- AI race commentary or course names through the hackathon's LLM proxy
- Spectator camera that follows the race leader
- Daily challenge history and per-ring split times

Terrain detail replacements keep normal flight active while existing terrain covers the area. The loading glide remains only for genuinely missing nearby terrain, including initial loading.
