import * as THREE from "three";
import type { Avatar } from "../avatar";
import { glowTexture } from "../avatar";
import { clamp, smoothstep } from "../math";
import { Kind, type Particles, fx, fxTime } from "../particles";
import { type ItemId, type ItemSlot, buildItem, disposeItem, fireworkFlame, itemInfo } from "./models";

// Item animations, looks only (what items do comes later):
//  - Equipment: the pilot pulls an item out of thin air (the inventory) with
//    a sparkle. The giant firework appears in the right hand, is swung over
//    the shoulder and strapped onto the back, where its flame can roar
//    (`setThrust`). A helmet pops into the air above the head and drops onto
//    it with a bounce. Candies, fruits and the feather appear in the hand and
//    are held up; `use()` brings them to the mouth and they vanish in light.
//    `use("raise")` holds an item up high until it bursts into light (a relic
//    being activated); `use("toss")` throws it down and away. Boots go on both
//    feet with a pop. `lift` holds the hand item up (a lantern, a kite's string).
//  - ItemDisplay: an item floating as a pickup: bobbing, turning, a halo
//    below and a sparkle now and then.

const backOut = (t: number) => {
  const c1 = 1.9;
  const c3 = c1 + 1;
  const x = clamp(t, 0, 1) - 1;
  return 1 + c3 * x * x * x + c1 * x * x;
};
const ease = (t: number) => {
  const x = clamp(t, 0, 1);
  return x * x * (3 - 2 * x);
};

/** How each slot holds its item, in the slot's space */
const HOLD: Record<ItemSlot, { position: THREE.Vector3; rotation: THREE.Euler; scale: number }> = {
  // The rocket along the spine, nose past the head, nozzle down by the hips; far enough out that the cape
  // drapes between it and the back (the avatar keeps cloth and wings out of it: items/clearance.ts)
  back: { position: new THREE.Vector3(0, -0.22, 0.08), rotation: new THREE.Euler(0, 0, 0), scale: 1 },
  head: { position: new THREE.Vector3(0, 0.02, 0.01), rotation: new THREE.Euler(0.25, 0, 0), scale: 1 },
  hand: { position: new THREE.Vector3(0, -0.04, -0.02), rotation: new THREE.Euler(Math.PI, 0, 0), scale: 1 },
  // Boots: on the shin, the toe along the pointed foot
  feet: { position: new THREE.Vector3(0, 0, 0), rotation: new THREE.Euler(0, 0, 0), scale: 1 },
};

/** The firework held in the hand while it is pulled out: along the arm, by its middle */
const FIREWORK_IN_HAND = { position: new THREE.Vector3(0, 0.25, -0.05), rotation: new THREE.Euler(Math.PI, 0, 0), scale: 0.9 };

const EQUIP_TIME: Record<ItemSlot, number> = { back: 1.5, head: 1.0, hand: 0.6, feet: 0.5 };
/** Strapped straight onto the back, without the swing over the shoulder (used mid-flight) */
const QUICK_BACK = 0.45;
/** How using an item looks: eaten, held up high until it bursts into light, or thrown down and away */
export type UseStyle = "eat" | "raise" | "toss";
const USE_TIME: Record<UseStyle, number> = { eat: 1.1, raise: 0.75, toss: 0.5 };

const m1 = new THREE.Matrix4();
const m2 = new THREE.Matrix4();
const pA = new THREE.Vector3();
const pB = new THREE.Vector3();
const qA = new THREE.Quaternion();
const qB = new THREE.Quaternion();
const sA = new THREE.Vector3();
const sB = new THREE.Vector3();
const at = new THREE.Vector3();
const vel = new THREE.Vector3();
const tmp = new THREE.Vector3();
const GOLD = new THREE.Color("#ffe6a0");
const WHITE = new THREE.Color("#ffffff");
const rand = (min: number, max: number) => min + Math.random() * (max - min);

