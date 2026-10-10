import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { Avatar } from "../avatar";
import { clamp } from "../math";
import { Kind, type Particles, fx, fxTime } from "../particles";
import { type Rng, makeRng, range } from "../rng";
import type { SidequestSpec } from "../world/biomes/types";
import { UP } from "../world/terrain/shapes";
import type { World } from "../world/World";
import type { Objective } from "./run";
import type { RunStats } from "./upgrades";

// Sidequests: two per biome, as its data names them, placed from the level's
// seed so everyone on the same run finds them in the same places. Everything
// sits ahead along the course and no higher than the racing line, so a
// descending glide can always reach it. Each kind keeps its own visuals and
// reports points through the host.

export interface QuestHost {
  world: World;
  group: THREE.Group;
  particles: Particles;
  stats: RunStats;
  accent: THREE.Color;
  /** A toast and points (0 for a message only) */
  notify(text: string, points: number): void;
  chime(big: boolean): void;
}

const tmp = new THREE.Vector3();
const tmp2 = new THREE.Vector3();
const frameP = new THREE.Vector3();
const frameT = new THREE.Vector3();
const frameS = new THREE.Vector3();
const WHITE = new THREE.Color("#ffffff");
const GOLD = new THREE.Color("#ffd23f");

/** A point beside the line at course fraction `along` (0 start … 1 finish), `lateral` metres to the side, `rise` metres above it */
function besideLine(world: World, along: number, lateral: number, rise: number, out = new THREE.Vector3()): THREE.Vector3 {
  const { course } = world;
  const z = course.start.z + (course.endZ - course.start.z) * along;
  course.pointAt(z, frameP);
  course.tangentAt(z, frameT);
  frameS.crossVectors(frameT, UP).normalize();
  return out.copy(frameP).addScaledVector(frameS, lateral).add(tmp.set(0, rise, 0));
}

/** The land surface under a point (marching down the distance field), or NaN within `depth` metres */
function surfaceBelow(world: World, x: number, y: number, z: number, depth: number): number {
  let h = y;
  for (let i = 0; i < 120 && h > y - depth; i++) {
    const d = world.rock.distance(x, h, z);
    if (d < 0.25) return h;
    h -= Math.max(d, 0.5);
  }
  return NaN;
}

/** A spot in the open air, clear of land: tries a few places near the wanted one */
function airSpot(world: World, rng: Rng, along: [number, number], lateral: [number, number], rise: [number, number], clear = 9): THREE.Vector3 {
  const out = new THREE.Vector3();
  for (let i = 0; i < 24; i++) {
    besideLine(world, range(rng, along[0], along[1]), (rng() < 0.5 ? -1 : 1) * range(rng, lateral[0], lateral[1]), range(rng, rise[0], rise[1]), out);
    if (world.distance(out.x, out.y, out.z) > clear && !world.lost(out.y, out.z)) return out;
  }
  // Fall back to the racing line itself, which is always clear
  return besideLine(world, (along[0] + along[1]) / 2, 0, -2, out);
}

/** A spot on the land: a surface point near the wanted place, above any water */
function groundSpot(world: World, rng: Rng, along: [number, number], lateral: [number, number]): THREE.Vector3 | null {
  const out = new THREE.Vector3();
  for (let i = 0; i < 30; i++) {
    besideLine(world, range(rng, along[0], along[1]), (rng() < 0.5 ? -1 : 1) * range(rng, lateral[0], lateral[1]), -4, out);
    const h = surfaceBelow(world, out.x, out.y, out.z, 160);
    if (Number.isNaN(h)) continue;
    if (world.seaLevel !== null && h < world.seaLevel + 1) continue;
    if (world.steps && world.steps.waterDistance(out.x, h + 0.5, out.z) < 1) continue;
    out.y = h;
    return out;
  }
  return null;
}

/** Did the segment a→b pass through a disc (center, facing `normal`, radius)? */
function throughDisc(a: THREE.Vector3, b: THREE.Vector3, center: THREE.Vector3, normal: THREE.Vector3, radius: number): boolean {
  const before = tmp.subVectors(a, center).dot(normal);
  const after = tmp2.subVectors(b, center).dot(normal);
  if (before * after > 0 || before === after) return false;
  const t = before / (before - after);
  tmp.lerpVectors(a, b, t);
  return tmp.distanceTo(center) <= radius;
}

