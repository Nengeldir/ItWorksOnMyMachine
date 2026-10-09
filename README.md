# Wingrace

A Superflight-style wingsuit game for the browser, with multiplayer races.
Every course is a canyon generated from a seed: same seed, same canyon,
rings, pillars, floating rocks and arches for everyone. Dive for speed, skim
the rock for style points and a boost, and beat your friends to the last ring.

- **Race friends:** create a room, share the link, everyone flies the same map
  at the same time and sees each other live.
- **Time trial:** race the clock on today's course, a random one or any seed,
  against the ghosts of the fastest runs. Leaderboards per seed.

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
| Mouse (click the view)    | Pitch and roll. The mouse acts like a stick.       |
| `W` `S` / `↑` `↓`         | Dive / pull up (flight-stick style)                |
| `A` `D` / `←` `→`         | Roll left / right. Banking turns you.              |
| `Q` `E`, double-tap `A` `D` | Barrel roll (just for show; gamepad: `LB` `RB`)  |
| Gamepad left stick        | Pitch and roll. `Y` respawns.                      |
| `R`                       | Respawn at the last ring                           |
| `M`                       | Mute                                               |
| `Enter`                   | Start the run / the race, fly again                |
| `N`                       | New map (in a room's lobby)                        |
| `Esc`                     | Free the mouse                                     |

Pitch can be inverted in the menu. Diving turns height into speed, climbing
turns speed back into height. Flying within a few metres of the terrain fills
the proximity bar: you get style points with a growing multiplier and extra
acceleration, so risky lines are faster. Crash and you respawn at your last
ring, with the clock still running.

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
terrain is a heightmap function, a meandering canyon that keeps dropping, built
from simplex noise and a seeded PRNG. Chunks are meshed on an 8 m grid around
the camera. Collisions use the same grid, and the obstacles are simple shapes
with signed distance functions, so crash checks and proximity scoring are a
few lines of math. The racing line follows the canyon through every ring, and
obstacles keep clear of it.

**Flight model** ([`frontend/src/game/flight.ts`](frontend/src/game/flight.ts)):
an arcade, energy-based wingsuit. The nose points where you go, gravity along
the flight path speeds you up or slows you down, drag caps the speed, and
banking turns you. Physics runs at a fixed 120 Hz. Open the game with `?tune`
(e.g. `http://localhost:5173/?seed=42&tune`) to tune every constant live:
flight physics, the pilot's animation, trails and particles, the crystal gates,
the camera and the render quality. Look tweaks are remembered in the browser;
physics tweaks aren't, so they can't follow you into a race.

**Looks** ([`frontend/src/game/avatar.ts`](frontend/src/game/avatar.ts) and
friends): the pilot is a cel-shaded little flyer with outlines, a cape, a scarf
and feathered wings, all built from primitives at runtime. Its animation sits on
top of the flight model and never changes it: the body leans into turns ahead
of the physics, the wings flap harder when climbing, turning or slow and fold
back in a dive, the cloth ripples with speed, and hard turns throw a barrel
roll. Gates are cohorts of floating crystals that flare and burst when you fly
through. One GPU particle system draws every mote, star and shard, and bright
things bloom (High quality). The game steps its quality down by itself if the
frame rate can't keep up.

**Leaderboards and ghosts:** a finished run is uploaded with a 15 Hz recording
of the flight. Each player's best run per seed keeps its ghost; the top three
fly along in time trials. The server times runs and races too, and rejects a
finish that claims to be faster than its own clock allows.

## Project Structure

| Path                                   | Purpose                                                  |
| :------------------------------------- | :------------------------------------------------------- |
| `backend/app.py`                       | API endpoints, login headers, solo runs                  |
| `backend/rooms.py`                     | Rooms, race state machine, SSE listeners, tick loop      |
| `backend/store.py`                     | SQLite runs, leaderboards and ghosts                     |
| `backend/models.py`                    | Request and response models (Pydantic)                   |
| `backend/tests/`                       | pytest tests for rooms and the API                       |
| `frontend/src/game/Game.ts`            | The game: loop, physics steps, race state, HUD data      |
| `frontend/src/game/world/`             | Terrain, course, obstacles, palettes, and their meshes   |
| `frontend/src/game/flight.ts`          | Flight model                                             |
| `frontend/src/game/avatar.ts`          | The pilot's model and animation                          |
| `frontend/src/game/tuning.ts`          | Every look-and-feel constant, for the `?tune` panel      |
| `frontend/src/game/pilots.ts`          | Remote players and ghosts, with interpolation            |
| `frontend/src/net/`                    | Server clock and the room connection (SSE + POST)        |
| `frontend/src/session/`                | Solo and room sessions: wire a Game to the network and UI |
| `frontend/src/components/`             | React screens: menu, HUD, lobby and result panels        |
| `frontend/Caddyfile`                   | Static files, compression, `/api` to the backend         |

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
```

To test multiplayer on one machine, open the room in two different browsers
(or one on `localhost` and one on `127.0.0.1`). Without HTTP/2, a browser
allows only 6 connections per host, and several tabs with live streams use
them up. Deployed, HTTP/2 lifts the limit.

In development, the running game is available as `window.__game` in the
browser console, handy for teleporting around or poking at the race state.

## Ideas for Next Steps

- Touch and tilt controls for phones
- Floating islands: a 3D density function meshed with surface nets
- AI race commentary or course names through the hackathon's LLM proxy
- Spectator camera that follows the race leader
- Daily challenge history and per-ring split times
