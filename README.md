# Wingrace

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
  Sky Isles, Verdant Highlands, Glacier Peaks, Sky Archipelago, Coral Lagoon,
  Twilight Forest, Ember Wastes and the Aurora Summit. Chain gates, skim for
  style, and pick an upgrade at every portal (stronger boost, wingbeats, hover, glide lock and more).

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
| Hold `F` / gamepad `B`    | Hover (adventure, with the upgrade)                |
| `1` to `4`                | Choose an upgrade at a portal                      |
| `Enter` in the finale     | Skip the cutscene                                  |
| `Backspace` at the end    | Back to the menu from the finish screen            |
| `Enter`                   | Start the run / the race, fly again                |
| `N`                       | New map (in a room's lobby)                        |
| `←` `→` / `A` `D`         | Switch course in the map select (`Esc` goes back)  |
| `Esc`                     | Free the mouse                                     |

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
To change the pause key, edit `KEY_BINDINGS.pause` in
[`frontend/src/game/input.ts`](frontend/src/game/input.ts) using a
`KeyboardEvent.code` (for example, `KeyO`). The in-game controls and resume hint
automatically use that binding.

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
(fireflies, snow, embers, spores). Fly any biome freely at
`/?explore=<id>&seed=<n>` (ids: `verdant`, `glacier`, `archipelago`,
`lagoon`, `twilight`, `ember`, `aurora`).

**Flight model** ([`frontend/src/game/flight.ts`](frontend/src/game/flight.ts)):
an arcade, energy-based wingsuit. The nose points where you go, gravity along
the flight path speeds you up or slows you down, drag caps the speed, and
banking turns you. Physics runs at a fixed 120 Hz. What you can hit is a small
ball for the body and a rectangle for each wing, tilted up like the wings
drawn, a little smaller than the pilot so near misses stay graceful; the land
you see is snapped onto the same surface the collisions use. Open the game with `?tune`
(e.g. `http://localhost:5173/?seed=42&tune`) to tune every constant live:
flight physics, the pilot's animation, trails and particles, the crystal gates,
the camera and the render quality. Look tweaks are remembered in the browser;
physics tweaks aren't, so they can't follow you into a race.

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

## Project Structure

| Path                                   | Purpose                                                  |
| :------------------------------------- | :------------------------------------------------------- |
| `backend/app.py`                       | API endpoints, login headers, solo runs                  |
| `backend/rooms.py`                     | Rooms, race state machine, SSE listeners, tick loop      |
| `backend/store.py`                     | SQLite runs, leaderboards and ghosts                     |
| `backend/models.py`                    | Request and response models (Pydantic)                   |
| `backend/tests/`                       | pytest tests for rooms and the API                       |
| `frontend/src/game/Game.ts`            | The game: loop, physics steps, race state, HUD data      |
| `frontend/src/game/input.ts`           | Input, actions and shared keyboard bindings (including pause) |
| `frontend/src/game/world/`             | Racing line, rock field, meshing workers, palettes, view |
| `frontend/src/game/world/snap.ts`      | Snaps meshed land onto the collision surface             |
| `frontend/src/game/world/structures/`  | Towers, lanterns and windmills in the adventure's biomes |
| `frontend/src/game/flight.ts`          | Flight model and the pilot's hitbox                      |
| `frontend/src/game/avatar.ts`          | The pilot's model and animation                          |
| `frontend/src/game/death.ts`           | Crash animations: how a crash plays out (looks only)     |
| `frontend/src/game/items/`             | Item models and animations; `/?gallery` shows them all   |
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
| `GET`  | `/api/me`                  | The current user (portal login or guest)                 |
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

- Touch and tilt controls for phones
- More gate types (spirals, crumbling bridges) and difficulty settings for the tube radius
- AI race commentary or course names through the hackathon's LLM proxy
- Spectator camera that follows the race leader
- Daily challenge history and per-ring split times
