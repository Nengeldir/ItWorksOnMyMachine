# Debug playtest mode

The mode requires a development server or an explicit `VITE_ENABLE_DEBUG=true`
build, plus a `?debug` URL opt-in. `vite.config.ts` compiles this policy into
the boolean `__PLAYTEST__` so default public builds exclude the panel and
actions. Settings belong to that game instance; they neither persist nor
apply to rooms or the menu backdrop. The private Docker configuration and
commands are documented in the README's Debug playtesting section.

After take-off, `Shift+P` spawns a temporary adventure portal ahead of the
pilot, 40 m by default. The panel's portal-distance setting adjusts this.
Repeated presses replace the temporary portal, retaining the normal exit.
Entering it uses the normal upgrade and biome-transition flow; changing
levels removes it.

`Shift+O` opens the adventure victory screen immediately, including from
pause, intro or the upgrade picker. It banks current style once, clears
portal effects and uses the existing victory event. The summary reports the
actual score, upgrades and visited biomes. Test adventures never save best
scores; test time trials never submit times or ghosts.

Both actions have panel buttons and share the `DEBUG_ACTIONS` registry in
`frontend/src/game/debug/actions.ts`. `Input.onShortcut` gives these chords
precedence over pause. Plain P retains pause/resume; repeated keydowns do
not repeat actions, and typing in editable fields is ignored.

To extend the mode, add a setting to `debugMode.ts`, its default and control
descriptor to `tuning.ts`, and a `__PLAYTEST__`-guarded consumer. Add actions
to `DEBUG_ACTIONS` and handle them in `Game.performDebugAction`. The same
controls appear in `?debug&tune` without persisting gameplay overrides.

## 2026-10-10: Docker playtesting

Docker builds set Vite's `DEV` flag to false. That previously disabled URL
preservation, panel loading and both actions. The shared `__PLAYTEST__`
constant now covers all those paths, as well as session score isolation.
The Dockerfile defaults `VITE_ENABLE_DEBUG` to `false`; the explicit
`docker-compose.debug.yml` override builds with it enabled and replaces the
public port mapping with `127.0.0.1:8081:8080`. Using the separate project
name in the README keeps the normal deployment and its data independent.

`?debug` and `?debug=` both opt in; the parameter is not a password.
General development hooks stay disabled in optimized playtest builds.
Current verification and follow-ups are recorded in `CLAUDE.md`.

## 2026-10-10: Remove flight telemetry

Removed all flight readouts, the visibility toggle, the telemetry sampler,
and its respawn, fixed-step and HUD hooks, as requested. The panel now
contains only playtest controls, with no telemetry sampling overhead.

Changed `frontend/src/game/debug/{panel.ts,panel.css,telemetry.ts}`,
`debugMode.ts`, `tuning.ts`, `Game.ts`, the debug tests and README. Removed
the obsolete telemetry tests; updated the remaining test fixture for the
current wormhole host methods and upgrade-picker timing. The portal and
victory implementations are unchanged.

This dated record and the README carry the documentation updates because
the user explicitly requested that `CLAUDE.md` remain unchanged.

Verification:

- `npm run build` and `npm run lint` pass.
- `npm run test:debug`: all six remaining tests pass, covering development
  gating, shortcuts and typing/repeat guards, portal placement/replacement,
  upgrades and biome transitions, victory idempotency and wormhole cleanup.
- Headless Firefox: one panel with exactly three controls and no flight
  readouts or telemetry setting, including with `?debug&tune`. Real Shift+P
  spawns a portal 40 m ahead and replaces it on another press; plain P
  pauses; Shift+O from pause opens the finish screen without saving scores
  or uploading results. The finish screen fades in normally. Games without
  `?debug` have no panel or victory shortcut. No game JavaScript errors.
- Inspected screenshots of the compact panel and finish screen at 1200×800.
- No telemetry references remain in frontend source or current README.
  `CLAUDE.md`, flight physics, input and portal/victory logic have no diff.

Follow-ups: focused-window mouse/gamepad playtesting and narrow-screen
layout checks were not performed. This change was validated with the
targeted debug suite, not the complete frontend test glob; the existing
camera, flight-realism and input fixture issues noted in `CLAUDE.md` remain
outside this removal.
