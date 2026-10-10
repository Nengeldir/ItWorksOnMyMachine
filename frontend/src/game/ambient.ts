import * as THREE from "three";
import { clamp } from "./math";
import { Kind, type ParticleSpec, type Particles } from "./particles";
import { WATER } from "./tuning";
import type { Ambient as AmbientSpec } from "./world/biomes/types";
import { forestAt } from "./world/flora/placement";
import type { World } from "./world/World";

// The air of a biome: particles drifting around the camera (fireflies in the
// shade of the forest, pollen, snow, leaves, embers, spores, ash, glitter),
// and the mist and spray at the foot of every waterfall. Spawned ahead of you,
// so you fly into them. Looks only: nothing here touches the flight.

/** Fills in a particle spec without allocating */
function look(s: ParticleSpec, life: number, size: number, kind: Kind, gravity: number, drag: number, intensity: number) {
  s.life = life;
  s.size = size;
  s.kind = kind;
  s.gravity = gravity;
  s.drag = drag;
  s.intensity = intensity;
}

const tmp = new THREE.Vector3();
const at = new THREE.Vector3();
const vel = new THREE.Vector3();
const rand = (min: number, max: number) => min + Math.random() * (max - min);

interface Emitter {
  spec: AmbientSpec;
  colors: THREE.Color[];
  debt: number;
}

export class Ambient {
  private world: World | null = null;
  private emitters: Emitter[] = [];
  private fallDebt = 0;
  private readonly glow: Particles;
  private readonly soft: Particles;
  private readonly spec: ParticleSpec = { life: 1, size: 1, color: new THREE.Color(), kind: Kind.Glow };

  /** `glow` adds light (motes, embers); `soft` blends (snow, leaves, mist) */
  constructor(glow: Particles, soft: Particles) {
    this.glow = glow;
    this.soft = soft;
  }

  setWorld(world: World) {
    this.world = world;
    this.emitters = world.biome.particles.ambient.map((spec) => ({ spec, colors: spec.colors.map((c) => new THREE.Color(c)), debt: 0 }));
    this.fallDebt = 0;
  }

  /** Ground height under a point, or NaN where there is no ground */
  private groundAt(x: number, z: number): number {
    const ground = this.world?.land?.ground;
    return ground ? ground.height(x, z) : NaN;
  }

  update(dt: number, camera: THREE.Vector3, velocity: THREE.Vector3, budget: number) {
    const world = this.world;
    if (!world || dt <= 0) return;
    const night = world.palette.night;
    // Spawn around where you'll be in a second or so
    const lead = tmp.copy(velocity).multiplyScalar(1.1);
    if (lead.lengthSq() > 90 * 90) lead.setLength(90);
    const cx = camera.x + lead.x;
    const cy = camera.y + lead.y;
    const cz = camera.z + lead.z;
    for (const e of this.emitters) {
      e.debt += e.spec.rate * (1 + (e.spec.night ?? 0) * night) * budget * dt;
      let tries = 0;
      while (e.debt >= 1 && tries++ < 40) {
        e.debt--;
        this.emit(e, cx, cy, cz, night);
      }
      e.debt = Math.min(e.debt, 4);
    }
    this.falls(dt, camera, budget);
  }

