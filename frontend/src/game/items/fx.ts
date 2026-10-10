import * as THREE from "three";
import { RingQuads } from "../abilities/models";
import { funnelMesh } from "../abilities/models2";
import type { Avatar } from "../avatar";
import type { Flight } from "../flight";
import { Trail } from "../trail";
import { clamp, smoothstep } from "../math";
import { Kind, type Particles, fx } from "../particles";
import { ITEM, type Items, type RunItemId, runItem } from "../run/items";
import { ITEMS_FX } from "../tuning";
import { auraMesh } from "./auras";
import type { Equipment } from "./equip";

// What the design list's items look like when used (their rules:
// run/items.ts). Looks only: this reads the items' state and drives the
// pilot's Equipment (taking the item out, holding it up, using it up) and the
// effects in the world. It never changes the flight.
//  - Anemo Catcher: the bottle is held up and uncorked with a pop; a column of
//    wind bursts up under the pilot, who rides it reaching for the sky, wisps
//    and leaves streaming up past.
//  - Starflake Shield: the crystal is held up and bursts into a faceted
//    bubble of ice round the pilot, frost glittering on its seams; the first
//    hit shatters it into a ring of shards.
//  - Luminescent Glider Wax: the tin is held up and the wax spreads over the
//    wings in a flash of gold; while it lasts, golden ribbons stream off the
//    wingtips and the wings shed glitter like honey in the sun.

export type ItemSound = "pickup" | "full" | "auto" | "uncork" | "shield" | "shatter" | "wax";

export interface ItemFxHost {
  kick(degrees?: number): void;
  sound(kind: ItemSound, pitch?: number): void;
}

const TAU = Math.PI * 2;
const WHITE = new THREE.Color("#ffffff");
const ANEMO = new THREE.Color("#7df5d8");
const LEAF = new THREE.Color("#8ee8b0");
const ICE = new THREE.Color("#a8e4ff");
const FROST = new THREE.Color("#e8fbff");
const HONEY = new THREE.Color("#ffd36e");
const UP = new THREE.Vector3(0, 1, 0);
const ORIGIN = new THREE.Vector3();

const at = new THREE.Vector3();
const vel = new THREE.Vector3();
const tmp = new THREE.Vector3();
const tipL = new THREE.Vector3();
const tipR = new THREE.Vector3();
const span = new THREE.Vector3();
const wingPoints = Array.from({ length: 10 }, () => new THREE.Vector3());
const matrix = new THREE.Matrix4();
const rand = (min: number, max: number) => min + Math.random() * (max - min);
const ease = (current: number, target: number, rate: number, dt: number) => current + (target - current) * (1 - Math.exp(-rate * dt));
/** `out` turned so its -z looks along `direction` */
const lookAlong = (out: THREE.Quaternion, direction: THREE.Vector3) =>
  out.setFromRotationMatrix(matrix.lookAt(ORIGIN, direction, Math.abs(direction.y) > 0.98 ? tmp.set(0, 0, 1) : UP));

/** How each item is taken out and used up in the hand (the firework and the boots are worn instead) */
const USE_STYLE: Partial<Record<RunItemId, "eat" | "raise" | "toss">> = {
  anemoCatcher: "raise",
  starflakeShield: "raise",
  gliderWax: "raise",
};

interface Wave {
  t: number;
  life: number;
  center: THREE.Vector3;
  normal: THREE.Vector3 | null;
  radius: number;
  grow: number;
  tint: THREE.Color;
}

export class ItemFx {
  /** Everything placed in the world (the level's): hidden with it inside a wormhole */
  readonly group = new THREE.Group();
  /** Inside a wormhole the level is hidden, and so is everything in `group` */
  inWormhole = false;
  private readonly avatar: Avatar;
  private readonly equipment: Equipment;
  private readonly particles: Particles;
  private readonly host: ItemFxHost;
  private readonly disposables: { dispose(): void }[] = [];
  private active = false;
  private version = -1;
  private readonly cue = { pickup: 0, use: 0, full: 0, auto: 0, shatter: 0 };
  private readonly rings = new RingQuads(16, true);
  private readonly waves: Wave[] = [];

  // Anemo Catcher
  private readonly column = funnelMesh({ mouth: 2.4, end: 1.3, color: "#7fe9cf", twist: 0.45, flow: 3.4, spin: 1.8, streaks: 7, rings: true });
  private columnT = -1;
  private riseDebt = 0;
  // Starflake Shield
  private readonly bubble = auraMesh(0, "#cfefff", "#ffffff");
  private shieldT = -1;
  private frostDebt = 0;
  // Luminescent Glider Wax
  private readonly waxTrails: Trail[];
  private waxShown = 0;
  private glitterDebt = 0;

