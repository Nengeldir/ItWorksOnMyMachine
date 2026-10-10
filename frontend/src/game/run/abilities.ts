import * as THREE from "three";
import { FLIGHT, type Flight, type FlightInput, type FlightMods, type HitPart } from "../flight";
import { clamp, smoothstep } from "../math";
import { makeRng, range } from "../rng";
import type { Course, Ring } from "../world/course";
import type { World } from "../world/World";
import type { RunStats, UpgradeId } from "./upgrades";

// The rules of the design list's first ten abilities (CLAUDE.md, "Items and
// abilities"), for runs only: the run controller hands them the flight state
// every physics step and they answer with FlightMods (thrust, a dive, the
// hover-stall), boost refills and points. What they look like is in
// game/abilities/ (AbilityFx), which only reads this.

/** Ability physics and scoring. Shown in ?tune, not saved (like FLIGHT) */
export const ABILITY = {
  // Skim-Booster: proximity above `thrillFrom` refills the boost reserve, per stack
  thrillFrom: 0.25,
  thrillRefill: 0.55, // reserve per second at full thrill (the boost drains 0.4/s)
  // Cloud-Surfing: just over a cloud lane
  surfHeight: 7, // metres above the lane's top that still count as surfing
  surfThrust: 7, // m/s²…
  surfTopSpeed: 62, // …fading out by this speed
  surfRefill: 0.35, // boost reserve per second
  surfStamina: 0.5, // wingbeats per second
  // Plunging Attack
  plungeAngle: 62, // degrees below the horizon
  plungeTime: 1.6, // seconds at most
  plungeThrust: 16, // m/s²
  plungeCooldown: 5,
  plungeBonus: 300, // points for a gate struck mid-plunge, times the gate chain
  // Wind-Shear Dash (the Q / E dodge, upgraded)
  shearDistance: 9,
  shearDuration: 0.16,
  shearCooldown: 0.8,
  // Slipstream Rider: the wake behind the spirit manta
  slipLength: 34, // metres behind it
  slipRadius: 5, // metres across, at its tail (wider further back)
  slipThrust: 16, // m/s²…
  slipTopSpeed: 74, // …up to this speed (the manta's own top speed)
  // Gale Force (elemental burst)
  burstTime: 4, // seconds of wind
  burstThrust: 20, // m/s² inside the tunnel
  burstTopSpeed: 105,
  burstLength: 320, // metres of tunnel ahead
  burstRadius: 16,
  burstWiden: 6, // metres added to the gates inside
  burstPerGate: 0.25, // energy per gate
  burstPerSecond: 1 / 50, // energy trickling in
  burstPerSkim: 0.05, // energy per second of full proximity
  // Acrobatic Recovery
  recoverCooldown: 4,
  recoverKeep: 0.92, // share of the speed kept
  recoverPush: 0.8, // metres out of the rock
  // Hover-Stall
  hangTime: 2, // seconds hovering
  hangCooldown: 7,
  hangLaunch: 0.8, // share of the speed going in, coming out…
  hangMinLaunch: 28, // …at least this
};

/** A river of cloud along the racing line, just under it (Cloud-Surfing) */
export interface CloudLane {
  z0: number;
  z1: number;
  /** Metres from the line down to the lane's top */
  depth: number;
  /** Metres across */
  width: number;
  phase: number;
}

/** The lane's top at `z`, and its middle across (x), into `out` (x, top, z) */
export function laneAt(course: Course, lane: CloudLane, z: number, out: THREE.Vector3): THREE.Vector3 {
  const swell = Math.sin(z * 0.021 + lane.phase) * 0.8 + Math.sin(z * 0.047 + lane.phase * 2.3) * 0.4;
  return out.set(course.x(z) + Math.sin(z * 0.013 + lane.phase) * 2, course.y(z) - lane.depth + swell, z);
}

/** Puffs taper in and out at a lane's ends: 0..1 */
export function laneFade(lane: CloudLane, z: number): number {
  return smoothstep(lane.z0, lane.z0 + 30, z) * (1 - smoothstep(lane.z1 - 30, lane.z1, z));
}

