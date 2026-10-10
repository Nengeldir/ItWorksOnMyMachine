# Test mode

A sandbox for playtesting the adventure: portals, the upgrade picker,
biome transitions and the finish screen, without flying eight levels and
without saving anything. It is part of the normal build (dev, `vite
preview`, Docker); the URL alone turns it on.

## Opening it

`test` can be added to any single-player URL (`frontend/src/route.ts`):

| URL | Opens |
| :-- | :-- |
| `/?test` | Sky Isles, seed 1 |
| `/?test=verdant&seed=2` | Verdant Highlands, seed 2 |
| `/?explore=verdant&seed=2&test` | the same: `explore=` names the world when `test` has none |
| `/?seed=42&test` | Sky Isles, seed 42 |
| `/?run=5&test` | Sky Isles, run seed 5 (not a saved run) |
| `/?room=ABCD&test`, `/?gallery&test` | the room or gallery as usual: test mode is single-player only |

An unknown world falls back to Sky Isles. Once open, the URL is rewritten to
`?test=<world>&seed=<n>` and follows the world as portals change it.

## What's on screen

- The flight panel with style points, and the run HUD: score, gate chain,
  "Reach the portal" with its distance, and the compass.
- The top bar: `Test · #seed · level n/8 · world · mood · speed`.
- The test panel (bottom left; below 840 px wide it moves to the right,
  under the compass, to stay clear of the flight panel):

| Keys | Does |
| :-- | :-- |
| `Shift+P` | Replaces this level's portal with one straight ahead (at least 3 portal radii, or 1.5 s of flight) |
| `Shift+O` | Ends the run now: the real finish screen ("test result · not saved") over the victory lap |
| `Shift+S` | Half speed / normal speed for physics, animation, shaders, camera and CSS animations; the panel shows which |
| `Enter` | Skips the finale; on the finish screen, flies the test again |
| `Backspace` | On the finish screen, back to the menu |

The chords are taken before ordinary bindings (Shift boost, P pause, S
pitch), fire once per press, and are ignored while typing or with a
settings dialog open. The panel hides during portals, the picker, the
finale and the finish screen.

## How it's built

- `route.ts`: `screenFromSearch` gives a `{ kind: "test", biome, seed }` screen.
- `ExploreSession` (with `testMode`) starts a `RunController` on the chosen
  level (`Game.startRun(seed, events, level, Infinity)`: the sandbox never
  runs out of lives). Its `ended` event never reaches `RunSession`'s bests or
  the server.
- `Input.onTestAction` (installed only by `Game` in test mode) and
  `RunController.spawnTestPortal` / `testWin`.
- `testPlayback.ts`: the playback rate. `Game.loop` scales its frame delta
  (adaptive quality still reads the real one); CSS animations follow through
  the Web Animations API.
- Tests: `frontend/tests/test-mode.test.mjs` (URL parsing, chord handling).
