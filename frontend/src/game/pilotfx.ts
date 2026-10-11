import * as THREE from "three";
import type { Avatar } from "./avatar";
import { Kind, type Particles, fx } from "./particles";
import { Trail } from "./trail";
import { FX } from "./tuning";
import { smoothstep } from "./math";

const tipL = new THREE.Vector3();
const tipR = new THREE.Vector3();
const span = new THREE.Vector3();
const cape = new THREE.Vector3();
const at = new THREE.Vector3();
const vel = new THREE.Vector3();
const color = new THREE.Color();
const down = new THREE.Vector3();
const jitter = new THREE.Vector3();
/** Sky's light: warm white; the player's color only tints it (FX.lightTint) */
const WARM = new THREE.Color("#fff1cf");
const WISP = new THREE.Color("#ffffff");

const rand = (min: number, max: number) => min + Math.random() * (max - min);

export interface PilotFxOptions {
  /** Share of the particle effects this pilot gets (others' pilots get fewer than yours) */
  share?: number;
  ghost?: boolean;
  /** Soft (alpha-blended) particles for the cloud wisps; only your own pilot gets them */
  soft?: Particles;
}

/**
 * Everything a pilot leaves in the air: glowing ribbons from the wingtips and
 * the cape, light motes shed from the wings like in Sky, puffs of air on each
 * downstroke, and a spiral of stars during barrel rolls.
 */
export class PilotFx {
  readonly trails: Trail[];
  private readonly avatar: Avatar;
  private readonly particles: Particles | null;
  private readonly soft: Particles | null;
  private readonly share: number;
  private readonly ghost: boolean;
  private readonly head = new THREE.Color();
  private readonly body = new THREE.Color();
  private readonly gold = new THREE.Color("#ffe4b0");
  private debtL = 0;
  private debtR = 0;
  private spiralDebt = 0;
  private readonly velocity = new THREE.Vector3();
  private readonly center = new THREE.Vector3();
  private moving = true;
  private brakeDebt = 0;
  private wispDebt = 0;
  private wispSide = false;

  constructor(avatar: Avatar, color: string, particles: Particles | null, options: PilotFxOptions = {}) {
    this.avatar = avatar;
    this.particles = particles;
    this.soft = options.soft ?? null;
    this.share = options.share ?? 1;
    this.ghost = !!options.ghost;
    this.trails = [
      // Soft streams of air off the wingtips and a veil off the cape, not neon ribbons
      new Trail(color, { width: 0.3, shimmer: FX.trailShimmer }),
      new Trail(color, { width: 0.3, shimmer: FX.trailShimmer }),
      new Trail(color, { width: 0.75, shimmer: FX.trailShimmer * 0.35, length: 1.4 }),
    ];
    this.setColor(color);
    avatar.onDownstroke = (strength) => this.downstroke(strength);
  }

  get meshes(): THREE.Object3D[] {
    return this.trails.map((t) => t.mesh);
  }

  setColor(value: string) {
    this.head.copy(WARM);
    this.body.copy(WARM).lerp(new THREE.Color(value), FX.lightTint);
    const ribbon = this.ghost ? "#ffffff" : WARM.getStyle();
    const tail = this.ghost ? "#ffffff" : this.body.getStyle();
    for (const trail of this.trails) trail.setColor(ribbon, tail);
  }

  reset() {
    this.trails.forEach((t) => t.reset());
    this.debtL = this.debtR = this.spiralDebt = this.brakeDebt = this.wispDebt = 0;
  }

  hide() {
    this.trails.forEach((t) => (t.opacity = 0));
  }

