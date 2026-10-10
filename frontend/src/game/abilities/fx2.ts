import * as THREE from "three";
import { type Avatar, glowTexture } from "../avatar";
import type { Flight } from "../flight";
import { Builder, leaf } from "../items/models";
import { clamp, smoothstep } from "../math";
import { Kind, type Particles, fx } from "../particles";
import { ABILITY, type Abilities, ECHO_SAMPLES } from "../run/abilities";
import { toonMaterial } from "../toon";
import { Trail } from "../trail";
import { ABILITIES_FX } from "../tuning";
import type { World } from "../world/World";
import { RingQuads } from "./models";
import { Ribbon, Swarm, cushionMesh, funnelMesh, pipGeometry, songMesh } from "./models2";

// What the design list's abilities 11 to 20 look like (their rules:
// run/abilities.ts). Looks only: this reads the abilities' state and never
// changes the flight. (The first ten are in fx.ts.)
//  - Moth's Attraction: spirit moths circle the next gate's heart; thread it
//    and they swirl round you; a bullseye rings the gate in gold.
//  - Zenith Climber: on a steep climb the pilot reaches for the sky on hard
//    wingbeats inside a funnel of rushing wind, shedding gold; the apex of a
//    long climb flashes like a star.
//  - Resonance: head thrown back, arms open, a call of light; a cap of
//    ripples and notes rolls out ahead, and every gate it reaches turns to
//    face you with a chime and a ring of notes.
//  - Ley-Line Surger: crystal pips orbit you, one per gate of the chain; five,
//    and a ley line of flowing runes lights up along the course ahead, your
//    wingtips stream violet and gold; when it breaks, the pips shatter.
//  - Aero-Braking: the pilot rears up, cape and wings thrown forward against a
//    cushion of pressed air that spills round the rim.
//  - Draft-Weaving: tight spirals gather wisps round you; full, a little
//    tornado of streaks and leaves wraps you; a glancing hit bursts it.
//  - Ascension: a column of wind like Genshin's wind currents bursts up from
//    where you were, a ring across the ground below, leaves spiralling up.
//  - Falcon Stance: a falcon of light swoops onto you and merges; wings tucked,
//    long contrails off the wingtips.
//  - Butterfly Stance: a great butterfly of light unfolds behind you and
//    scatters into small ones that flutter round you; cape and wings spread.
//  - Echo-Trail: a ribbon of light behind you, fading; close a circle across it
//    and the circle flashes and becomes a ring of wind where you drew it.

export type AbilitySound2 =
  | "moth" | "bullseye" | "apex" | "sing" | "attune" | "ley" | "leyEnd" | "flare" | "tornado" | "shield" | "ascend" | "falcon" | "butterfly" | "stanceOff" | "echo" | "echoPass";

export interface AbilityFx2Host {
  kick(degrees?: number): void;
  sound(kind: AbilitySound2, pitch?: number): void;
  /** Turns a gate's crystals and veil to face along `normal` (looks only) */
  turnGate(index: number, normal: THREE.Vector3): void;
}

const TAU = Math.PI * 2;
const WHITE = new THREE.Color("#ffffff");
const GOLD = new THREE.Color("#ffe39a");
const ANEMO = new THREE.Color("#7df5d8");
const LEAF = new THREE.Color("#8ee8b0");
const LILAC = new THREE.Color("#c9b6ff");
const SONG = new THREE.Color("#d8c4ff");
const LEY_VIOLET = new THREE.Color("#b07cff");
const PINK = new THREE.Color("#ffc4e6");
const UP = new THREE.Vector3(0, 1, 0);
const ORIGIN = new THREE.Vector3();

const at = new THREE.Vector3();
const vel = new THREE.Vector3();
const tmp = new THREE.Vector3();
const tmp2 = new THREE.Vector3();
const side = new THREE.Vector3();
const dir = new THREE.Vector3();
const tipL = new THREE.Vector3();
const tipR = new THREE.Vector3();
const span = new THREE.Vector3();
const color = new THREE.Color();
const matrix = new THREE.Matrix4();
const quat = new THREE.Quaternion();
const quat2 = new THREE.Quaternion();
const scale = new THREE.Vector3();
const rand = (min: number, max: number) => min + Math.random() * (max - min);
const ease = (current: number, target: number, rate: number, dt: number) => current + (target - current) * (1 - Math.exp(-rate * dt));
const backOut = (t: number) => {
  const x = clamp(t, 0, 1) - 1;
  return 1 + 2.7 * x * x * x + 1.7 * x * x;
};
/** `out` turned so its -z looks along `direction` */
const lookAlong = (out: THREE.Quaternion, direction: THREE.Vector3) =>
  out.setFromRotationMatrix(matrix.lookAt(ORIGIN, direction, Math.abs(direction.y) > 0.98 ? tmp2.set(0, 0, 1) : UP));
/** A creature's matrix: at `p`, heading along `heading`, banked `bank` rad, `size` m */
const place = (p: THREE.Vector3, heading: THREE.Vector3, bank: number, size: number) => {
  lookAlong(quat, heading);
  quat2.setFromAxisAngle(tmp.set(0, 0, 1), bank);
  quat.multiply(quat2);
  return matrix.compose(p, quat, scale.setScalar(size));
};

interface Wave {
  t: number;
  delay: number;
  life: number;
  center: THREE.Vector3;
  normal: THREE.Vector3;
  radius: number;
  grow: number;
  tint: THREE.Color;
}

/** A gate turning to face you (Resonance) */
interface Turn {
  index: number;
  t: number;
  from: THREE.Vector3;
  to: THREE.Vector3;
  now: THREE.Vector3;
}

/** A creature flying a scripted path (moths after a threaded gate) */
interface Flyer {
  t: number;
  life: number;
  angle: number;
  radius: number;
  height: number;
  rate: number;
  phase: number;
}

const GATE_MOTHS = 6;
const SWIRL_MOTHS = 10;
const SMALL_BUTTERFLIES = 5;

export class AbilityFx2 {
  /** Everything placed in the world (the level's): hidden with it inside a wormhole */
  readonly group = new THREE.Group();
  /** Inside a wormhole the level is hidden, and so is everything in `group` */
  inWormhole = false;
  private readonly avatar: Avatar;
  private readonly particles: Particles;
  private readonly soft: Particles;
  private readonly host: AbilityFx2Host;
  private readonly disposables: { dispose(): void }[] = [];
  private time = 0;
  private active = false;
  private version = -1;
  private readonly cue = {
    moth: 0, bullseye: 0, apex: 0, sing: 0, ley: 0, leyEnd: 0, flare: 0, tornado: 0, shield: 0, ascend: 0, stance: 0, echo: 0, echoPass: 0,
  };
  private readonly rings = new RingQuads(24, true);
  private readonly waves: Wave[] = [];