export abstract class Quest {
  readonly spec: SidequestSpec;
  done = false;
  failed = false;
  protected readonly host: QuestHost;
  protected readonly rng: Rng;
  protected readonly group = new THREE.Group();
  protected readonly disposables: { dispose(): void }[] = [];

  constructor(spec: SidequestSpec, host: QuestHost, salt: string) {
    this.spec = spec;
    this.host = host;
    this.rng = makeRng(host.world.seed, `quest/${salt}`);
    host.group.add(this.group);
  }

  abstract objective(): Objective;
  /** Per physics step: the pilot moved from prev to pos */
  abstract step(prev: THREE.Vector3, pos: THREE.Vector3, speed: number, proximity: number, dt: number): void;
  /** Per frame: animation and particles */
  abstract update(dt: number, camera: THREE.Vector3, pos: THREE.Vector3): void;
  /** The next thing to fly to, for the objectives marker */
  target(): THREE.Vector3 | null {
    return null;
  }
  /** Updraft at a point (thermals), m/s */
  lift(pos: THREE.Vector3): number {
    void pos;
    return 0;
  }
  /** Seconds left, for timed quests */
  timer(): number | null {
    return null;
  }

  protected complete() {
    if (this.done) return;
    this.done = true;
    this.host.notify(`${this.spec.title}!`, this.spec.reward);
    this.host.chime(true);
  }

  protected own<T extends { dispose(): void }>(thing: T): T {
    this.disposables.push(thing);
    return thing;
  }

  protected burst(at: THREE.Vector3, color: THREE.Color, count: number) {
    const particles = this.host.particles;
    const n = Math.round(count * particles.budget);
    for (let i = 0; i < n; i++) {
      tmp.set(Math.random() - 0.5, Math.random() - 0.3, Math.random() - 0.5).normalize().multiplyScalar(4 + Math.random() * 9);
      particles.emit(at, tmp, fx(1 + Math.random(), 0.5 + Math.random() * 0.7, i % 3 ? color : WHITE, Kind.Star, -0.5, 1.4, 2.8));
    }
  }

  dispose() {
    this.disposables.forEach((d) => d.dispose());
    this.group.removeFromParent();
  }
}

// --- shared meshes ---------------------------------------------------------------

/** A beacon: stacked stones with a crystal on top */
function beaconGeometry(): { stones: THREE.BufferGeometry; crystal: THREE.BufferGeometry } {
  const parts = [
    new THREE.CylinderGeometry(1.4, 1.8, 1.4, 7).translate(0, 0.7, 0),
    new THREE.CylinderGeometry(1.1, 1.3, 1.2, 6).rotateY(0.4).translate(0, 2, 0),
    new THREE.CylinderGeometry(0.8, 1, 1, 6).rotateY(1).translate(0, 3.1, 0),
  ].map((g) => g.toNonIndexed());
  const stones = mergeGeometries(parts)!;
  parts.forEach((p) => p.dispose());
  stones.computeVertexNormals();
  const crystal = new THREE.OctahedronGeometry(0.9, 0).scale(0.8, 1.6, 0.8).translate(0, 5, 0);
  return { stones, crystal };
}

/** A thin, tall beam of light marking something from afar */
function beamMesh(color: THREE.Color, height: number, radius: number): THREE.Mesh<THREE.CylinderGeometry, THREE.MeshBasicMaterial> {
  const material = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.35, blending: THREE.AdditiveBlending, depthWrite: false, fog: false });
  const mesh = new THREE.Mesh(new THREE.CylinderGeometry(radius * 0.6, radius, height, 10, 1, true).translate(0, height / 2, 0), material);
  mesh.renderOrder = 6;
  return mesh;
}

// --- beacons -----------------------------------------------------------------------

/** Light N beacons standing on the land near the line: fly close to each */
class Beacons extends Quest {
  private readonly spots: THREE.Vector3[] = [];
  private readonly lit: boolean[] = [];
  private readonly crystals: THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>[] = [];
  private readonly beams: THREE.Mesh<THREE.CylinderGeometry, THREE.MeshBasicMaterial>[] = [];

