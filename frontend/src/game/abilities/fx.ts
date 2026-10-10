import * as THREE from "three";
import { Avatar, glowTexture } from "../avatar";
import type { Flight } from "../flight";
import { clamp, smoothstep } from "../math";
import { Kind, type Particles, fx } from "../particles";
import { outlineMaterial, toonMaterial } from "../toon";
import { Trail } from "../trail";
import { ABILITIES_FX } from "../tuning";
import { ABILITY, type Abilities } from "../run/abilities";
import type { World } from "../world/World";
import { CloudLanes } from "./lanes";
import { type MantaModel, RingQuads, bladeGeometry, bladeMaterial, buildManta, chevronGeometry, downFeather, helixMesh, sigilMesh, tunnelMesh } from "./models";

// What the run's abilities look like (their rules: run/abilities.ts). Looks
// only: this reads the abilities' state and never changes the flight.
//  - Featherfalling: three downy feathers drift round the pilot's back, more
//    when gliding slowly, and shed soft motes.
//  - Skim-Booster: wingtips flare and stream sparks with thrill, two ribbons
//    of warm light behind them.
//  - Cloud-Surfing: the rivers of cloud (lanes.ts), a wake of cloud and
//    glitter while surfing, and a crouched surfing pose.
//  - Plunging Attack: tucked like a diver, a comet's head of light and a
//    stream of stars; a gate struck sends out a shockwave and shards.
//  - Wind-Shear Dash: a fading afterimage where you were, crescents of wind
//    and leaves along the blink.
//  - Thermal Vision: warm rings over every gate ahead (and the portal), seen
//    through fog and rock, revealed near to far; rising motes of warm air
//    along the line; the manta and the cloud lanes glow warm from afar.
//  - Slipstream Rider: the spirit manta (models.ts) flapping along the line
//    with ribbons off its wingtips and a wake; streams of air round you in it.
//  - Gale Force: arms thrown forward, a burst of wind and leaves, blades
//    spinning out; the tunnel of wind rushing ahead, rings of wind round the
//    gates it widens.
//  - Acrobatic Recovery: sparks off the rock, a spiral of light round the roll.
//  - Hover-Stall: hanging upright on fluttering wings over a turning sigil
//    whose outer ring is the timer, chevrons where you'll launch, downwash;
//    on launch the sigil bursts.

export type AbilitySound = "plunge" | "strike" | "shear" | "burst" | "recover" | "hang" | "launch" | "manta";

export interface AbilityFxHost {
  kick(degrees?: number): void;
  sound(kind: AbilitySound): void;
}

const TAU = Math.PI * 2;
const WHITE = new THREE.Color("#ffffff");
const GOLD = new THREE.Color("#ffe39a");
const ANEMO = new THREE.Color("#7df5d8");
const LEAF = new THREE.Color("#8ee8b0");
const THRILL = new THREE.Color("#ffad4a");
const HEAT_NEAR = new THREE.Color("#ffd27a");
const HEAT_FAR = new THREE.Color("#ff5f8f");
const MANTA_GLOW = new THREE.Color("#9ff5ff");
const UP = new THREE.Vector3(0, 1, 0);
const ORIGIN = new THREE.Vector3();

const at = new THREE.Vector3();
const vel = new THREE.Vector3();
const tmp = new THREE.Vector3();
const tmp2 = new THREE.Vector3();
const side = new THREE.Vector3();
const tipL = new THREE.Vector3();
const tipR = new THREE.Vector3();
const span = new THREE.Vector3();
const color = new THREE.Color();
const matrix = new THREE.Matrix4();
const quat = new THREE.Quaternion();
const rand = (min: number, max: number) => min + Math.random() * (max - min);
const ease = (current: number, target: number, rate: number, dt: number) => current + (target - current) * (1 - Math.exp(-rate * dt));
const backOut = (t: number) => {
  const x = clamp(t, 0, 1) - 1;
  return 1 + 2.7 * x * x * x + 1.7 * x * x;
};
/** `out` turned so its -z looks along `direction` */
const lookAlong = (out: THREE.Quaternion, direction: THREE.Vector3) => out.setFromRotationMatrix(matrix.lookAt(ORIGIN, direction, Math.abs(direction.y) > 0.98 ? tmp2.set(0, 0, 1) : UP));

interface Blade {
  mesh: THREE.Mesh<THREE.BufferGeometry, THREE.ShaderMaterial>;
  t: number; // seconds since it was thrown; -1 idle
  life: number;
  /** "dash": sweeps from `from` along `axis`; "orbit": spins round the pilot, growing */
  kind: "dash" | "orbit";
  from: THREE.Vector3;
  axis: THREE.Vector3;
  forward: THREE.Vector3;
  angle: number;
}

interface Wave {
  t: number;
  life: number;
  center: THREE.Vector3;
  normal: THREE.Vector3;
  radius: number;
  grow: number;
  tint: THREE.Color;
}

interface Afterimage {
  avatar: Avatar;
  t: number;
  drift: THREE.Vector3;
}

export class AbilityFx {
  /** Everything placed in the world (the level's): hidden with it inside a wormhole */
  readonly group = new THREE.Group();
  private readonly avatar: Avatar;
  private readonly particles: Particles;
  private readonly soft: Particles;
  private readonly host: AbilityFxHost;
  private readonly materials: THREE.Material[] = [];
  private readonly geometries: THREE.BufferGeometry[] = [];
  private time = 0;
  private readonly cue = { plunge: 0, strike: 0, shear: 0, burst: 0, recover: 0, hang: 0, launch: 0 };
  private version = -1;
  private arrivals = 0;
  private active = false;

