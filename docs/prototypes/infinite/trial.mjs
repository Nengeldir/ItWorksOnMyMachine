// Feasibility trials for the infinite mode (docs/infinite-mode-prototype.md).
// Not part of the game or the test suite. Run from frontend/:
//   node --experimental-strip-types --import ./tests/register.mjs ../docs/prototypes/infinite/trial.mjs
import { createNoise2D } from "../../../frontend/node_modules/simplex-noise/dist/esm/simplex-noise.js";
import { makeRng } from "../../../frontend/src/game/rng.ts";
import { Course } from "../../../frontend/src/game/world/course.ts";
import { World } from "../../../frontend/src/game/world/World.ts";
import { makeLevel } from "../../../frontend/src/game/world/biomes/index.ts";

const line = (label, value) => console.log(`${label.padEnd(58)} ${value}`);

// --- A. The racing line without an end ----------------------------------------------------------
// Course.x(z) is simplex noise of z, defined everywhere; only its height table (`ys`, the slope
// integrated) and its gates stop at 2280 m. An endless line integrates the slope in chunks on
// demand and draws each chunk's gates from its own random stream.
class EndlessLine {
  constructor(seed, chunk = 2000) {
    this.noise = createNoise2D(makeRng(seed, "line"));
    this.seed = seed;
    this.chunk = chunk;
    this.heights = new Map(); // chunk index -> Float64Array of y every 2 m
    this.start = new Map([[0, 0]]); // chunk index -> y at its start
  }
  x(z) { return 170 * this.noise(z * 0.0011, 1.3) + 45 * this.noise(z * 0.004, 7.7); }
  /** The slope of the first prototype: the game's (always down), so the line sinks forever */
  slope(z) { return 0.22 + 0.1 * this.noise(z * 0.003, 3.1); }
  table(k) {
    let t = this.heights.get(k);
    if (t) return t;
    const y0 = k === 0 ? 0 : (() => { const prev = this.table(k - 1); return prev[prev.length - 1]; })();
    t = new Float64Array(this.chunk / 2 + 1);
    let y = y0;
    for (let i = 0; i < t.length; i++) { t[i] = y; y -= this.slope(k * this.chunk + i * 2) * 2; }
    this.heights.set(k, t);
    return t;
  }
  y(z) {
    const k = Math.floor(z / this.chunk), t = this.table(k), f = (z - k * this.chunk) / 2, i = Math.min(Math.floor(f), t.length - 2);
    return t[i] + (t[i + 1] - t[i]) * (f - i);
  }
  gates(k) {
    const rng = makeRng(this.seed, `gates/${k}`), out = [];
    for (let z = k * this.chunk + 90; z < (k + 1) * this.chunk; z += 95 + rng() * 35) out.push(z);
    return out;
  }
}
const endless = new EndlessLine(42);
const course = new Course(42);
let same = 0;
// Heights relative to z = 0 (the game's table starts integrating at z = -140, this one at 0)
for (let z = 0; z < 2000; z += 10) same = Math.max(same, Math.abs(endless.x(z) - course.x(z)) + Math.abs((endless.y(z) - endless.y(0)) - (course.y(z) - course.y(0))));
line("A1 endless line = the game's line on its first 2 km (max error m)", same.toFixed(4));
let jump = 0;
for (let k = 1; k < 50; k++) {
  const z = k * 2000;
  jump = Math.max(jump, Math.abs(endless.y(z + 1e-6) - endless.y(z - 1e-6)));
}
line("A2 height jump at chunk seams over 100 km (m)", jump.toExponential(2));
line("A3 height after 100 km with the game's always-down slope (m)", endless.y(100_000).toFixed(0));
const gateGaps = [];
for (let k = 0; k < 50; k++) { const g = endless.gates(k); for (let i = 1; i < g.length; i++) gateGaps.push(g[i] - g[i - 1]); }
line("A4 gate spacing over 100 km, min..max (m)", `${Math.min(...gateGaps).toFixed(0)}..${Math.max(...gateGaps).toFixed(0)}`);

// --- B. Precision far from the origin -----------------------------------------------------------
// The GPU keeps positions in 32-bit floats: far away, vertices snap to a coarse grid and shake.
for (const far of [2_000, 20_000, 100_000, 1_000_000]) {
  // The gap between neighbouring float32 values there: how far a vertex can snap
  const ulp = 2 ** (Math.floor(Math.log2(far)) - 23);
  line(`B1 float32 spacing near ${far.toLocaleString()} m (m)`, ulp.toFixed(4));
}