  constructor(spec: SidequestSpec, host: QuestHost, salt: string) {
    super(spec, host, salt);
    const { stones, crystal } = beaconGeometry();
    this.own(stones);
    this.own(crystal);
    const stoneMaterial = this.own(new THREE.MeshLambertMaterial({ color: "#8a8478", flatShading: true }));
    for (let i = 0; i < spec.count; i++) {
      const a = 0.12 + (0.76 * i) / spec.count;
      const spot = groundSpot(host.world, this.rng, [a, a + 0.7 / spec.count], [26, 90]);
      if (!spot) continue;
      this.spots.push(spot);
      this.lit.push(false);
      const stone = new THREE.Mesh(stones, stoneMaterial);
      stone.position.copy(spot).y -= 0.4;
      stone.scale.setScalar(1.4);
      this.group.add(stone);
      const glow = new THREE.Mesh(crystal, this.own(new THREE.MeshBasicMaterial({ color: host.accent.clone().multiplyScalar(0.6) })));
      glow.position.copy(stone.position);
      glow.scale.setScalar(1.4);
      this.group.add(glow);
      this.crystals.push(glow);
      const beam = beamMesh(host.accent.clone(), 260, 2.2);
      this.own(beam.geometry);
      this.own(beam.material);
      beam.position.copy(spot);
      this.group.add(beam);
      this.beams.push(beam);
    }
  }

  private get count(): number {
    return this.lit.filter(Boolean).length;
  }

  objective(): Objective {
    const total = this.spots.length;
    return { title: this.spec.title, progress: `${this.count} / ${total}`, fraction: total ? this.count / total : 1, done: this.done, failed: false };
  }

  step(_prev: THREE.Vector3, pos: THREE.Vector3) {
    if (this.done) return;
    const reach = 18 + this.host.stats.magnet;
    this.spots.forEach((spot, i) => {
      if (this.lit[i] || pos.distanceTo(tmp.copy(spot).setY(spot.y + 6)) > reach) return;
      this.lit[i] = true;
      this.crystals[i].material.color.copy(GOLD).multiplyScalar(3);
      this.beams[i].material.color.copy(GOLD);
      this.beams[i].material.opacity = 0.6;
      this.burst(tmp.copy(spot).setY(spot.y + 7), GOLD, 60);
      this.host.chime(false);
      this.host.notify(`${this.spec.thing[0].toUpperCase()}${this.spec.thing.slice(1)} ${this.count} / ${this.spots.length}`, 150);
      if (this.count === this.spots.length) this.complete();
    });
    if (!this.spots.length) this.done = true;
  }

  update(dt: number) {
    const t = fxTime.value;
    this.crystals.forEach((c, i) => {
      c.rotation.y += dt * (this.lit[i] ? 2 : 0.6);
      if (!this.lit[i]) this.beams[i].material.opacity = 0.18 + 0.12 * Math.sin(t * 2 + i);
    });
  }

  target(): THREE.Vector3 | null {
    const i = this.lit.findIndex((l) => !l);
    return i >= 0 ? this.spots[i] : null;
  }
}

// --- collect ------------------------------------------------------------------------

/** Pick up N glowing things laid in a trail off the line */
class Collect extends Quest {
  private readonly items: THREE.Mesh[] = [];
  private readonly taken: boolean[] = [];
  private readonly material: THREE.MeshBasicMaterial;

  constructor(spec: SidequestSpec, host: QuestHost, salt: string) {
    super(spec, host, salt);
    const geometry = this.own(new THREE.OctahedronGeometry(1.1, 0));
    this.material = this.own(new THREE.MeshBasicMaterial({ color: host.accent.clone().lerp(GOLD, 0.5).multiplyScalar(2.4) }));
    // Two or three trails, each curving away from the line and back
    const trails = spec.count > 6 ? 3 : 2;
    let left = spec.count;
    for (let k = 0; k < trails; k++) {
      const n = Math.ceil(left / (trails - k));
      left -= n;
      const a = 0.15 + (0.7 * k) / trails + range(this.rng, 0, 0.08);
      const side = this.rng() < 0.5 ? -1 : 1;
      const start = airSpot(host.world, this.rng, [a, a + 0.04], [25, 60], [-30, -8]);
      for (let i = 0; i < n; i++) {
        const along = a + i * 0.012;
        const swing = Math.sin((i / Math.max(1, n - 1)) * Math.PI) * 30 * side;
        const p = besideLine(host.world, along, 0, 0);
        p.lerp(start, 0.6).add(tmp.set(swing * 0.3, -i * 2, 0));
        if (host.world.distance(p.x, p.y, p.z) < 6) continue;
        const mesh = new THREE.Mesh(geometry, this.material);
        mesh.position.copy(p);
        this.group.add(mesh);
        this.items.push(mesh);
        this.taken.push(false);
      }
    }
  }