  // Featherfalling
  private readonly halo = new THREE.Group();
  private readonly feathers: THREE.Mesh[] = [];
  private featherWeight = 0;
  private downDebt = 0;
  // Skim-Booster
  private readonly thrillTrails: Trail[];
  private readonly flares: THREE.Sprite[] = [];
  private sparkDebt = 0;
  // Cloud-Surfing
  private lanes: CloudLanes | null = null;
  private lanesFor = -1;
  private wakeDebt = 0;
  // Plunging Attack
  private readonly comet: THREE.Sprite;
  private cometDebt = 0;
  // Rings of light that sit in the world (shockwaves, wind halos), and Thermal Vision's markers, seen through rock
  private readonly rings = new RingQuads(32, true);
  private readonly markers = new RingQuads(64, false);
  private readonly waves: Wave[] = [];
  private reveal = 0;
  private heatDebt = 0;
  // Wind-Shear Dash and Gale Force
  private readonly blades: Blade[] = [];
  private readonly afterimages: Afterimage[] = [];
  private nextAfterimage = 0;
  private cast = 0;
  // Slipstream Rider
  private manta: MantaModel | null = null;
  private mantaAura: THREE.Sprite | null = null;
  private mantaTrails: Trail[] = [];
  private mantaShown = 0;
  private mantaPhase = 0;
  private wakeDebtManta = 0;
  private streamDebt = 0;
  // Gale Force
  private readonly tunnel = tunnelMesh(ANEMO);
  // Acrobatic Recovery
  private readonly helix = helixMesh("#ffe7a8");
  private helixT = -1;
  private helixSpin = 1;
  // Hover-Stall
  private readonly sigil = sigilMesh("#f0b443", ANEMO);
  private readonly chevrons: THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>;
  private sigilOpen = 0;
  private sigilBurst = -1;
  private downwashDebt = 0;

  constructor(scene: THREE.Scene, avatar: Avatar, particles: Particles, soft: Particles, host: AbilityFxHost) {
    this.avatar = avatar;
    this.particles = particles;
    this.soft = soft;
    this.host = host;
    scene.add(this.group);

    // Three feathers on the pilot's back
    const featherGeometry = this.geometry(downFeather());
    const featherMaterial = this.material(toonMaterial({ rim: 0.6, side: THREE.DoubleSide }));
    const ink = this.material(outlineMaterial(0.008));
    for (let i = 0; i < 3; i++) {
      const mesh = new THREE.Mesh(featherGeometry, featherMaterial);
      mesh.add(new THREE.Mesh(featherGeometry, ink));
      this.feathers.push(mesh);
      this.halo.add(mesh);
    }
    this.halo.visible = false;
    avatar.group.add(this.halo);

    this.thrillTrails = [new Trail("#ffb04a", { width: 0.2, shimmer: 1.4, length: 0.8 }), new Trail("#ffb04a", { width: 0.2, shimmer: 1.4, length: 0.8 })];
    for (const trail of this.thrillTrails) {
      trail.setColor("#ffd27a", "#ff6a3d");
      scene.add(trail.mesh);
    }
    for (let i = 0; i < 2; i++) {
      const flare = new THREE.Sprite(this.material(new THREE.SpriteMaterial({ map: glowTexture(), color: THRILL.clone().multiplyScalar(1.8), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity: 0 })));
      flare.visible = false;
      this.flares.push(flare);
      scene.add(flare);
    }

    this.comet = new THREE.Sprite(this.material(new THREE.SpriteMaterial({ map: glowTexture(), color: new THREE.Color(1.5, 1.35, 1.05), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity: 0 })));
    this.comet.visible = false;
    scene.add(this.comet);

    this.group.add(this.rings.mesh, this.markers.mesh, this.tunnel, this.sigil);
    this.tunnel.visible = false;
    this.sigil.visible = false;
    this.chevrons = new THREE.Mesh(this.geometry(chevronGeometry()), this.material(new THREE.MeshBasicMaterial({ color: GOLD.clone().multiplyScalar(1.6), transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide })));
    this.chevrons.visible = false;
    this.group.add(this.chevrons);
    this.helix.visible = false;
    avatar.group.add(this.helix);

    const bladeGeo = this.geometry(bladeGeometry());
    for (let i = 0; i < 6; i++) {
      const mesh = new THREE.Mesh(bladeGeo, this.material(bladeMaterial(i % 2 ? "#bffbea" : ANEMO)));
      mesh.visible = false;
      mesh.frustumCulled = false;
      mesh.renderOrder = 7;
      this.group.add(mesh);
      this.blades.push({ mesh, t: -1, life: 0.35, kind: "dash", from: new THREE.Vector3(), axis: new THREE.Vector3(), forward: new THREE.Vector3(), angle: 0 });
    }
    for (let i = 0; i < 2; i++) {
      const ghost = new Avatar("#8ff5e0", { ghost: true });
      ghost.visible = false;
      this.group.add(ghost.group);
      this.afterimages.push({ avatar: ghost, t: -1, drift: new THREE.Vector3() });
    }
  }

  private material<T extends THREE.Material>(material: T): T {
    this.materials.push(material);
    return material;
  }

  private geometry<T extends THREE.BufferGeometry>(geometry: T): T {
    this.geometries.push(geometry);
    return geometry;
  }

  /** Before the avatar animates: the abilities' poses (eased in and out) */
  pose(dt: number, abilities: Abilities | null) {
    if (dt <= 0) return;
    const st = this.avatar.stance;
    const a = abilities;
    this.cast = Math.max(0, this.cast - dt);
    st.tuck = ease(st.tuck, a && a.plunge >= 0 ? 1 : 0, 10, dt);
    st.hover = ease(st.hover, a && a.hang >= 0 ? 1 : 0, 8, dt);
    st.cast = ease(st.cast, this.cast > 0 ? 1 : 0, this.cast > 0 ? 16 : 5, dt);
    st.surf = ease(st.surf, a ? smoothstep(0.1, 0.6, a.surf) : 0, 5, dt);
  }