const rel = new THREE.Vector3();
/** A push along the path, fading out as the speed nears its own top speed */
const push = (amount: number, top: number, speed: number) => amount * clamp((top - speed) / 15, 0, 1);
const point = new THREE.Vector3();
const SIDE = new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0);

export class Abilities {
  private stats: RunStats | null = null;
  private course: Course | null = null;
  private endZ = 0;
  /** Seconds into the current plunge (-1: none) and until the next */
  plunge = -1;
  plungeWait = 0;
  /** Seconds into the hover-stall (-1: none) and until the next; the speed going in */
  hang = -1;
  hangWait = 0;
  private hangEntry = 0;
  /** Gale Force: 0..1 charged; seconds since it was unleashed (-1: not blowing) */
  energy = 0.5;
  burst = -1;
  readonly burstOrigin = new THREE.Vector3();
  readonly burstAxis = new THREE.Vector3(0, 0, -1);
  /** Seconds until Acrobatic Recovery is ready again */
  recoverWait = 0;
  /** 0..1, smoothed: how much each passive is working right now (the looks read these) */
  thrill = 0;
  surf = 0;
  slip = 0;
  /** Gates (indices) the Gale Force tunnel covers */
  readonly widened = new Set<number>();
  /** Wingbeats restored since the controller last took them */
  restore = 0;
  /** Cloud lanes of this level (always worked out; drawn and surfed with Cloud-Surfing) */
  readonly lanes: CloudLane[] = [];
  /** Bumped when the level changes, so the looks rebuild what depends on it */
  version = 0;
  /** The spirit manta (Slipstream Rider): where it is along the line, and how far it has faded in */
  readonly manta = {
    active: false,
    z: 0,
    speed: 30,
    time: 0,
    position: new THREE.Vector3(),
    tangent: new THREE.Vector3(0, 0, 1),
    /** Bumped when it reappears ahead of you */
    arrivals: 0,
  };
  /** One-off moments, counted so the looks can tell a new one happened */
  readonly cue = { plunge: 0, strike: 0, shear: 0, burst: 0, recover: 0, hang: 0, launch: 0 };
  strikeGate = -1;
  strikePoints = 0;
  readonly shearFrom = new THREE.Vector3();
  readonly shearQuaternion = new THREE.Quaternion();
  shearDirection: 1 | -1 = 1;
  readonly recoverPoint = new THREE.Vector3();
  readonly recoverNormal = new THREE.Vector3();
  private readonly shearParams = { ...FLIGHT };

  /** What the run's upgrades add up to */
  setStats(stats: RunStats) {
    this.stats = stats;
  }

  has(id: UpgradeId): boolean {
    return !!this.stats && this.stats[id as keyof RunStats] > 0;
  }

  level(stat: keyof RunStats): number {
    return this.stats?.[stat] ?? 0;
  }

  /** A new level: its cloud lanes, the manta back at the start, nothing under way */
  setLevel(world: World) {
    this.course = world.course;
    this.endZ = world.course.endZ;
    this.lanes.length = 0;
    // Three or four stretches of cloud between gates, the same for everyone on this level
    const rng = makeRng(world.seed, "cloud lanes");
    const gates = world.course.gates;
    const count = 3 + Math.floor(rng() * 2);
    const stride = Math.max(1, Math.floor((gates.length - 2) / count));
    for (let i = 0; i < count; i++) {
      const g = 1 + i * stride + Math.floor(rng() * Math.max(1, stride - 1));
      if (g >= gates.length - 1) break;
      const z0 = gates[g] + range(rng, 12, 30);
      const z1 = Math.min(gates[g + 1] + range(rng, 40, 140), this.endZ - 160);
      if (z1 - z0 < 80) continue;
      this.lanes.push({ z0, z1, depth: range(rng, 4.5, 6), width: range(rng, 14, 19), phase: range(rng, 0, 10) });
    }
    this.manta.active = false;
    this.reset();
    this.version++;
  }

  /** After a crash or a respawn: nothing under way */
  reset() {
    this.plunge = -1;
    this.hang = -1;
    this.burst = -1;
    this.widened.clear();
    this.thrill = this.surf = this.slip = 0;
  }

