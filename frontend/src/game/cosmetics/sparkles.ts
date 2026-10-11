import * as THREE from "three";
import type { Avatar } from "../avatar";
import { Kind, type Particles, fx } from "../particles";
import { COSMETIC_FX } from "../tuning";
import type { Appearance } from "./storage";

// Rare and legendary capes, hats and shoes shed their own light in flight:
// starlight off the Aurora veil's hem, gilded flakes off the royal cape,
// embers off the ember mantle (brighter while boosting), a wisp off the
// winged helm, stardust off the star-witch hat, frost and sparks off the
// shoes. Decoration only (CLAUDE.md rule 6): nothing here touches the flight.
// Wings shed their particles in pilotfx.ts, pets their trails in pets/.

interface Sparkle {
  from: "hem" | "head" | "feet";
  color: string;
  kind: Kind;
  rate: number; // per second, at full particle budget
  size: number; // metres
  life: number; // seconds
  gravity: number;
  /** Extra rate while boosting, × the boost (0: none) */
  boost?: number;
}

/** Keyed "slot:id", the cosmetics' ids in catalog.ts */
export const COSMETIC_SPARKLES: Readonly<Record<string, Sparkle>> = {
  "cape:aurora": { from: "hem", color: "#cfe6ff", kind: Kind.Star, rate: 14, size: 0.12, life: 1.1, gravity: -0.2 },
  "cape:royal": { from: "hem", color: "#ffe39a", kind: Kind.Shard, rate: 10, size: 0.09, life: 0.9, gravity: 0.6 },
  "cape:ember": { from: "hem", color: "#ff9a52", kind: Kind.Glow, rate: 22, size: 0.11, life: 0.8, gravity: -0.9, boost: 2 },
  "hat:wingedHelm": { from: "head", color: "#fff1c4", kind: Kind.Wisp, rate: 6, size: 0.18, life: 0.6, gravity: 0 },
  "hat:starwitch": { from: "head", color: "#d8c8ff", kind: Kind.Star, rate: 8, size: 0.1, life: 1.2, gravity: -0.3 },
  "shoes:frost": { from: "feet", color: "#d7f3ff", kind: Kind.Shard, rate: 10, size: 0.08, life: 0.9, gravity: 0.8 },
  "shoes:ember": { from: "feet", color: "#ffb36b", kind: Kind.Glow, rate: 12, size: 0.08, life: 0.6, gravity: -0.6 },
};

const at = new THREE.Vector3();
const vel = new THREE.Vector3();
const jitter = new THREE.Vector3();
const rand = (min: number, max: number) => min + Math.random() * (max - min);

export class CosmeticSparkles {
  private readonly avatar: Avatar;
  private readonly particles: Particles;
  private sheds: { sparkle: Sparkle; debt: number; color: THREE.Color }[] = [];
  private foot = 0;

  constructor(avatar: Avatar, particles: Particles) {
    this.avatar = avatar;
    this.particles = particles;
  }

  /** What's worn: which particles to shed */
  setAppearance(appearance: Appearance) {
    this.sheds = [];
    for (const key of [`cape:${appearance.cape}`, `hat:${appearance.hat}`, `shoes:${appearance.shoes}`]) {
      const sparkle = COSMETIC_SPARKLES[key];
      if (sparkle) this.sheds.push({ sparkle, debt: 0, color: new THREE.Color(sparkle.color) });
    }
  }

  /** Each frame after the avatar animated; sheds only while the pilot is `moving` */
  update(dt: number, velocity: THREE.Vector3, moving: boolean) {
    if (!moving || dt <= 0 || COSMETIC_FX.sparkle <= 0) return;
    const budget = this.particles.budget * COSMETIC_FX.sparkle;
    for (const entry of this.sheds) {
      const { sparkle } = entry;
      // Some burn brighter while boosting (the ember mantle)
      const rate = sparkle.rate * budget * (1 + (sparkle.boost ?? 0) * this.avatar.boost);
      entry.debt = Math.min(entry.debt + rate * dt, 6);
      for (; entry.debt >= 1; entry.debt--) {
        this.anchor(sparkle.from);
        at.add(jitter.set(rand(-0.15, 0.15), rand(-0.15, 0.15), rand(-0.15, 0.15)));
        vel.copy(velocity).multiplyScalar(0.1).add(jitter.set(rand(-0.4, 0.4), rand(-0.2, 0.5), rand(-0.4, 0.4)));
        this.particles.emit(at, vel, fx(sparkle.life * rand(0.7, 1.2), sparkle.size * rand(0.8, 1.2), entry.color, sparkle.kind, sparkle.gravity, 1.3, 1.3));
      }
    }
  }

  /** Where a sparkle comes from, into `at` */
  private anchor(from: Sparkle["from"]) {
    const avatar = this.avatar;
    if (from === "hem") avatar.capeTip(at);
    else if (from === "head") avatar.slots.head.getWorldPosition(at);
    else avatar.feet[(this.foot = 1 - this.foot)].getWorldPosition(at);
  }
}