  objective(): Objective {
    const got = this.taken.filter(Boolean).length;
    const total = this.items.length;
    return { title: this.spec.title, progress: `${got} / ${total}`, fraction: total ? got / total : 1, done: this.done, failed: false };
  }

  step(_prev: THREE.Vector3, pos: THREE.Vector3) {
    if (this.done) return;
    const reach = 5 + this.host.stats.magnet;
    const pull = 12 + this.host.stats.magnet * 2;
    this.items.forEach((item, i) => {
      if (this.taken[i]) return;
      const d = item.position.distanceTo(pos);
      // A magnet draws them in
      if (this.host.stats.magnet > 0 && d < pull) item.position.lerp(pos, 0.04);
      if (d > reach) return;
      this.taken[i] = true;
      item.visible = false;
      this.burst(item.position, this.material.color, 26);
      this.host.chime(false);
      const got = this.taken.filter(Boolean).length;
      this.host.notify(`${this.spec.thing[0].toUpperCase()}${this.spec.thing.slice(1)} ${got} / ${this.items.length}`, 60);
      if (got === this.items.length) this.complete();
    });
    if (!this.items.length) this.done = true;
  }

  update(dt: number, camera: THREE.Vector3) {
    const t = fxTime.value;
    this.items.forEach((item, i) => {
      if (this.taken[i]) return;
      item.rotation.y += dt * 2;
      item.position.y += Math.sin(t * 2 + i) * dt * 0.6;
      if (Math.random() < dt * 3 && item.position.distanceToSquared(camera) < 300 * 300) {
        this.host.particles.emit(item.position, tmp.set(0, 0.6, 0), fx(0.8, 1.6, this.material.color, Kind.Star, 0, 0, 1.6));
      }
    });
  }

  target(): THREE.Vector3 | null {
    const i = this.taken.findIndex((x) => !x);
    return i >= 0 ? this.items[i].position : null;
  }
}

// --- thread and rush: rings in the air -------------------------------------------------

/** Rings of wind floating off the line. Thread: fly through all. Rush: in order, against the clock */
class Rings extends Quest {
  private readonly rings: { center: THREE.Vector3; normal: THREE.Vector3; radius: number; mesh: THREE.Mesh<THREE.TorusGeometry, THREE.MeshBasicMaterial> }[] = [];
  private readonly passed: boolean[] = [];
  private readonly timed: boolean;
  private clock: number | null = null;

