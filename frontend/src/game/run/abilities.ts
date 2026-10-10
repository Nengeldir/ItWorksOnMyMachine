import * as THREE from "three";
import { FLIGHT, type Flight, type FlightInput, type FlightMods, type HitPart } from "../flight";
import { clamp, smoothstep } from "../math";
import { makeRng, range } from "../rng";
import type { Course, Ring } from "../world/course";
import type { World } from "../world/World";
import type { RunStats, UpgradeId } from "./upgrades";

// The rules of the design list's twenty abilities (CLAUDE.md, "Items and
// abilities"), for runs only: the run controller hands them the flight state
// every physics step and they answer with FlightMods (thrust, a dive, the
// hover-stall), boost refills and points. What they look like is in
// game/abilities/ (AbilityFx for the first ten, AbilityFx2 for the rest),
// which only reads this.

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
  // Moth's Attraction: a gate passed near its heart
  mothSurge: 14, // m/s at the very heart, less further out…
  mothTop: 100, // …none above this speed
  mothBullseye: 0.25, // share of the radius that counts as the heart
  // Zenith Climber
  zenithLonger: 1.2, // climbs keep their speed this much longer (gravity pulls back 1/1.2 as hard)
  // Resonance
  songRange: 260, // metres the wave reaches
  songSpeed: 170, // m/s it rolls out
  songCone: 42, // degrees either side of the nose
  songCooldown: 6,
  // Ley-Line Surger
  leyGates: 5, // gates in a row…
  leyGap: 7, // …each within this many seconds of the last
  leyHold: 9, // seconds between gates that keep a ley line alive
  // Aero-Braking (the brake key, upgraded)
  flareTime: 0.55, // seconds of the hard brake
  flareDecel: 42, // m/s²…
  flareFloor: 20, // …fading out by this speed
  flareTurn: 2.3, // steering multiplier…
  flareTurnTime: 1.3, // …for this long
  flareCooldown: 3,
  // Draft-Weaving
  weaveTurn: 270, // degrees of tight turning spin up a tornado…
  weaveRate: 0.7, // …turning at least this fast (rad/s)
  weaveRoll: 0.5, // a barrel roll counts as this share of a tornado
  weaveDecay: 0.08, // share lost per second when not spiralling
  weaveTime: 14, // seconds the tornado lasts unused
  weaveGlance: 0.55, // hits flying into the surface at most this steeply (the cosine) are glancing
  weavePush: 0.8,
  weaveKeep: 0.9,
  // Ascension
  ascendTime: 0.4, // seconds of the rise on rails
  ascendShare: 0.75, // share of the speed turned upwards…
  ascendMin: 32, // …at least this…
  ascendMax: 58, // …at most this
  ascendCooldown: 8,
  // Gliding stances (H toggles; with both, it cycles)
  stanceBlend: 0.45, // seconds to change stance
  falconSink: 2.4,
  falconDrag: 0.62,
  falconTurn: 0.55,
  falconStall: 1.15,
  butterflySink: 0.3,
  butterflyDrag: 2.2,
  butterflyTurn: 1.75,
  butterflyStall: 0.6,
  // Echo-Trail
  echoLife: 9, // seconds the ribbon lasts
  echoTurn: 320, // degrees of turning that make a circle…
  echoClose: 6, // …closed within this many metres of the ribbon
  echoMinAge: 2, // the ribbon you cross must be at least this old (seconds)…
  echoMinLength: 45, // …and at least this many metres of flight behind you
  echoSurge: 12, // m/s at once…
  echoThrust: 14, // …and m/s² for…
  echoPush: 1.4, // …this long
  echoRingLife: 6, // seconds the wind ring hangs where you drew it (fly it again for another push)
};

