import * as THREE from "three";
import { funnelMesh } from "../abilities/models2";
import type { Avatar } from "../avatar";
import type { Flight } from "../flight";
import { smoothstep } from "../math";
import { Kind, type Particles, fx } from "../particles";
import { type Items, type RunItemId, runItem } from "../run/items";
import { ITEMS_FX } from "../tuning";
import type { Equipment } from "./equip";

// What the design list's items look like when used (their rules:
// run/items.ts). Looks only: this reads the items' state and drives the
// pilot's Equipment (taking the item out, holding it up, using it up) and the
// effects in the world. It never changes the flight.
//  - Anemo Catcher: the bottle is held up and uncorked with a pop; a column of
//    wind bursts up under the pilot, who rides it reaching for the sky, wisps
//    and leaves streaming up past.

export type ItemSound = "pickup" | "full" | "auto" | "uncork";

export interface ItemFxHost {
  kick(degrees?: number): void;
  sound(kind: ItemSound, pitch?: number): void;
}

const TAU = Math.PI * 2;
const WHITE = new THREE.Color("#ffffff");
const ANEMO = new THREE.Color("#7df5d8");
const LEAF = new THREE.Color("#8ee8b0");
const UP = new THREE.Vector3(0, 1, 0);
const ORIGIN = new THREE.Vector3();

const at = new THREE.Vector3();
const vel = new THREE.Vector3();
const tmp = new THREE.Vector3();
const matrix = new THREE.Matrix4();
const rand = (min: number, max: number) => min + Math.random() * (max - min);
const ease = (current: number, target: number, rate: number, dt: number) => current + (target - current) * (1 - Math.exp(-rate * dt));
/** `out` turned so its -z looks along `direction` */
const lookAlong = (out: THREE.Quaternion, direction: THREE.Vector3) =>
  out.setFromRotationMatrix(matrix.lookAt(ORIGIN, direction, Math.abs(direction.y) > 0.98 ? tmp.set(0, 0, 1) : UP));

/** How each item is taken out and used up in the hand (the firework and the boots are worn instead) */
const USE_STYLE: Partial<Record<RunItemId, "eat" | "raise" | "toss">> = {
  anemoCatcher: "raise",
};

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
  private readonly cue = { pickup: 0, use: 0, full: 0, auto: 0 };

  // Anemo Catcher
  private readonly column = funnelMesh({ mouth: 2.4, end: 1.3, color: "#7fe9cf", twist: 0.45, flow: 3.4, spin: 1.8, streaks: 7, rings: true });
  private columnT = -1;
  private riseDebt = 0;

  constructor(scene: THREE.Scene, avatar: Avatar, equipment: Equipment, particles: Particles, host: ItemFxHost) {
    this.avatar = avatar;
    this.equipment = equipment;
    this.particles = particles;
    this.host = host;
    scene.add(this.group);
    this.group.add(this.column);
    this.disposables.push(this.column.geometry, this.column.material);
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
  }

  /** After the avatar and its effects animated: everything else */
  update(dt: number, items: Items, flight: Flight, flying: boolean) {
    this.active = true;
    this.group.visible = !this.inWormhole;
    const budget = this.particles.budget * (flying ? 1 : 0);
    if (items.version !== this.version) {
      this.version = items.version;
      this.columnT = -1;
    }
    this.cues(items, flight, budget);
    this.anemoCatcher(dt, items, budget);
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

  dispose() {
    this.group.removeFromParent();
    for (const d of this.disposables) d.dispose();
  }
}