  constructor(spec: SidequestSpec, host: QuestHost, salt: string, timed: boolean) {
    super(spec, host, salt);
    this.timed = timed;
    const color = timed ? new THREE.Color("#ff7a3a") : host.accent.clone().lerp(WHITE, 0.3);
    const a0 = timed ? range(this.rng, 0.2, 0.45) : 0.12;
    for (let i = 0; i < spec.count; i++) {
      const a = timed ? a0 + i * 0.035 : 0.12 + (0.76 * i) / spec.count + range(this.rng, 0, 0.6 / spec.count);
      const center = airSpot(host.world, this.rng, [a, a + 0.01], timed ? [18, 45] : [30, 85], [-26, -6], 11);
      const z = center.z;
      const normal = host.world.course.tangentAt(z, new THREE.Vector3());
      const radius = timed ? 7 : 6;
      const mesh = new THREE.Mesh(this.own(new THREE.TorusGeometry(radius, 0.45, 8, 40)), this.own(new THREE.MeshBasicMaterial({ color: color.clone().multiplyScalar(2.2), fog: false })));
      mesh.position.copy(center);
      mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), normal);
      this.group.add(mesh);
      this.rings.push({ center, normal, radius, mesh });
      this.passed.push(false);
    }
  }

  private get count(): number {
    return this.passed.filter(Boolean).length;
  }

  objective(): Objective {
    const total = this.rings.length;
    const progress = this.failed ? "too slow" : this.timed && this.clock !== null ? `${this.count} / ${total} · ${Math.ceil(this.clock)} s` : `${this.count} / ${total}`;
    return { title: this.spec.title, progress, fraction: total ? this.count / total : 1, done: this.done, failed: this.failed };
  }

  step(prev: THREE.Vector3, pos: THREE.Vector3, _speed: number, _proximity: number, dt: number) {
    if (this.done || this.failed) return;
    const slack = this.host.stats.magnet;
    if (this.timed && this.clock !== null) {
      this.clock -= dt;
      if (this.clock <= 0) {
        this.failed = true;
        this.host.notify(`${this.spec.title}: out of time`, 0);
        this.rings.forEach((r) => (r.mesh.material.color.setScalar(0.25)));
        return;
      }
    }
    this.rings.forEach((ring, i) => {
      if (this.passed[i]) return;
      // In a rush, only the next marker counts
      if (this.timed && i !== this.count) return;
      if (!throughDisc(prev, pos, ring.center, ring.normal, ring.radius + 1 + slack)) return;
      this.passed[i] = true;
      ring.mesh.visible = false;
      this.burst(ring.center, ring.mesh.material.color, 50);
      this.host.chime(false);
      if (this.timed) this.clock = (this.clock ?? 6) + 7;
      this.host.notify(`${this.spec.thing[0].toUpperCase()}${this.spec.thing.slice(1)} ${this.count} / ${this.rings.length}`, this.timed ? 100 : 120);
      if (this.count === this.rings.length) this.complete();
    });
  }

  update(dt: number) {
    this.rings.forEach((ring, i) => {
      ring.mesh.rotation.z += dt * (i % 2 ? 1 : -1);
      const next = !this.timed || i === this.count;
      ring.mesh.scale.setScalar(next && !this.failed ? 1 + 0.06 * Math.sin(fxTime.value * 4 + i) : 0.8);
    });
  }

  target(): THREE.Vector3 | null {
    if (this.failed) return null;
    const i = this.passed.findIndex((p) => !p);
    return i >= 0 ? this.rings[i].center : null;
  }

  timer(): number | null {
    return this.timed && this.clock !== null && !this.done && !this.failed ? this.clock : null;
  }
}

// --- skim ------------------------------------------------------------------------------

/** Fly close to the surface (the water, where there is any) for N seconds in all */
class Skim extends Quest {
  private seconds = 0;
  private lastWhole = 0;

  objective(): Objective {
    const s = Math.min(this.seconds, this.spec.count);
    return { title: this.spec.title, progress: `${s.toFixed(1)} / ${this.spec.count} s`, fraction: s / this.spec.count, done: this.done, failed: false };
  }

  step(_prev: THREE.Vector3, pos: THREE.Vector3, _speed: number, proximity: number, dt: number) {
    if (this.done || proximity < 0.45) return;
    const world = this.host.world;
    // Over water if the biome has any, otherwise any surface counts
    if (world.seaLevel !== null || world.steps) {
      const water = world.seaLevel !== null ? pos.y - world.seaLevel : world.steps!.waterDistance(pos.x, pos.y, pos.z);
      if (water > 8) return;
    }
    this.seconds += dt;
    if (Math.floor(this.seconds) > this.lastWhole) {
      this.lastWhole = Math.floor(this.seconds);
      this.host.notify(`Skimming ${this.lastWhole} / ${this.spec.count} s`, 30);
    }
    if (this.seconds >= this.spec.count) this.complete();
  }

  update() {}
}

// --- thermals -------------------------------------------------------------------------

const thermalVertex = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;
const thermalFragment = /* glsl */ `
  uniform vec3 color;
  uniform float time;
  uniform float used;
  varying vec2 vUv;
  void main() {
    float rise = fract(vUv.y * 3.0 - time * 0.5 + sin(vUv.x * 25.0) * 0.1);
    float shimmer = smoothstep(0.0, 0.3, rise) * smoothstep(1.0, 0.6, rise);
    float fade = (1.0 - vUv.y) * smoothstep(0.0, 0.1, vUv.y);
    gl_FragColor = vec4(color * shimmer * fade * (0.5 - used * 0.35), 1.0);
    #include <colorspace_fragment>
  }
`;

/** Columns of rising hot air: fly through them for an updraft (run mode lifts you) */
class Thermals extends Quest {
  private readonly columns: { base: THREE.Vector3; radius: number; height: number; used: boolean; material: THREE.ShaderMaterial }[] = [];
  private debt = 0;