  /** Not in a run, crashed, or in a race: nothing shows */
  hide() {
    if (!this.active) return;
    this.active = false;
    const st = this.avatar.stance;
    st.tuck = st.hover = st.cast = st.surf = 0;
    this.halo.visible = false;
    for (const trail of this.thrillTrails) trail.opacity = 0;
    for (const flare of this.flares) flare.visible = false;
    this.comet.visible = false;
    this.helix.visible = false;
    this.group.visible = false;
    for (const trail of this.mantaTrails) trail.opacity = 0;
  }

  /** After the avatar and its effects animated: everything else */
  update(dt: number, abilities: Abilities, world: World, flight: Flight, camera: THREE.Camera, passed: (gate: number) => boolean, flying: boolean) {
    this.active = true;
    this.group.visible = true;
    this.time += dt;
    const a = abilities;
    const avatar = this.avatar;
    avatar.group.updateWorldMatrix(true, true);
    avatar.wingtips(tipL, tipR);
    avatar.span(span);
    const budget = this.particles.budget * (flying ? 1 : 0);
    if (a.version !== this.version) {
      this.version = a.version;
      this.reveal = 0;
      this.waves.length = 0;
    }

    this.rings.begin();
    this.markers.begin();
    this.cues(a, world, flight, budget);
    this.featherfalling(dt, a, flight, budget);
    this.skimBooster(dt, a, flight, budget);
    this.cloudSurfing(dt, a, world, flight, budget);
    this.plunging(dt, a, flight, budget);
    this.shear(dt);
    this.thermal(dt, a, world, flight, camera, passed, budget);
    this.slipstream(dt, a, flight, budget);
    this.gale(dt, a, world, flight, budget);
    this.recovery(dt);
    this.hoverStall(dt, a, flight, budget);
    this.updateWaves(dt);
    this.rings.end();
    this.markers.end();
  }

  // --- one-off moments ----------------------------------------------------------------

  private cues(a: Abilities, world: World, flight: Flight, budget: number) {
    const c = a.cue;
    const seen = this.cue;
    if (c.plunge !== seen.plunge) {
      seen.plunge = c.plunge;
      this.host.sound("plunge");
      this.burst(flight.position, flight.velocity, 24 * budget, GOLD, Kind.Star, 6);
    }
    if (c.strike !== seen.strike) {
      seen.strike = c.strike;
      const ring = world.course.rings[a.strikeGate];
      if (ring) {
        const tint = color.set(world.palette.accent).lerp(WHITE, 0.35);
        this.wave(ring.position, ring.normal, ring.radius, 4.2, 0.9, tint);
        this.wave(ring.position, ring.normal, ring.radius * 0.7, 3.2, 1.1, GOLD);
        // Shards thrown out across the gate's plane
        lookAlong(quat, ring.normal);
        for (let k = 0; k < Math.round(50 * budget); k++) {
          const angle = Math.random() * TAU;
          side.set(Math.cos(angle), Math.sin(angle), 0).applyQuaternion(quat);
          at.copy(ring.position).addScaledVector(side, ring.radius * rand(0.6, 1));
          vel.copy(side).multiplyScalar(rand(12, 30)).addScaledVector(ring.normal, rand(2, 10));
          this.particles.emit(at, vel, fx(rand(0.8, 1.5), rand(0.4, 0.8), k % 3 ? WHITE : tint, k % 2 ? Kind.Shard : Kind.Star, 3, 1.4, 1.8));
        }
      }
      this.host.sound("strike");
      this.host.kick(12);
    }
    if (c.shear !== seen.shear) {
      seen.shear = c.shear;
      this.startShear(a, flight, budget);
    }
    if (c.burst !== seen.burst) {
      seen.burst = c.burst;
      this.cast = 0.75;
      this.host.sound("burst");
      this.host.kick(14);
      // A swirl of wind and leaves, and blades spinning out round the pilot
      for (let k = 0; k < Math.round(50 * budget); k++) {
        vel.set(rand(-1, 1), rand(-1, 1), rand(-1, 1)).normalize().multiplyScalar(rand(4, 12)).addScaledVector(flight.forward, rand(6, 20)).addScaledVector(flight.velocity, 0.6);
        this.particles.emit(flight.position, vel, k % 3 ? fx(rand(0.6, 1.1), rand(0.5, 1), ANEMO, Kind.Wisp, 0, 1.5, 0.45) : fx(rand(1, 1.6), rand(0.3, 0.5), LEAF, Kind.Shard, 1, 1.2, 1.2));
      }
      for (let i = 0; i < 3; i++) this.throwBlade("orbit", flight.position, flight.forward, flight.forward, (i * TAU) / 3, 0.7);
      this.wave(flight.position, flight.forward, 1.2, 5, 0.6, ANEMO);
    }
    if (c.recover !== seen.recover) {
      seen.recover = c.recover;
      this.helixT = 0;
      this.helixSpin = a.recoverNormal.dot(flight.right) >= 0 ? -1 : 1;
      for (let k = 0; k < Math.round(46 * budget); k++) {
        vel.set(rand(-1, 1), rand(-1, 1), rand(-1, 1)).normalize().addScaledVector(a.recoverNormal, 1.4).normalize().multiplyScalar(rand(6, 16)).addScaledVector(flight.velocity, 0.3);
        this.particles.emit(a.recoverPoint, vel, k % 3 ? fx(rand(0.35, 0.7), rand(0.25, 0.45), GOLD, Kind.Star, 9, 1, 2.6) : fx(rand(0.5, 0.9), rand(0.4, 0.8), WHITE, Kind.Glow, 0, 3, 2));
      }
      this.host.sound("recover");
      this.host.kick(5);
    }
    if (c.hang !== seen.hang) {
      seen.hang = c.hang;
      this.sigilBurst = -1;
      this.host.sound("hang");
      this.wave(at.copy(flight.position).addScaledVector(UP, -1.4), UP, 0.8, 5, 0.55, GOLD);
    }
    if (c.launch !== seen.launch) {
      seen.launch = c.launch;
      this.sigilBurst = 0;
      this.host.sound("launch");
      this.host.kick(9);
      // Feathers of light thrown back as you push off
      for (let k = 0; k < Math.round(50 * budget); k++) {
        vel.copy(flight.forward).multiplyScalar(-rand(6, 14)).add(tmp.set(rand(-4, 4), rand(-3, 4), rand(-4, 4)));
        this.particles.emit(flight.position, vel, k % 2 ? fx(rand(0.8, 1.4), rand(0.35, 0.6), WHITE, Kind.Shard, 2, 1.5, 1.8) : fx(rand(0.6, 1), rand(0.3, 0.5), GOLD, Kind.Star, 0, 2, 2.4));
      }
    }
  }