interface Worn {
  id: ItemId;
  group: THREE.Group;
  /** The left boot (boots come in pairs) */
  twin?: THREE.Group;
}

type Animation =
  | { kind: "equip"; slot: ItemSlot; t: number; worn: Worn; sparkled: boolean; quick: boolean }
  | { kind: "use"; t: number; worn: Worn; sparkled: boolean; style: UseStyle }
  | { kind: "drop"; slot: ItemSlot; t: number; worn: Worn };

/** What the pilot carries, and the animations of taking things out, putting them on and using them */
export class Equipment {
  private readonly avatar: Avatar;
  private readonly particles: Particles | null;
  private readonly worn: Partial<Record<ItemSlot, Worn>> = {};
  private readonly animations: Animation[] = [];
  private flame: THREE.Mesh | null = null;
  private thrust = 0;
  private thrustTarget = 0;
  private sparkDebt = 0;
  /** 0..1: hold the hand item up (a lantern lit, a kite's string); eased */
  lift = 0;
  private lifted = 0;
  /** Fires when an item used with "raise" bursts, or one tossed leaves the hand, with where it was */
  onRelease?: (id: ItemId, at: THREE.Vector3) => void;

  constructor(avatar: Avatar, particles: Particles | null) {
    this.avatar = avatar;
    this.particles = particles;
  }

  /** The item in a slot, if any (still animating in counts) */
  wearing(slot: ItemSlot): ItemId | null {
    return this.worn[slot]?.id ?? null;
  }

  /**
   * Takes an item out of the inventory and puts it where it goes (replacing
   * what was there). `quick`: the firework pops straight onto the back
   */
  equip(id: ItemId, quick = false) {
    const slot = itemInfo(id).slot;
    this.unequip(slot);
    const group = buildItem(id);
    group.scale.setScalar(0.001);
    const worn: Worn = { id, group };
    this.worn[slot] = worn;
    if (slot === "feet") {
      // A mirrored pair, one on each shin
      const twin = new THREE.Group();
      for (const child of group.children) twin.add(child.clone());
      twin.scale.set(-0.001, 0.001, 0.001);
      worn.twin = twin;
      this.avatar.feet[0].add(group);
      this.avatar.feet[1].add(twin);
      this.animations.push({ kind: "equip", slot, t: 0, worn, sparkled: false, quick });
      return;
    }
    if (id === "firework") {
      this.flame = fireworkFlame(fxTime);
      this.flame.scale.set(1, 0.001, 1);
      this.flame.visible = false;
      group.add(this.flame);
    }
    // In the hand to start with (the firework too: it's swung onto the back from there, unless quick)
    (slot === "head" ? this.avatar.slots.head : slot === "back" && quick ? this.avatar.slots.back : this.avatar.slots.hand).add(group);
    this.animations.push({ kind: "equip", slot, t: 0, worn, sparkled: false, quick });
  }

  /** Puts an item away again, with a little pop */
  unequip(slot: ItemSlot) {
    const worn = this.worn[slot];
    if (!worn) return;
    delete this.worn[slot];
    for (let i = this.animations.length - 1; i >= 0; i--) if (this.animations[i].worn === worn) this.animations.splice(i, 1);
    if (worn.id === "firework") {
      this.flame = null;
      this.thrust = this.thrustTarget = 0;
    }
    this.animations.push({ kind: "drop", slot, t: 0, worn });
  }

  /** Eats (or uses up) what's in the hand: to the mouth, then gone in a sparkle (or held up, or tossed) */
  use(style: UseStyle = "eat") {
    const worn = this.worn.hand;
    if (!worn) return;
    // Still popping into the hand: use it from there
    for (let i = this.animations.length - 1; i >= 0; i--) if (this.animations[i].worn === worn && this.animations[i].kind === "equip") this.animations.splice(i, 1);
    if (this.animations.some((a) => a.worn === worn)) return;
    delete this.worn.hand;
    this.animations.push({ kind: "use", t: 0, worn, sparkled: false, style });
  }