/** Gliding stances (Falcon and Butterfly) */
export type Stance = "none" | "falcon" | "butterfly";
/** A button press for a run ability */
export type AbilityPress = "plunge" | "burst" | "hover" | "resonance" | "ascend" | "stance";
/** Samples kept for the Echo-Trail ribbon (12 a second for `echoLife`) */
export const ECHO_SAMPLES = 128;
const ECHO_EVERY = 1 / 12;

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
  /** World motion rate; only moving environmental actors use it. */
  worldRate = 1;
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
  readonly cue = {
    plunge: 0, strike: 0, shear: 0, burst: 0, recover: 0, hang: 0, launch: 0,
    moth: 0, bullseye: 0, apex: 0, sing: 0, ley: 0, leyEnd: 0, flare: 0, tornado: 0, shield: 0, ascend: 0, stance: 0, echo: 0, echoPass: 0,
  };
  /** The abilities' own clock (seconds of flying) */
  private clock = 0;
  // Moth's Attraction: the last gate threaded, how near its heart (0 edge … 1 heart)
  mothGate = -1;
  mothHeart = 0;
  // Zenith Climber: 0..1, how steeply it is helping right now; where the last climb peaked
  zenithClimb = 0;
  private zenithHeld = 0;
  readonly apexPoint = new THREE.Vector3();
  // Resonance: seconds since the song (-1: none) and until the next; the gates it turned
  song = -1;
  songWait = 0;
  readonly songOrigin = new THREE.Vector3();
  readonly songAxis = new THREE.Vector3(0, 0, -1);
  /** Gate index → the direction it now faces (from where you were when it heard the song) */
  readonly attuned = new Map<number, THREE.Vector3>();
  // Ley-Line Surger: gates in quick succession, and whether a ley line is awake
  leyStreak = 0;
  ley = false;
  private lastGateAt = -1e3;
  // Aero-Braking: seconds into the flare (-1: none) and until the next
  flare = -1;
  flareWait = 0;
  private braking = false;
  // Draft-Weaving: 0..1 spun up, then seconds of tornado left; where it last shielded you
  weave = 0;
  tornado = 0;
  readonly shieldPoint = new THREE.Vector3();
  readonly shieldNormal = new THREE.Vector3();
  private readonly lastForward = new THREE.Vector3(0, 0, -1);
  private hasForward = false;
  // Ascension: seconds into the rise (-1: none) and until the next; where it began
  ascend = -1;
  ascendWait = 0;
  private ascendSpeed = 0;
  readonly ascendOrigin = new THREE.Vector3();
  // Gliding stances: the one chosen, and how far each is blended in (0..1)
  stance: Stance = "none";
  falcon = 0;
  butterfly = 0;
  // Echo-Trail: the ribbon (newest at `echoHead`), and the wind ring a closed circle made
  readonly echo = {
    positions: Array.from({ length: ECHO_SAMPLES }, () => new THREE.Vector3()),
    sides: Array.from({ length: ECHO_SAMPLES }, () => new THREE.Vector3()),
    times: new Float64Array(ECHO_SAMPLES),
    turned: new Float64Array(ECHO_SAMPLES),
    travelled: new Float64Array(ECHO_SAMPLES),
    head: -1,
    count: 0,
    /** The circle that closed: the ribbon between these times flashes */
    loopFrom: 0,
    loopTo: 0,
  };
  readonly echoRing = { t: -1, center: new THREE.Vector3(), normal: new THREE.Vector3(0, 0, 1), radius: 10, passWait: 0 };
  private echoTurned = 0;
  private echoTravelled = 0;
  private echoSince = 0;
  private echoNext = 0;
  private echoPush = 0;
  private readonly lastPosition = new THREE.Vector3();
  /** Seconds since the abilities' clock started, for the looks' fading ribbon */
  get now(): number {
    return this.clock;
  }
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
    this.attuned.clear();
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
    this.song = -1;
    this.flare = -1;
    this.ascend = -1;
    this.weave = 0;
    this.tornado = 0;
    this.zenithClimb = 0;
    this.zenithHeld = 0;
    this.hasForward = false;
    this.endLey();
    this.leyStreak = 0;
    this.echo.count = 0;
    this.echo.head = -1;
    this.echoRing.t = -1;
    this.echoPush = 0;
  }

  private endLey() {
    if (this.ley) this.cue.leyEnd++;
    this.ley = false;
  }

  /**
   * The buttons: X plunges, Z unleashes Gale Force, F hover-stalls (again: off
   * early), T sings (Resonance), G ascends, H changes the gliding stance
   */
  press(action: AbilityPress, flight: Flight): boolean {
    if (action === "resonance") {
      if (!this.has("resonance") || this.song >= 0 || this.songWait > 0) return false;
      this.song = 0;
      this.songWait = ABILITY.songCooldown;
      this.songOrigin.copy(flight.position);
      this.songAxis.copy(flight.forward);
      this.cue.sing++;
      return true;
    }
    if (action === "ascend") {
      if (!this.has("ascension") || this.ascend >= 0 || this.ascendWait > 0 || this.hang >= 0) return false;
      this.ascend = 0;
      this.plunge = -1;
      this.ascendSpeed = clamp(flight.speed * ABILITY.ascendShare, ABILITY.ascendMin, ABILITY.ascendMax);
      this.ascendOrigin.copy(flight.position);
      this.cue.ascend++;
      return true;
    }
    if (action === "stance") {
      const owned: Stance[] = ["none"];
      if (this.has("falcon")) owned.push("falcon");
      if (this.has("butterfly")) owned.push("butterfly");
      if (owned.length < 2) return false;
      this.stance = owned[(owned.indexOf(this.stance) + 1) % owned.length];
      this.cue.stance++;
      return true;
    }
    if (action === "plunge") {
      if (!this.has("plunge") || this.plunge >= 0 || this.plungeWait > 0 || this.hang >= 0 || this.ascend >= 0) return false;
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
    if (this.hangWait > 0 || this.plunge >= 0 || this.ascend >= 0) return false;
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
    // A barrel roll spins Draft-Weaving's tornado up a little
    if (this.has("draftWeave") && this.tornado <= 0) this.spinUp(ABILITY.weaveRoll);
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
    // Ley-Line Surger: gates in quick succession wake a ley line, and keep it awake
    if (this.has("leyLine")) {
      const gap = this.clock - this.lastGateAt;
      this.leyStreak = gap <= (this.ley ? ABILITY.leyHold : ABILITY.leyGap) ? this.leyStreak + 1 : 1;
      if (!this.ley && this.leyStreak >= ABILITY.leyGates) {
        this.ley = true;
        this.cue.ley++;
      }
    }
    this.lastGateAt = this.clock;
    if (this.plunge < 0) return 0;
    this.plunge = -1;
    this.plungeWait = ABILITY.plungeCooldown * 0.5;
    this.strikeGate = index;
    this.strikePoints = ABILITY.plungeBonus * Math.max(1, chain);
    this.cue.strike++;
    return this.strikePoints;
  }

  /**
   * Moth's Attraction: a gate was passed `offset` metres from its middle (of
   * `radius`): out faster, the nearer the heart. True for a bullseye
   */
  threaded(index: number, offset: number, radius: number, flight: Flight): boolean {
    if (!this.has("moth")) return false;
    const heart = clamp(1 - offset / Math.max(radius, 1), 0, 1);
    flight.surge(ABILITY.mothSurge * heart ** 1.5 * clamp((ABILITY.mothTop - flight.speed) / 15, 0, 1));
    this.mothGate = index;
    this.mothHeart = heart;
    this.cue.moth++;
    const bullseye = offset <= radius * ABILITY.mothBullseye;
    if (bullseye) this.cue.bullseye++;
    return bullseye;
  }

  /** The direction gate `ring` is flown through: Resonance may have turned it to face you */
  gateNormal(ring: Ring): THREE.Vector3 {
    return this.attuned.get(ring.index) ?? ring.normal;
  }

  /**
   * Something touched: can an ability save the pilot? "roll": Acrobatic
   * Recovery (a wingtip); "shield": Draft-Weaving's tornado takes a glancing
   * hit (flying into the surface no steeper than `weaveGlance`). Null: a crash
   */
  save(part: HitPart | null, normal: THREE.Vector3, direction: THREE.Vector3): "roll" | "shield" | null {
    if (this.canRecover(part)) return "roll";
    if (part !== null && this.tornado > 0 && this.hang < 0 && -direction.dot(normal) <= ABILITY.weaveGlance) return "shield";
    return null;
  }

  /** The save happened at `at`, off a surface facing `normal` */
  saved(how: "roll" | "shield", at: THREE.Vector3, normal: THREE.Vector3) {
    if (how === "roll") {
      this.recovered(at, normal);
      return;
    }
    this.tornado = 0;
    this.weave = 0;
    this.shieldPoint.copy(at);
    this.shieldNormal.copy(normal);
    this.cue.shield++;
  }

  /** Draft-Weaving: turning tightly or rolling spins the tornado up; full, it forms */
  private spinUp(amount: number) {
    this.weave = Math.min(1, this.weave + amount);
    if (this.weave >= 1 && this.tornado <= 0) {
      this.tornado = ABILITY.weaveTime;
      this.cue.tornado++;
    }
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
    this.clock += dt;
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
      this.stepManta(dt * this.worldRate, flight, course);
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

    this.stepLater(dt, input, flight, mods, course, recharge);
  }

  /** The design list's abilities 11 to 20, per physics step */
  private stepLater(dt: number, input: FlightInput, flight: Flight, mods: FlightMods, course: Course, recharge: number) {
    const speed = flight.speed;
    // How far the path turned this step, in any direction (Draft-Weaving, Echo-Trail)
    const turned = this.hasForward ? Math.acos(clamp(this.lastForward.dot(flight.forward), -1, 1)) : 0;
    this.songWait = Math.max(0, this.songWait - recharge);
    this.flareWait = Math.max(0, this.flareWait - recharge);
    if (this.ascend < 0) this.ascendWait = Math.max(0, this.ascendWait - recharge);

    // Gliding stances: blended in and out, each a set of multipliers
    const blend = dt / Math.max(0.05, ABILITY.stanceBlend);
    const towards = (v: number, target: number) => (v < target ? Math.min(target, v + blend) : Math.max(target, v - blend));
    this.falcon = towards(this.falcon, this.stance === "falcon" && this.has("falcon") ? 1 : 0);
    this.butterfly = towards(this.butterfly, this.stance === "butterfly" && this.has("butterfly") ? 1 : 0);
    const f = smoothstep(0, 1, this.falcon);
    const b = smoothstep(0, 1, this.butterfly);
    if (f > 0 || b > 0) {
      const mix = (falcon: number, butterfly: number) => (1 + (falcon - 1) * f) * (1 + (butterfly - 1) * b);
      mods.sink *= mix(ABILITY.falconSink, ABILITY.butterflySink);
      mods.drag *= mix(ABILITY.falconDrag, ABILITY.butterflyDrag);
      mods.turn *= mix(ABILITY.falconTurn, ABILITY.butterflyTurn);
      mods.stall *= mix(ABILITY.falconStall, ABILITY.butterflyStall);
    }

    // Zenith Climber: the steeper the climb, the less gravity pulls back along it
    if (this.has("zenith")) {
      const steep = smoothstep(0.25, 0.6, flight.forward.y) * (this.hang < 0 ? 1 : 0);
      mods.climb = 1 - (1 - 1 / ABILITY.zenithLonger) * steep;
      this.zenithClimb += (steep - this.zenithClimb) * (1 - Math.exp(-dt * 5));
      // A long climb that tops out: the apex shines
      if (steep > 0.5) this.zenithHeld += dt;
      else if (this.zenithHeld > 0.8 && flight.velocity.y < 4) {
        this.zenithHeld = 0;
        this.apexPoint.copy(flight.position);
        this.cue.apex++;
      } else if (steep < 0.2) this.zenithHeld = 0;
    }

    // Resonance: the wave rolls out; every gate inside its cone that it reaches turns to face you
    if (this.song >= 0) {
      this.song += dt;
      const front = Math.min(ABILITY.songRange, this.song * ABILITY.songSpeed);
      const cone = Math.cos((ABILITY.songCone * Math.PI) / 180);
      for (const ring of course.rings) {
        if (this.attuned.has(ring.index)) continue;
        rel.subVectors(ring.position, this.songOrigin);
        const d = rel.length();
        if (d > front || d < 1 || rel.dot(this.songAxis) < cone * d) continue;
        this.attuned.set(ring.index, new THREE.Vector3().subVectors(ring.position, flight.position).normalize());
      }
      if (this.song * ABILITY.songSpeed > ABILITY.songRange + 40) this.song = -1;
    }

    // Ley-Line Surger: endless boost while it's awake, until the gates stop coming
    if (this.ley) {
      if (this.clock - this.lastGateAt > ABILITY.leyHold) {
        this.endLey();
        this.leyStreak = 0;
      } else flight.boostCharge = 1;
    } else if (this.leyStreak > 0 && this.clock - this.lastGateAt > ABILITY.leyGap) this.leyStreak = 0;

    // Aero-Braking: the brake's press flares cape and wings: a hard stop, then tight turns
    const braking = (input.brake ?? 0) > 0.3;
    if (braking && !this.braking && this.has("aeroBrake") && this.flare < 0 && this.flareWait <= 0 && this.hang < 0 && this.ascend < 0) {
      this.flare = 0;
      this.flareWait = ABILITY.flareCooldown;
      this.plunge = -1;
      this.cue.flare++;
    }
    this.braking = braking;
    if (this.flare >= 0) {
      this.flare += dt;
      if (this.flare < ABILITY.flareTime) mods.thrust -= ABILITY.flareDecel * (1 - smoothstep(0.5, 1, this.flare / ABILITY.flareTime)) * clamp((speed - ABILITY.flareFloor) / 8, 0, 1);
      if (this.flare < ABILITY.flareTurnTime) mods.turn *= 1 + (ABILITY.flareTurn - 1) * (1 - smoothstep(ABILITY.flareTurnTime * 0.6, ABILITY.flareTurnTime, this.flare));
      else this.flare = -1;
    }

    // Draft-Weaving: tight turning (any axis) spins the tornado up; unused, it dies down
    if (this.has("draftWeave")) {
      if (this.hasForward && this.tornado <= 0) {
        if (turned / Math.max(dt, 1e-6) > ABILITY.weaveRate) this.spinUp(turned / ((ABILITY.weaveTurn * Math.PI) / 180));
        else this.weave = Math.max(0, this.weave - ABILITY.weaveDecay * dt);
      }
      if (this.tornado > 0) {
        this.tornado = Math.max(0, this.tornado - dt);
        if (this.tornado === 0) this.weave = 0;
      }
    }
    this.lastForward.copy(flight.forward);
    this.hasForward = true;

    // Ascension: all the speed turned straight up, on rails for a moment
    if (this.ascend >= 0) {
      this.ascend += dt;
      if (this.ascend < ABILITY.ascendTime) mods.ascend = this.ascendSpeed;
      else {
        this.ascend = -1;
        this.ascendWait = ABILITY.ascendCooldown;
      }
    }

    // Echo-Trail: the ribbon, a circle closing across it, and the wind ring it leaves
    if (this.has("echoTrail")) this.stepEcho(dt, flight, mods, turned);
    this.lastPosition.copy(flight.position);
  }

  private stepEcho(dt: number, flight: Flight, mods: FlightMods, turned: number) {
    const e = this.echo;
    const r = this.echoRing;
    if (this.echoPush > 0) {
      this.echoPush = Math.max(0, this.echoPush - dt);
      mods.thrust += push(ABILITY.echoThrust, FLIGHT.maxSpeed, flight.speed);
    }
    // The wind ring: fly through it again (either way) for another push
    if (r.t >= 0) {
      r.t += dt;
      r.passWait = Math.max(0, r.passWait - dt);
      if (r.t > ABILITY.echoRingLife) r.t = -1;
      else if (r.t > 0.6 && r.passWait <= 0) {
        const before = rel.subVectors(this.lastPosition, r.center).dot(r.normal);
        const after = rel.subVectors(flight.position, r.center).dot(r.normal);
        if (before * after < 0) {
          point.lerpVectors(this.lastPosition, flight.position, before / (before - after));
          if (point.distanceTo(r.center) < r.radius + 1.5) {
            r.passWait = 1;
            flight.surge(ABILITY.echoSurge * 0.6);
            this.echoPush = ABILITY.echoPush;
            this.cue.echoPass++;
          }
        }
      }
    }
    // How far the path has turned, in any direction
    // How far the path has turned and gone; a hover-stall turns on the spot, which is no circle
    if (e.count > 0 && this.hang < 0) {
      this.echoTurned += turned;
      this.echoTravelled += flight.position.distanceTo(this.lastPosition);
    }
    if (this.clock < this.echoNext) {
      // Keep the newest sample glued to the pilot between samples
      if (e.head >= 0) {
        e.positions[e.head].copy(flight.position);
        e.sides[e.head].copy(flight.right);
      }
      return;
    }
    this.echoNext = this.clock + ECHO_EVERY;
    e.head = (e.head + 1) % ECHO_SAMPLES;
    e.positions[e.head].copy(flight.position);
    e.sides[e.head].copy(flight.right);
    e.times[e.head] = this.clock;
    e.turned[e.head] = this.echoTurned;
    e.travelled[e.head] = this.echoTravelled;
    e.count = Math.min(ECHO_SAMPLES, e.count + 1);
    // Closed a circle? Crossing ribbon old enough, a full turn ago, and the smallest such loop
    const full = (ABILITY.echoTurn * Math.PI) / 180;
    for (let k = 1; k < e.count; k++) {
      const i = (e.head - k + ECHO_SAMPLES) % ECHO_SAMPLES;
      const t = e.times[i];
      if (this.clock - t > ABILITY.echoLife || t < this.echoSince) break;
      if (this.clock - t < ABILITY.echoMinAge || this.echoTurned - e.turned[i] < full || this.echoTravelled - e.travelled[i] < ABILITY.echoMinLength) continue;
      if (e.positions[i].distanceTo(flight.position) > ABILITY.echoClose) continue;
      this.closeLoop(i, k, flight);
      break;
    }
  }

  /** The circle from sample `from` (`length` samples back) to now becomes a wind ring */
  private closeLoop(from: number, length: number, flight: Flight) {
    const e = this.echo;
    const r = this.echoRing;
    r.center.set(0, 0, 0);
    for (let k = 0; k <= length; k++) r.center.add(e.positions[(e.head - k + ECHO_SAMPLES) % ECHO_SAMPLES]);
    r.center.divideScalar(length + 1);
    // The loop's plane: the sum of the turns round its middle
    r.normal.set(0, 0, 0);
    let radius = 0;
    for (let k = 0; k < length; k++) {
      const a = e.positions[(e.head - k - 1 + ECHO_SAMPLES) % ECHO_SAMPLES];
      const b = e.positions[(e.head - k + ECHO_SAMPLES) % ECHO_SAMPLES];
      r.normal.add(SIDE.subVectors(a, r.center).cross(point.subVectors(b, r.center)));
      radius += a.distanceTo(r.center);
    }
    if (r.normal.lengthSq() < 1e-6) r.normal.copy(flight.right);
    r.normal.normalize();
    r.radius = clamp(radius / Math.max(1, length), 4, 40);
    r.t = 0;
    r.passWait = 0;
    e.loopFrom = e.times[from];
    e.loopTo = this.clock;
    this.echoSince = this.clock;
    flight.surge(ABILITY.echoSurge);
    this.echoPush = ABILITY.echoPush;
    this.cue.echo++;
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
    // Close in and it surges ahead, so you can sit in its wake but never fly into it
    const target = Math.min(ABILITY.slipTopSpeed + 10, pace * (1 - 0.35 * smoothstep(30, 80, gap)) + 16 * (1 - smoothstep(8, 24, gap)));
    m.speed += (target - m.speed) * (1 - Math.exp(-dt * (gap < 12 ? 6 : 2)));
    course.tangentAt(m.z, m.tangent);
    m.z = Math.min(m.z + m.speed * m.tangent.z * dt, this.endZ - 150);
    // A slow weave around the line, a little above it: always inside the racing tube
    SIDE.crossVectors(m.tangent, UP).normalize();
    course.pointAt(m.z, m.position)
      .addScaledVector(SIDE, Math.sin(m.time * 0.35) * 2.5)
      .addScaledVector(UP, 2.2 + Math.sin(m.time * 0.5) * 1.3);
  }

  /** The abilities' buttons on the HUD */
  hud(flight: Flight): { id: UpgradeId; name: string; key: string; charge: number; ready: boolean; count?: number }[] {
    const out: { id: UpgradeId; name: string; key: string; charge: number; ready: boolean; count?: number }[] = [];
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
    if (this.has("resonance")) out.push({ id: "resonance", name: "Resonance", key: "T", charge: 1 - this.songWait / ABILITY.songCooldown, ready: this.songWait <= 0 });
    if (this.has("aeroBrake")) out.push({ id: "aeroBrake", name: "Aero-Braking", key: "Space", charge: 1 - this.flareWait / ABILITY.flareCooldown, ready: this.flareWait <= 0 });
    if (this.has("ascension")) {
      const active = this.ascend >= 0;
      out.push({ id: "ascension", name: "Ascension", key: "G", charge: active ? 1 : 1 - this.ascendWait / ABILITY.ascendCooldown, ready: active || this.ascendWait <= 0 });
    }
    if (this.has("falcon") || this.has("butterfly")) {
      const id: UpgradeId = this.stance === "butterfly" || (this.stance === "none" && !this.has("falcon")) ? "butterfly" : "falcon";
      const on = this.stance !== "none";
      out.push({ id, name: on ? (id === "falcon" ? "Falcon Stance" : "Butterfly Stance") : "Gliding stance", key: "H", charge: on ? 1 : 0.35, ready: on });
    }
    if (this.has("leyLine")) {
      const since = this.clock - this.lastGateAt;
      out.push({ id: "leyLine", name: "Ley-Line Surger", key: "", charge: this.ley ? 1 - since / ABILITY.leyHold : this.leyStreak / ABILITY.leyGates, ready: this.ley, count: this.ley ? undefined : this.leyStreak });
    }
    if (this.has("draftWeave")) out.push({ id: "draftWeave", name: "Draft-Weaving", key: "", charge: this.tornado > 0 ? this.tornado / ABILITY.weaveTime : this.weave, ready: this.tornado > 0 });
    return out;
  }
}