  /** A burst of particles round a point */
  private burst(p: THREE.Vector3, velocity: THREE.Vector3, count: number, tint: THREE.Color, kind: Kind, speed: number) {
    for (let k = 0; k < Math.round(count); k++) {
      vel.set(rand(-1, 1), rand(-1, 1), rand(-1, 1)).normalize().multiplyScalar(rand(1, speed)).addScaledVector(velocity, 0.5);
      this.particles.emit(p, vel, fx(rand(0.5, 1), rand(0.3, 0.55), tint, kind, 0, 2, 2.4));
    }
  }

  /** A ring of light that grows out from `center` across `normal` and fades */
  private wave(center: THREE.Vector3, normal: THREE.Vector3, radius: number, grow: number, life: number, tint: THREE.Color) {
    let wave = this.waves.find((w) => w.t >= w.life);
    if (!wave) {
      if (this.waves.length >= 8) return;
      wave = { t: 0, life, center: new THREE.Vector3(), normal: new THREE.Vector3(), radius, grow, tint: new THREE.Color() };
      this.waves.push(wave);
    }
    wave.t = 0;
    wave.life = life;
    wave.center.copy(center);
    wave.normal.copy(normal);
    wave.radius = radius;
    wave.grow = grow;
    wave.tint.copy(tint);
  }

  private updateWaves(dt: number) {
    for (const w of this.waves) {
      if (w.t >= w.life) continue;
      w.t += dt;
      const k = clamp(w.t / w.life, 0, 1);
      const out = 1 - (1 - k) * (1 - k) * (1 - k);
      this.rings.add(w.center, w.normal, w.radius * (1 + w.grow * out), Math.pow(1 - k, 1.5) * 1.2, 0.03 + 0.05 * k, 1, w.tint);
    }
  }

  // --- Featherfalling -------------------------------------------------------------------

  private featherfalling(dt: number, a: Abilities, flight: Flight, budget: number) {
    const has = a.has("featherfalling");
    // Tucked against the back at speed, drifting wide when gliding slowly
    const target = has ? 0.5 + 0.5 * smoothstep(50, 26, flight.speed) : 0;
    this.featherWeight = ease(this.featherWeight, target * (1 - this.avatar.stance.tuck), 3, dt);
    const w = this.featherWeight;
    this.halo.visible = w > 0.02;
    if (!this.halo.visible) return;
    const t = this.time;
    for (let i = 0; i < 3; i++) {
      const angle = t * 0.7 + (i * TAU) / 3;
      const radius = 0.45 + 0.5 * w;
      const f = this.feathers[i];
      f.position.set(Math.cos(angle) * radius, 0.55 + Math.sin(angle) * radius * 0.45 + Math.sin(t * 2.1 + i) * 0.06, 0.45 + Math.sin(angle) * 0.15);
      // Pointing out from the middle, leaning back, fluttering
      f.rotation.set(0.7 + Math.sin(t * 4.7 + i * 2) * 0.12, Math.sin(t * 3.1 + i) * 0.2, angle - Math.PI / 2 + Math.sin(t * 5.3 + i) * 0.1);
      f.scale.setScalar(Math.min(1, w * 1.4));
    }
    // Soft down drifting off: it falls slower than you, so it seems to rise past
    this.downDebt += 9 * w * w * budget * dt;
    for (; this.downDebt >= 1; this.downDebt--) {
      at.copy(flight.position).add(tmp.set(rand(-1, 1), rand(-0.3, 0.8), rand(-0.2, 1)));
      vel.copy(flight.velocity).multiplyScalar(0.82).add(tmp.set(rand(-0.6, 0.6), rand(0, 0.8), rand(-0.6, 0.6)));
      this.particles.emit(at, vel, Math.random() < 0.3 ? fx(rand(1.2, 2), rand(0.25, 0.4), WHITE, Kind.Shard, -0.3, 1.5, 1.3) : fx(rand(1.2, 2), rand(0.18, 0.32), WHITE, Kind.Glow, -0.4, 1.5, 1.5));
    }
  }

  // --- Skim-Booster ------------------------------------------------------------------------