  /** Puts away everything worn, without a sound (a new run) */
  clearWorn() {
    for (const slot of Object.keys(this.worn) as ItemSlot[]) this.unequip(slot);
  }

  /** The firework's flame, 0..1 (only shows with the firework on the back) */
  setThrust(amount: number) {
    this.thrustTarget = clamp(amount, 0, 1);
  }

  clear() {
    for (const slot of Object.keys(this.worn) as ItemSlot[]) {
      disposeWorn(this.worn[slot]!);
      delete this.worn[slot];
    }
    for (const a of this.animations) disposeWorn(a.worn);
    this.animations.length = 0;
    this.flame = null;
    this.avatar.armPose.amount = 0;
    this.avatar.carry("back", null, null);
    this.avatar.carry("hand", null, null);
  }

  /** Call every frame after the avatar has animated (it needs the avatar's world matrices) */
  update(dt: number) {
    const arm = this.avatar.armPose;
    // Holding something up in the hand keeps the arm half raised; lifted, it's held up high
    this.lifted += ((this.worn.hand ? this.lift : 0) - this.lifted) * (1 - Math.exp(-dt * 8));
    let armTarget = this.worn.hand ? 0.45 + 0.55 * this.lifted : 0;
    let x = 0;
    let z = 2.0 + 0.7 * this.lifted;
    let elbow = 0.5 - 0.3 * this.lifted;
    this.avatar.group.updateMatrixWorld(true);

    for (let i = this.animations.length - 1; i >= 0; i--) {
      const a = this.animations[i];
      a.t += dt;
      const g = a.worn.group;
      if (a.kind === "equip") {
        const time = EQUIP_TIME[a.slot];
        const k = a.t / time;
        if (!a.sparkled && a.t > 0.08) {
          a.sparkled = true;
          this.sparkle(g.getWorldPosition(at), 26);
        }
        if (a.slot === "hand") {
          this.place(g, HOLD.hand, backOut(a.t / 0.35));
          armTarget = Math.max(armTarget, 1 - smoothstep(0.4, 1, k) * 0.55);
          z = Math.max(z, 2.4);
        } else if (a.slot === "feet") {
          // Both boots pop on with a little squash, and a sparkle at each foot
          const size = backOut(a.t / 0.35);
          this.place(g, HOLD.feet, size);
          const twin = a.worn.twin!;
          this.place(twin, HOLD.feet, size);
          twin.scale.x *= -1;
          if (a.t > 0.12 && a.t - dt <= 0.12) {
            this.sparkle(g.getWorldPosition(at), 12);
            this.sparkle(twin.getWorldPosition(at), 12);
          }
        } else if (a.slot === "head") {
          // Pops up above the head, then drops on with a squash
          const drop = ease((a.t - 0.25) / 0.3);
          this.place(g, HOLD.head, backOut(a.t / 0.3));
          g.position.y += (1 - drop) * 0.45;
          const squash = a.t > 0.55 ? Math.sin(clamp((a.t - 0.55) / 0.3, 0, 1) * Math.PI) * 0.18 : 0;
          g.scale.set(g.scale.x * (1 + squash), g.scale.y * (1 - squash), g.scale.z * (1 + squash));
          if (a.t > 0.55 && a.t - dt <= 0.55) this.sparkle(g.getWorldPosition(at), 14);
        } else if (a.quick) {
          // Popped straight onto the back, with a bounce
          const settle = Math.sin(clamp(a.t / QUICK_BACK, 0, 1) * Math.PI) * 0.15;
          this.place(g, HOLD.back, backOut(a.t / 0.3));
          g.scale.set(g.scale.x * (1 + settle), g.scale.y * (1 - settle), g.scale.z * (1 + settle));
          if (a.t >= QUICK_BACK) {
            this.animations.splice(i, 1);
            continue;
          }
        } else {
          this.equipFirework(a, g);
          if (a.t < 0.45) {
            armTarget = 1;
            z = 2.7;
            x = 0;
            elbow = 0.2;
          } else if (a.t < 1.15) {
            // Over the shoulder, towards the back
            armTarget = 1;
            const swing = ease((a.t - 0.45) / 0.7);
            z = 2.7 - swing * 0.5;
            x = -1.1 * swing;
            elbow = 0.2 + swing * 0.9;
          } else {
            armTarget = Math.max(armTarget, 1 - ease((a.t - 1.15) / 0.3));
            x = -1.1;
            z = 2.2;
            elbow = 1.1;
          }
        }
        if (a.t >= time) this.animations.splice(i, 1);
      } else if (a.kind === "use") {
        const time = USE_TIME[a.style];
        const k = a.t / time;
        if (a.style === "eat") {
          // Up to the mouth, a nibble, then gone in light
          armTarget = Math.max(armTarget, 1 - smoothstep(0.75, 1, k));
          z = 2.5;
          x = 0.35;
          elbow = 1.7 * ease(k / 0.35);
          const nibble = a.t > 0.4 ? 1 - ease((a.t - 0.45) / 0.35) : 1;
          this.place(g, HOLD.hand, nibble);
          if (!a.sparkled && a.t > 0.75) {
            a.sparkled = true;
            this.sparkle(g.getWorldPosition(at), 30);
          }
        } else if (a.style === "raise") {
          // Held up high, swelling with light, then it bursts
          armTarget = Math.max(armTarget, 1 - smoothstep(0.85, 1, k));
          z = 2.95;
          x = -0.1;
          elbow = 0.1;
          const swell = 1 + 0.35 * ease((a.t - 0.2) / 0.4);
          this.place(g, HOLD.hand, a.t < 0.6 ? swell : swell * (1 - ease((a.t - 0.6) / 0.15)));
          g.rotation.y += a.t * 9;
          if (!a.sparkled && a.t > 0.6) {
            a.sparkled = true;
            g.getWorldPosition(at);
            this.sparkle(at, 36);
            this.onRelease?.(a.worn.id, at);
          }
        } else {
          // A wind-up, then thrown down and away: it leaves the hand at the bottom of the swing
          armTarget = Math.max(armTarget, 1 - smoothstep(0.8, 1, k));
          const swing = ease(k / 0.7);
          z = 2.3 - swing * 1.6;
          x = 0.6 - swing * 0.9;
          elbow = 0.8 - swing * 0.6;
          this.place(g, HOLD.hand, a.sparkled ? 0.001 : 1);
          if (!a.sparkled && k > 0.6) {
            a.sparkled = true;
            g.getWorldPosition(at);
            this.sparkle(at, 14);
            this.onRelease?.(a.worn.id, at);
            g.scale.setScalar(0.001);
          }
        }
        if (a.t >= time) {
          disposeWorn(a.worn);
          this.animations.splice(i, 1);
        }
      } else {
        // Shrinks away with a pop
        const k = a.t / 0.3;
        g.scale.setScalar(Math.max(0.001, (1 - ease(k)) * (a.slot === "back" ? 1 : HOLD[a.slot].scale)));
        if (a.worn.twin) a.worn.twin.scale.set(-g.scale.x, g.scale.y, g.scale.z);
        if (a.t - dt <= 0) this.sparkle(g.getWorldPosition(at), 16);
        if (k >= 1) {
          disposeWorn(a.worn);
          this.animations.splice(i, 1);
        }
      }
    }

    // The arm eases into its pose
    const kArm = 1 - Math.exp(-dt * 14);
    arm.amount += (armTarget - arm.amount) * kArm;
    arm.x += (x - arm.x) * kArm;
    arm.z += (z - arm.z) * kArm;
    arm.elbow += (elbow - arm.elbow) * kArm;

    this.updateFlame(dt);
    this.settle("back");
    this.settle("hand");
  }