  constructor(scene: THREE.Scene, avatar: Avatar, equipment: Equipment, particles: Particles, host: ItemFxHost) {
    this.avatar = avatar;
    this.equipment = equipment;
    this.particles = particles;
    this.host = host;
    scene.add(this.group);
    this.group.add(this.column, this.bubble, this.rings.mesh);
    this.disposables.push(this.column.geometry, this.column.material, this.bubble.geometry, this.bubble.material, this.rings);
    this.waxTrails = [0, 1].map(() => {
      const trail = new Trail("#ffd36e", { width: 0.22, shimmer: 1.2, length: 1.6 });
      trail.setColor("#fff4c4", "#ffb84a");
      scene.add(trail.mesh);
      this.disposables.push(trail);
      return trail;
    });
  }

  /** Before the avatar animates: the items' poses (eased in and out) */
  pose(dt: number, items: Items | null) {
    if (dt <= 0) return;
    const st = this.avatar.stance;
    // Riding the updraft, the pilot reaches for the sky
    const climbing = items && items.time("anemoCatcher") >= 0 ? 1 : 0;
    if (climbing) st.climb = Math.max(st.climb, ease(st.climb, 1, 8, dt));
  }

  /** Not in a run, crashed, or in a race: nothing shows */
  hide() {
    if (!this.active) return;
    this.active = false;
    this.group.visible = false;
    this.equipment.lift = 0;
    this.equipment.setThrust(0);
    for (const trail of this.waxTrails) trail.opacity = 0;
  }

  /** After the avatar and its effects animated: everything else */
  update(dt: number, items: Items, flight: Flight, flying: boolean) {
    this.active = true;
    this.group.visible = !this.inWormhole;
    const budget = this.particles.budget * (flying ? 1 : 0);
    if (items.version !== this.version) {
      this.version = items.version;
      this.columnT = -1;
      this.waves.length = 0;
    }
    this.rings.begin();
    this.cues(items, flight, budget);
    this.anemoCatcher(dt, items, budget);
    this.starflake(dt, items, budget);
    this.gliderWax(dt, items, flight, budget);
    this.equipment.setThrust(items.burn);
    if (items.time("cometFirework") < 0 && this.equipment.wearing("back") === "firework") this.equipment.unequip("back");
    this.updateWaves(dt);
    this.rings.end();
  }

  // --- one-off moments ----------------------------------------------------------------

  private cues(items: Items, flight: Flight, budget: number) {
    const c = items.cue;
    const seen = this.cue;
    if (c.full !== seen.full) {
      seen.full = c.full;
      this.host.sound("full");
    }
    if (c.auto !== seen.auto) {
      seen.auto = c.auto;
      this.host.sound("auto");
    }
    if (c.shatter !== seen.shatter) {
      seen.shatter = c.shatter;
      // The shield shatters: a ring of ice shards thrown off the hit, the shell gone in a flash
      this.shieldT = -1;
      this.bubble.visible = false;
      const pilot = this.avatar.group.position;
      this.wave(items.savePoint, items.saveNormal, 1, 6, 0.6, FROST);
      this.wave(pilot, null, 2.2, 1.6, 0.4, ICE);
      for (let k = 0; k < Math.round(70 * budget); k++) {
        vel.set(rand(-1, 1), rand(-1, 1), rand(-1, 1)).normalize();
        at.copy(pilot).addScaledVector(vel, 2.2);
        vel.multiplyScalar(rand(4, 12)).addScaledVector(items.saveNormal, rand(2, 6)).addScaledVector(flight.velocity, 0.5);
        this.particles.emit(at, vel, k % 3 ? fx(rand(0.7, 1.3), rand(0.25, 0.5), k % 2 ? ICE : FROST, Kind.Shard, 6, 1.2, 1.6) : fx(rand(0.5, 0.9), rand(0.3, 0.5), WHITE, Kind.Star, 2, 1.5, 2.4));
      }
      this.host.sound("shatter");
      this.host.kick(8);
    }
    if (c.use !== seen.use) {
      seen.use = c.use;
      const id = items.used;
      if (!id) return;
      const style = USE_STYLE[id];
      if (style) {
        this.equipment.equip(runItem(id).model);
        this.equipment.use(style);
      }
      this.used(id, flight, budget);
    }
  }

