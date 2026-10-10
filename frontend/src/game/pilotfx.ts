import * as THREE from "three";
import type { Avatar } from "./avatar";
import { Kind, type Particles, fx } from "./particles";
import { Trail } from "./trail";
import { FX, COSMETIC_FX } from "./tuning";
import { wingSpec } from "./cosmetics/catalog";

const tipL = new THREE.Vector3();
const tipR = new THREE.Vector3();
const span = new THREE.Vector3();
const cape = new THREE.Vector3();
const at = new THREE.Vector3();
const vel = new THREE.Vector3();
const color = new THREE.Color();
const down = new THREE.Vector3();
const jitter = new THREE.Vector3();

const rand = (min: number, max: number) => min + Math.random() * (max - min);

export interface PilotFxOptions {
  /** Share of the particle effects this pilot gets (others' pilots get fewer than yours) */
  share?: number;
  ghost?: boolean;
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
  private readonly share: number;
  private readonly ghost: boolean;
  private readonly head = new THREE.Color();
  private readonly body = new THREE.Color();
  private readonly gold = new THREE.Color("#ffe6a0");
  private debtL = 0;
  private debtR = 0;
  private spiralDebt = 0;
  private readonly velocity = new THREE.Vector3();
  private readonly center = new THREE.Vector3();
  private moving = true;
  private brakeDebt = 0;
  private wingDebt = 0;
  private readonly previousL = new THREE.Vector3();
  private readonly previousR = new THREE.Vector3();
  private readonly previousCenter = new THREE.Vector3();
  private hasPrevious = false;

  constructor(avatar: Avatar, color: string, particles: Particles | null, options: PilotFxOptions = {}) {
    this.avatar = avatar;
    this.particles = particles;
    this.share = options.share ?? 1;
    this.ghost = !!options.ghost;
    this.trails = [
      new Trail(color, { width: 0.16, shimmer: 1 }),
      new Trail(color, { width: 0.16, shimmer: 1 }),
      new Trail(color, { width: 0.55, shimmer: 0.35, length: 1.4 }),
    ];
    this.setColor(color);
    avatar.onDownstroke = (strength) => this.downstroke(strength);
  }

  get meshes(): THREE.Object3D[] {
    return this.trails.map((t) => t.mesh);
  }

  setColor(value: string) {
    this.body.set(value);
    this.head.set(value).lerp(new THREE.Color("#ffffff"), 0.6);
    const ribbon = this.ghost ? "#ffffff" : value;
    this.trails[0].setColor(ribbon);
    this.trails[1].setColor(ribbon);
    this.trails[2].setColor(ribbon, this.ghost ? "#ffffff" : new THREE.Color(value).multiplyScalar(0.8).getStyle());
  }

