import * as THREE from "three";
import type { Avatar } from "./avatar";
import { FX_LIGHT, Kind, type Particles, fx } from "./particles";
import { Trail } from "./trail";
import { FX, COSMETIC_FX, JAR_FX } from "./tuning";
import { type WingLayer, skyTint, wingParticles } from "./cosmetics/wingParticles";
import type { JarMotes } from "./cosmetics/jars";
import { type JarsModule, jarsModule } from "./cosmetics/jarLoader";
import type { JarId } from "./cosmetics/catalog";

const tipL = new THREE.Vector3();
const tipR = new THREE.Vector3();
const span = new THREE.Vector3();
const cape = new THREE.Vector3();
const at = new THREE.Vector3();
const vel = new THREE.Vector3();
const color = new THREE.Color();
const tinted = new THREE.Color();
const down = new THREE.Vector3();
const jitter = new THREE.Vector3();
const drift = new THREE.Vector3();
const settledL = new THREE.Vector3();
const settledR = new THREE.Vector3();
const toRig = new THREE.Matrix4();

/** Half the size of the space round the pilot a worn jar's aura drifts in (m: across, up, along the body) */
const JAR_AURA = new THREE.Vector3(1.05, 0.75, 1.25);
/** The richest aura (a legendary jar's): the most motes one can show */
const JAR_MOTES = 28;

/** Seconds over which the ribbons calm the wingtips' flap: fast beats leave a gentle wave, not a zigzag */
const RIBBON_CALM = 0.07;

const rand = (min: number, max: number) => min + Math.random() * (max - min);

export interface PilotFxOptions {
  /** Share of the particle effects this pilot gets (others' pilots get fewer than yours) */
  share?: number;
  ghost?: boolean;
  /** Ordinarily blended particles: the wings' non-glowing shapes go here on light skies (none: always added light) */
  solid?: Particles;
}

/**
 * Everything a pilot leaves in the air: glowing ribbons from the wingtips and
 * the cape, light motes shed from the wings like in Sky, puffs of air on each
 * downstroke, a spiral of stars during barrel rolls, and a worn particle jar's aura and trail.
 */
export class PilotFx {
  readonly trails: Trail[];
  private readonly avatar: Avatar;
  private readonly particles: Particles | null;
  private readonly solid: Particles | null;
  private readonly share: number;
  private readonly ghost: boolean;
  private readonly head = new THREE.Color();
  private readonly body = new THREE.Color();
  private readonly gold = new THREE.Color("#ffd779");
  private readonly ivory = new THREE.Color("#fff4d6");
  private debtL = 0;
  private debtR = 0;
  private spiralDebt = 0;
  private boostDebt = 0;
  private rollGrain = 0;
  private boostGrain = 0;
  private readonly velocity = new THREE.Vector3();
  private readonly center = new THREE.Vector3();
  private moving = true;
  private wind = false;
  private brakeDebt = 0;
  /** Particles owed to each layer of the worn wings' recipe */
  private readonly wingDebts = [0, 0, 0, 0, 0, 0];
  private readonly previousL = new THREE.Vector3();
  private readonly previousR = new THREE.Vector3();
  private readonly previousCenter = new THREE.Vector3();
  private hasPrevious = false;
  /** The wingtips in the body's frame, with the flap calmed (`RIBBON_CALM`) */
  private readonly calmL = new THREE.Vector3();
  private readonly calmR = new THREE.Vector3();
  private calmed = false;
  /** A worn particle jar's aura (carried by the pilot, made once the jars' code has loaded), how much of it shows, and its trail's debt */
  private jarMotes: JarMotes | null = null;
  private jarShown = 0;
  private jarDebt = 0;
  private jarGrain = 0;

  constructor(avatar: Avatar, color: string, particles: Particles | null, options: PilotFxOptions = {}) {
    this.avatar = avatar;
    this.particles = particles;
    this.solid = options.solid ?? null;
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
    this.calmed = false;
    this.debtL = this.debtR = this.spiralDebt = this.boostDebt = this.brakeDebt = this.jarDebt = 0;
    this.wingDebts.fill(0);
    this.rollGrain = this.boostGrain = 0;
  }

  hide() {
    this.trails.forEach((t) => (t.opacity = 0));
  }