  /** The buttons: X plunges, G unleashes Gale Force, F hover-stalls (again: off early) */
  press(action: "plunge" | "burst" | "hover", flight: Flight): boolean {
    if (action === "plunge") {
      if (!this.has("plunge") || this.plunge >= 0 || this.plungeWait > 0 || this.hang >= 0) return false;
      this.plunge = 0;
      this.cue.plunge++;
      return true;
    }
    if (action === "burst") {
      if (!this.has("galeForce") || this.burst >= 0 || this.energy < 1) return false;
      this.energy = 0;
      this.burst = 0;
      this.burstOrigin.copy(flight.position);
      this.burstAxis.copy(flight.forward);
      this.widen();
      this.cue.burst++;
      return true;
    }
    if (!this.has("hoverStall")) return false;
    if (this.hang >= 0) {
      if (this.hang > 0.3) this.launch(flight);
      return this.hang < 0;
    }
    if (this.hangWait > 0 || this.plunge >= 0) return false;
    this.hang = 0;
    this.hangEntry = flight.speed;
    this.cue.hang++;
    return true;
  }

  private launch(flight: Flight) {
    flight.launch(Math.max(ABILITY.hangMinLaunch, this.hangEntry * ABILITY.hangLaunch));
    this.hang = -1;
    this.hangWait = ABILITY.hangCooldown;
    this.cue.launch++;
  }

  /** The gates inside the Gale Force tunnel */
  private widen() {
    this.widened.clear();
    const rings = this.course?.rings ?? [];
    for (const ring of rings) {
      rel.subVectors(ring.position, this.burstOrigin);
      const along = rel.dot(this.burstAxis);
      if (along < 0 || along > ABILITY.burstLength) continue;
      const across = rel.addScaledVector(this.burstAxis, -along).length();
      if (across < ABILITY.burstRadius + ring.radius) this.widened.add(ring.index);
    }
  }

  /** Is a point inside the Gale Force tunnel? */
  inTunnel(p: THREE.Vector3): boolean {
    rel.subVectors(p, this.burstOrigin);
    const along = rel.dot(this.burstAxis);
    if (along < -8 || along > ABILITY.burstLength) return false;
    return rel.addScaledVector(this.burstAxis, -along).lengthSq() < ABILITY.burstRadius ** 2;
  }

  /** The dodge's timing and distance: Wind-Shear Dash turns it into a blink */
  dodgeParams(): typeof FLIGHT {
    if (!this.has("windShear")) return FLIGHT;
    return Object.assign(this.shearParams, FLIGHT, {
      dodgeDistance: ABILITY.shearDistance,
      dodgeDuration: ABILITY.shearDuration,
      dodgeCooldown: ABILITY.shearCooldown,
    });
  }

  /** A dodge started from here (for the afterimage) */
  dodged(direction: 1 | -1, flight: Flight) {
    if (!this.has("windShear")) return;
    this.shearFrom.copy(flight.position);
    this.shearQuaternion.copy(flight.quaternion);
    this.shearDirection = direction;
    this.cue.shear++;
  }

  /** Extra metres on a gate's ring (Gale Force) */
  widening(ring: Ring): number {
    return this.burst >= 0 && this.widened.has(ring.index) ? ABILITY.burstWiden : 0;
  }

  /** A gate was passed: Gale Force charges, and a plunge strikes. Returns bonus points */
  gate(index: number, chain: number): number {
    if (this.has("galeForce") && this.burst < 0) this.energy = Math.min(1, this.energy + ABILITY.burstPerGate);
    if (this.plunge < 0) return 0;
    this.plunge = -1;
    this.plungeWait = ABILITY.plungeCooldown * 0.5;
    this.strikeGate = index;
    this.strikePoints = ABILITY.plungeBonus * Math.max(1, chain);
    this.cue.strike++;
    return this.strikePoints;
  }

  /** A wingtip clipped rock: can we roll away instead of crashing? (never for the body) */
  canRecover(part: HitPart | null): boolean {
    return part !== null && part !== "body" && this.has("acrobatic") && this.recoverWait <= 0 && this.hang < 0;
  }