  // Moth's Attraction
  private readonly moths = new Swarm("moth", GATE_MOTHS + SWIRL_MOTHS);
  private readonly heart: THREE.Sprite;
  private readonly swirl: Flyer[] = [];
  private swirlGate = new THREE.Vector3();
  // Zenith Climber
  private readonly updraft = funnelMesh({ mouth: 0.55, end: 1.7, color: "#fff1c4", twist: 0.15, flow: 2.2, spin: 0.6, streaks: 9 });
  private updraftShown = 0;
  private featherDebt = 0;
  // Resonance
  private readonly song = songMesh((ABILITY.songCone * Math.PI) / 180, SONG, GOLD);
  private readonly call: THREE.Sprite;
  private callT = -1;
  private singing = 0;
  private readonly turns: Turn[] = [];
  private attunedSeen = 0;
  // Ley-Line Surger
  private readonly pips: THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>[] = [];
  private readonly ley = new Ribbon(72, "#fff2c2", "#b07cff", "#ffffff", true);
  private leyShown = 0;
  private leyFlare = 0;
  private readonly leyTrails: Trail[];
  private runeDebt = 0;
  // Aero-Braking
  private readonly cushion = cushionMesh("#dff9ff");
  private cushionT = -1;
  private spillDebt = 0;
  // Draft-Weaving
  private readonly tornado = funnelMesh({ mouth: 1.2, end: 2.5, color: "#bff7e6", twist: 1.3, flow: 1.4, spin: 9, streaks: 4 });
  private readonly leaves: THREE.InstancedMesh;
  private tornadoShown = 0;
  private gatherDebt = 0;
  // Ascension
  private readonly column = funnelMesh({ mouth: 2.6, end: 1.6, color: "#c9fff0", twist: 0.35, flow: 3, spin: 1.2, streaks: 7, rings: true });
  private columnT = -1;
  private readonly columnAt = new THREE.Vector3();
  private riseDebt = 0;
  // Gliding stances
  private readonly falconSpirit = new Swarm("falcon", 1);
  private readonly butterflies = new Swarm("butterfly", SMALL_BUTTERFLIES + 1);
  private readonly contrails: Trail[];
  private spiritT = -1;
  private spirit: "falcon" | "butterfly" = "falcon";
  private pollenDebt = 0;
  // Echo-Trail
  private readonly echo = new Ribbon(ECHO_SAMPLES, "#ffffff", "#b9a6ff", "#ffe39a", false);
  private echoFlash = 0;

  constructor(scene: THREE.Scene, avatar: Avatar, particles: Particles, soft: Particles, host: AbilityFx2Host) {
    this.avatar = avatar;
    this.particles = particles;
    this.soft = soft;
    this.host = host;
    scene.add(this.group);

    const sprite = (tint: THREE.Color) => {
      const material = new THREE.SpriteMaterial({ map: glowTexture(), color: tint, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity: 0 });
      this.disposables.push(material);
      const s = new THREE.Sprite(material);
      s.visible = false;
      return s;
    };
    this.heart = sprite(GOLD.clone().multiplyScalar(1.4));
    this.call = sprite(new THREE.Color(1.05, 0.95, 1.25));

    // The ley line's pips: little crystals of light that bloom
    const pip = pipGeometry();
    const pipMaterial = new THREE.MeshBasicMaterial({ color: new THREE.Color(0.95, 0.55, 1.6), transparent: true, opacity: 0.95, depthWrite: false });
    this.disposables.push(pip, pipMaterial);
    for (let i = 0; i < ABILITY.leyGates - 1; i++) {
      const mesh = new THREE.Mesh(pip, pipMaterial);
      mesh.visible = false;
      mesh.scale.setScalar(0.32);
      this.pips.push(mesh);
      this.group.add(mesh);
    }
    this.leyTrails = [0, 1].map(() => {
      const trail = new Trail("#c99cff", { width: 0.16, shimmer: 1.6, length: 1 });
      trail.setColor("#ffe7a8", "#9a6bff");
      scene.add(trail.mesh);
      return trail;
    });
    this.contrails = [0, 1].map(() => {
      const trail = new Trail("#ffffff", { width: 0.07, shimmer: 0.3, length: 1.8 });
      trail.setColor("#ffffff", "#ffe0a0");
      scene.add(trail.mesh);
      return trail;
    });

    // The tornado's leaves: one instanced mesh, toon-shaded like the rest of the world
    const leafGeometry = new Builder().add(leaf(0.34, 0.14, 0.01), (p, out) => out.set("#9df2b9").lerp(color.set("#f5ffd9"), clamp(p.y / 0.34, 0, 1)), 0.4).build();
    const leafMaterial = toonMaterial({ rim: 0.6, side: THREE.DoubleSide });
    this.disposables.push(leafGeometry, leafMaterial);
    this.leaves = new THREE.InstancedMesh(leafGeometry, leafMaterial, 12);
    this.leaves.frustumCulled = false;
    this.leaves.visible = false;

    this.group.add(
      this.rings.mesh, this.moths.mesh, this.heart, this.updraft, this.song, this.call, this.ley.mesh, this.cushion,
      this.tornado, this.leaves, this.column, this.falconSpirit.mesh, this.butterflies.mesh, this.echo.mesh,
    );
    this.disposables.push(this.rings, this.moths, this.ley, this.falconSpirit, this.butterflies, this.echo);
    for (const mesh of [this.updraft, this.song, this.cushion, this.tornado, this.column]) this.disposables.push(mesh.geometry, mesh.material);
    for (let i = 0; i < SWIRL_MOTHS; i++) this.swirl.push({ t: -1, life: 1.6, angle: 0, radius: 2, height: 0, rate: 8, phase: 0 });
  }

  /** Before the avatar animates: these abilities' poses (eased in and out) */
  pose(dt: number, a: Abilities | null) {
    if (dt <= 0) return;
    const st = this.avatar.stance;
    this.singing = Math.max(0, this.singing - dt);
    const climbing = a ? Math.max(a.has("zenith") ? a.zenithClimb * 0.85 : 0, a.ascend >= 0 ? 1 : 0) : 0;
    st.climb = ease(st.climb, climbing, 6, dt);
    st.sing = ease(st.sing, this.singing > 0 ? 1 : 0, this.singing > 0 ? 12 : 4, dt);
    const flaring = a && a.flare >= 0 && a.flare < ABILITY.flareTime + 0.2 ? 1 : 0;
    st.flare = ease(st.flare, flaring, flaring ? 16 : 4, dt);
    st.falcon = a ? smoothstep(0, 1, a.falcon) : ease(st.falcon, 0, 6, dt);
    st.butterfly = a ? smoothstep(0, 1, a.butterfly) : ease(st.butterfly, 0, 6, dt);
  }