  private skimBooster(dt: number, a: Abilities, flight: Flight, budget: number) {
    const thrill = a.has("skimBooster") ? a.thrill : 0;
    this.thrillTrails[0].push(tipL, span, 0.8 + thrill * 0.4);
    this.thrillTrails[1].push(tipR, span, 0.8 + thrill * 0.4);
    for (const trail of this.thrillTrails) trail.opacity = thrill * 0.95 * ABILITIES_FX.thrill;
    for (let i = 0; i < 2; i++) {
      const flare = this.flares[i];
      flare.visible = thrill > 0.02;
      if (!flare.visible) continue;
      flare.position.copy(i === 0 ? tipL : tipR);
      const flicker = 0.85 + 0.15 * Math.sin(this.time * 31 + i * 2);
      flare.scale.setScalar((0.5 + thrill * 1.6) * flicker);
      flare.material.opacity = thrill * ABILITIES_FX.thrill;
    }
    this.sparkDebt += 80 * thrill * budget * ABILITIES_FX.thrill * dt;
    for (; this.sparkDebt >= 1; this.sparkDebt--) {
      const tip = Math.random() < 0.5 ? tipL : tipR;
      vel.copy(flight.velocity).multiplyScalar(0.3).add(tmp.set(rand(-3, 3), rand(-1, 3), rand(-3, 3)));
      this.particles.emit(tip, vel, fx(rand(0.3, 0.6), rand(0.2, 0.38), Math.random() < 0.5 ? THRILL : GOLD, Kind.Star, 5, 1.2, 2.6));
    }
  }

  // --- Cloud-Surfing ---------------------------------------------------------------------

  private cloudSurfing(dt: number, a: Abilities, world: World, flight: Flight, budget: number) {
    const has = a.has("cloudSurf");
    if (has && this.lanesFor !== a.version) {
      this.lanes?.dispose();
      this.lanes?.mesh.removeFromParent();
      this.lanes = new CloudLanes(world.course, a.lanes, world.palette, world.seed, (x, y, z) => world.distance(x, y, z));
      this.lanesFor = a.version;
      this.group.add(this.lanes.mesh);
    }
    if (this.lanes) {
      this.lanes.mesh.visible = has;
      this.lanes.heat = a.has("thermalVision") ? 0.35 : 0;
    }
    const surf = has ? a.surf : 0;
    if (surf < 0.05) return;
    // A wake of cloud thrown out to both sides and behind, and glitter where the air skims it
    this.wakeDebt += 60 * surf * budget * dt;
    color.set(world.palette.cloud).lerp(WHITE, 0.5);
    for (; this.wakeDebt >= 1; this.wakeDebt--) {
      const s = Math.random() < 0.5 ? 1 : -1;
      at.copy(flight.position).addScaledVector(UP, -rand(1.2, 2.2)).addScaledVector(flight.right, s * rand(0.3, 1.5));
      vel.copy(flight.velocity).multiplyScalar(0.35).addScaledVector(flight.right, s * rand(3, 8)).addScaledVector(UP, rand(0.5, 2.5));
      if (Math.random() < 0.75) this.soft.emit(at, vel, fx(rand(0.9, 1.6), rand(1.4, 2.8), color, Kind.Glow, 0.4, 2.2, 0.85));
      else this.particles.emit(at, vel, fx(rand(0.6, 1), rand(0.2, 0.35), GOLD, Kind.Star, 2, 1.5, 2.2));
    }
  }

  // --- Plunging Attack -------------------------------------------------------------------

  private plunging(dt: number, a: Abilities, flight: Flight, budget: number) {
    const tuck = this.avatar.stance.tuck;
    this.comet.visible = tuck > 0.03;
    if (!this.comet.visible) return;
    // A small bright head just ahead of the hands: the pilot stays readable inside it
    this.comet.position.copy(this.avatar.group.position).addScaledVector(flight.forward, 1.3);
    this.comet.scale.setScalar((1.2 + Math.sin(this.time * 37) * 0.12) * (0.6 + tuck * 0.4));
    this.comet.material.opacity = tuck * 0.5;
    if (a.plunge < 0) return;
    // A falling star's tail
    // A falling star's tail, left hanging in the air behind
    this.cometDebt += 90 * budget * dt;
    for (; this.cometDebt >= 1; this.cometDebt--) {
      at.copy(this.avatar.group.position).add(tmp.set(rand(-0.6, 0.6), rand(-0.6, 0.6), rand(-0.6, 0.6)));
      vel.copy(flight.velocity).multiplyScalar(rand(0.05, 0.2)).add(tmp.set(rand(-1, 1), rand(-1, 1), rand(-1, 1)));
      this.particles.emit(at, vel, Math.random() < 0.7 ? fx(rand(0.5, 0.9), rand(0.25, 0.45), GOLD, Kind.Star, 0, 1, 2.2) : fx(rand(0.3, 0.6), rand(0.25, 0.4), WHITE, Kind.Glow, 0, 2, 1.3));
    }
  }

  // --- Wind-Shear Dash ---------------------------------------------------------------------