  /** Tells the pilot what sits still in a slot (nothing while it animates), so wings and cape keep out of it */
  private settle(slot: "back" | "hand") {
    const worn = this.worn[slot];
    let settled = !!worn;
    for (const a of this.animations) if (a.worn === worn) settled = false;
    this.avatar.carry(slot, settled ? worn!.id : null, settled ? worn!.group : null);
  }

  /** The firework: appears in the hand, is swung over the shoulder, strapped onto the back */
  private equipFirework(a: Extract<Animation, { kind: "equip" }>, g: THREE.Group) {
    const { hand, back } = this.avatar.slots;
    const chest = back.parent!;
    if (a.t < 0.45) {
      if (g.parent !== hand) hand.add(g);
      this.place(g, FIREWORK_IN_HAND, backOut((a.t - 0.05) / 0.35));
      return;
    }
    if (a.t < 1.15) {
      // From the hand's pose to the back's, both seen from the chest, along an arc over the shoulder
      if (g.parent !== chest) chest.add(g);
      m1.copy(chest.matrixWorld).invert().multiply(hand.matrixWorld).multiply(localMatrix(FIREWORK_IN_HAND, m2));
      m1.decompose(pA, qA, sA);
      back.updateMatrix();
      m1.copy(back.matrix).multiply(localMatrix(HOLD.back, m2));
      m1.decompose(pB, qB, sB);
      const k = ease((a.t - 0.45) / 0.7);
      g.position.lerpVectors(pA, pB, k);
      g.position.z += Math.sin(Math.PI * k) * 0.35;
      g.position.y += Math.sin(Math.PI * k) * 0.15;
      g.quaternion.slerpQuaternions(qA, qB, k);
      g.scale.lerpVectors(sA, sB, k);
      return;
    }
    // Strapped on: a bounce, and a sparkle along the straps
    if (g.parent !== back) {
      back.add(g);
      this.sparkle(g.getWorldPosition(at), 20);
    }
    const settle = Math.sin(clamp((a.t - 1.15) / 0.3, 0, 1) * Math.PI) * 0.12;
    this.place(g, HOLD.back, 1);
    g.scale.set(1 + settle, 1 - settle, 1 + settle);
  }