  /** Not in a run, crashed, or in a race: nothing shows */
  hide() {
    if (!this.active) return;
    this.active = false;
    const st = this.avatar.stance;
    st.climb = st.sing = st.flare = st.falcon = st.butterfly = 0;
    this.group.visible = false;
    for (const trail of [...this.leyTrails, ...this.contrails]) trail.opacity = 0;
  }

  /** After the avatar and its effects animated: everything else */
  update(dt: number, a: Abilities, world: World, flight: Flight, camera: THREE.Camera, passed: (gate: number) => boolean, flying: boolean) {
    this.active = true;
    this.group.visible = !this.inWormhole;
    this.time += dt;
    const avatar = this.avatar;
    avatar.group.updateWorldMatrix(true, true);
    avatar.wingtips(tipL, tipR);
    avatar.span(span);
    const budget = this.particles.budget * (flying ? 1 : 0);
    if (a.version !== this.version) {
      this.version = a.version;
      this.waves.length = 0;
      this.turns.length = 0;
      this.attunedSeen = 0;
      this.columnT = -1;
      for (const s of this.swirl) s.t = -1;
    }
    this.rings.begin();
    this.moths.begin();
    this.butterflies.begin();
    this.falconSpirit.begin();
    this.cues(a, world, flight, budget);
    this.mothsAt(dt, a, world, flight, camera, passed);
    this.zenith(dt, a, flight, budget);
    this.resonance(dt, a, world, flight);
    this.leyLine(dt, a, world, flight, camera, passed, budget);
    this.aeroBrake(dt, a, flight, budget);
    this.draftWeave(dt, a, flight, budget);
    this.ascension(dt, a, budget);
    this.stances(dt, a, flight, budget);
    this.echoTrail(dt, a);
    this.updateWaves(dt);
    this.rings.end();
    this.moths.end();
    this.butterflies.end();
    this.falconSpirit.end();
  }

  // --- one-off moments ----------------------------------------------------------------

  private cues(a: Abilities, world: World, flight: Flight, budget: number) {
    const c = a.cue;
    const seen = this.cue;
    const pilot = this.avatar.group.position;
    if (c.moth !== seen.moth) {
      seen.moth = c.moth;
      const ring = world.course.rings[a.mothGate];
      if (ring) {
        // The gate's moths take off after you: more of them, the nearer the heart
        this.swirlGate.copy(ring.position);
        const count = Math.round(4 + 6 * a.mothHeart);
        for (let i = 0; i < count && i < this.swirl.length; i++) {
          const s = this.swirl[i];
          s.t = 0;
          s.life = rand(1.3, 2);
          s.angle = rand(0, TAU);
          s.radius = rand(1.6, 3);
          s.height = rand(-0.8, 1);
          s.rate = rand(7, 10);
          s.phase = rand(0, TAU);
        }
        this.host.sound("moth", 0.8 + a.mothHeart * 0.5);
      }
    }
    if (c.bullseye !== seen.bullseye) {
      seen.bullseye = c.bullseye;
      const ring = world.course.rings[a.mothGate];
      if (ring) {
        const normal = a.gateNormal(ring);
        this.wave(ring.position, normal, ring.radius * 0.25, 4.5, 0.8, GOLD);
        this.wave(ring.position, normal, ring.radius * 0.1, 3, 0.6, WHITE, 0.1);
        this.burst(ring.position, flight.velocity, 30 * budget, GOLD, Kind.Star, 8);
      }
      this.host.sound("bullseye");
      this.host.kick(6);
    }
    if (c.apex !== seen.apex) {
      seen.apex = c.apex;
      this.wave(a.apexPoint, UP, 0.8, 6, 0.7, GOLD);
      for (let k = 0; k < Math.round(36 * budget); k++) {
        vel.set(rand(-1, 1), rand(-0.4, 1), rand(-1, 1)).normalize().multiplyScalar(rand(3, 9)).addScaledVector(flight.velocity, 0.4);
        this.particles.emit(a.apexPoint, vel, k % 3 ? fx(rand(0.6, 1.1), rand(0.3, 0.55), GOLD, Kind.Star, 2, 1.5, 2.4) : fx(rand(0.9, 1.4), rand(0.3, 0.45), WHITE, Kind.Shard, 3, 1, 1.6));
      }
      this.host.sound("apex");
    }
    if (c.sing !== seen.sing) {
      seen.sing = c.sing;
      this.singing = 0.9;
      this.callT = 0;
      // Three rings of the call, rolling out ahead one after another
      for (let i = 0; i < 3; i++) this.wave(a.songOrigin, a.songAxis, 1.2, 6 + i * 2, 0.9, i === 1 ? GOLD : SONG, i * 0.14);
      for (let k = 0; k < Math.round(30 * budget); k++) {
        vel.set(rand(-1, 1), rand(-1, 1), rand(-1, 1)).normalize().multiplyScalar(rand(2, 6)).addScaledVector(a.songAxis, rand(8, 20)).addScaledVector(flight.velocity, 0.5);
        this.particles.emit(pilot, vel, fx(rand(0.6, 1.1), rand(0.3, 0.5), k % 2 ? SONG : GOLD, Kind.Star, 0, 1.5, 2.2));
      }
      this.host.sound("sing");
    }
    if (c.ley !== seen.ley) {
      seen.ley = c.ley;
      this.leyFlare = 1;
      this.wave(pilot, flight.forward, 1, 7, 0.8, LEY_VIOLET);
      this.burst(pilot, flight.velocity, 40 * budget, LEY_VIOLET, Kind.Star, 7);
      for (const trail of this.leyTrails) trail.reset();
      this.host.sound("ley");
      this.host.kick(6);
    }
    if (c.leyEnd !== seen.leyEnd) {
      seen.leyEnd = c.leyEnd;
      // The ley line breaks: the pips shatter
      for (let k = 0; k < Math.round(30 * budget); k++) {
        vel.set(rand(-1, 1), rand(-1, 1), rand(-1, 1)).normalize().multiplyScalar(rand(2, 7)).addScaledVector(flight.velocity, 0.6);
        this.particles.emit(pilot, vel, fx(rand(0.5, 0.9), rand(0.2, 0.38), LEY_VIOLET, Kind.Shard, 4, 1.5, 2));
      }
      this.host.sound("leyEnd");
    }
    if (c.flare !== seen.flare) {
      seen.flare = c.flare;
      this.cushionT = 0;
      this.spillDebt = 0;
      // Feathers knocked loose by the flare, and a puff of air thrown out ahead
      for (let k = 0; k < Math.round(8 * budget); k++) {
        vel.copy(flight.right).multiplyScalar((k % 2 ? -1 : 1) * rand(2, 5)).add(tmp.set(rand(-1, 1), rand(0, 2), rand(-1, 1))).addScaledVector(flight.velocity, 0.5);
        this.particles.emit(k % 2 ? tipL : tipR, vel, fx(rand(1.2, 1.8), rand(0.14, 0.22), WHITE, Kind.Shard, 1.2, 1.4, 0.9));
      }
      this.host.sound("flare");
      this.host.kick(4);
    }
    if (c.tornado !== seen.tornado) {
      seen.tornado = c.tornado;
      this.tornadoShown = 0;
      this.wave(pilot, flight.forward, 1.2, 3.5, 0.6, ANEMO);
      this.host.sound("tornado");
    }
    if (c.shield !== seen.shield) {
      seen.shield = c.shield;
      this.tornadoShown = 0;
      this.wave(a.shieldPoint, a.shieldNormal, 1.2, 5, 0.6, ANEMO);
      this.wave(pilot, flight.forward, 2.4, 3, 0.5, WHITE);
      for (let k = 0; k < Math.round(50 * budget); k++) {
        const angle = rand(0, TAU);
        side.set(Math.cos(angle), Math.sin(angle), 0);
        lookAlong(quat, flight.forward);
        side.applyQuaternion(quat);
        vel.copy(side).multiplyScalar(rand(6, 14)).addScaledVector(flight.velocity, 0.6);
        at.copy(pilot).addScaledVector(side, rand(1, 2.2));
        this.particles.emit(at, vel, k % 3 ? fx(rand(0.5, 0.9), rand(0.5, 0.9), ANEMO, Kind.Wisp, 0, 2, 0.5) : fx(rand(1, 1.6), rand(0.3, 0.45), LEAF, Kind.Shard, 1.5, 1.2, 1.2));
      }
      this.host.sound("shield");
      this.host.kick(7);
    }
    if (c.ascend !== seen.ascend) {
      seen.ascend = c.ascend;
      this.columnT = 0;
      this.columnAt.copy(a.ascendOrigin);
      this.wave(tmp.copy(a.ascendOrigin).addScaledVector(UP, -1), UP, 1.5, 6, 0.8, ANEMO);
      this.wave(a.ascendOrigin, UP, 2.4, 3.5, 0.6, WHITE, 0.08);
      for (let k = 0; k < Math.round(40 * budget); k++) {
        const angle = rand(0, TAU);
        at.copy(a.ascendOrigin).add(tmp.set(Math.cos(angle) * rand(0.5, 2.5), rand(-1.5, 0), Math.sin(angle) * rand(0.5, 2.5)));
        vel.set(-Math.sin(angle) * rand(2, 5), rand(10, 26), Math.cos(angle) * rand(2, 5));
        this.particles.emit(at, vel, k % 3 ? fx(rand(0.6, 1.1), rand(0.5, 1), ANEMO, Kind.Wisp, 0, 1.5, 0.5) : fx(rand(1, 1.8), rand(0.3, 0.45), LEAF, Kind.Shard, 1, 1, 1.2));
      }
      this.host.sound("ascend");
      this.host.kick(8);
    }
    if (c.stance !== seen.stance) {
      seen.stance = c.stance;
      if (a.stance === "none") {
        this.burst(pilot, flight.velocity, 24 * budget, WHITE, Kind.Glow, 4);
        this.host.sound("stanceOff");
      } else {
        this.spirit = a.stance;
        this.spiritT = 0;
        this.host.sound(a.stance);
      }
    }
    if (c.echo !== seen.echo) {
      seen.echo = c.echo;
      this.echoFlash = 1;
      const r = a.echoRing;
      this.wave(r.center, r.normal, r.radius * 0.6, 1.2, 0.9, LILAC);
      this.wave(pilot, flight.forward, 1, 5, 0.6, ANEMO);
      this.burst(pilot, flight.velocity, 30 * budget, LILAC, Kind.Star, 6);
      this.host.sound("echo");
      this.host.kick(8);
    }
    if (c.echoPass !== seen.echoPass) {
      seen.echoPass = c.echoPass;
      const r = a.echoRing;
      this.wave(r.center, r.normal, r.radius, 0.8, 0.6, ANEMO);
      this.host.sound("echoPass");
      this.host.kick(5);
    }
  }