// --- C/D. Blending two biomes' land -------------------------------------------------------------
// Each generator-v2 biome is a signed distance field around the same line (same seed, same course).
// A crossfade d = (1 - w) dA + w dB with w a smoothstep over a window stays a usable distance field
// if its gradient stays near 1 (the mesher and the hitbox assume |grad| <= ~1) and if it never eats
// into the racing tube (11 m round the line, the space every biome keeps clear).
const level = (biome) => makeLevel({ biome, seed: 5, mood: 0, runSeed: 0, index: 0 });
const smooth = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
function blendTrial(a, b, label) {
  const A = new World(level(a)), B = new World(level(b));
  const z0 = 900, z1 = 1200;
  const blend = (x, y, z) => { const w = smooth(z0, z1, z); return (1 - w) * A.rock.distance(x, y, z) + w * B.rock.distance(x, y, z); };
  const fields = { [a]: (x, y, z) => A.rock.distance(x, y, z), [b]: (x, y, z) => B.rock.distance(x, y, z), blend };
  const slopes = Object.fromEntries(Object.keys(fields).map((k) => [k, []]));
  let tube = Infinity, holes = 0, samples = 0;
  const rng = makeRng(7, label);
  for (let i = 0; i < 6000; i++) {
    const z = z0 - 50 + rng() * (z1 - z0 + 100);
    const p = A.course.pointAt(z);
    const x = p.x + (rng() - 0.5) * 300, y = p.y + (rng() - 0.65) * 260;
    const dx = (rng() - 0.5) * 4, dy = (rng() - 0.5) * 4, dz = (rng() - 0.5) * 4, len = Math.hypot(dx, dy, dz);
    if (Math.abs(blend(x, y, z)) > 30) continue;
    samples++;
    for (const [k, f] of Object.entries(fields)) slopes[k].push(Math.abs(f(x + dx, y + dy, z + dz) - f(x, y, z)) / len);
    // A contradiction: the blend says "air" where both fields say "inside rock"
    if (A.rock.distance(x, y, z) < -1 && B.rock.distance(x, y, z) < -1 && blend(x, y, z) > 1) holes++;
  }
  for (let z = z0; z <= z1; z += 5) { const p = A.course.pointAt(z); tube = Math.min(tube, blend(p.x, p.y, p.z)); }
  const pct = (list, q) => { const sorted = [...list].sort((m, n) => m - n); return sorted[Math.floor(q * (sorted.length - 1))]; };
  line(`${label} near-surface samples`, samples);
  for (const [k, list] of Object.entries(slopes)) line(`${label} gradient of ${k}: median / p99 / max`, `${pct(list, 0.5).toFixed(2)} / ${pct(list, 0.99).toFixed(2)} / ${Math.max(...list).toFixed(1)}`);
  line(`${label} closest rock to the racing line in the blend (m, want >= ~8)`, tube.toFixed(1));
  line(`${label} contradictions (inside both, air in the blend)`, holes);
}
blendTrial("verdant", "glacier", "C ");
blendTrial("verdant", "ember", "C'");
blendTrial("archipelago", "verdant", "D ");

// --- E. What the island-to-valley crossfade looks like under the line ---------------------------
// From island country (no ground) into a valley, the blended ground rises out of the cloud sea
// across the window: depth of the first land below the line, metres, every 50 m along it
{
  const A = new World(level("archipelago")), B = new World(level("verdant"));
  const z0 = 900, z1 = 1200;
  const blend = (x, y, z) => { const w = smooth(z0, z1, z); return (1 - w) * A.rock.distance(x, y, z) + w * B.rock.distance(x, y, z); };
  const depths = [];
  for (let z = z0 - 50; z <= z1 + 50; z += 50) {
    const p = A.course.pointAt(z);
    let below = null;
    for (let d = 0; d < 400; d += 2) if (blend(p.x, p.y - d, p.z) < 0) { below = d; break; }
    depths.push(below === null ? "none" : `${below}`);
  }
  line("E  land under the line across the crossfade (m below, every 50 m)", depths.join(" "));
}