  /** The roll away happened at `at`, off a surface facing `normal` */
  recovered(at: THREE.Vector3, normal: THREE.Vector3) {
    this.recoverWait = ABILITY.recoverCooldown;
    this.recoverPoint.copy(at);
    this.recoverNormal.copy(normal);
    this.plunge = -1;
    this.cue.recover++;
  }

  crashed() {
    this.reset();
  }

  /** Per physics step, after the flight moved: the next step's mods, refills, the manta */
  step(dt: number, input: FlightInput, proximity: number, flight: Flight, mods: FlightMods) {
    const course = this.course;
    if (!course) return;
    const speed = flight.speed;
    // Surfing a cloud lane makes everything come back twice as fast
    const recharge = dt * (1 + this.surf);
    this.plungeWait = Math.max(0, this.plungeWait - recharge);
    this.recoverWait = Math.max(0, this.recoverWait - recharge);
    if (this.hang < 0) this.hangWait = Math.max(0, this.hangWait - recharge);

    // Featherfalling is all multipliers (upgrades.ts); Skim-Booster: thrill from skimming refills the boost
    const thrill = this.has("skimBooster") ? clamp((proximity - ABILITY.thrillFrom) / (1 - ABILITY.thrillFrom), 0, 1) : 0;
    this.thrill += (thrill - this.thrill) * (1 - Math.exp(-dt * 6));
    if (this.thrill > 0.01) flight.boostCharge = Math.min(1, flight.boostCharge + ABILITY.thrillRefill * this.level("skimBooster") * this.thrill * dt);

    // Plunging Attack: nose hauled down, pushed along; pull up (or run out of time) to stop
    if (this.plunge >= 0) {
      this.plunge += dt;
      if (this.plunge > ABILITY.plungeTime || (this.plunge > 0.25 && input.pitch > 0.35)) {
        this.plunge = -1;
        this.plungeWait = ABILITY.plungeCooldown;
      } else {
        mods.dive = smoothstep(0, 0.15, this.plunge);
        mods.diveAngle = (ABILITY.plungeAngle * Math.PI) / 180;
        mods.thrust += push(ABILITY.plungeThrust, FLIGHT.maxSpeed, speed);
      }
    }

    // Hover-Stall: the flight model hangs (flight.ts) until the time is up, then off again
    if (this.hang >= 0) {
      this.hang += dt;
      if (this.hang >= ABILITY.hangTime) this.launch(flight);
      else mods.hang = true;
    }

    // Gale Force: charges from gates, skimming and time; blows for a while once unleashed
    if (this.has("galeForce") && this.burst < 0) this.energy = Math.min(1, this.energy + dt * (ABILITY.burstPerSecond + ABILITY.burstPerSkim * proximity));
    if (this.burst >= 0) {
      this.burst += dt;
      if (this.burst < ABILITY.burstTime && this.inTunnel(flight.position)) mods.thrust += push(ABILITY.burstThrust * (1 - smoothstep(ABILITY.burstTime - 1, ABILITY.burstTime, this.burst)), ABILITY.burstTopSpeed, speed);
      if (this.burst > ABILITY.burstTime + 1.5) {
        this.burst = -1;
        this.widened.clear();
      }
    }

    // Cloud-Surfing: just over a lane's top, and within its width
    let surf = 0;
    if (this.has("cloudSurf")) {
      const { x, y, z } = flight.position;
      for (const lane of this.lanes) {
        if (z < lane.z0 || z > lane.z1) continue;
        const fade = laneFade(lane, z);
        laneAt(course, lane, z, point);
        const height = y - point.y;
        if (height > -2.5 && height < ABILITY.surfHeight && Math.abs(x - point.x) < (lane.width / 2) * fade) {
          surf = 1 - smoothstep(ABILITY.surfHeight * 0.4, ABILITY.surfHeight, height);
        }
        break;
      }
    }
    this.surf += (surf - this.surf) * (1 - Math.exp(-dt * 8));
    if (surf > 0) {
      mods.thrust += push(ABILITY.surfThrust * surf, ABILITY.surfTopSpeed, speed);
      flight.boostCharge = Math.min(1, flight.boostCharge + ABILITY.surfRefill * surf * dt);
      this.restore += ABILITY.surfStamina * surf * dt;
    }

    // Slipstream Rider: the spirit manta, and its wake
    let slip = 0;
    if (this.has("slipstream")) {
      this.stepManta(dt, flight, course);
      const m = this.manta;
      if (m.active) {
        rel.subVectors(flight.position, m.position);
        const behind = -rel.dot(m.tangent);
        if (behind > 1.5 && behind < ABILITY.slipLength && flight.forward.dot(m.tangent) > 0.6) {
          const across = rel.addScaledVector(m.tangent, behind).length();
          const radius = ABILITY.slipRadius * (1 + behind / ABILITY.slipLength);
          slip = Math.sqrt(1 - behind / ABILITY.slipLength) * (1 - smoothstep(radius * 0.45, radius, across));
        }
      }
    }
    this.slip += (slip - this.slip) * (1 - Math.exp(-dt * 6));
    if (slip > 0) mods.thrust += push(ABILITY.slipThrust * slip, ABILITY.slipTopSpeed, speed);
  }