  /** Puts an item at a hold pose in its parent's space, at `size` of its full scale */
  private place(g: THREE.Object3D, hold: { position: THREE.Vector3; rotation: THREE.Euler; scale: number }, size: number) {
    g.position.copy(hold.position);
    g.rotation.copy(hold.rotation);
    g.scale.setScalar(Math.max(0.001, hold.scale * size));
  }

  private updateFlame(dt: number) {
    const flame = this.flame;
    const target = this.worn.back?.id === "firework" && !this.animations.some((a) => a.worn === this.worn.back) ? this.thrustTarget : 0;
    this.thrust += (target - this.thrust) * (1 - Math.exp(-dt * 8));
    if (!flame) return;
    flame.visible = this.thrust > 0.01;
    if (!flame.visible) return;
    const flicker = 0.85 + 0.15 * Math.sin(fxTime.value * 37) * Math.sin(fxTime.value * 21);
    flame.scale.set(0.8 + this.thrust * 0.5, (0.2 + this.thrust * 0.9) * flicker, 0.8 + this.thrust * 0.5);
    // Sparks and stars thrown out of the nozzle
    const particles = this.particles;
    if (!particles) return;
    this.sparkDebt += this.thrust * 90 * particles.budget * dt;
    flame.getWorldPosition(at);
    tmp.set(0, -1, 0).transformDirection(flame.matrixWorld);
    for (; this.sparkDebt >= 1; this.sparkDebt--) {
      vel.copy(tmp).multiplyScalar(rand(6, 14)).add(pB.set(rand(-1.5, 1.5), rand(-1.5, 1.5), rand(-1.5, 1.5)));
      particles.emit(at, vel, Math.random() < 0.3 ? fx(rand(0.4, 0.8), rand(0.25, 0.45), GOLD, Kind.Star, 2, 2, 2.6) : fx(rand(0.3, 0.6), rand(0.15, 0.3), WHITE, Kind.Glow, 4, 1.5, 2.2));
    }
  }

