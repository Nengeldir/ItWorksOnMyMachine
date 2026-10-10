import type { DebugSettings } from "./debugMode";

// Every look-and-feel constant that isn't physics lives here, grouped so the
// ?tune panel can show one folder per group. None of these change how fast you
// fly or what you hit: the flight model (FLIGHT in flight.ts) does that.
// Tweaks made in the panel are remembered in this browser.

/** How the pilot moves on top of the flight model: rolls, flaps, bobbing, cloth */
export const ANIM = {
  boostSweep: 0.25,
  brakeSweep: 0.7,
  bankLead: 0.55, // extra visual bank, as a share of the roll rate (rad per rad/s)
  bankSpring: 14, // stiffness of the lean spring; lower = floatier
  bankDamping: 0.42, // 1 = no overshoot, lower = a little wobble after a turn
  autoBarrel: false, // snapping hard into a turn throws a full barrel roll
  barrelTime: 0.7, // seconds for one barrel roll
  barrelRadius: 0.9, // metres the pilot corkscrews around the flight path
  barrelCooldown: 1.1,
  flapRate: 1.6, // flaps per second while gliding slowly
  flapBoost: 2.6, // extra flaps per second when climbing, turning or rolling
  flapAngle: 0.5, // radians of wing travel at full effort
  glideFlutter: 0.06, // tiny wing flutter while cruising
  sweepAtSpeed: 0.75, // how far the wings fold back in a fast dive (radians)
  bobAmount: 0.12, // metres of gentle up-and-down drift
  bobRate: 0.85, // cycles per second
  headLook: 0.5, // how much the head turns into a turn
  limbSwing: 1, // arm and leg reaction to turns and pitch
  clothWave: 1, // amplitude of the cape and scarf ripples
  clothSpeed: 1, // ripple speed multiplier
};

/** Trails, particles, wind and screen effects */
export const FX = {
  boostTrailGlow: 0.45,
  brakeWisps: 24, // particles/second at full brake
  trailLength: 1, // multiplier on ribbon length
  trailWidth: 1,
  trailGlow: 1, // brightness of the ribbons
  bodyTrail: true, // the wide silk ribbon from the cape
  sparkles: 1, // wingtip motes per metre, as a multiplier
  flapPuffs: 1, // feather puffs on each downstroke
  skimDust: 1, // spray from the ground while skimming
  speedLines: 1, // wind streaks at speed
  speedLinesFrom: 45, // m/s where the wind streaks start
  aura: 1, // soft glow around the pilot
  vignette: 1, // speed vignette at the screen edges
  bloom: 0.6, // glow strength (0 turns post-processing off)
  bloomRadius: 0.55,
  bloomThreshold: 1.3,
  bloomResolution: 1, // the bloom renders at most at this pixel ratio (its cost grows fast with it)
  bloomMsaa: 2, // antialiasing samples of the bloom's render target
  autoQuality: true, // drop effects if the frame rate can't keep up
};

/** The crystal gates */
export const RINGS = {
  crystals: 16, // crystals per gate (finish gets 1.5×); applies to the next map
  drift: 0.6, // metres each crystal bobs
  driftRate: 0.55,
  spin: 0.08, // how fast the cohort turns around the gate (rad/s)
  selfSpin: 0.6, // how fast each crystal turns on its own axis
  glow: 1, // inner glow of the next gate
  shatter: 1, // particles when you pass through
  passTime: 1.4, // seconds of the pass animation
};

/** The chase camera */
export const CAMERA = {
  distance: 8.5, // metres behind at low speed
  distancePerSpeed: 0.035, // extra metres per m/s
  height: 2.6,
  lookAhead: 14,
  stiffness: 7, // how tightly it follows
  rollFollow: 0.18, // share of the pilot's bank the horizon follows
  fov: 70,
  fovPerSpeed: 0.25, // extra degrees per m/s above 30
  fovMax: 18,
  shake: 0.03, // when skimming the ground at speed
  boostFov: 4,
  boostDistance: 1.2,
  pathFollow: 0.6,
  ringPunch: 3, // FOV kick when passing a gate (degrees)
};

/** Generator-v2 land: level of detail and the terrain shader. Looks only; collisions never change */
export const TERRAIN = {
  lodNear: 300, // metres: land closer than this is meshed at full detail (6 m)
  lodFar: 700, // closer than this at half detail (12 m), further at quarter (24 m)
  viewDistance: 1500,
  readyRadius: 260, // the start waits until the land this close has arrived
  uploadsPerFrame: 4, // arrived land meshes taken in per frame once you're flying (smooths frame times)
  snowLine: 0, // metres added to the biome's snow line
  coverSlope: 0, // added to the slope where grass (moss, sand…) gives way to rock
  texture: 1, // strength of the painted noise on cliffs
  textureScale: 1,
  glow: 1, // glowing cracks and spots
};

/** Plants and grass. Looks only: colliders don't move with the wind */
export const FLORA = {
  wind: 1, // how hard the wind moves leaves and grass
  glow: 1, // self-lit mushroom caps and crystals
  grassDistance: 140, // metres: grass and flowers grow on screen within this
};

/** Rivers, falls and seas */
export const WATER = {
  glitter: 1, // sun glitter on the water
  glow: 1, // lava and bioluminescent pools
  spray: 1, // spray when skimming the water, mist at the foot of falls
};

/** The roguelike run's looks (its rules live in run/run.ts and run/upgrades.ts) */
export const RUN = {
  tunnelFade: 1.4, // seconds to fade out of the tunnel into the next biome
  compass: 1, // size of the portal compass
  toasts: true, // pop-ups for points and run events
};