  constructor(spec: SidequestSpec, host: QuestHost, salt: string) {
    super(spec, host, salt);
    const color = new THREE.Color("#ff9a4a");
    for (let i = 0; i < spec.count; i++) {
      const a = 0.15 + (0.72 * i) / spec.count;
      const spot = groundSpot(host.world, this.rng, [a, a + 0.6 / spec.count], [18, 55]);
      if (!spot) continue;
      const line = host.world.course.y(spot.z);
      const height = Math.max(60, line + 40 - spot.y);
      const radius = 12;
      const material = this.own(
        new THREE.ShaderMaterial({
          uniforms: { color: { value: color }, time: fxTime, used: { value: 0 } },
          vertexShader: thermalVertex,
          fragmentShader: thermalFragment,
          transparent: true,
          depthWrite: false,
          blending: THREE.AdditiveBlending,
          side: THREE.DoubleSide,
        }),
      );
      const mesh = new THREE.Mesh(this.own(new THREE.CylinderGeometry(radius, radius * 0.7, height, 20, 1, true).translate(0, height / 2, 0)), material);
      mesh.position.copy(spot);
      mesh.renderOrder = 6;
      this.group.add(mesh);
      this.columns.push({ base: spot, radius, height, used: false, material });
    }
  }

  private inside(pos: THREE.Vector3): number {
    return this.columns.findIndex((c) => pos.y > c.base.y && pos.y < c.base.y + c.height && Math.hypot(pos.x - c.base.x, pos.z - c.base.z) < c.radius);
  }

  objective(): Objective {
    const used = this.columns.filter((c) => c.used).length;
    const total = this.columns.length;
    return { title: this.spec.title, progress: `${used} / ${total}`, fraction: total ? used / total : 1, done: this.done, failed: false };
  }

  step(_prev: THREE.Vector3, pos: THREE.Vector3) {
    if (this.done) return;
    const i = this.inside(pos);
    if (i < 0 || this.columns[i].used) return;
    this.columns[i].used = true;
    this.columns[i].material.uniforms.used.value = 1;
    this.host.chime(false);
    const used = this.columns.filter((c) => c.used).length;
    this.host.notify(`Thermal ${used} / ${this.columns.length}`, 150);
    if (used === this.columns.length) this.complete();
    if (!this.columns.length) this.done = true;
  }

  lift(pos: THREE.Vector3): number {
    return this.inside(pos) >= 0 ? 14 : 0;
  }

  update(dt: number, camera: THREE.Vector3) {
    // Embers riding up the columns near you
    this.debt += 30 * this.host.particles.budget * dt;
    for (; this.debt >= 1; this.debt--) {
      const c = this.columns[Math.floor(Math.random() * this.columns.length)];
      if (!c || c.base.distanceToSquared(camera) > 450 * 450) continue;
      const a = Math.random() * Math.PI * 2;
      const r = Math.random() * c.radius;
      tmp.set(c.base.x + Math.cos(a) * r, c.base.y + Math.random() * c.height * 0.5, c.base.z + Math.sin(a) * r);
      this.host.particles.emit(tmp, tmp2.set(0, 10 + Math.random() * 8, 0), fx(3, 0.4, EMBER, Kind.Glow, -1, 0.3, 2.2));
    }
  }

  target(): THREE.Vector3 | null {
    const c = this.columns.find((c) => !c.used);
    return c ? c.base : null;
  }
}

const EMBER = new THREE.Color("#ff8a3a");

// --- chase ------------------------------------------------------------------------------

/** A glowing spirit creature: a body and two flapping wings */
function spiritMesh(color: THREE.Color): { group: THREE.Group; wings: THREE.Mesh[]; dispose(): void } {
  const group = new THREE.Group();
  const material = new THREE.MeshBasicMaterial({ color: color.clone().multiplyScalar(2.2), side: THREE.DoubleSide, fog: false });
  const body = new THREE.Mesh(new THREE.OctahedronGeometry(1, 0).scale(0.7, 0.6, 2.2), material);
  group.add(body);
  const wingGeometry = new THREE.BufferGeometry();
  wingGeometry.setAttribute("position", new THREE.Float32BufferAttribute([0, 0, 1.2, 0, 0, -1, 4, 0, -0.6], 3));
  const wings = [-1, 1].map((s) => {
    const wing = new THREE.Mesh(wingGeometry, material);
    wing.scale.x = s;
    group.add(wing);
    return wing;
  });
  return {
    group,
    wings,
    dispose: () => {
      body.geometry.dispose();
      wingGeometry.dispose();
      material.dispose();
    },
  };
}