  private emit(e: Emitter, cx: number, cy: number, cz: number, night: number) {
    const s = this.spec;
    s.color = e.colors[Math.floor(Math.random() * e.colors.length)];
    s.gravity = 0;
    s.drag = 0;
    s.intensity = 1;
    switch (e.spec.kind) {
      case "fireflies": {
        // In the shade of the woods (anywhere low at night), close to the ground
        at.set(cx + rand(-70, 70), 0, cz + rand(-70, 70));
        const g = this.groundAt(at.x, at.z);
        if (Number.isNaN(g)) return;
        const shade = forestAt(this.world!, at.x, at.z);
        if (Math.random() > shade + night * 0.5) return;
        at.y = g + rand(0.6, 5);
        look(s, rand(4, 7), rand(0.28, 0.45), Kind.Firefly, -0.03, 0.4, 2.4 + night);
        this.glow.emit(at, vel.set(rand(-0.6, 0.6), rand(-0.2, 0.3), rand(-0.6, 0.6)), s);
        break;
      }
      case "motes": {
        at.set(cx + rand(-45, 45), cy + rand(-25, 20), cz + rand(-45, 45));
        look(s, rand(4, 7), rand(0.1, 0.18), Kind.Glow, -0.06, 0.6, 1.3);
        this.glow.emit(at, vel.set(rand(-0.5, 0.5), rand(-0.1, 0.25), rand(-0.5, 0.5)), s);
        break;
      }
      case "glitter": {
        at.set(cx + rand(-40, 40), cy + rand(-20, 15), cz + rand(-40, 40));
        look(s, rand(0.5, 1.2), rand(0.25, 0.5), Kind.Star, 0, 0, 2.2);
        this.glow.emit(at, vel.set(0, rand(-0.3, 0.1), 0), s);
        break;
      }
      case "embers": {
        at.set(cx + rand(-60, 60), cy + rand(-40, 5), cz + rand(-60, 60));
        const g = this.groundAt(at.x, at.z);
        if (!Number.isNaN(g)) at.y = Math.max(at.y, g + rand(0.5, 8));
        look(s, rand(2.5, 4.5), rand(0.16, 0.3), Kind.Glow, -2.2, 0.5, 2.6);
        this.glow.emit(at, vel.set(rand(-1.5, 1.5), rand(1, 3), rand(-1.5, 1.5)), s);
        break;
      }
      case "spores": {
        at.set(cx + rand(-50, 50), cy + rand(-25, 15), cz + rand(-50, 50));
        look(s, rand(5, 8), rand(0.14, 0.26), Kind.Glow, -0.25, 0.8, 1.8 + night);
        this.glow.emit(at, vel.set(rand(-0.4, 0.4), rand(0.1, 0.5), rand(-0.4, 0.4)), s);
        break;
      }
      case "snow": {
        at.set(cx + rand(-50, 50), cy + rand(0, 30), cz + rand(-50, 50));
        look(s, rand(5, 8), rand(0.12, 0.24), Kind.Glow, 0, 0, 1);
        this.soft.emit(at, vel.set(rand(-1.2, 1.2), rand(-2.4, -1.4), rand(-1.2, 1.2)), s);
        break;
      }
      case "ash": {
        at.set(cx + rand(-50, 50), cy + rand(0, 30), cz + rand(-50, 50));
        look(s, rand(5, 8), rand(0.18, 0.32), Kind.Glow, 0, 0, 0.7);
        this.soft.emit(at, vel.set(rand(-1, 1), rand(-1.2, -0.5), rand(-1, 1)), s);
        break;
      }
      case "leaves":
      case "petals": {
        at.set(cx + rand(-45, 45), cy + rand(-10, 25), cz + rand(-45, 45));
        const petal = e.spec.kind === "petals";
        look(s, rand(4, 7), petal ? rand(0.12, 0.2) : rand(0.28, 0.45), Kind.Shard, 0, 0, 1);
        this.soft.emit(at, vel.set(rand(-1.5, 1.5), rand(-1.4, -0.6), rand(-1.5, 1.5)), s);
        break;
      }
    }
  }

  /** Mist and spray at the foot of waterfalls near you */
  private falls(dt: number, camera: THREE.Vector3, budget: number) {
    const steps = this.world?.steps;
    if (!steps || WATER.spray <= 0) return;
    const lava = steps.river?.kind === "lava";
    if (steps.river?.kind === "ice") return;
    this.fallDebt += 26 * budget * WATER.spray * dt;
    if (this.fallDebt < 1) return;
    const s = this.spec;
    for (const fall of steps.falls) {
      const drop = fall.top - fall.bottom;
      if (drop < 3) continue;
      const x = steps.center(fall.z);
      const z = fall.z + 3 + drop * 0.07;
      const d = Math.hypot(x - camera.x, fall.bottom - camera.y, z - camera.z);
      if (d > 320) continue;
      const near = clamp(1 - d / 320, 0.2, 1);
      for (let k = 0; k < 3 && this.fallDebt >= 1; k++) {
        this.fallDebt -= 1 / near;
        const w = Math.max(3, fall.width / 2);
        at.set(x + rand(-w, w), fall.bottom + rand(0, 3), z + rand(-3, 6));
        if (lava) {
          look(s, rand(2, 3.5), rand(0.2, 0.35), Kind.Glow, -2, 0.6, 2.4);
          s.color = SPARK;
          this.glow.emit(at, vel.set(rand(-2, 2), rand(2, 5), rand(-2, 2)), s);
        } else {
          look(s, rand(2.5, 4), rand(4, 8), Kind.Glow, -0.4, 1.2, 1);
          s.color = MIST;
          this.soft.emit(at, vel.set(rand(-2, 2), rand(1, 3), rand(0, 4)), s);
          look(s, rand(0.6, 1.2), rand(0.15, 0.3), Kind.Glow, 9, 0.4, 1.6);
          s.color = SPRAY;
          this.glow.emit(at, vel.set(rand(-4, 4), rand(3, 8), rand(-2, 6)), s);
        }
      }
    }
    this.fallDebt = Math.min(this.fallDebt, 3);
  }
}

const MIST = new THREE.Color("#ffffff").multiplyScalar(0.92);
const SPRAY = new THREE.Color("#e6f6ff");
const SPARK = new THREE.Color("#ff8a3a");