  private startShear(a: Abilities, flight: Flight, budget: number) {
    this.host.sound("shear");
    // The afterimage: a ghost of the pilot left where the blink began, fading
    const image = this.afterimages[this.nextAfterimage];
    this.nextAfterimage = (this.nextAfterimage + 1) % this.afterimages.length;
    image.t = 0;
    image.avatar.group.position.copy(a.shearFrom);
    image.avatar.group.quaternion.copy(a.shearQuaternion);
    image.avatar.resetMotion();
    image.avatar.update(1 / 60, flight.speed, 0);
    image.avatar.visible = true;
    side.set(a.shearDirection, 0, 0).applyQuaternion(a.shearQuaternion);
    image.drift.copy(side).multiplyScalar(-1.5).addScaledVector(flight.velocity, 0.15);
    // Crescents of wind sweeping across the blink, leaves and streaks along it
    tmp.set(0, 0, -1).applyQuaternion(a.shearQuaternion);
    this.throwBlade("dash", a.shearFrom, side, tmp, 0, 0.32);
    this.throwBlade("dash", at.copy(a.shearFrom).addScaledVector(UP, 0.6), side, tmp, 0.4, 0.38);
    const length = ABILITY.shearDistance;
    for (let k = 0; k < Math.round(40 * budget); k++) {
      at.copy(a.shearFrom).addScaledVector(side, rand(0, length)).add(tmp2.set(rand(-0.6, 0.6), rand(-0.6, 0.6), rand(-0.6, 0.6)));
      vel.copy(flight.velocity).multiplyScalar(0.4).addScaledVector(side, rand(2, 8)).addScaledVector(UP, rand(0, 2));
      this.particles.emit(at, vel, k % 3 ? fx(rand(0.4, 0.7), rand(0.5, 0.9), ANEMO, Kind.Wisp, 0, 2.5, 0.4) : fx(rand(0.9, 1.5), rand(0.25, 0.45), LEAF, Kind.Shard, 1.5, 1.2, 1.2));
    }
  }

  private throwBlade(kind: Blade["kind"], from: THREE.Vector3, axis: THREE.Vector3, forward: THREE.Vector3, angle: number, life: number) {
    const blade = this.blades.find((b) => b.t < 0) ?? this.blades[0];
    blade.kind = kind;
    blade.t = 0;
    blade.life = life;
    blade.from.copy(from);
    blade.axis.copy(axis);
    blade.forward.copy(forward);
    blade.angle = angle;
    blade.mesh.visible = true;
  }

  private shear(dt: number) {
    for (const image of this.afterimages) {
      if (image.t < 0) continue;
      image.t += dt;
      const k = image.t / 0.5;
      if (k >= 1) {
        image.t = -1;
        image.avatar.visible = false;
        continue;
      }
      image.avatar.group.position.addScaledVector(image.drift, dt);
      image.avatar.fade(0.65 * (1 - k) * (1 - k));
    }
    for (const b of this.blades) {
      if (b.t < 0) continue;
      b.t += dt;
      const k = b.t / b.life;
      if (k >= 1) {
        b.t = -1;
        b.mesh.visible = false;
        continue;
      }
      const m = b.mesh;
      const fade = smoothstep(0, 0.15, k) * (1 - smoothstep(0.55, 1, k));
      m.material.uniforms.opacity.value = fade * 1.3;
      if (b.kind === "dash") {
        // The arc lies across the blink (its head leading along it) and sweeps from where it began to its end
        m.position.copy(b.from).addScaledVector(b.axis, ABILITY.shearDistance * (0.15 + 0.85 * k));
        tmp.copy(b.forward).cross(b.axis).normalize();
        matrix.makeBasis(b.forward, b.axis, tmp);
        m.quaternion.setFromRotationMatrix(matrix);
        m.rotateZ(b.angle);
        m.scale.setScalar(2.2 + k * 1.6);
      } else {
        // Spinning round the pilot's line of flight and growing
        const r = 1.6 + k * 5;
        m.position.copy(this.avatar.group.position);
        lookAlong(m.quaternion, b.forward);
        m.rotateZ(b.angle + k * 7);
        m.scale.setScalar(r);
      }
    }
  }

  // --- Thermal Vision ----------------------------------------------------------------------

  private thermal(dt: number, a: Abilities, world: World, flight: Flight, camera: THREE.Camera, passed: (gate: number) => boolean, budget: number) {
    if (!a.has("thermalVision")) {
      this.reveal = 0;
      return;
    }
    this.reveal += dt;
    const rings = world.course.rings;
    let order = 0;
    for (const ring of rings) {
      if (passed(ring.index)) continue;
      const d = ring.position.distanceTo(camera.position);
      // Near ones are plain to see; the rest light up from near to far as the vision opens
      const shown = smoothstep(40, 130, d) * smoothstep(0, 0.5, this.reveal - order * 0.12) * (1 - smoothstep(2600, 3200, d));
      const next = order === 0;
      if (ring.finish) color.copy(GOLD).multiplyScalar(1.3);
      else if (next) color.copy(HEAT_NEAR).multiplyScalar(1.25);
      else color.copy(HEAT_NEAR).lerp(HEAT_FAR, Math.min(1, order / 6));
      const radius = ring.finish ? ring.radius * 1.4 : ring.radius * 1.25;
      this.markers.add(ring.position, null, radius, shown * (next || ring.finish ? 1 : 0.6) * ABILITIES_FX.thermal, next ? 0.06 : 0.045, 0, color);
      order++;
    }
    // Rising warm air along the line ahead: the thermals you'd read in the air
    this.heatDebt += 22 * budget * ABILITIES_FX.thermal * dt;
    for (; this.heatDebt >= 1; this.heatDebt--) {
      world.course.pointAt(flight.position.z + rand(60, 420), at).add(tmp.set(rand(-28, 28), rand(-18, 4), 0));
      vel.set(rand(-0.5, 0.5), rand(3, 6), rand(-0.5, 0.5));
      this.particles.emit(at, vel, fx(rand(2, 3.2), rand(0.9, 1.8), Math.random() < 0.5 ? HEAT_NEAR : THRILL, Kind.Glow, -0.6, 0.4, 1.4));
    }
  }

  // --- Slipstream Rider: the spirit manta ------------------------------------------------------