/** Follow a spirit as it flies off along its own path: stay close for long enough */
class Chase extends Quest {
  private readonly spirit: ReturnType<typeof spiritMesh>;
  private readonly path: THREE.CatmullRomCurve3;
  private readonly pathLength: number;
  private state: "waiting" | "flying" | "resting" = "waiting";
  private travelled = 0;
  private close = 0; // seconds spent near it
  private readonly needed: number;
  private readonly heading = new THREE.Vector3();

  constructor(spec: SidequestSpec, host: QuestHost, salt: string) {
    super(spec, host, salt);
    const a = range(this.rng, 0.15, 0.3);
    const points: THREE.Vector3[] = [];
    // A weaving path ahead, never above the line, never into the land
    for (let i = 0; i < 9; i++) {
      const along = a + i * 0.045;
      const p = airSpot(host.world, this.rng, [along, along + 0.005], i === 0 ? [20, 30] : [0, 40], [-28, -6], 8);
      points.push(p);
    }
    this.path = new THREE.CatmullRomCurve3(points);
    this.pathLength = this.path.getLength();
    this.needed = clamp(this.pathLength / 50 * 0.55, 8, 18);
    this.spirit = spiritMesh(host.accent.clone().lerp(WHITE, 0.25));
    this.own(this.spirit);
    this.spirit.group.position.copy(points[0]);
    this.spirit.group.scale.setScalar(1.6);
    this.group.add(this.spirit.group);
  }

  objective(): Objective {
    const progress = this.state === "waiting" ? "find it" : `${Math.min(100, Math.round((this.close / this.needed) * 100))}%`;
    return { title: this.spec.title, progress, fraction: this.close / this.needed, done: this.done, failed: false };
  }

  step(_prev: THREE.Vector3, pos: THREE.Vector3, speed: number, _proximity: number, dt: number) {
    if (this.done) return;
    const spirit = this.spirit.group.position;
    const d = spirit.distanceTo(pos);
    if (this.state === "waiting" || this.state === "resting") {
      if (d < 50) {
        const resumed = this.state === "resting";
        this.state = "flying";
        this.host.notify(resumed ? `The ${this.spec.thing} flies on: keep up!` : `The ${this.spec.thing} takes off: follow it!`, 0);
      }
      return;
    }
    // Keeps a little ahead of you: slower when you fall behind, so it can be caught
    const pace = clamp(speed * (d > 45 ? 0.75 : 0.98), 22, 70);
    this.travelled = Math.min(this.pathLength, this.travelled + pace * dt);
    if (d < 40) this.close += dt;
    if (this.close >= this.needed) {
      this.burst(spirit, GOLD, 80);
      this.spirit.group.visible = false;
      this.complete();
      return;
    }
    if (this.travelled >= this.pathLength) {
      // Out of path: it rests at the end and waits for you to try again
      this.state = "resting";
      this.travelled = 0;
      this.path.points.splice(0, this.path.points.length - 1);
      const last = this.path.points[0].clone();
      for (let i = 1; i < 6; i++) {
        const z = last.z + i * 70;
        const along = clamp((z - this.host.world.course.start.z) / (this.host.world.course.endZ - this.host.world.course.start.z), 0, 0.98);
        this.path.points.push(airSpot(this.host.world, this.rng, [along, along + 0.004], [0, 35], [-26, -8], 8));
      }
      this.path.updateArcLengths();
    }
  }

  update(dt: number, camera: THREE.Vector3) {
    if (this.done) return;
    const t = fxTime.value;
    const group = this.spirit.group;
    if (this.state === "flying") {
      const u = clamp(this.travelled / this.path.getLength(), 0, 1);
      this.path.getPointAt(u, group.position);
      this.path.getTangentAt(u, this.heading);
      group.lookAt(tmp.copy(group.position).add(this.heading));
    } else {
      group.position.y += Math.sin(t * 1.5) * dt * 0.8;
      group.rotation.y += dt * 0.5;
    }
    const flap = Math.sin(t * (this.state === "flying" ? 9 : 3)) * 0.7;
    this.spirit.wings[0].rotation.z = flap;
    this.spirit.wings[1].rotation.z = -flap;
    if (group.position.distanceToSquared(camera) < 500 * 500 && Math.random() < dt * 25) {
      this.host.particles.emit(group.position, tmp.set(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5), fx(1.2, 0.8, this.host.accent, Kind.Glow, 0, 1, 2));
    }
  }