  /** A burst of particles round a point */
  private burst(p: THREE.Vector3, velocity: THREE.Vector3, count: number, tint: THREE.Color, kind: Kind, speed: number) {
    for (let k = 0; k < Math.round(count); k++) {
      vel.set(rand(-1, 1), rand(-1, 1), rand(-1, 1)).normalize().multiplyScalar(rand(1, speed)).addScaledVector(velocity, 0.5);
      this.particles.emit(p, vel, fx(rand(0.5, 1), rand(0.3, 0.55), tint, kind, 0, 2, 2.4));
    }
  }

  /** A ring of light that grows out from `center` across `normal` and fades, after `delay` s */
  private wave(center: THREE.Vector3, normal: THREE.Vector3, radius: number, grow: number, life: number, tint: THREE.Color, delay = 0) {
    let wave = this.waves.find((w) => w.t >= w.life);
    if (!wave) {
      if (this.waves.length >= 12) return;
      wave = { t: 0, delay: 0, life, center: new THREE.Vector3(), normal: new THREE.Vector3(), radius, grow, tint: new THREE.Color() };
      this.waves.push(wave);
    }
    wave.t = 0;
    wave.delay = delay;
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
      if (w.delay > 0) {
        w.delay -= dt;
        continue;
      }
      w.t += dt;
      const k = clamp(w.t / w.life, 0, 1);
      const out = 1 - (1 - k) * (1 - k) * (1 - k);
      this.rings.add(w.center, w.normal, w.radius * (1 + w.grow * out), Math.pow(1 - k, 1.5) * 1.1, 0.03 + 0.05 * k, 3, w.tint);
    }
  }

  // --- Moth's Attraction ---------------------------------------------------------------

  private mothsAt(dt: number, a: Abilities, world: World, flight: Flight, camera: THREE.Camera, passed: (gate: number) => boolean) {
    const has = a.has("moth");
    const strength = ABILITIES_FX.moths;
    // Round the next gate's heart: a slow dance of figure eights, the heart glowing between them
    let next = -1;
    if (has) for (const ring of world.course.rings) if (!passed(ring.index)) { next = ring.index; break; }
    const ring = next >= 0 ? world.course.rings[next] : null;
    const near = ring ? 1 - smoothstep(220, 380, ring.position.distanceTo(camera.position)) : 0;
    this.heart.visible = near > 0.01 && strength > 0;
    if (ring && near > 0.01) {
      const normal = a.gateNormal(ring);
      lookAlong(quat, normal);
      const r = Math.min(2.6, ring.radius * 0.28);
      this.heart.position.copy(ring.position);
      this.heart.scale.setScalar(r * (1.5 + 0.2 * Math.sin(this.time * 3)));
      this.heart.material.opacity = near * 0.45 * strength;
      for (let i = 0; i < GATE_MOTHS; i++) {
        const t = this.time * (0.55 + i * 0.04) + (i * TAU) / GATE_MOTHS;
        const k = r * (0.75 + 0.25 * Math.sin(t * 1.7 + i));
        at.set(Math.cos(t) * k, Math.sin(2 * t) * k * 0.45, Math.sin(t * 1.3 + i) * 0.6).applyQuaternion(quat).add(ring.position);
        // Heading along the path: the derivative, roughly
        dir.set(-Math.sin(t) * k, Math.cos(2 * t) * k * 0.9, Math.cos(t * 1.3 + i) * 0.8).applyQuaternion(quat).normalize();
        this.moths.add(place(at, dir, Math.sin(t * 2) * 0.4, 0.55), i * 1.7, 8 + (i % 3), 0.75, near * strength);
      }
    }
    // Threaded: the gate's moths swirl round you, then fall behind and fade
    const pilot = this.avatar.group.position;
    for (const s of this.swirl) {
      if (s.t < 0) continue;
      s.t += dt;
      const k = s.t / s.life;
      if (k >= 1) {
        s.t = -1;
        continue;
      }
      const angle = s.angle + s.t * 5.5;
      const radius = s.radius * (1 - 0.45 * k);
      lookAlong(quat, flight.forward);
      side.set(Math.cos(angle) * radius, Math.sin(angle) * radius * 0.7 + s.height, 0.5 + k * k * 6).applyQuaternion(quat);
      // Flying out from the gate to you over the first moment
      at.lerpVectors(this.swirlGate, tmp.copy(pilot).add(side), smoothstep(0, 0.25, k));
      dir.set(-Math.sin(angle), Math.cos(angle) * 0.7, -1.2).applyQuaternion(quat).normalize();
      this.moths.add(place(at, dir, 0.6, 0.45), s.phase, s.rate, 0.85, (1 - smoothstep(0.65, 1, k)) * strength);
      if (Math.random() < dt * 14) this.particles.emit(at, tmp.copy(flight.velocity).multiplyScalar(0.6), fx(0.5, 0.18, GOLD, Kind.Glow, 0, 2, 1.8));
    }
  }

  // --- Zenith Climber ----------------------------------------------------------------------

  private zenith(dt: number, a: Abilities, flight: Flight, budget: number) {
    const climb = Math.max(a.has("zenith") ? a.zenithClimb : 0, a.ascend >= 0 ? 1 : 0);
    this.updraftShown = ease(this.updraftShown, climb, climb > this.updraftShown ? 6 : 3, dt);
    const shown = this.updraftShown * ABILITIES_FX.wind;
    this.updraft.visible = shown > 0.02;
    if (!this.updraft.visible) return;
    // Behind the pilot, along the path: the air rushing down past you as you climb
    const pilot = this.avatar.group.position;
    dir.copy(flight.velocity).normalize().negate();
    if (!Number.isFinite(dir.x) || dir.lengthSq() < 0.5) dir.copy(flight.forward).negate();
    this.updraft.position.copy(pilot).addScaledVector(dir, -0.6);
    lookAlong(this.updraft.quaternion, dir);
    this.updraft.scale.set(1, 1, 7);
    this.updraft.material.uniforms.opacity.value = shown * 0.75;
    // Feathers of gold shed on the hard wingbeats
    this.featherDebt += 14 * shown * budget * dt;
    for (; this.featherDebt >= 1; this.featherDebt--) {
      at.copy(Math.random() < 0.5 ? tipL : tipR);
      vel.copy(flight.velocity).multiplyScalar(0.5).add(tmp.set(rand(-1.5, 1.5), rand(-2, 0), rand(-1.5, 1.5)));
      this.particles.emit(at, vel, Math.random() < 0.5 ? fx(rand(0.8, 1.3), rand(0.22, 0.34), GOLD, Kind.Shard, 2, 1.5, 1.5) : fx(rand(0.5, 0.8), rand(0.2, 0.3), WHITE, Kind.Star, 0, 2, 2));
    }
  }

  // --- Resonance ------------------------------------------------------------------------------

  private resonance(dt: number, a: Abilities, world: World, flight: Flight) {
    // The song: a cap of ripples and notes rolling out ahead
    const strength = ABILITIES_FX.song;
    this.song.visible = a.song >= 0 && strength > 0;
    if (this.song.visible) {
      const front = Math.max(1, Math.min(ABILITY.songRange, a.song * ABILITY.songSpeed));
      this.song.position.copy(a.songOrigin);
      lookAlong(this.song.quaternion, a.songAxis);
      this.song.scale.setScalar(front);
      this.song.material.uniforms.opacity.value = (smoothstep(0, 0.08, a.song) * (1 - smoothstep(ABILITY.songRange * 0.6, ABILITY.songRange, front))) * 0.85 * strength;
    }
    // The call: a burst of light at the pilot, like Sky's honk
    this.call.visible = this.callT >= 0;
    if (this.callT >= 0) {
      this.callT += dt;
      const k = this.callT / 0.6;
      if (k >= 1) this.callT = -1;
      else {
        this.call.position.copy(this.avatar.group.position).addScaledVector(flight.forward, 0.6).addScaledVector(UP, 0.3);
        // A small bright note of light just ahead of the face: the pilot stays readable behind it
        this.call.scale.setScalar(0.8 + backOut(k * 1.6) * 1.1);
        this.call.material.opacity = (1 - k) * (1 - k) * 0.55 * strength;
      }
    }
    // Gates that heard it: turn to face you, chime, wear a ring of notes for a while
    if (a.attuned.size !== this.attunedSeen) {
      let i = 0;
      for (const [index, normal] of a.attuned) {
        if (i++ < this.attunedSeen) continue;
        const ring = world.course.rings[index];
        if (!ring) continue;
        const turn = this.turns.find((t) => t.t < 0) ?? (this.turns.length < 24 ? { index, t: 0, from: new THREE.Vector3(), to: new THREE.Vector3(), now: new THREE.Vector3() } : null);
        if (!turn) continue;
        if (!this.turns.includes(turn)) this.turns.push(turn);
        turn.index = index;
        turn.t = 0;
        turn.from.copy(ring.normal);
        turn.to.copy(normal);
        this.burst(ring.position, ORIGIN, 24 * this.particles.budget, SONG, Kind.Star, 5);
        // Chimes rising with the distance, so the song seems to travel
        this.host.sound("attune", 1 + Math.min(1, ring.position.distanceTo(a.songOrigin) / ABILITY.songRange) * 0.8);
      }
      this.attunedSeen = a.attuned.size;
    }
    for (const turn of this.turns) {
      if (turn.t < 0) continue;
      turn.t += dt;
      const k = turn.t / 0.75;
      const ring = world.course.rings[turn.index];
      if (!ring) {
        turn.t = -1;
        continue;
      }
      // Swings round with a little overshoot, like a weathervane catching the wind
      quat.setFromUnitVectors(turn.from, turn.to);
      quat2.identity().slerp(quat, backOut(Math.min(1, k)));
      turn.now.copy(turn.from).applyQuaternion(quat2).normalize();
      if (k <= 1.05) this.host.turnGate(turn.index, k >= 1 ? turn.to : turn.now);
      // A ring of notes round it for a while
      const glow = smoothstep(0, 0.2, turn.t) * (1 - smoothstep(2, 3, turn.t));
      color.copy(SONG).lerp(GOLD, 0.5 + 0.5 * Math.sin(this.time * 4 + turn.index));
      this.rings.add(ring.position, turn.now, ring.radius * 1.12, glow * 0.45 * strength, 0.035, 4, color);
      if (turn.t > 3) turn.t = -1;
    }
  }

  // --- Ley-Line Surger ----------------------------------------------------------------------

  private leyLine(dt: number, a: Abilities, world: World, flight: Flight, camera: THREE.Camera, passed: (gate: number) => boolean, budget: number) {
    const has = a.has("leyLine");
    const strength = ABILITIES_FX.ley;
    const pilot = this.avatar.group.position;
    // The chain so far: one pip of light per gate, orbiting behind your shoulders
    const pips = has && !a.ley ? Math.min(this.pips.length, a.leyStreak) : 0;
    lookAlong(quat, flight.forward);
    for (let i = 0; i < this.pips.length; i++) {
      const pip = this.pips[i];
      pip.visible = i < pips;
      if (!pip.visible) continue;
      const angle = this.time * 2.2 + (i * TAU) / Math.max(1, pips);
      pip.position.set(Math.cos(angle) * 1.5, 1.1 + Math.sin(angle) * 0.45, 0.6).applyQuaternion(quat).add(pilot);
      pip.rotation.set(0, this.time * 3 + i, 0.3);
      pip.scale.setScalar(0.5 + 0.06 * Math.sin(this.time * 6 + i));
    }
    // Awake: a line of flowing runes along the course ahead, and wingtips streaming violet and gold
    this.leyShown = ease(this.leyShown, has && a.ley ? 1 : 0, a.ley ? 4 : 2, dt);
    this.leyFlare = Math.max(0, this.leyFlare - dt * 1.2);
    const shown = this.leyShown * strength;
    for (let i = 0; i < 2; i++) {
      this.leyTrails[i].push(i === 0 ? tipL : tipR, span, 1);
      this.leyTrails[i].opacity = shown * 0.9;
    }
    if (shown < 0.01) {
      this.ley.mesh.visible = false;
      return;
    }
    const course = world.course;
    let endZ = course.endZ;
    let gates = 0;
    for (const ring of course.rings) {
      if (passed(ring.index) || ring.position.z < flight.position.z) continue;
      endZ = ring.position.z;
      if (++gates >= 3) break;
    }
    const z0 = flight.position.z + 3;
    const z1 = Math.min(course.endZ, Math.max(z0 + 60, Math.min(endZ + 20, z0 + 520)));
    const n = this.ley.size;
    for (let i = 0; i < n; i++) {
      const u = i / (n - 1);
      const z = z0 + (z1 - z0) * u;
      course.pointAt(z, at);
      // From the pilot it bends onto the racing line over the first stretch
      const join = smoothstep(0, 0.15, u);
      tmp.copy(pilot).addScaledVector(flight.forward, 3 + u * 40);
      at.lerpVectors(tmp, at, join).addScaledVector(UP, -1.2 * join + Math.sin(z * 0.05 + this.time * 2) * 0.25 * join);
      // Facing the camera
      course.tangentAt(z, dir);
      side.subVectors(camera.position, at).cross(dir).normalize();
      const fade = smoothstep(0, 0.04, u) * (1 - smoothstep(0.8, 1, u));
      this.ley.set(i, at, side, 0.28 + 0.18 * this.leyFlare, fade * (0.75 + this.leyFlare), this.leyFlare * (1 - u));
    }
    this.ley.mesh.material.uniforms.opacity.value = shown;
    this.ley.commit(n);
    this.runeDebt += 24 * shown * budget * dt;
    for (; this.runeDebt >= 1; this.runeDebt--) {
      at.copy(pilot).add(tmp.set(rand(-1.2, 1.2), rand(-0.6, 1), rand(-1.2, 1.2)));
      vel.copy(flight.velocity).multiplyScalar(0.7).add(tmp.set(rand(-1, 1), rand(0, 1.5), rand(-1, 1)));
      this.particles.emit(at, vel, fx(rand(0.4, 0.7), rand(0.22, 0.34), Math.random() < 0.5 ? LEY_VIOLET : GOLD, Kind.Star, 0, 2, 2.2));
    }
  }

  // --- Aero-Braking -----------------------------------------------------------------------------

  private aeroBrake(dt: number, a: Abilities, flight: Flight, budget: number) {
    this.cushion.visible = this.cushionT >= 0;
    if (this.cushionT < 0) return;
    this.cushionT += dt;
    const k = this.cushionT / 0.85;
    if (k >= 1) {
      this.cushionT = -1;
      this.cushion.visible = false;
      return;
    }
    // The air piles up ahead of the spread wings, then lets go
    const pilot = this.avatar.group.position;
    dir.copy(flight.velocity).normalize();
    if (!Number.isFinite(dir.x) || dir.lengthSq() < 0.5) dir.copy(flight.forward);
    this.cushion.position.copy(pilot).addScaledVector(dir, 0.9 - k * 0.5);
    lookAlong(this.cushion.quaternion, dir);
    const squash = smoothstep(0, 0.12, k) * (1 - smoothstep(0.35, 0.8, k));
    this.cushion.scale.set(2.3 + k * 0.8, 2.1 + k * 0.6, 1.3 - squash * 0.5 + k * 0.6);
    const u = this.cushion.material.uniforms;
    u.squash.value = squash;
    u.opacity.value = smoothstep(0, 0.08, k) * (1 - smoothstep(0.45, 1, k)) * 0.8 * ABILITIES_FX.wind;
    // Air spilling round the rim and streaming off the wingtips while the flare lasts
    if (a.flare < 0 || a.flare > ABILITY.flareTime) return;
    this.spillDebt += 36 * budget * dt;
    lookAlong(quat, dir);
    for (; this.spillDebt >= 1; this.spillDebt--) {
      const angle = rand(0, TAU);
      side.set(Math.cos(angle), Math.sin(angle) * 0.7, 0).applyQuaternion(quat);
      at.copy(pilot).addScaledVector(dir, rand(0.4, 1.2)).addScaledVector(side, rand(1.6, 2.4));
      vel.copy(flight.velocity).multiplyScalar(0.55).addScaledVector(side, rand(4, 9)).addScaledVector(dir, -rand(1, 4));
      if (Math.random() < 0.6) this.soft.emit(at, vel, fx(rand(0.4, 0.7), rand(0.5, 0.9), color.set("#f4fbff"), Kind.Glow, 0, 2.5, 0.45));
      else this.particles.emit(at, vel, fx(rand(0.3, 0.6), rand(0.4, 0.7), ANEMO, Kind.Wisp, 0, 2, 0.35));
    }
  }

  // --- Draft-Weaving ------------------------------------------------------------------------------

  private draftWeave(dt: number, a: Abilities, flight: Flight, budget: number) {
    const has = a.has("draftWeave");
    const pilot = this.avatar.group.position;
    // Spinning up: wisps gathering round you, faster the closer it is to forming
    if (has && a.tornado <= 0 && a.weave > 0.05) {
      this.gatherDebt += 40 * a.weave * budget * dt;
      lookAlong(quat, flight.forward);
      for (; this.gatherDebt >= 1; this.gatherDebt--) {
        const angle = rand(0, TAU);
        const r = rand(1.6, 2.6);
        side.set(Math.cos(angle), Math.sin(angle), 0).applyQuaternion(quat);
        tmp.set(-Math.sin(angle), Math.cos(angle), 0).applyQuaternion(quat);
        at.copy(pilot).addScaledVector(side, r);
        vel.copy(flight.velocity).multiplyScalar(0.85).addScaledVector(tmp, rand(4, 8) * (0.5 + a.weave)).addScaledVector(side, -rand(1, 3));
        this.particles.emit(at, vel, fx(rand(0.35, 0.6), rand(0.35, 0.6), ANEMO, Kind.Wisp, 0, 1, 0.4 + a.weave * 0.3));
      }
    }
    // The tornado: a funnel of streaks wrapped round you, leaves riding it
    const target = has && a.tornado > 0 ? Math.min(1, a.tornado / 2) : 0;
    this.tornadoShown = ease(this.tornadoShown, target, target > this.tornadoShown ? 5 : 8, dt);
    const shown = this.tornadoShown * ABILITIES_FX.wind;
    this.tornado.visible = shown > 0.02;
    this.leaves.visible = this.tornado.visible;
    if (!this.tornado.visible) return;
    dir.copy(flight.forward);
    this.tornado.position.copy(pilot).addScaledVector(dir, 2.2);
    lookAlong(this.tornado.quaternion, tmp.copy(dir).negate());
    const pulse = 1 + 0.04 * Math.sin(this.time * 11);
    this.tornado.scale.set(pulse, pulse, 5);
    this.tornado.material.uniforms.opacity.value = shown * 0.7;
    lookAlong(quat, dir);
    for (let i = 0; i < this.leaves.count; i++) {
      const angle = this.time * (7 + (i % 3)) + (i * TAU) / this.leaves.count;
      const along = ((i * 0.37 + this.time * 0.6) % 1) * 4.6 - 2.2;
      const r = (1.4 + (along + 2.2) * 0.22) * (0.6 + 0.4 * shown);
      at.set(Math.cos(angle) * r, Math.sin(angle) * r, along).applyQuaternion(quat).add(pilot);
      quat2.setFromAxisAngle(tmp.set(Math.sin(i), Math.cos(i * 1.3), 0.4).normalize(), this.time * 6 + i);
      this.leaves.setMatrixAt(i, matrix.compose(at, quat2, scale.setScalar(0.8 * shown + 0.2)));
    }
    this.leaves.instanceMatrix.needsUpdate = true;
  }

  // --- Ascension ------------------------------------------------------------------------------------

  private ascension(dt: number, a: Abilities, budget: number) {
    this.column.visible = this.columnT >= 0;
    if (this.columnT < 0) return;
    this.columnT += dt;
    const t = this.columnT;
    if (t > 2.4) {
      this.columnT = -1;
      this.column.visible = false;
      return;
    }
    // A column of wind like Genshin's wind currents: it bursts up, then thins away
    this.column.position.copy(this.columnAt).addScaledVector(UP, -2);
    lookAlong(this.column.quaternion, UP);
    this.column.scale.set(1, 1, 55);
    const u = this.column.material.uniforms;
    u.reach.value = smoothstep(0, 0.35, t);
    u.opacity.value = (1 - smoothstep(1.2, 2.4, t)) * 0.85 * ABILITIES_FX.wind;
    // Leaves spiralling up round the pilot while it rises
    if (a.ascend < 0) return;
    this.riseDebt += 60 * budget * dt;
    const pilot = this.avatar.group.position;
    for (; this.riseDebt >= 1; this.riseDebt--) {
      const angle = rand(0, TAU);
      at.copy(pilot).add(tmp.set(Math.cos(angle) * rand(1, 2.2), rand(-3, 0), Math.sin(angle) * rand(1, 2.2)));
      vel.set(-Math.sin(angle) * 4, rand(20, 34), Math.cos(angle) * 4);
      this.particles.emit(at, vel, Math.random() < 0.7 ? fx(rand(0.4, 0.7), rand(0.5, 0.9), ANEMO, Kind.Wisp, 0, 2, 0.45) : fx(rand(0.8, 1.2), rand(0.3, 0.45), LEAF, Kind.Shard, 0, 1.5, 1.2));
    }
  }

  // --- the gliding stances ---------------------------------------------------------------------

  private stances(dt: number, a: Abilities, flight: Flight, budget: number) {
    const pilot = this.avatar.group.position;
    const falcon = smoothstep(0, 1, a.falcon);
    const butterfly = smoothstep(0, 1, a.butterfly);
    // Falcon: long fine contrails off the wingtips, brighter with speed
    const trailOn = falcon * smoothstep(30, 60, flight.speed);
    this.contrails[0].push(tipL, span, 1);
    this.contrails[1].push(tipR, span, 1);
    for (const trail of this.contrails) trail.opacity = trailOn * 0.85;
    // Butterfly: small butterflies fluttering round you, pollen glittering in your wake
    if (butterfly > 0.02) {
      lookAlong(quat, flight.forward);
      for (let i = 0; i < SMALL_BUTTERFLIES; i++) {
        const t = this.time * (0.7 + i * 0.09) + i * 2.1;
        side.set(Math.sin(t) * (1.4 + i * 0.25), 0.6 + Math.sin(t * 1.9 + i) * 0.7, 0.6 + Math.cos(t * 0.8 + i) * 1.4).applyQuaternion(quat);
        at.copy(pilot).add(side);
        dir.set(Math.cos(t), Math.cos(t * 1.9 + i) * 0.6, -1.5).applyQuaternion(quat).normalize();
        color.copy(i % 2 ? PINK : WHITE).lerp(LILAC, (i % 3) * 0.3);
        this.butterflies.add(place(at, dir, Math.sin(t * 3) * 0.5, 0.38), i * 1.3, 4.5 + (i % 2), 0.9, butterfly, color);
      }
      this.pollenDebt += 12 * butterfly * budget * dt;
      for (; this.pollenDebt >= 1; this.pollenDebt--) {
        at.copy(Math.random() < 0.5 ? tipL : tipR);
        vel.copy(flight.velocity).multiplyScalar(0.7).add(tmp.set(rand(-0.6, 0.6), rand(-0.3, 0.8), rand(-0.6, 0.6)));
        this.particles.emit(at, vel, fx(rand(0.9, 1.5), rand(0.15, 0.26), Math.random() < 0.5 ? PINK : GOLD, Kind.Star, -0.2, 1.2, 2));
      }
    }
    // The spirit of a new stance: a falcon of light swoops onto you, or a great butterfly unfolds behind you
    if (this.spiritT < 0) return;
    this.spiritT += dt;
    const t = this.spiritT;
    lookAlong(quat, flight.forward);
    if (this.spirit === "falcon") {
      const k = t / 0.75;
      if (k >= 1) {
        this.spiritT = -1;
        for (let n = 0; n < Math.round(30 * budget); n++) {
          vel.set(rand(-1, 1), rand(-1, 1), rand(-1, 1)).normalize().multiplyScalar(rand(1, 4)).addScaledVector(flight.velocity, 0.8);
          this.particles.emit(pilot, vel, n % 2 ? fx(rand(0.6, 1), rand(0.25, 0.4), GOLD, Kind.Shard, 1, 1.5, 1.6) : fx(rand(0.4, 0.7), rand(0.3, 0.5), WHITE, Kind.Glow, 0, 2, 2));
        }
        this.host.kick(5);
        return;
      }
      // Down out of the sky behind you, onto your back
      const e = k * k * (3 - 2 * k);
      side.set(Math.sin(k * 3) * 2 * (1 - e), 7 * (1 - e) + 0.4, 15 * (1 - e)).applyQuaternion(quat);
      at.copy(pilot).add(side);
      dir.set(-Math.cos(k * 3) * 0.3 * (1 - e), -0.45 * (1 - e), -1).applyQuaternion(quat).normalize();
      this.falconSpirit.add(place(at, dir, Math.sin(k * 3) * 0.4, 2.4 - e * 0.8), 0, k < 0.6 ? 2.6 : 1, k < 0.6 ? 0.5 : 0.15, smoothstep(0, 0.15, k) * (1 - smoothstep(0.85, 1, k)));
      if (Math.random() < dt * 40) this.particles.emit(at, tmp.copy(flight.velocity).multiplyScalar(0.5), fx(0.6, 0.3, GOLD, Kind.Star, 0, 2, 2));
    } else {
      const k = t / 1.2;
      if (k >= 1) {
        this.spiritT = -1;
        return;
      }
      // Opening its wings behind you on two slow beats, rising a little, then scattering into light
      side.set(0, 1.2 + k * 1.5, 2.6 + k * 1.5).applyQuaternion(quat);
      at.copy(pilot).add(side);
      dir.copy(flight.forward);
      this.butterflies.add(place(at, dir, 0, 3.6 * backOut(Math.min(1, k * 3))), -Math.PI / 2, 1.4, 1.1, smoothstep(0, 0.1, k) * (1 - smoothstep(0.6, 1, k)) * 0.9);
      if (k > 0.55 && Math.random() < dt * 60) {
        vel.set(rand(-3, 3), rand(-1, 3), rand(-3, 3)).addScaledVector(flight.velocity, 0.8);
        this.particles.emit(tmp.copy(at).add(tmp2.set(rand(-2.5, 2.5), rand(-0.5, 0.5), rand(-1, 1))), vel, fx(rand(0.6, 1), rand(0.3, 0.5), Math.random() < 0.5 ? PINK : LILAC, Kind.Star, 0, 1.5, 2.2));
      }
    }
  }

  // --- Echo-Trail ---------------------------------------------------------------------------------

  private echoTrail(dt: number, a: Abilities) {
    const has = a.has("echoTrail");
    const e = a.echo;
    const strength = ABILITIES_FX.echo;
    this.echoFlash = Math.max(0, this.echoFlash - dt / 1.4);
    if (!has || e.count < 2 || strength <= 0) {
      this.echo.mesh.visible = false;
    } else {
      // Newest first; it fades with age, and the circle that closed lights up gold
      const now = a.now;
      let n = 0;
      for (let k = 0; k < e.count && n < this.echo.size; k++) {
        const i = (e.head - k + ECHO_SAMPLES) % ECHO_SAMPLES;
        const age = now - e.times[i];
        if (age > ABILITY.echoLife) break;
        // Faint right behind you (it would stream past the camera), clear once it hangs in the air
        const fade = (1 - smoothstep(ABILITY.echoLife * 0.55, ABILITY.echoLife, age)) * smoothstep(0.35, 1.3, age);
        const inLoop = e.times[i] >= e.loopFrom - 0.05 && e.times[i] <= e.loopTo + 0.05 ? this.echoFlash : 0;
        // The newest point rides with the pilot as drawn, not as last stepped
        at.copy(k === 0 ? this.avatar.group.position : e.positions[i]);
        this.echo.set(n++, at, e.sides[i], 0.22 + inLoop * 0.2, fade, inLoop);
      }
      this.echo.mesh.material.uniforms.opacity.value = 0.7 * strength;
      this.echo.commit(n);
    }
    // The wind ring a closed circle left where it was drawn: fly it again for another push
    const r = a.echoRing;
    if (!has || r.t < 0) return;
    const life = smoothstep(0, 0.4, r.t) * (1 - smoothstep(ABILITY.echoRingLife - 1.5, ABILITY.echoRingLife, r.t));
    // Kept below a blinding brightness: bloom's widest blur pools inside a big bright circle and fills it
    this.rings.add(r.center, r.normal, r.radius, life * 0.42 * strength, 0.05, 2, ANEMO);
    this.rings.add(r.center, r.normal, r.radius * 0.92, life * 0.3 * strength, 0.025, 4, LILAC);
    if (Math.random() < dt * 30 * life) {
      const angle = rand(0, TAU);
      lookAlong(quat, r.normal);
      side.set(Math.cos(angle), Math.sin(angle), 0).applyQuaternion(quat);
      tmp.set(-Math.sin(angle), Math.cos(angle), 0).applyQuaternion(quat);
      at.copy(r.center).addScaledVector(side, r.radius);
      this.particles.emit(at, vel.copy(tmp).multiplyScalar(rand(4, 8)), fx(rand(0.5, 0.9), rand(0.4, 0.7), ANEMO, Kind.Wisp, 0, 1, 0.5));
    }
  }

  dispose() {
    this.group.removeFromParent();
    for (const trail of [...this.leyTrails, ...this.contrails]) {
      trail.mesh.removeFromParent();
      trail.dispose();
    }
    this.disposables.forEach((d) => d.dispose());
  }
}