/** Music and sound levels */
export const AUDIO = {
  music: 0.45, // volume of the background music
  sfx: 1, // volume of the wingbeat samples
  crossfade: 3, // seconds to blend into the next biome's track
  nightDim: 0.25, // how much quieter the music gets at night
  nightMuffle: 0.55, // how much the highs are rolled off at night
};

/** Dev-only playtesting. Kept out of GROUPS so gameplay overrides are never persisted. */
export const DEBUG_DEFAULTS = { showFlight: true, portalAhead: 40 } satisfies DebugSettings;
export const DEBUG_CONTROLS = [
  { key: "showFlight", label: "Show flight telemetry" },
  { key: "portalAhead", label: "Portal distance (m)", range: [10, 150, 1] },
] as const;

const GROUPS = { ANIM, FX, RINGS, CAMERA, TERRAIN, FLORA, WATER, RUN, AUDIO } as const;
const DEFAULTS = JSON.parse(JSON.stringify(GROUPS)) as typeof GROUPS;
const STORAGE_KEY = "wingrace.tuning.speed-control-v1";

type Group = Record<string, number | boolean>;

/** Applies tweaks saved in this browser (only keys that still exist, with the same type) */
export function loadTuning() {
  let saved: Record<string, Group>;
  try {
    saved = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "{}");
  } catch {
    return;
  }
  for (const [name, group] of Object.entries(GROUPS) as [string, Group][]) {
    for (const [key, value] of Object.entries(saved[name] ?? {})) {
      if (key in group && typeof group[key] === typeof value) group[key] = value;
    }
  }
}

export function saveTuning(extra: Record<string, Group> = {}) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...GROUPS, ...extra }));
  } catch {
    // Not persisted, still applies for this visit
  }
}

export function resetTuning() {
  for (const [name, group] of Object.entries(GROUPS) as [string, Group][]) {
    Object.assign(group, (DEFAULTS as unknown as Record<string, Group>)[name]);
  }
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Nothing saved
  }
}

/** Slider ranges for the ?tune panel; anything missing gets a range from its default */
export const RANGES: Record<string, [number, number, number?]> = {
  boostSweep: [0, 0.6],
  brakeSweep: [0, 1.2],
  boostTrailGlow: [0, 2],
  brakeWisps: [0, 60],
  boostFov: [0, 8],
  boostDistance: [0, 3],
  pathFollow: [0, 0.8],
  bankLead: [0, 1.5],
  bankSpring: [2, 40],
  bankDamping: [0.1, 1],
  barrelTime: [0.3, 1.5],
  barrelRadius: [0, 3],
  barrelCooldown: [0.2, 3],
  flapRate: [0, 4],
  flapBoost: [0, 6],
  flapAngle: [0, 1.2],
  glideFlutter: [0, 0.3],
  sweepAtSpeed: [0, 1.3],
  bobAmount: [0, 0.6],
  bobRate: [0, 3],
  headLook: [0, 1.5],
  limbSwing: [0, 2],
  clothWave: [0, 3],
  clothSpeed: [0, 3],
  trailLength: [0.2, 2.5],
  trailWidth: [0.2, 3],
  trailGlow: [0, 3],
  sparkles: [0, 4],
  flapPuffs: [0, 4],
  skimDust: [0, 4],
  speedLines: [0, 3],
  speedLinesFrom: [10, 100],
  aura: [0, 3],
  vignette: [0, 2],
  bloom: [0, 2.5],
  bloomRadius: [0, 1.5],
  bloomThreshold: [0.5, 1.5],
  bloomResolution: [0.5, 2, 0.05],
  bloomMsaa: [0, 4, 1],
  crystals: [6, 32, 1],
  drift: [0, 3],
  driftRate: [0, 3],
  spin: [-1, 1],
  selfSpin: [0, 4],
  glow: [0, 3],
  shatter: [0, 4],
  passTime: [0.4, 3],
  distance: [3, 20],
  distancePerSpeed: [0, 0.1],
  height: [0, 8],
  lookAhead: [2, 40],
  stiffness: [1, 20],
  rollFollow: [0, 1],
  fov: [40, 100],
  fovPerSpeed: [0, 1],
  fovMax: [0, 50],
  shake: [0, 0.5],
  ringPunch: [0, 15],
  lodNear: [120, 600, 10],
  lodFar: [300, 1400, 10],
  viewDistance: [600, 2500, 10],
  readyRadius: [100, 500, 10],
  uploadsPerFrame: [1, 16, 1],
  snowLine: [-300, 300],
  coverSlope: [-0.4, 0.25],
  texture: [0, 3],
  textureScale: [0.2, 4],
  wind: [0, 4],
  glitter: [0, 4],
  spray: [0, 4],
  tunnelFade: [0.3, 4],
  compass: [0.5, 2],
  grassDistance: [40, 300, 5],
  music: [0, 1],
  sfx: [0, 2],
  crossfade: [0.5, 10],
  nightDim: [0, 0.6],
  nightMuffle: [0, 1],
};

export const TUNING_GROUPS: [string, Group][] = [
  ["Pilot animation", ANIM],
  ["Trails & particles", FX],
  ["Crystal gates", RINGS],
  ["Camera", CAMERA],
  ["Terrain", TERRAIN],
  ["Plants", FLORA],
  ["Water", WATER],
  ["Run", RUN],
  ["Audio", AUDIO],
];