  /** An item was just used */
  private used(id: RunItemId, flight: Flight, budget: number) {
    const hand = this.avatar.slots.hand.getWorldPosition(at);
    if (id === "anemoCatcher") {
      this.columnT = 0;
      // The cork pops and the wind rushes out of the bottle
      for (let k = 0; k < Math.round(30 * budget); k++) {
        vel.set(rand(-1, 1), rand(0.5, 2), rand(-1, 1)).normalize().multiplyScalar(rand(3, 9)).addScaledVector(flight.velocity, 0.8);
        this.particles.emit(hand, vel, k % 3 ? fx(rand(0.5, 0.9), rand(0.4, 0.8), ANEMO, Kind.Wisp, -2, 2, 0.6) : fx(rand(0.6, 1), rand(0.2, 0.35), WHITE, Kind.Star, -1, 1.5, 2.2));
      }
      this.host.sound("uncork");
      this.host.kick(4);
    } else if (id === "starflakeShield") {
      this.shieldT = 0;
    } else if (id === "cometFirework") {
      this.equipment.equip("firework", true);
      this.host.sound("uncork");
      this.host.kick(9);
    } else if (id === "gliderWax") {
      this.waxShown = 0;
      for (const trail of this.waxTrails) trail.reset();
      this.host.sound("wax");
    }
  }

  // --- Anemo Catcher ---------------------------------------------------------------------

  private anemoCatcher(dt: number, items: Items, budget: number) {
    this.column.visible = this.columnT >= 0;
    if (this.columnT < 0) return;
    this.columnT += dt;
    const t = this.columnT;
    const on = items.time("anemoCatcher") >= 0;
    if (!on && t > 0.3 && this.column.material.uniforms.opacity.value < 0.01) {
      this.columnT = -1;
      this.column.visible = false;
      return;
    }
    // A column of wind under the pilot, rushing up past them; it follows them up, then thins away
    const pilot = this.avatar.group.position;
    this.column.position.copy(pilot).addScaledVector(UP, -18);
    lookAlong(this.column.quaternion, UP);
    this.column.scale.set(1.1, 1.1, 26);
    const u = this.column.material.uniforms;
    u.reach.value = smoothstep(0, 0.3, t);
    u.opacity.value = ease(u.opacity.value, on ? 0.55 * ITEMS_FX.wind : 0, on ? 10 : 4, dt);
    if (!on) return;
    // Wisps and leaves streaming up round the pilot
    this.riseDebt += 70 * budget * dt * ITEMS_FX.wind;
    for (; this.riseDebt >= 1; this.riseDebt--) {
      const angle = rand(0, TAU);
      const r = rand(1.2, 2.4);
      at.copy(pilot).add(tmp.set(Math.cos(angle) * r, rand(-6, -1), Math.sin(angle) * r));
      vel.set(-Math.sin(angle) * 5, rand(24, 38), Math.cos(angle) * 5);
      this.particles.emit(at, vel, Math.random() < 0.7 ? fx(rand(0.4, 0.7), rand(0.5, 0.9), ANEMO, Kind.Wisp, 0, 2, 0.45) : fx(rand(0.8, 1.2), rand(0.3, 0.45), LEAF, Kind.Shard, 0, 1.5, 1.2));
    }
  }

  // --- Starflake Shield -------------------------------------------------------------------

  private starflake(dt: number, items: Items, budget: number) {
    const left = items.time("starflakeShield");
    if (left < 0 && this.shieldT >= 0 && this.shieldT > 1) {
      // It ran out: the ice melts away in a glitter
      this.shieldT = -1;
      const pilot = this.avatar.group.position;
      for (let k = 0; k < Math.round(30 * budget); k++) {
        vel.set(rand(-1, 1), rand(-1, 1), rand(-1, 1)).normalize();
        this.particles.emit(at.copy(pilot).addScaledVector(vel, 2.2), vel.multiplyScalar(rand(0.5, 2)), fx(rand(0.8, 1.4), rand(0.2, 0.35), FROST, Kind.Star, -0.5, 1, 2));
      }
    }
    if (this.shieldT < 0 || left < 0) {
      this.bubble.visible = false;
      return;
    }
    this.shieldT += dt;
    const t = this.shieldT;
    // The crystal bursts at the top of the raise (0.45 s), and the bubble swells out of it
    const grow = smoothstep(0.42, 0.85, t);
    if (t >= 0.45 && t - dt < 0.45) {
      this.host.sound("shield");
      this.wave(this.avatar.slots.hand.getWorldPosition(at), null, 0.4, 5, 0.5, FROST);
    }
    this.bubble.visible = grow > 0;
    if (!this.bubble.visible) return;
    const pilot = this.avatar.group.position;
    this.bubble.position.copy(pilot);
    this.bubble.quaternion.copy(this.avatar.group.quaternion);
    this.bubble.rotateY(t * 0.4);
    this.bubble.scale.setScalar(2.3 * (0.6 + 0.4 * grow) * (1 + 0.025 * Math.sin(t * 5)));
    // In its last seconds it flickers, thinning
    const ending = clamp((3 - this.shieldLeft(items)) / 3, 0, 1);
    const flicker = 1 - ending * (0.5 + 0.5 * Math.sin(t * 22));
    this.bubble.material.uniforms.opacity.value = grow * flicker * ITEMS_FX.shield;
    // Frost glittering on its seams
    this.frostDebt += 14 * budget * dt * ITEMS_FX.shield;
    for (; this.frostDebt >= 1; this.frostDebt--) {
      vel.set(rand(-1, 1), rand(-1, 1), rand(-1, 1)).normalize();
      this.particles.emit(at.copy(pilot).addScaledVector(vel, 2.3), vel.set(0, 0, 0), fx(rand(0.4, 0.8), rand(0.15, 0.3), FROST, Kind.Star, 0, 0, 2.2));
    }
  }