  target(): THREE.Vector3 | null {
    return this.done ? null : this.spirit.group.position;
  }
}

// --- rescue -----------------------------------------------------------------------------

/** A glider stranded on a ledge: reach them, then they fly with you for a while */
class Rescue extends Quest {
  private readonly glider: Avatar;
  private readonly spot: THREE.Vector3;
  private state: "stranded" | "following" = "stranded";
  private escorted = 0;
  private readonly flare: THREE.Mesh<THREE.CylinderGeometry, THREE.MeshBasicMaterial>;
  private readonly last = new THREE.Vector3();

  constructor(spec: SidequestSpec, host: QuestHost, salt: string) {
    super(spec, host, salt);
    this.spot = groundSpot(host.world, this.rng, [0.25, 0.55], [30, 80]) ?? airSpot(host.world, this.rng, [0.3, 0.5], [30, 60], [-20, -5]);
    this.glider = new Avatar("#ffb03a");
    this.glider.group.position.copy(this.spot).y += 1.2;
    this.glider.group.scale.setScalar(1);
    this.group.add(this.glider.group);
    this.flare = beamMesh(new THREE.Color("#ff5a3a"), 300, 1.6);
    this.own(this.flare.geometry);
    this.own(this.flare.material);
    this.flare.position.copy(this.spot);
    this.group.add(this.flare);
    this.last.copy(this.glider.group.position);
  }

  objective(): Objective {
    const progress = this.state === "stranded" ? "find them" : `escort ${Math.min(100, Math.round((this.escorted / 20) * 100))}%`;
    return { title: this.spec.title, progress, fraction: this.state === "stranded" ? 0 : this.escorted / 20, done: this.done, failed: false };
  }

  step(_prev: THREE.Vector3, pos: THREE.Vector3, _speed: number, _proximity: number, dt: number) {
    if (this.done) return;
    if (this.state === "stranded") {
      if (pos.distanceTo(this.glider.group.position) < 22 + this.host.stats.magnet) {
        this.state = "following";
        this.flare.visible = false;
        this.host.chime(false);
        this.host.notify("Found them! Fly on together", 300);
      }
      return;
    }
    this.escorted += dt;
    if (this.escorted >= 20) {
      this.burst(this.glider.group.position, GOLD, 60);
      this.complete();
    }
  }

  /** The rescued glider flies off your wing */
  follow(pos: THREE.Vector3, quaternion: THREE.Quaternion, dt: number, speed: number) {
    if (this.state !== "following") return;
    const g = this.glider.group;
    tmp.set(6, 1.5, 7).applyQuaternion(quaternion).add(pos);
    g.position.lerp(tmp, 1 - Math.exp(-dt * 3));
    g.quaternion.slerp(quaternion, 1 - Math.exp(-dt * 4));
    this.glider.update(dt, speed, 0, 0);
  }

  update(dt: number) {
    if (this.state === "stranded") {
      this.glider.update(dt, 0, 0, 0);
      this.flare.material.opacity = 0.3 + 0.15 * Math.sin(fxTime.value * 5);
    }
  }

  target(): THREE.Vector3 | null {
    return this.state === "stranded" ? this.glider.group.position : null;
  }

  dispose() {
    this.glider.dispose();
    super.dispose();
  }
}

/** Builds a level's sidequests from its biome's data */
export function createQuests(specs: readonly SidequestSpec[], host: QuestHost): Quest[] {
  return specs.map((spec, i) => {
    const salt = `${i}/${spec.kind}`;
    switch (spec.kind) {
      case "beacons":
        return new Beacons(spec, host, salt);
      case "collect":
        return new Collect(spec, host, salt);
      case "thread":
        return new Rings(spec, host, salt, false);
      case "rush":
        return new Rings(spec, host, salt, true);
      case "skim":
        return new Skim(spec, host, salt);
      case "thermals":
        return new Thermals(spec, host, salt);
      case "chase":
        return new Chase(spec, host, salt);
      case "rescue":
        return new Rescue(spec, host, salt);
    }
  });
}

export { Rescue };