  reset() {
    this.trails.forEach((t) => t.reset());
    this.hasPrevious = false;
    this.debtL = this.debtR = this.spiralDebt = this.brakeDebt = this.wingDebt = 0;
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
    const wingOpacity = THREE.MathUtils.clamp(0.18 + (speed - 30) / 45 + proximity * 0.5 + barrel * 0.6 + avatar.boost * 0.3 - avatar.brake * 0.2, 0, 0.95);
    const lengthScale = 1 + avatar.boost * 0.45 - avatar.brake * 0.35;
    for (const trail of this.trails) trail.glowScale = 1 + avatar.boost * FX.boostTrailGlow;
    this.trails[0].push(tipL, span, lengthScale);
    this.trails[1].push(tipR, span, lengthScale);
    this.trails[0].opacity = wingOpacity * (this.ghost ? 0.6 : 1);
    this.trails[1].opacity = wingOpacity * (this.ghost ? 0.6 : 1);
    this.trails[2].push(cape, span, lengthScale);
    this.trails[2].opacity = FX.bodyTrail
      ? THREE.MathUtils.clamp(0.12 + (speed - 25) / 70 + proximity * 0.3, 0, 0.6) * (this.ghost ? 0.4 : 1)
      : 0;

    if (!this.hasPrevious || !moving) this.rememberPose();
    const particles = this.particles;
    if (!particles || dt <= 0 || !moving) {
      this.rememberPose();
      return;
    }
    const budget = particles.budget * this.share;
    const style = avatar.wingStyle;
    if (style !== "classic") {
      const wingRate = COSMETIC_FX.wingParticles * budget * (style === "astral" ? 1.5 : 1);
      this.wingDebt += dt * wingRate;
      color.set(wingSpec(style).accent);
      for (; this.wingDebt >= 1; this.wingDebt--) {
        const age = (this.wingDebt - 1) / wingRate;
        const left = Math.random() < .5;
        this.sampleTip(left ? tipL : tipR, left ? this.previousL : this.previousR, age, dt);
        jitter.lerpVectors(this.center, this.previousCenter, age / dt);
        at.lerp(jitter, rand(0, .65));
        particles.emit(at, vel.copy(velocity).multiplyScalar(.08), fx(.55, COSMETIC_FX.wingParticleSize * rand(.75, 1.15), color,
          style === "astral" ? Kind.Star : style === "frost" || style === "storm" ? Kind.Shard : style === "tide" ? Kind.Bubble : Kind.Glow, -.3, 1.5, .9), age);
      }
    }
    const brakeRate = FX.brakeWisps * avatar.brake * budget;
    this.brakeDebt += dt * brakeRate;
    for (; this.brakeDebt >= 1; this.brakeDebt--) {
      const age = (this.brakeDebt - 1) / brakeRate;
      const left = Math.random() < 0.5;
      this.sampleTip(left ? tipL : tipR, left ? this.previousL : this.previousR, age, dt);
      particles.emit(at,
        vel.copy(velocity).multiplyScalar(0.12),
        fx(0.3, FX.wingPuffSize, this.head, Kind.Wisp, 0, 2, 0.25), age);
    }

    // Light motes shed from the wingtips: more with speed, a sky-like drift upwards
    const rate = (10 + speed * 0.9) * FX.sparkles * budget * (1 + proximity + avatar.boost);
    this.debtL += rate * dt;
    this.debtR += rate * dt;
    for (; this.debtL >= 1; this.debtL--) this.mote(tipL, this.previousL, (this.debtL - 1) / rate, dt);
    for (; this.debtR >= 1; this.debtR--) this.mote(tipR, this.previousR, (this.debtR - 1) / rate, dt);

    // A spiral of stars while rolling
    if (barrel > 0) {
      const spiralRate = 140 * barrel * budget;
      this.spiralDebt += spiralRate * dt;
      for (; this.spiralDebt >= 1; this.spiralDebt--) {
        const age = (this.spiralDebt - 1) / spiralRate;
        const left = Math.random() < 0.5;
        this.sampleTip(left ? tipL : tipR, left ? this.previousL : this.previousR, age, dt);
        particles.emit(
          at.addScaledVector(span, rand(-0.2, 0.2)),
          vel.copy(velocity).multiplyScalar(0.1).addScaledVector(span, rand(-1, 1)),
          fx(rand(0.5, 0.9), FX.wingGrainSize * rand(1.2, 1.8), this.gold, Kind.Star, 0, 2, FX.wingGrainLight * 1.2),
          age,
        );
      }
    }
    this.rememberPose();
  }

  private rememberPose() {
    this.previousL.copy(tipL);
    this.previousR.copy(tipR);
    this.previousCenter.copy(this.center);
    this.hasPrevious = true;
  }

  private sampleTip(tip: THREE.Vector3, previous: THREE.Vector3, age: number, dt: number) {
    at.lerpVectors(tip, previous, THREE.MathUtils.clamp(age / dt, 0, 1));
  }

  private mote(tip: THREE.Vector3, previous: THREE.Vector3, age: number, dt: number) {
    const star = Math.random() < 0.12;
    this.sampleTip(tip, previous, age, dt);
    color.copy(this.head).lerp(this.body, Math.random() * 0.6);
    this.particles!.emit(
      at.add(jitter.set(rand(-0.16, 0.16), rand(-0.16, 0.16), rand(-0.16, 0.16))),
      vel.copy(this.velocity).multiplyScalar(0.12).add(jitter.set(rand(-1.2, 1.2), rand(-0.4, 1.2), rand(-1.2, 1.2))),
      fx(rand(0.45, 0.85), FX.wingGrainSize * (star ? rand(1.2, 1.8) : rand(0.75, 1.15)), color,
        star ? Kind.Star : Kind.Glow, -0.6, 1.4, FX.wingGrainLight * (this.ghost ? 0.6 : rand(0.8, 1.1))),
      age,
    );
  }

  /** A puff of air and feathers of light pushed down and back off each wing */
  private downstroke(strength: number) {
    const particles = this.particles;
    if (!particles || FX.flapPuffs <= 0 || !this.moving) return;
    const count = Math.round((2 + strength * 6) * FX.flapPuffs * particles.budget * this.share);
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
          ? fx(rand(0.3, 0.5), FX.wingPuffSize * rand(0.7, 1.2), this.head, Kind.Wisp, 0, 3, 0.25)
          : fx(rand(0.4, 0.7), FX.wingGrainSize * rand(1.2, 1.8), this.gold, Kind.Star, 0, 2, FX.wingGrainLight),
      );
    }
  }

  dispose() {
    this.trails.forEach((t) => t.dispose());
  }
}