  // --- Luminescent Glider Wax -----------------------------------------------------------------

  private gliderWax(dt: number, items: Items, flight: Flight, budget: number) {
    const t = items.time("gliderWax");
    const on = t >= 0.35;
    // The wax spreads over the wings in a flash of gold as the tin bursts
    if (on && t - dt < 0.35) {
      this.avatar.wingPoints(wingPoints);
      for (let k = 0; k < Math.round(40 * budget); k++) {
        at.copy(wingPoints[k % 10]).applyMatrix4(this.avatar.group.matrixWorld);
        vel.set(rand(-1, 1), rand(-1, 1), rand(-1, 1)).multiplyScalar(2).addScaledVector(flight.velocity, 0.7);
        this.particles.emit(at, vel, fx(rand(0.5, 0.9), rand(0.25, 0.45), k % 2 ? HONEY : WHITE, Kind.Star, 0, 2, 2.4));
      }
    }
    const left = ITEM.waxTime - t;
    this.waxShown = ease(this.waxShown, on ? (left < 1.5 ? 0.4 + 0.4 * Math.sin(t * 18) : 1) : 0, 6, dt);
    this.avatar.wingtips(tipL, tipR);
    this.avatar.span(span);
    this.waxTrails[0].push(tipL, span, 1);
    this.waxTrails[1].push(tipR, span, 1);
    for (const trail of this.waxTrails) trail.opacity = this.waxShown * 0.9 * ITEMS_FX.wax;
    if (this.waxShown < 0.05) return;
    // Glitter shed off the wings, more the faster you go
    this.glitterDebt += (12 + flight.speed * 0.5) * this.waxShown * budget * dt * ITEMS_FX.wax;
    if (this.glitterDebt < 1) return;
    this.avatar.wingPoints(wingPoints);
    for (; this.glitterDebt >= 1; this.glitterDebt--) {
      const a = wingPoints[Math.floor(rand(0, 10))];
      const b = wingPoints[Math.floor(rand(0, 10))];
      at.lerpVectors(a, b, Math.random()).applyMatrix4(this.avatar.group.matrixWorld);
      vel.copy(flight.velocity).multiplyScalar(0.2).add(tmp.set(rand(-0.5, 0.5), rand(-0.5, 0.5), rand(-0.5, 0.5)));
      this.particles.emit(at, vel, fx(rand(0.5, 1), rand(0.12, 0.24), Math.random() < 0.7 ? HONEY : WHITE, Kind.Star, 0.5, 1, 2.2));
    }
  }

  private shieldLeft(items: Items): number {
    return ITEM.shieldTime - items.time("starflakeShield");
  }

  // --- rings of light ------------------------------------------------------------------------

  private wave(center: THREE.Vector3, normal: THREE.Vector3 | null, radius: number, grow: number, life: number, tint: THREE.Color) {
    let wave = this.waves.find((w) => w.t >= w.life);
    if (!wave) {
      if (this.waves.length >= 12) return;
      wave = { t: 0, life, center: new THREE.Vector3(), normal: null, radius, grow, tint: new THREE.Color() };
      this.waves.push(wave);
    }
    wave.t = 0;
    wave.life = life;
    wave.center.copy(center);
    wave.normal = normal ? (wave.normal ?? new THREE.Vector3()).copy(normal) : null;
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
      this.rings.add(w.center, w.normal, w.radius * (1 + w.grow * out), Math.pow(1 - k, 1.5), 0.03 + 0.05 * k, 3, w.tint);
    }
  }

  dispose() {
    this.group.removeFromParent();
    for (const d of this.disposables) d.dispose();
  }
}