  private slipstream(dt: number, a: Abilities, flight: Flight, budget: number) {
    const has = a.has("slipstream");
    const m = a.manta;
    if (has && !this.manta) this.buildManta();
    const model = this.manta;
    if (!model) return;
    if (m.arrivals !== this.arrivals) {
      this.arrivals = m.arrivals;
      this.mantaShown = 0;
      for (const trail of this.mantaTrails) trail.reset();
      if (has) {
        this.burst(m.position, m.tangent, 40 * budget, MANTA_GLOW, Kind.Star, 5);
        this.host.sound("manta");
      }
    }
    this.mantaShown = ease(this.mantaShown, has && m.active ? 1 : 0, has && m.active ? 1.6 : 3, dt);
    const shown = this.mantaShown;
    model.group.visible = shown > 0.01;
    if (!model.group.visible) {
      for (const trail of this.mantaTrails) trail.opacity = 0;
      return;
    }
    // Flapping slowly, wingtips lagging; the body bobs against the stroke and banks into its weave
    this.mantaPhase += dt * TAU * 0.5;
    const ph = this.mantaPhase;
    const g = model.group;
    g.position.copy(m.position).addScaledVector(UP, -Math.sin(ph) * 0.25);
    lookAlong(g.quaternion, m.tangent);
    g.rotateZ(-Math.cos(m.time * 0.35) * 0.18);
    g.rotateX(Math.sin(ph + 0.6) * 0.05);
    g.scale.setScalar(backOut(shown) * (1 + 0.02 * Math.sin(ph * 2)));
    for (let i = 0; i < 2; i++) {
      const s = i === 0 ? -1 : 1;
      model.wings[i].rotation.z = s * (Math.sin(ph) * 0.32 + 0.06);
      model.tips[i].rotation.z = s * Math.sin(ph - 0.9) * 0.5;
    }
    for (let i = 0; i < model.tail.length; i++) model.tail[i].rotation.set(Math.sin(ph - i * 0.8) * 0.12, Math.sin(ph * 0.5 - i * 0.9) * 0.22, 0);
    // Ribbons off the wingtips, a glow round it (warmer and wider with Thermal Vision)
    g.updateWorldMatrix(true, true);
    const thermal = a.has("thermalVision") ? 1 : 0;
    for (let i = 0; i < 2; i++) {
      model.ends[i].getWorldPosition(at);
      tmp.set(0, 1, 0).applyQuaternion(g.quaternion);
      this.mantaTrails[i].push(at, tmp, 1.3);
      this.mantaTrails[i].opacity = shown * 0.75;
    }
    const aura = this.mantaAura!;
    aura.material.opacity = shown * (0.22 + thermal * 0.25);
    aura.material.color.copy(MANTA_GLOW).lerp(HEAT_NEAR, thermal * 0.6).multiplyScalar(1.2);
    aura.scale.setScalar(9 + thermal * 6);
    // The wake: a faint stream of air left behind it, where you want to be
    this.wakeDebtManta += 30 * shown * budget * dt;
    for (; this.wakeDebtManta >= 1; this.wakeDebtManta--) {
      at.copy(m.position).addScaledVector(m.tangent, -rand(1, 5)).add(tmp.set(rand(-1.5, 1.5), rand(-0.8, 0.8), rand(-1.5, 1.5)));
      vel.copy(m.tangent).multiplyScalar(m.speed * rand(0.55, 0.75));
      this.particles.emit(at, vel, fx(rand(0.8, 1.3), rand(1.2, 2.2), MANTA_GLOW, Kind.Wisp, 0, 1, 0.55));
    }
    // In its slipstream: air streaming past you
    const slip = a.slip;
    this.streamDebt += 90 * slip * budget * dt;
    for (; this.streamDebt >= 1; this.streamDebt--) {
      const angle = Math.random() * TAU;
      at.copy(flight.position).addScaledVector(flight.right, Math.cos(angle) * rand(1.2, 2.4)).addScaledVector(flight.up, Math.sin(angle) * rand(1, 2)).addScaledVector(flight.forward, rand(2, 6));
      vel.copy(flight.velocity).multiplyScalar(0.7);
      this.particles.emit(at, vel, fx(rand(0.25, 0.45), rand(0.12, 0.22), MANTA_GLOW, Kind.Glow, 0, 0, 2.2));
    }
  }

  private buildManta() {
    const model = buildManta();
    model.materials.forEach((m) => this.material(m));
    model.geometries.forEach((g) => this.geometry(g));
    const aura = new THREE.Sprite(this.material(new THREE.SpriteMaterial({ map: glowTexture(), color: MANTA_GLOW, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity: 0 })));
    model.group.add(aura);
    model.group.visible = false;
    this.group.add(model.group);
    this.mantaAura = aura;
    this.mantaTrails = [new Trail("#9ff5ff", { width: 0.28, shimmer: 1, length: 1.4 }), new Trail("#9ff5ff", { width: 0.28, shimmer: 1, length: 1.4 })];
    for (const trail of this.mantaTrails) {
      trail.setColor("#c9fbff", "#5fd6ff");
      this.group.add(trail.mesh);
    }
    this.manta = model;
  }

  // --- Gale Force --------------------------------------------------------------------------