  /**
   * Call after the avatar has animated this frame; particles only flow while `moving`. `wind`: the pilot
   * is held still (the finale) but flies through the air at `velocity` all the same: motes, puffs and
   * ribbons stream back past them as they would in flight
   */
  update(dt: number, speed: number, velocity: THREE.Vector3, proximity: number, moving = true, wind = false) {
    const avatar = this.avatar;
    this.velocity.copy(velocity);
    this.moving = moving;
    this.wind = wind;
    if (wind) {
      drift.copy(velocity).multiplyScalar(-dt);
      for (const trail of this.trails) trail.drift(drift);
    }
    avatar.group.updateWorldMatrix(true, true);
    avatar.wingtips(tipL, tipR);
    avatar.span(span);
    avatar.capeTip(cape);
    avatar.group.getWorldPosition(this.center);

    const barrel = avatar.barrelProgress >= 0 ? Math.sin(Math.PI * avatar.barrelProgress) : 0;
    const wingOpacity = THREE.MathUtils.clamp(0.18 + (speed - 30) / 45 + proximity * 0.5 + barrel * 0.6 + avatar.boost * 0.3 - avatar.brake * 0.2, 0, 0.95);
    const lengthScale = 1 + avatar.boost * 0.45 - avatar.brake * 0.35;
    for (const trail of this.trails) trail.glowScale = 1 + avatar.boost * FX.boostTrailGlow;
    // The ribbons keep the tips' path with the flap calmed, in the body's (rolled) frame so a barrel
    // roll still draws its spiral exactly
    const rig = avatar.rigMatrix;
    toRig.copy(rig).invert();
    settledL.copy(tipL).applyMatrix4(toRig);
    settledR.copy(tipR).applyMatrix4(toRig);
    if (!this.calmed) {
      this.calmL.copy(settledL);
      this.calmR.copy(settledR);
      this.calmed = true;
    }
    const calm = 1 - Math.exp(-dt / RIBBON_CALM);
    this.calmL.lerp(settledL, calm);
    this.calmR.lerp(settledR, calm);
    settledL.copy(this.calmL).applyMatrix4(rig);
    settledR.copy(this.calmR).applyMatrix4(rig);
    this.trails[0].push(tipL, span, lengthScale, settledL);
    this.trails[1].push(tipR, span, lengthScale, settledR);
    this.trails[0].opacity = wingOpacity * (this.ghost ? 0.6 : 1);
    this.trails[1].opacity = wingOpacity * (this.ghost ? 0.6 : 1);
    this.trails[2].push(cape, span, lengthScale);
    this.trails[2].opacity = FX.bodyTrail
      ? THREE.MathUtils.clamp(0.12 + (speed - 25) / 70 + proximity * 0.3, 0, 0.6) * (this.ghost ? 0.4 : 1)
      : 0;

    // A worn jar's aura shows whenever the pilot is about (not mid-crash); its trail only streams in flight
    const jar = avatar.jarStyle;
    const jars = jar !== "none" || this.jarMotes ? jarsModule() : null;
    if (jars && !this.jarMotes) {
      this.jarMotes = new jars.JarMotes(JAR_MOTES, JAR_AURA);
      avatar.group.add(this.jarMotes.points);
    }
    this.jarMotes?.set(jar);
    this.jarShown += ((jar !== "none" && !avatar.dying ? 1 : 0) - this.jarShown) * (1 - Math.exp(-dt * 4));
    if (jars && this.jarMotes && jar !== "none") {
      this.jarMotes.opacity = this.jarShown * (this.ghost ? 0.5 : 1);
      this.jarMotes.scale = JAR_FX.auraSize;
      this.jarMotes.update(dt, jars.jarLook(jar).auraCount * JAR_FX.aura * (this.particles?.budget ?? 1) * this.share);
    }

    if (!this.hasPrevious || !moving) this.rememberPose();
    const particles = this.particles;
    if (!particles || dt <= 0 || !moving) {
      this.rememberPose();
      return;
    }
    const budget = particles.budget * this.share;
    // The worn wings' own particles: each layer of their recipe (cosmetics/wingParticles.ts)
    const layers = wingParticles(avatar.wingStyle).layers;
    for (let l = 0; l < layers.length && l < this.wingDebts.length; l++) {
      const layer = layers[l];
      const layerRate = layer.rate * COSMETIC_FX.wingParticles * budget;
      if (layerRate <= 0) continue;
      this.wingDebts[l] += dt * layerRate;
      for (; this.wingDebts[l] >= 1; this.wingDebts[l]--) {
        const age = (this.wingDebts[l] - 1) / layerRate;
        const left = Math.random() < .5;
        this.sampleTip(left ? tipL : tipR, left ? this.previousL : this.previousR, age, dt);
        jitter.lerpVectors(this.center, this.previousCenter, THREE.MathUtils.clamp(age / dt, 0, 1));
        // From somewhere between `from` and the tip, towards the shoulder
        at.lerp(jitter, rand(0, 1 - layer.from));
        this.wingGrain(layer, at, vel.copy(velocity).multiplyScalar(.07), 1, age);
      }
    }
    if (jars && jar !== "none" && !avatar.dying) this.jarTrail(jars, jar, dt, budget);
    const brakeRate = FX.brakeWisps * avatar.brake * budget;
    this.brakeDebt += dt * brakeRate;
    for (; this.brakeDebt >= 1; this.brakeDebt--) {
      const age = (this.brakeDebt - 1) / brakeRate;
      const left = Math.random() < 0.5;
      this.sampleTip(left ? tipL : tipR, left ? this.previousL : this.previousR, age, dt);
      this.emit(at,
        vel.copy(velocity).multiplyScalar(0.12),
        fx(0.3, FX.wingPuffSize, this.head, Kind.Wisp, 0, 2, 0.25), age);
    }

    // Light motes shed from the wingtips: more with speed, a sky-like drift upwards
    const rate = (10 + speed * 0.9) * FX.sparkles * budget * (1 + proximity);
    this.debtL += rate * dt;
    this.debtR += rate * dt;
    for (; this.debtL >= 1; this.debtL--) this.mote(tipL, this.previousL, (this.debtL - 1) / rate, dt);
    for (; this.debtR >= 1; this.debtR--) this.mote(tipR, this.previousR, (this.debtR - 1) / rate, dt);

    // Boost: small gold dust with occasional ivory slivers, swept backwards.
    // Sample each birth along the wing movement, never a bright batch at one point.
    const boostRate = FX.boostSparkles * avatar.boost * budget;
    this.boostDebt += boostRate * dt;
    for (; this.boostDebt >= 1; this.boostDebt--) {
      const age = (this.boostDebt - 1) / boostRate;
      const grain = this.boostGrain++;
      const left = grain % 2 === 0;
      this.sampleTip(left ? tipL : tipR, left ? this.previousL : this.previousR, age, dt);
      jitter.lerpVectors(this.center, this.previousCenter, age / dt);
      at.lerp(jitter, rand(0, 0.3)).addScaledVector(span, rand(-0.08, 0.08));
      const sliver = grain % 3 === 0;
      this.emit(at,
        vel.copy(velocity).multiplyScalar(-0.08).addScaledVector(span, (left ? -1 : 1) * rand(0.3, 1)),
        fx(rand(0.25, 0.5), FX.wingGrainSize * (sliver ? rand(1.1, 1.5) : rand(0.7, 1.1)),
          sliver ? this.ivory : this.gold, sliver ? Kind.Shard : Kind.Glow, 0, 1.5,
          FX.wingGrainLight * (this.ghost ? 0.6 : 0.95)), age);
    }
    if (avatar.boost <= 0) this.boostDebt = 0;

    // Rolling wingtips leave two fine golden arcs: twinkles mixed with tiny flakes.
    if (barrel > 0) {
      const spiralRate = FX.rollSparkles * barrel * budget;
      this.spiralDebt += spiralRate * dt;
      for (; this.spiralDebt >= 1; this.spiralDebt--) {
        const age = (this.spiralDebt - 1) / spiralRate;
        const grain = this.rollGrain++;
        const left = grain % 2 === 0;
        const flake = grain % 3 === 0;
        this.sampleTip(left ? tipL : tipR, left ? this.previousL : this.previousR, age, dt);
        this.emit(
          at.addScaledVector(span, rand(-0.08, 0.08)),
          vel.copy(velocity).multiplyScalar(0.1).addScaledVector(span, rand(-1, 1)),
          fx(rand(0.45, 0.75), FX.wingGrainSize * rand(1, 1.6), this.gold,
            flake ? Kind.Shard : Kind.Star, 0, 2, FX.wingGrainLight * (this.ghost ? 0.6 : 1.1)),
          age,
        );
      }
    } else {
      this.spiralDebt = 0;
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
    this.emit(
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
    // Rare and legendary wings throw a fan of their first layer off every beat
    const recipe = wingParticles(this.avatar.wingStyle);
    const fan = Math.round(recipe.burst * strength * particles.budget * this.share);
    for (let i = 0; i < fan; i++) {
      at.lerpVectors(this.center, i % 2 ? tipL : tipR, rand(0.35, 1));
      this.wingGrain(recipe.layers[0], at, vel.copy(down).multiplyScalar(rand(2, 5)).addScaledVector(this.velocity, 0.2), 1.25);
    }
    for (let i = 0; i < count; i++) {
      const tip = i % 2 ? tipL : tipR;
      const f = rand(0.35, 1);
      // Somewhere along the wing, between the shoulder and the tip
      at.lerpVectors(this.center, tip, f);
      const wisp = i % 3 !== 0;
      this.emit(
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

  /**
   * A worn jar's particles streaming off behind: born round the body along this frame's path, drifting slowly
   * so they hang in the air the pilot has passed through. Glowing jars add light; plain ones are drawn solid
   */
  private jarTrail(jars: JarsModule, jar: JarId, dt: number, budget: number) {
    const look = jars.jarLook(jar);
    const { trail, kind } = look.recipe;
    const rate = trail.rate * look.trailRichness * JAR_FX.trail * budget;
    if (rate <= 0) return;
    this.jarDebt += dt * rate;
    const into = look.glow ? null : this.solid;
    const spread = trail.scatter;
    for (; this.jarDebt >= 1; this.jarDebt--) {
      const age = (this.jarDebt - 1) / rate;
      at.lerpVectors(this.center, this.previousCenter, THREE.MathUtils.clamp(age / dt, 0, 1))
        .add(jitter.set(rand(-0.5, 0.5), rand(-0.35, 0.4), rand(-0.5, 0.5)));
      vel.copy(this.velocity).multiplyScalar(0.06).add(jitter.set(rand(-spread, spread), rand(-spread * 0.6, spread), rand(-spread, spread)));
      // Legendary trails throw a big "hero" piece now and then
      const hero = look.rarity >= 3 && this.jarGrain++ % 5 === 0;
      const size = rand(trail.size[0], trail.size[1]) * JAR_FX.trailSize * (hero ? 1.8 : 1);
      const bright = look.glow ? look.recipe.light * JAR_FX.glow * (this.ghost ? 0.6 : 1) : into ? 1 : 0.8;
      this.emit(at, vel, fx(rand(trail.life[0], trail.life[1]) * (hero ? 1.3 : 1), size,
        look.colors[Math.floor(Math.random() * look.colors.length)], kind, trail.gravity, trail.drag, bright), age, into);
    }
  }

  /** One particle of a wing recipe's layer, its shape and color picked from the layer's */
  private wingGrain(layer: WingLayer, position: THREE.Vector3, velocity: THREE.Vector3, light: number, age = 0) {
    const spread = layer.scatter;
    velocity.add(jitter.set(rand(-spread, spread), rand(-spread * 0.6, spread), rand(-spread, spread)));
    const kind = layer.kinds[Math.floor(Math.random() * layer.kinds.length)];
    const dark = FX_LIGHT.dark;
    const tint = skyTint(layer.colors[Math.floor(Math.random() * layer.colors.length)], dark, tinted);
    // On a light sky added light vanishes: plain shapes are drawn solid (full color, no extra brightness)
    const solid = !layer.glow && !dark && this.solid ? this.solid : null;
    const bright = solid ? 1 : layer.light * light * (layer.glow ? COSMETIC_FX.glowParticles : 1) * (this.ghost ? 0.6 : 1);
    this.emit(position, velocity, fx(rand(layer.life[0], layer.life[1]),
      COSMETIC_FX.wingParticleSize * rand(layer.size[0], layer.size[1]), tint, kind, layer.gravity, layer.drag,
      bright), age, solid);
  }

  /** Emits a particle; held still in moving air, it is blown back as if the pilot were flying on */
  private emit(position: THREE.Vector3, velocity: THREE.Vector3, spec: Parameters<Particles["emit"]>[2], age = 0, into: Particles | null = null) {
    if (this.wind) velocity.sub(this.velocity);
    (into ?? this.particles!).emit(position, velocity, spec, age);
  }

  dispose() {
    this.trails.forEach((t) => t.dispose());
    this.jarMotes?.dispose();
  }
}
