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
  // The rocket along the spine, nose past the head, nozzle down by the hips
  back: { position: new THREE.Vector3(0, -0.22, 0.02), rotation: new THREE.Euler(0, 0, 0), scale: 1 },
  head: { position: new THREE.Vector3(0, 0.02, 0.01), rotation: new THREE.Euler(0.25, 0, 0), scale: 1 },
  hand: { position: new THREE.Vector3(0, -0.04, -0.02), rotation: new THREE.Euler(Math.PI, 0, 0), scale: 1 },
};

/** The firework held in the hand while it is pulled out: along the arm, by its middle */
const FIREWORK_IN_HAND = { position: new THREE.Vector3(0, 0.25, -0.05), rotation: new THREE.Euler(Math.PI, 0, 0), scale: 0.9 };

const EQUIP_TIME: Record<ItemSlot, number> = { back: 1.5, head: 1.0, hand: 0.6 };
const USE_TIME = 1.1;

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
}

type Animation =
  | { kind: "equip"; slot: ItemSlot; t: number; worn: Worn; sparkled: boolean }
  | { kind: "use"; t: number; worn: Worn; sparkled: boolean }
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

  constructor(avatar: Avatar, particles: Particles | null) {
    this.avatar = avatar;
    this.particles = particles;
  }

  /** The item in a slot, if any (still animating in counts) */
  wearing(slot: ItemSlot): ItemId | null {
    return this.worn[slot]?.id ?? null;
  }

  /** Takes an item out of the inventory and puts it where it goes (replacing what was there) */
  equip(id: ItemId) {
    const slot = itemInfo(id).slot;
    this.unequip(slot);
    const group = buildItem(id);
    group.scale.setScalar(0.001);
    const worn = { id, group };
    this.worn[slot] = worn;
    if (id === "firework") {
      this.flame = fireworkFlame(fxTime);
      this.flame.scale.set(1, 0.001, 1);
      this.flame.visible = false;
      group.add(this.flame);
    }
    // In the hand to start with (the firework too: it's swung onto the back from there)
    (slot === "head" ? this.avatar.slots.head : this.avatar.slots.hand).add(group);
    this.animations.push({ kind: "equip", slot, t: 0, worn, sparkled: false });
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

  /** Eats (or uses up) what's in the hand: to the mouth, then gone in a sparkle */
  use() {
    const worn = this.worn.hand;
    if (!worn || this.animations.some((a) => a.worn === worn)) return;
    delete this.worn.hand;
    this.animations.push({ kind: "use", t: 0, worn, sparkled: false });
  }

  /** The firework's flame, 0..1 (only shows with the firework on the back) */
  setThrust(amount: number) {
    this.thrustTarget = clamp(amount, 0, 1);
  }

  clear() {
    for (const slot of Object.keys(this.worn) as ItemSlot[]) {
      disposeItem(this.worn[slot]!.group);
      delete this.worn[slot];
    }
    for (const a of this.animations) disposeItem(a.worn.group);
    this.animations.length = 0;
    this.flame = null;
    this.avatar.armPose.amount = 0;
  }

  /** Call every frame after the avatar has animated (it needs the avatar's world matrices) */
  update(dt: number) {
    const arm = this.avatar.armPose;
    // Holding something up in the hand keeps the arm half raised
    let armTarget = this.worn.hand ? 0.45 : 0;
    let x = 0;
    let z = 2.0;
    let elbow = 0.5;
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
          z = 2.4;
        } else if (a.slot === "head") {
          // Pops up above the head, then drops on with a squash
          const drop = ease((a.t - 0.25) / 0.3);
          this.place(g, HOLD.head, backOut(a.t / 0.3));
          g.position.y += (1 - drop) * 0.45;
          const squash = a.t > 0.55 ? Math.sin(clamp((a.t - 0.55) / 0.3, 0, 1) * Math.PI) * 0.18 : 0;
          g.scale.set(g.scale.x * (1 + squash), g.scale.y * (1 - squash), g.scale.z * (1 + squash));
          if (a.t > 0.55 && a.t - dt <= 0.55) this.sparkle(g.getWorldPosition(at), 14);
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
        // Up to the mouth, a nibble, then gone in light
        const k = a.t / USE_TIME;
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
        if (a.t >= USE_TIME) {
          disposeItem(g);
          this.animations.splice(i, 1);
        }
      } else {
        // Shrinks away with a pop
        const k = a.t / 0.3;
        g.scale.setScalar(Math.max(0.001, (1 - ease(k)) * (a.slot === "back" ? 1 : HOLD[a.slot].scale)));
        if (a.t - dt <= 0) this.sparkle(g.getWorldPosition(at), 16);
        if (k >= 1) {
          disposeItem(g);
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