  private gale(dt: number, a: Abilities, world: World, flight: Flight, budget: number) {
    const t = a.burst;
    this.tunnel.visible = t >= 0;
    if (t < 0) return;
    const fade = 1 - smoothstep(ABILITY.burstTime, ABILITY.burstTime + 1.5, t);
    const u = this.tunnel.material.uniforms;
    u.reach.value = smoothstep(0, 0.5, t);
    u.opacity.value = fade * 0.8 * ABILITIES_FX.gale;
    u.length.value = ABILITY.burstLength;
    this.tunnel.position.copy(a.burstOrigin);
    lookAlong(this.tunnel.quaternion, a.burstAxis);
    this.tunnel.scale.set(ABILITY.burstRadius, ABILITY.burstRadius, ABILITY.burstLength);
    // Rings of wind round every gate it widened
    for (const index of a.widened) {
      const ring = world.course.rings[index];
      if (ring) this.rings.add(ring.position, ring.normal, ring.radius + ABILITY.burstWiden, fade * 0.9 * ABILITIES_FX.gale, 0.05, 2, ANEMO);
    }
    // Streaks rushing past while you ride it
    if (t < ABILITY.burstTime && a.inTunnel(flight.position)) {
      this.streamDebt += 70 * budget * dt;
      for (; this.streamDebt >= 1; this.streamDebt--) {
        const angle = Math.random() * TAU;
        at.copy(flight.position).addScaledVector(flight.right, Math.cos(angle) * rand(2, 6)).addScaledVector(flight.up, Math.sin(angle) * rand(2, 5)).addScaledVector(flight.forward, rand(4, 14));
        vel.copy(flight.velocity).multiplyScalar(0.5);
        this.particles.emit(at, vel, Math.random() < 0.8 ? fx(rand(0.3, 0.5), rand(0.5, 1), ANEMO, Kind.Wisp, 0, 0, 0.5) : fx(rand(0.8, 1.2), rand(0.25, 0.4), LEAF, Kind.Shard, 0, 1, 1.2));
      }
    }
  }

  // --- Acrobatic Recovery -------------------------------------------------------------------

  private recovery(dt: number) {
    if (this.helixT < 0) {
      this.helix.visible = false;
      return;
    }
    this.helixT += dt;
    const k = this.helixT / 0.6;
    if (k >= 1) {
      this.helixT = -1;
      this.helix.visible = false;
      return;
    }
    this.helix.visible = true;
    const u = this.helix.material.uniforms;
    u.head.value = k * 1.4;
    u.opacity.value = 1 - smoothstep(0.6, 1, k);
    this.helix.rotation.z += dt * 11 * this.helixSpin;
  }

  // --- Hover-Stall ------------------------------------------------------------------------------

  private hoverStall(dt: number, a: Abilities, flight: Flight, budget: number) {
    const hanging = a.hang >= 0;
    const u = this.sigil.material.uniforms;
    if (hanging) {
      this.sigilOpen = Math.min(1, this.sigilOpen + dt / 0.35);
      this.sigilBurst = -1;
    } else if (this.sigilBurst >= 0) {
      this.sigilBurst += dt;
      if (this.sigilBurst > 0.45) {
        this.sigilBurst = -1;
        this.sigilOpen = 0;
      }
    } else {
      this.sigilOpen = 0;
    }
    const showing = hanging || this.sigilBurst >= 0;
    this.sigil.visible = showing && this.sigilOpen > 0;
    this.chevrons.visible = hanging;
    if (!showing) return;
    // Under the pilot, flat, turning slowly; its outer ring runs down with the time left
    const burst = this.sigilBurst >= 0 ? this.sigilBurst / 0.45 : 0;
    if (hanging) this.sigil.position.copy(this.avatar.group.position).addScaledVector(UP, -1.5);
    this.sigil.rotation.y += dt * 0.4;
    this.sigil.scale.setScalar(3.4 * backOut(this.sigilOpen) * (1 + burst * 0.8));
    u.opacity.value = (1 - burst) * 0.85;
    u.progress.value = hanging ? 1 - a.hang / ABILITY.hangTime : 0;
    if (!hanging) return;
    // Chevrons where you'll launch, pulsing outwards
    this.chevrons.position.copy(this.avatar.group.position).addScaledVector(flight.forward, 2.6);
    lookAlong(this.chevrons.quaternion, flight.forward);
    this.chevrons.material.opacity = (0.55 + 0.35 * Math.sin(this.time * 9)) * this.sigilOpen;
    // Downwash: air pushed out under the fluttering wings
    this.downwashDebt += 25 * budget * dt;
    for (; this.downwashDebt >= 1; this.downwashDebt--) {
      const angle = Math.random() * TAU;
      side.set(Math.cos(angle), 0, Math.sin(angle));
      at.copy(this.avatar.group.position).addScaledVector(UP, -rand(0.6, 1.4)).addScaledVector(side, rand(0.3, 1.2));
      vel.copy(side).multiplyScalar(rand(3, 7)).addScaledVector(UP, -rand(1, 3));
      this.particles.emit(at, vel, Math.random() < 0.85 ? fx(rand(0.5, 0.9), rand(0.6, 1.1), WHITE, Kind.Wisp, 0, 2.5, 0.3) : fx(rand(0.8, 1.2), rand(0.25, 0.4), GOLD, Kind.Star, 0.5, 2, 2));
    }
  }

  dispose() {
    this.group.removeFromParent();
    this.halo.removeFromParent();
    this.helix.removeFromParent();
    this.comet.removeFromParent();
    this.flares.forEach((f) => f.removeFromParent());
    this.thrillTrails.forEach((t) => {
      t.mesh.removeFromParent();
      t.dispose();
    });
    this.mantaTrails.forEach((t) => t.dispose());
    this.afterimages.forEach((i) => i.avatar.dispose());
    this.lanes?.dispose();
    this.rings.dispose();
    this.markers.dispose();
    for (const mesh of [this.tunnel, this.helix, this.sigil]) {
      mesh.geometry.dispose();
      mesh.material.dispose();
    }
    this.materials.forEach((m) => m.dispose());
    this.geometries.forEach((g) => g.dispose());
  }
}