  private sparkle(position: THREE.Vector3, count: number) {
    const particles = this.particles;
    if (!particles) return;
    for (let k = 0; k < Math.round(count * particles.budget); k++) {
      vel.set(rand(-1, 1), rand(-1, 1), rand(-1, 1)).normalize().multiplyScalar(rand(0.8, 3));
      particles.emit(position, vel, k % 3 ? fx(rand(0.5, 0.9), rand(0.12, 0.25), GOLD, Kind.Glow, -0.5, 2, 2.4) : fx(rand(0.6, 1), rand(0.25, 0.4), WHITE, Kind.Star, -0.3, 2, 2.6));
    }
  }

  dispose() {
    this.clear();
  }
}

function disposeWorn(worn: Worn) {
  disposeItem(worn.group);
  if (worn.twin) disposeItem(worn.twin);
}

const holdQuaternion = new THREE.Quaternion();
const holdScale = new THREE.Vector3();

function localMatrix(hold: { position: THREE.Vector3; rotation: THREE.Euler; scale: number }, out: THREE.Matrix4) {
  return out.compose(hold.position, holdQuaternion.setFromEuler(hold.rotation), holdScale.setScalar(hold.scale));
}

/** An item floating as a pickup: it bobs, turns, glows from below and sparkles now and then */
export class ItemDisplay {
  readonly group = new THREE.Group();
  readonly id: ItemId;
  private readonly item: THREE.Group;
  private readonly halo: THREE.Sprite;
  private readonly phase = Math.random() * Math.PI * 2;
  private time = 0;
  private sparkDebt = 0;

  /** `size`: about how many metres across it should look */
  constructor(id: ItemId, size = 1) {
    this.id = id;
    this.item = buildItem(id);
    const geometry = (this.item.children[0] as THREE.Mesh).geometry;
    const sphere = geometry.boundingSphere!;
    this.item.scale.setScalar(size / Math.max(0.05, sphere.radius * 2));
    // Centered on its middle so it turns in place
    this.item.position.copy(sphere.center).multiplyScalar(-this.item.scale.x);
    const pivot = new THREE.Group();
    pivot.add(this.item);
    this.group.add(pivot);
    this.halo = new THREE.Sprite(
      new THREE.SpriteMaterial({ map: glowTexture(), color: id === "goldenFeather" ? "#ffe39a" : "#fff4dc", blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, opacity: 0.45 }),
    );
    this.halo.scale.setScalar(size * 1.6);
    this.halo.position.y = -size * 0.15;
    this.group.add(this.halo);
  }

  update(dt: number, particles: Particles | null) {
    this.time += dt;
    const pivot = this.group.children[0];
    pivot.position.y = Math.sin(this.time * 1.8 + this.phase) * 0.12;
    pivot.rotation.y += dt * 0.9;
    pivot.rotation.z = Math.sin(this.time * 1.1 + this.phase) * 0.12;
    (this.halo.material as THREE.SpriteMaterial).opacity = 0.35 + 0.15 * Math.sin(this.time * 2.4 + this.phase);
    if (!particles) return;
    this.sparkDebt += 2.5 * particles.budget * dt;
    for (; this.sparkDebt >= 1; this.sparkDebt--) {
      this.group.getWorldPosition(at).add(tmp.set(rand(-0.5, 0.5), rand(-0.4, 0.5), rand(-0.5, 0.5)).multiplyScalar(this.halo.scale.x * 0.6));
      particles.emit(at, vel.set(0, rand(0.2, 0.6), 0), fx(rand(0.7, 1.2), rand(0.12, 0.22), WHITE, Kind.Star, -0.2, 1, 2.4));
    }
  }

  dispose() {
    disposeItem(this.item);
    (this.halo.material as THREE.SpriteMaterial).dispose();
    this.group.removeFromParent();
  }
}