  /**
   * The manta glides the racing line ahead of you: it waits when you fall
   * behind, keeps just ahead when you close in (so you can sit in its wake),
   * and comes back ahead of you if you lose it or overtake it
   */
  private stepManta(dt: number, flight: Flight, course: Course) {
    const m = this.manta;
    const pz = flight.position.z;
    if (pz > this.endZ - 140) {
      m.active = false;
      return;
    }
    if (!m.active || m.z - pz > 240 || m.z - pz < -45) {
      m.active = true;
      m.z = Math.min(pz + 110, this.endZ - 150);
      m.speed = Math.max(26, flight.speed);
      m.arrivals++;
    }
    m.time += dt;
    const gap = m.z - pz;
    const pace = Math.max(26, flight.velocity.z);
    const target = Math.min(ABILITY.slipTopSpeed, pace * (1 - 0.35 * smoothstep(30, 80, gap)) + 6 * (1 - smoothstep(10, 26, gap)));
    m.speed += (target - m.speed) * (1 - Math.exp(-dt * 1.5));
    course.tangentAt(m.z, m.tangent);
    m.z = Math.min(m.z + m.speed * m.tangent.z * dt, this.endZ - 150);
    // A slow weave around the line, a little above it: always inside the racing tube
    SIDE.crossVectors(m.tangent, UP).normalize();
    course.pointAt(m.z, m.position)
      .addScaledVector(SIDE, Math.sin(m.time * 0.35) * 2.5)
      .addScaledVector(UP, 2.2 + Math.sin(m.time * 0.5) * 1.3);
  }

  /** The abilities' buttons on the HUD */
  hud(flight: Flight): { id: UpgradeId; name: string; key: string; charge: number; ready: boolean }[] {
    const out: { id: UpgradeId; name: string; key: string; charge: number; ready: boolean }[] = [];
    if (this.has("plunge")) {
      const active = this.plunge >= 0;
      out.push({ id: "plunge", name: "Plunging Attack", key: "X", charge: active ? 1 - this.plunge / ABILITY.plungeTime : 1 - this.plungeWait / ABILITY.plungeCooldown, ready: active || this.plungeWait <= 0 });
    }
    if (this.has("windShear")) out.push({ id: "windShear", name: "Wind-Shear Dash", key: "Q / E", charge: 1 - flight.dodgeCooldown / ABILITY.shearCooldown, ready: flight.dodgeCooldown <= 0 });
    if (this.has("galeForce")) {
      const active = this.burst >= 0;
      out.push({ id: "galeForce", name: "Gale Force", key: "G", charge: active ? 1 - this.burst / (ABILITY.burstTime + 1.5) : this.energy, ready: active || this.energy >= 1 });
    }
    if (this.has("hoverStall")) {
      const active = this.hang >= 0;
      out.push({ id: "hoverStall", name: "Hover-Stall", key: "F", charge: active ? 1 - this.hang / ABILITY.hangTime : 1 - this.hangWait / ABILITY.hangCooldown, ready: active || this.hangWait <= 0 });
    }
    return out;
  }
}