  /** Call after the avatar has animated this frame; particles only flow while `moving` */
  update(dt: number, speed: number, velocity: THREE.Vector3, proximity: number, moving = true) {
    const avatar = this.avatar;
    this.velocity.copy(velocity);
    this.moving = moving;
    avatar.group.updateWorldMatrix(true, true);
    avatar.wingtips(tipL, tipR);
    avatar.span(span);
    avatar.capeTip(cape);
    avatar.group.getWorldPosition(this.center);

    const barrel = avatar.barrelProgress >= 0 ? Math.sin(Math.PI * avatar.barrelProgress) : 0;
    const wingOpacity = THREE.MathUtils.clamp(0.12 + (speed - 30) / 60 + proximity * 0.4 + barrel * 0.5 + avatar.boost * 0.3 - avatar.brake * 0.2, 0, 0.8);
    const lengthScale = 1 + avatar.boost * 0.45 - avatar.brake * 0.35;
    for (const trail of this.trails) trail.glowScale = 1 + avatar.boost * FX.boostTrailGlow;
    this.trails[0].push(tipL, span, lengthScale);
    this.trails[1].push(tipR, span, lengthScale);
    this.trails[0].opacity = wingOpacity * (this.ghost ? 0.6 : 1);
    this.trails[1].opacity = wingOpacity * (this.ghost ? 0.6 : 1);
    this.trails[2].push(cape, span, lengthScale);
    this.trails[2].opacity = FX.bodyTrail
      ? THREE.MathUtils.clamp(0.08 + (speed - 25) / 90 + proximity * 0.25, 0, 0.45) * (this.ghost ? 0.4 : 1)
      : 0;

    const particles = this.particles;
    if (!particles || dt <= 0 || !moving) return;
    const budget = particles.budget * this.share;
    this.brakeDebt += dt * FX.brakeWisps * avatar.brake * budget;
    for (; this.brakeDebt >= 1; this.brakeDebt--) {
      particles.emit(Math.random() < 0.5 ? tipL : tipR,
        vel.copy(velocity).multiplyScalar(0.12),
        fx(0.35, 0.7, this.head, Kind.Wisp, 0, 2, 0.5));
    }

    // Cloud wisps: at speed the wingtips tear soft puffs of cloud that hang in the air behind you
    if (this.soft && FX.wisps > 0) {
      this.wispDebt += smoothstep(FX.wispsFrom, FX.wispsFrom + 30, speed) * 14 * FX.wisps * budget * dt;
      for (; this.wispDebt >= 1; this.wispDebt--) {
        const tip = this.wispSide ? tipL : tipR;
        this.wispSide = !this.wispSide;
        this.soft.emit(
          at.copy(tip).addScaledVector(velocity, -0.02),
          vel.copy(velocity).multiplyScalar(0.04).add(jitter.set(rand(-0.6, 0.6), rand(-0.3, 0.5), rand(-0.6, 0.6))),
          fx(rand(1.2, 2.2), rand(1.4, 2.6), WISP, Kind.Glow, -0.1, 2.5, 0.35),
        );
      }
    }

    // Light motes shed from the wingtips: few and large, drifting up slowly like Sky's winged light
    const rate = (4 + speed * 0.35) * FX.sparkles * budget * (1 + proximity + avatar.boost);
    this.debtL += rate * dt;
    this.debtR += rate * dt;
    for (; this.debtL >= 1; this.debtL--) this.mote(tipL);
    for (; this.debtR >= 1; this.debtR--) this.mote(tipR);

    // A spiral of stars while rolling
    if (barrel > 0) {
      this.spiralDebt += 140 * barrel * budget * dt;
      for (; this.spiralDebt >= 1; this.spiralDebt--) {
        const tip = Math.random() < 0.5 ? tipL : tipR;
        particles.emit(
          at.copy(tip).addScaledVector(span, rand(-0.2, 0.2)),
          vel.copy(velocity).multiplyScalar(0.1).addScaledVector(span, rand(-1, 1)),
          fx(rand(0.7, 1.2), rand(0.35, 0.6), this.gold, Kind.Star, 0, 2, 2.6),
        );
      }
    }
  }

  private mote(tip: THREE.Vector3) {
    const star = Math.random() < 0.55;
    color.copy(this.head).lerp(this.body, Math.random());
    this.particles!.emit(
      at.set(tip.x + rand(-0.25, 0.25), tip.y + rand(-0.25, 0.25), tip.z + rand(-0.25, 0.25)),
      vel.copy(this.velocity).multiplyScalar(0.08).add(jitter.set(rand(-0.7, 0.7), rand(-0.2, 0.9), rand(-0.7, 0.7))),
      fx(rand(1.2, 2.4), star ? rand(0.45, 0.8) : rand(0.3, 0.55), color, star ? Kind.Star : Kind.Glow, -0.45, 2.2, this.ghost ? 0.7 : rand(1.1, 1.7)),
    );
  }

  /** A puff of air and feathers of light pushed down and back off each wing */
  private downstroke(strength: number) {
    const particles = this.particles;
    if (!particles || FX.flapPuffs <= 0 || !this.moving) return;
    const count = Math.round((4 + strength * 12) * FX.flapPuffs * particles.budget * this.share);
    down.set(0, -1, 0).applyQuaternion(this.avatar.group.quaternion);
    for (let i = 0; i < count; i++) {
      const tip = i % 2 ? tipL : tipR;
      const f = rand(0.35, 1);
      // Somewhere along the wing, between the shoulder and the tip
      at.lerpVectors(this.center, tip, f);
      const wisp = i % 3 !== 0;
      particles.emit(
        at,
        vel
          .copy(down)
          .multiplyScalar(rand(3, 6) * strength + 1)
          .addScaledVector(this.velocity, 0.25),
        wisp
          ? fx(rand(0.5, 0.8), rand(0.8, 1.4), this.head, Kind.Wisp, 0, 3, 0.5)
          : fx(rand(0.6, 1), rand(0.25, 0.45), this.gold, Kind.Star, 0, 2, 2),
      );
    }
  }

  dispose() {
    this.trails.forEach((t) => t.dispose());
  }
}
