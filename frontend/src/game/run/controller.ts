import * as THREE from "three";
import type { Flight, FlightInput, FlightMods, HitPart } from "../flight";
import { FLIGHT, plainMods } from "../flight";
import { type Equipped, type PerkStats, charmOf, perksFor, plainPerks } from "../collection/abilities";
import type { BindingAction } from "../bindings";
import { Charm } from "./charm";
import { Orbs } from "./orbs";
import { clamp } from "../math";
import type { Particles } from "../particles";
import { RUN } from "../tuning";
import { ATMOSPHERE } from "../world/atmosphere";
import { BIOMES, type BiomeId, type Level, runLevel } from "../world/biomes/index";
import type { World } from "../world/World";
import type { WorldView } from "../world/WorldView";
import { Abilities, type AbilityPress } from "./abilities";
import { Finale } from "./finale";
import { Items, type RunItemId, runItem } from "./items";
import { Portal, Wormhole, WormholeCamera, screenSparkle } from "./portal";
import {
  CHAIN_MAX,
  GATE_POINTS,
  LEVEL_BONUS,
  PAR_POINTS,
  RUN_LENGTH,
  START_LIVES,
  type RunHud,
  type RunPhase,
  type RunSummary,
  destination,
  runOrder,
} from "./run";
import { type RunStats, UPGRADES, type Upgrade, type UpgradeId, baseStats, offer, statsFor } from "./upgrades";
import { Collection } from "./collection";
import type { Reward } from "../../profile/types";
import type { Rarity } from "../collection/rarity";

// One roguelike run, from the first level to the last portal: it loads each
// biome, scores gates and style, keeps the lives, runs the
// abilities (handing the flight model its FlightMods), and plays the portal,
// the upgrade pick and the wormhole to the next biome. Game calls it only in
// run mode, so races never see any of it.

/** What the run needs from the game */
export interface RunHost {
  readonly scene: THREE.Scene;
  readonly particles: Particles;
  readonly flight: Flight;
  readonly prevPosition: THREE.Vector3;
  readonly camera: THREE.PerspectiveCamera;
  readonly world: World;
  readonly view: WorldView;
  /** Style points flown in this level so far */
  readonly style: number;
  setLevel(level: Level): void;
  /** Puts the pilot back after `checkpoints` gates (0: the start) */
  respawnAt(checkpoints: number): void;
  /** Holds the pilot still (in the wormhole) */
  freeze(on: boolean): void;
  /** The portal's screen veil: blur and sparkle over everything, 0..1 */
  veil(amount: number): void;
  /** Inside the wormhole: the land, sky, weather and other effects of the level are hidden */
  insideWormhole(on: boolean): void;
  /** White light over the screen (the end of the finale), 0..1 */
  whiteOut(amount: number): void;
  /** The drawing buffer's height in pixels (for sizing point sprites) */
  readonly pixelHeight: number;
  gateBurst(index: number): void;
  wingbeat(): void;
  stinger(kind: "portal" | "upgrade" | "dash" | "gate" | "finish" | "item" | "orb"): void;
  /** The portal's hum, louder the nearer you are: 0..1 */
  portalHum(near: number): void;
  /** A persistent treasure or crystal was collected: a chime as bright as its rarity */
  treasure(rarity: Rarity): void;
}

export interface RunEvents {
  /** Only real adventure sessions receive issued persistent rewards. */
  rewards?: Reward[];
  collected?(reward: Reward): void;
  /** The portal was entered: choose one of these */
  offer?(upgrades: Upgrade[], next: BiomeId | null): void;
  /** A new biome begins */
  arrived?(level: number, biome: BiomeId): void;
  ended?(summary: RunSummary): void;
}

/** Sky colors captured for the cross-fade between biomes */
interface Sky {
  horizon: THREE.Color;
  zenith: THREE.Color;
  clouds: THREE.Color;
  sun: THREE.Color;
  mist: THREE.Color;
  fog: THREE.Color;
  sunDirection: THREE.Vector3;
  night: number;
  mistDensity: number;
}

function captureSky(scene: THREE.Scene, out?: Sky): Sky {
  const sky = out ?? {
    horizon: new THREE.Color(),
    zenith: new THREE.Color(),
    clouds: new THREE.Color(),
    sun: new THREE.Color(),
    mist: new THREE.Color(),
    fog: new THREE.Color(),
    sunDirection: new THREE.Vector3(),
    night: 0,
    mistDensity: 0,
  };
  sky.horizon.copy(ATMOSPHERE.horizon.value);
  sky.zenith.copy(ATMOSPHERE.zenith.value);
  sky.clouds.copy(ATMOSPHERE.clouds.value);
  sky.sun.copy(ATMOSPHERE.sunColor.value);
  sky.mist.copy(ATMOSPHERE.mistColor.value);
  sky.fog.copy((scene.fog as THREE.Fog | null)?.color ?? sky.horizon);
  sky.sunDirection.copy(ATMOSPHERE.sunDirection.value);
  sky.night = ATMOSPHERE.night.value;
  sky.mistDensity = ATMOSPHERE.mistDensity.value;
  return sky;
}

const tmp = new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0);
const toTarget = new THREE.Vector3();
const forward = new THREE.Vector3();
const SPARKLE = new THREE.Color();

/** Seconds for the screen to blur into sparkles going in, and to clear again inside */
const BLUR_IN = 0.5;
const BLUR_CLEAR = 0.8;
/** Seconds for the blur to come back on the way out (then it clears over RUN.tunnelFade) */
const BLUR_OUT = 0.4;
/** At most this long in the wormhole waiting for the next land, then out anyway (it glides in) */
const EXIT_WAIT = 8;
/** Who is flying: their level (items and abilities above it never turn up) and what they wear and carry */
export interface RunOptions {
  /** Crashes before the run ends (Infinity: never, the test sandbox) */
  lives?: number;
  playerLevel?: number;
  equipped?: Equipped;
}

/** How a collection power saved the pilot from a hit (Frost skate) */
export type PerkSave = "frost";

/** The most glancing hit Frost skate turns into a skate (the cosine of the angle into the surface) */
const FROST_GLANCE = 0.6;

/** Out of lives: the crash plays, the view fades into light over these seconds, then the summary */
const LOST_FADE_FROM = 1;
const LOST_FADE = 0.9;

const ease = (t: number) => {
  const x = clamp(t, 0, 1);
  return x * x * (3 - 2 * x);
};

export class RunController {
  readonly seed: number;
  phase: RunPhase = "arrive";
  private readonly host: RunHost;
  private readonly events: RunEvents;
  private readonly group = new THREE.Group();
  private readonly mods: FlightMods = plainMods();
  private readonly wormhole = new Wormhole();
  private readonly orbit = new WormholeCamera();
  private level = 1;
  private readonly path: BiomeId[] = [];
  private readonly picked: UpgradeId[] = [];
  private stats: RunStats = baseStats();
  private score = 0;
  private lives: number;
  private maxLives: number; // the most held so far
  private chain = 0;
  // For the summary
  private totalTime = 0;
  private gates = 0;
  private crashes = 0;
  private bestChain = 0;
  private totalStyle = 0;
  private readonly passed = new Set<number>();
  private lastGate = 0; // checkpoints: how many gates to respawn after
  private portals: Portal[] = [];
  private levelTime = 0;
  private phaseTime = 0;
  private stamina = 0;
  /** The design list's abilities: their rules (their looks read them, game/abilities/) */
  readonly abilities = new Abilities();
  /** The design list's items: the bag and what they do (their looks read them, items/fx.ts) */
  readonly items = new Items();
  private toast: RunHud["toast"] = null;
  /** The keepsake carried on this adventure (collection/abilities.ts) */
  readonly charm = new Charm();
  /** Stamina orbs: the only way the boost comes back by itself in a run */
  readonly orbs = new Orbs();
  /** What everything equipped adds up to (pets, rare cosmetics, a passive charm) */
  perks: PerkStats = plainPerks();
  /** The pilot's level: items and abilities above it never turn up */
  readonly playerLevel: number;
  /** Crashes the phoenix may still undo, and glancing hits Frost skate may still take, in this level */
  private revivesLeft = 0;
  private shieldsLeft = 0;
  /** Bumped when a collection power acts, so the looks and sounds can follow */
  readonly perkCue = { rekindle: 0, frost: 0, kick: 0, gate: 0 };
  /** Night falls over this level (the owl's watch) */
  private night = 0;
  private toastTime = 0;
  private toastId = 0;
  /** Through a portal: where to, the upgrades on offer, and whether the next biome is built yet */
  private through: { next: BiomeId; offers: Upgrade[]; built: boolean } | null = null;
  private skyFrom: Sky | null = null;
  private skyTo: Sky | null = null;
  private readonly skyNow: Sky;
  private ended = false;
  private styleBanked = false; // this level's style is already in the score (we're through the portal)
  private exiting = false; // on the way out of the wormhole
  private exitTime = 0;
  private waited = 0; // seconds in the wormhole waiting for the next land
  private unfrozen = false;
  private sparkled = false;
  /** The last portal's cutscene */
  private finale: Finale | null = null;
  private collection: Collection | null = null;
  /** The opening autopilot is flying (see preview) */
  private previewing = false;
  private readonly collected = (reward: Reward) => {
    this.events.collected?.(reward);
    this.host.treasure(reward.rarity);
  };

  constructor(seed: number, host: RunHost, events: RunEvents, options: RunOptions = {}) {
    this.seed = seed;
    this.playerLevel = options.playerLevel ?? Infinity;
    this.items.playerLevel = this.playerLevel;
    if (options.equipped) this.setEquipped(options.equipped);
    const lives = options.lives ?? START_LIVES;
    // The kirin and the golden feather each bring one more life (never to the endless sandbox)
    this.lives = Number.isFinite(lives) ? lives + this.perks.lives : lives;
    this.maxLives = this.lives;
    this.host = host;
    this.events = events;
    host.scene.add(this.group, this.wormhole.group);
    this.group.add(this.orbs.group);
    this.skyNow = captureSky(host.scene);
    this.abilities.setStats(this.stats);
  }

  /** What the pilot wears and carries changed (the inventory can be opened while paused) */
  setEquipped(equipped: Equipped) {
    this.perks = perksFor(equipped);
    this.items.reach = this.perks.pickupRadius;
    const charm = charmOf(equipped);
    this.charm.set(charm?.id ?? null, charm?.power ?? null);
  }

  /** Flight changes from upgrades and abilities, for this physics step */
  get flightMods(): FlightMods {
    return this.mods;
  }

  /** Extra levels on the style multiplier */
  get multiplierCap(): number {
    return 4 + this.stats.multiplier + this.perks.styleCap;
  }

  /** Gates to respawn after */
  get checkpoint(): number {
    return this.lastGate;
  }

  /** Has gate `index` been flown through on this level? */
  passedGate(index: number): boolean {
    return this.passed.has(index);
  }

  get frozen(): boolean {
    return this.phase === "portal" || this.phase === "pick" || this.phase === "finale" || this.phase === "won" || this.phase === "lost";
  }

  start(initial?: Level) {
    this.loadLevel(initial?.biome.id ?? runOrder(this.seed)[0], initial);
  }

  /**
   * The opening autopilot: the level waits (no clock, no gates, no pickups, no portal)
   * while the pilot glides the racing line on its own
   */
  preview() {
    this.previewing = true;
    this.group.visible = false;
  }

  /**
   * Taking off from the intro: the title card plays from here. `at`: where the opening
   * autopilot handed over; gates already behind it are skipped (never scored) and a crash
   * comes back after them
   */
  takeOff(at?: THREE.Vector3) {
    this.previewing = false;
    this.group.visible = true;
    this.phase = "arrive";
    this.phaseTime = 0;
    this.levelTime = 0;
    let next = 0;
    if (at) {
      const rings = this.host.world.course.rings;
      while (next < rings.length - 1 && tmp.subVectors(at, rings[next].position).dot(rings[next].normal) > 0) this.passed.add(next++);
      this.lastGate = next;
    }
    this.host.view.setRings("race", next);
  }

  // --- levels --------------------------------------------------------------------

  private loadLevel(biome: BiomeId, initial?: Level) {
    this.disposeLevel();
    this.path.push(biome);
    this.host.setLevel(initial ?? runLevel(this.seed, this.level, biome));
    const world = this.host.world;
    this.passed.clear();
    this.lastGate = 0;
    this.chain = 0;
    this.levelTime = 0;
    this.styleBanked = false;
    this.host.view.setRings("race", 0);
    this.abilities.setLevel(world);
    this.items.setLevel(world);
    this.charm.newLevel();
    this.orbs.setLevel(world, this.level);
    this.revivesLeft = this.perks.revives;
    this.shieldsLeft = this.perks.shields;
    this.night = world.palette.night;
    if (this.events.rewards) this.collection = new Collection(world, this.events.rewards.filter(r => r.level === this.level), this.host.scene);
    // The portal stands at the last gate
    const { course } = world;
    const finish = course.rings[course.rings.length - 1];
    const last = this.level >= RUN_LENGTH;
    const color = last ? "#ffe9a0" : BIOMES[destination(this.seed, this.path)].portals.color;
    // Deeper levels hide the portal a little: smaller, and off to one side of the line and higher
    const hard = world.level.key.difficulty ?? 0;
    const aside = tmp.crossVectors(finish.normal, UP).normalize().multiplyScalar(5 * hard * (this.level % 2 ? 1 : -1));
    const where = finish.position.clone().addScaledVector(finish.normal, 3).add(aside).addScaledVector(UP, 3 * hard);
    this.portals = [new Portal(where, finish.normal, 15 - 4 * hard, color)];
    for (const portal of this.portals) this.group.add(portal.group);
    // Abilities start charged
    this.stamina = 2 + this.stats.flap;
    this.phase = "arrive";
    this.phaseTime = 0;
    this.events.arrived?.(this.level, biome);
    if (this.charm.ready) this.notify(`Charm ready: ${this.charm.power!.name}`, 0, "charm");
  }

  private disposeLevel() {
    this.collection?.dispose();
    this.collection = null;
    this.portals.forEach((p) => p.dispose());
    this.portals = [];
  }

  // --- the pilot's moves ----------------------------------------------------------

  /** C: wingbeat; X: plunge; Z: Gale Force; F: hover-stall; T: Resonance; G: Ascension; H: stance (each needs its upgrade) */
  ability(action: "flap" | AbilityPress) {
    if (this.frozen || (this.phase !== "explore" && this.phase !== "arrive")) return;
    if (action === "flap") {
      if (this.stats.flap > 0 && this.stamina >= 1 && this.abilities.hang < 0) {
        this.stamina -= 1;
        this.host.flight.flap(5 + this.stats.flap * 1.5, 0.1);
        this.host.wingbeat();
      }
      return;
    }
    if (this.abilities.press(action, this.host.flight) && action === "burst") this.host.stinger("dash");
  }

  /** Y (or the right mouse button): uses the item picked in the bag */
  useItem() {
    if (this.frozen || (this.phase !== "explore" && this.phase !== "arrive")) return;
    this.items.use(this.host.flight);
    if(this.items.restore>0){this.stamina=Math.min(2+this.stats.flap,this.stamina+this.items.restore);this.items.restore=0;}
  }

  /** U (or the mouse wheel): the next item in the bag */
  nextItem() {
    this.items.cycle();
  }

  /** K: the charm (the keepsake carried on adventures) */
  useCharm() {
    if (this.frozen || (this.phase !== "explore" && this.phase !== "arrive")) return;
    const before = this.charm.rocket;
    if (!this.charm.press(this.host.flight, this.items)) {
      if (this.charm.use && this.charm.use.kind !== "rocket" && this.charm.use.kind !== "passive") this.notify("Charm used up for this level", 0);
      return;
    }
    if (this.charm.use?.kind === "rocket") this.notify(before === "off" ? "Strapping on the giant firework…" : "Firework off your back", 0);
    if (this.items.restore > 0) {
      this.stamina = Math.min(2 + this.stats.flap, this.stamina + this.items.restore);
      this.items.restore = 0;
    }
  }

  /**
   * A crash is coming: the phoenix may undo it, from a feather in the bag, the charm, or the
   * phoenix companion (once per level each)
   */
  revive(flight: Flight): boolean {
    if (this.items.revive(flight)) return true;
    const use = this.charm.use;
    if (use?.kind === "relic" && use.item === "phoenixFeather" && this.charm.left > 0) {
      this.charm.left--;
      this.charm.cue.use++;
      return this.items.rekindle(flight);
    }
    if (this.revivesLeft > 0 && this.items.rekindle(flight)) {
      this.orbs.reset();
      this.revivesLeft--;
      this.perkCue.rekindle++;
      this.notify("The phoenix pulls you from the flames", 0);
      return true;
    }
    return false;
  }

  /** Frost skate: a glancing hit (never head-on) turns into a skate off an ice ramp, once per level */
  perkSave(part: HitPart | null, normal: THREE.Vector3, direction: THREE.Vector3): PerkSave | null {
    if (part === null || this.shieldsLeft <= 0 || this.abilities.hang >= 0) return null;
    return -direction.dot(normal) <= FROST_GLANCE ? "frost" : null;
  }

  perkSaved(how: PerkSave, at: THREE.Vector3, normal: THREE.Vector3) {
    void how;
    this.shieldsLeft--;
    this.items.savePoint.copy(at);
    this.items.saveNormal.copy(normal);
    this.perkCue.frost++;
    this.notify("Frost skate!", 0);
  }

  /** The dodge's timing and distance: Wind-Shear's blink, or the plain dodge with the collection's powers */
  private readonly dodge = { ...FLIGHT };
  dodgeParams(): typeof FLIGHT {
    if (this.abilities.has("windShear")) return this.abilities.dodgeParams();
    return Object.assign(this.dodge, FLIGHT, {
      dodgeCooldown: FLIGHT.dodgeCooldown * this.perks.dodgeCooldown,
      dodgeDistance: FLIGHT.dodgeDistance + this.perks.dodgeDistance,
    });
  }

  /** A dodge began: the abilities hear of it, and Ember kick fires */
  dodged(direction: 1 | -1, flight: Flight) {
    this.abilities.dodged(direction, flight);
    if (this.perks.dodgeBurst > 0) {
      flight.surge(this.perks.dodgeBurst);
      this.perkCue.kick++;
    }
  }

  /** Style points right now: the owl at night, the stargazer, a starfruit */
  get styleRate(): number {
    return this.perks.styleRate * (this.night > 0.5 ? this.perks.nightStyle : 1) * this.charm.style;
  }

  /** Puts an item in the bag right now (dev tools and test mode); false if the bag is full */
  giveItem(id: RunItemId): boolean {
    const given = this.items.give(id);
    this.notify(given ? `${runItem(id).name}` : "Your bag is full", 0);
    return given;
  }

  /** The input flown this step: some items take the controls a little */
  steer(input: FlightInput): FlightInput {
    return this.phase === "explore" || this.phase === "arrive" ? this.items.steer(input) : input;
  }

  /** Per physics step, after the flight moved: gates and portals. `proximity` 0..1, the input flown */
  step(dt: number, proximity = 0, input: FlightInput = { pitch: 0, roll: 0 }) {
    const { flight, prevPosition } = this.host;
    // This step's flight changes, for the next one
    const m = this.mods;
    const perks = this.perks;
    m.drag = this.stats.drag * perks.drag;
    m.sink = this.stats.sink * perks.sink;
    m.stall = this.stats.stall;
    m.proximityBoost = this.stats.proximity * perks.proximity;
    m.glideLock = this.stats.glideLock > 0;
    m.boost = this.stats.dash * 0.25 + perks.boostAccel;
    m.hover = 0;
    m.lift = 0;
    m.thrust = 0;
    m.dive = 0;
    m.hang = false;
    m.turn = perks.turn;
    m.climb = perks.climb;
    m.ascend = 0;
    // No natural recharge in a run: stamina orbs, abilities and items refill the boost
    m.recharge = 0;
    if (this.phase !== "explore" && this.phase !== "arrive") return;
    if (!this.items.frozenCombo) this.levelTime += dt;
    this.abilities.worldRate=this.items.worldRate;
    this.collection?.step(prevPosition, flight.position, this.collected, this.host.particles, perks.pickupRadius);
    this.abilities.step(dt, input, proximity, flight, m);
    this.charm.step(dt, flight, m);
    const pickups = this.items.cue.pickup, full = this.items.cue.full;
    this.items.step(dt, input, proximity, flight, m);
    if (this.orbs.step(flight, perks.orbs, perks.pickupRadius) > 0) this.host.stinger("orb");
    if (this.items.cue.pickup !== pickups && this.items.picked) {
      const item = runItem(this.items.picked);
      this.notify(`Picked up ${item.name}`, 0, item.auto ? undefined : "useItem", item.rarity);
    } else if (this.items.cue.full !== full) this.notify("Your bag is full · use an item first", 0, "useItem");
    if (this.items.points > 0) {
      this.score += Math.round(this.items.points);
      this.items.points = 0;
    }
    if (this.abilities.restore > 0) {
      if (this.stats.flap > 0) this.stamina = Math.min(2 + this.stats.flap, this.stamina + this.abilities.restore);
      this.abilities.restore = 0;
    }

    // Gates: any gate passed scores; in a row without crashing, more and more
    const rings = this.host.world.course.rings;
    for (let i = 0; i < rings.length - 1; i++) {
      if (this.passed.has(i)) continue;
      const ring = rings[i];
      // Resonance may have turned the gate to face you
      const normal = this.abilities.gateNormal(ring);
      const before = tmp.subVectors(prevPosition, ring.position).dot(normal);
      const after = tmp.subVectors(flight.position, ring.position).dot(normal);
      if (before >= 0 || after < 0) continue;
      tmp.lerpVectors(prevPosition, flight.position, before / (before - after));
      const offset = tmp.distanceTo(ring.position);
      if (offset > ring.radius + 1 + this.stats.magnet + perks.magnet + this.abilities.widening(ring) + this.items.widening(i)) continue;
      this.passed.add(i);
      this.items.gate(i);
      this.chain = Math.min(CHAIN_MAX, this.chain + 1);
      this.bestChain = Math.max(this.bestChain, this.chain);
      this.gates++;
      this.lastGate = Math.max(this.lastGate, i + 1);
      this.score += Math.round((GATE_POINTS + this.stats.gateBonus + perks.gateBonus) * this.chain * perks.gatePoints) + this.charm.gate();
      // The dragon and the constellation wings: gates refill the boost (and a wingbeat)
      if (perks.gateRefill > 0) flight.refillBoost(perks.gateRefill);
      if (perks.gateRefill > 0 || perks.gateStamina > 0) this.perkCue.gate++;
      const leys = this.abilities.cue.ley;
      const strike = this.abilities.gate(i, this.chain);
      if (strike > 0) this.notify("Plunge strike!", strike);
      else if (this.abilities.cue.ley !== leys) this.notify("A ley line wakes: endless boost", 0);
      else if (this.abilities.threaded(i, offset, ring.radius, flight)) this.notify("Through the heart", 0);
      // Every gate refills a wingbeat (the dragon adds one more)
      this.stamina = Math.min(2 + this.stats.flap, this.stamina + 1 + perks.gateStamina);
      let next = 0;
      while (this.passed.has(next)) next++;
      this.host.view.setRings("race", next);
      this.host.gateBurst(i);
      this.host.stinger("gate");
    }

    for (const portal of this.portals) {
      if (portal.crossed(prevPosition, flight.position, this.stats.magnet + perks.magnet)) {
        this.enterPortal();
        break;
      }
    }
  }

  /** A frame without control (gliding in while the land loads): the level's clock still runs */
  wait(dt: number) {
    if (!this.previewing && (this.phase === "explore" || this.phase === "arrive") && !this.items.frozenCombo) this.levelTime += dt;
  }

  /** A crash costs a life and breaks the gate chain; the last life's crash ends the run. Flight resets the shared boost state. */
  crashed() {
    // The way out of a portal hands control back while the blur still clears: a crash there counts too
    const leaving = this.phase === "portal" && this.exiting && this.unfrozen;
    if (this.phase !== "explore" && this.phase !== "arrive" && !leaving) return;
    this.crashes++;
    this.abilities.crashed();
    this.items.reset();
    this.charm.reset();
    const chain = this.chain;
    this.chain = 0;
    this.lives--;
    if (this.lives <= 0) {
      this.lives = 0;
      this.bankLevel();
      if (leaving) {
        // The lost phase no longer runs the transition: finish it here, or the blur stays under the white
        this.host.veil(0);
        this.blendSky(1);
        this.skyFrom = null;
        this.exiting = false;
      }
      this.phase = "lost";
      this.phaseTime = 0;
      return;
    }
    if (Number.isFinite(this.lives)) this.notify(this.lives === 1 ? "Last feather!" : `${this.lives} feathers left`, 0);
    else if (chain > 1) this.notify("Gate chain lost", 0);
  }

  /** This level's clock and style into the run's totals, when it ends without its portal */
  private bankLevel() {
    if (this.styleBanked) return;
    this.totalTime += this.levelTime;
    this.totalStyle += this.host.style;
    this.score += Math.round(this.host.style);
    this.styleBanked = true;
  }

  private gain(id: UpgradeId) {
    this.picked.push(id);
    this.stats = statsFor(this.picked);
    this.abilities.setStats(this.stats);
    this.lives += UPGRADES.find((u) => u.id === id)?.effect.lives ?? 0;
    this.maxLives = Math.max(this.maxLives, this.lives);
  }

  /** A toast on screen; `action`: the key it reminds you of, `rarity`: its color (an item picked up) */
  private notify(text: string, points: number, action?: BindingAction, rarity?: number) {
    this.score += points;
    this.toast = { text, points, id: ++this.toastId, action, rarity };
    this.toastTime = action ? 3.4 : 2.6;
  }

  // --- portals, the upgrade pick and the wormhole -----------------------------------------

  private enterPortal() {
    // Clearing the level: a bonus, more for a fast one
    const par = (this.host.world.course.endZ - this.host.world.course.start.z) / 42;
    this.score += LEVEL_BONUS + Math.round(Math.max(0, par - this.levelTime) * PAR_POINTS) + Math.round(this.host.style);
    this.totalTime += this.levelTime;
    this.totalStyle += this.host.style;
    this.styleBanked = true;
    this.host.stinger("finish");
    this.host.stinger("portal");
    if (this.level >= RUN_LENGTH) {
      this.startFinale();
      return;
    }
    // The offer is drawn now, from this level, so building the next one early doesn't change it
    this.through = { next: destination(this.seed, this.path), offers: offer(this.seed, this.level, this.picked, this.playerLevel), built: false };
    this.phase = "portal";
    this.phaseTime = 0;
    this.sparkled = false;
    this.host.freeze(true);
    this.wormhole.colors(this.host.world.palette.accent, BIOMES[this.through.next].portals.color);
    this.skyFrom = captureSky(this.host.scene, this.skyFrom ?? undefined);
  }

  /**
   * Builds the next biome as soon as the wormhole hides everything, before the
   * upgrade pick (which doesn't change the level), so its land streams in
   * while the player chooses
   */
  private buildNext() {
    const through = this.through!;
    through.built = true;
    this.level++;
    this.loadLevel(through.next);
    this.host.respawnAt(0);
    this.host.freeze(true);
    this.skyTo = captureSky(this.host.scene, this.skyTo ?? undefined);
    // The new level's lights went up with it: keep the old sky until the way out
    this.blendSky(0);
    // loadLevel started the new level's phases; we're still in the wormhole
    this.phase = "portal";
  }

  /** The player chose an upgrade: out to the next biome (already built, maybe still streaming) */
  pick(id: UpgradeId) {
    if (this.phase !== "pick" || !this.through) return;
    this.gain(id);
    this.host.stinger("upgrade");
    if (!this.through.built) this.buildNext();
    this.phase = "portal";
    this.phaseTime = 0;
    this.through = null;
    this.exiting = false;
    this.waited = 0;
    this.unfrozen = false;
  }

  /** Adds an upgrade right now, without a portal (dev tools: `__game.grant(id)`) */
  grant(id: UpgradeId) {
    this.gain(id);
  }

  /** The last portal: out into space under the Milky Way, then white light */
  private startFinale() {
    this.phase = "finale";
    this.phaseTime = 0;
    this.sparkled = false;
    this.host.freeze(true);
    this.finale = new Finale();
    this.host.scene.add(this.finale.group);
  }

  /** Test mode: replace the portal with one directly along the pilot's heading. */
  spawnTestPortal() {
    if (this.frozen || this.ended) return;
    const { flight } = this.host;
    const radius = this.portals[0]?.radius ?? 15;
    const color = this.level >= RUN_LENGTH ? "#ffe9a0" : BIOMES[destination(this.seed, this.path)].portals.color;
    const position = flight.position.clone().addScaledVector(flight.forward, Math.max(radius * 3, flight.speed * 1.5));
    this.disposeLevel();
    const portal = new Portal(position, flight.forward, radius, color);
    this.portals.push(portal);
    this.group.add(portal.group);
  }

  /** Test mode: show the real summary immediately, including this level's stats. */
  testWin() {
    this.bankLevel();
    this.finish();
  }

  /** Enter during the finale: straight to the white light */
  skipFinale() {
    this.finale?.skip();
  }

  private finish(completed = true) {
    if (this.ended) return;
    this.ended = true;
    this.phase = completed ? "won" : "lost";
    this.host.freeze(true);
    this.events.ended?.({
      seed: this.seed,
      score: this.score,
      completed,
      levels: this.level,
      path: [...this.path],
      upgrades: [...this.picked],
      timeMs: Math.round(this.totalTime * 1000),
      gates: this.gates,
      crashes: this.crashes,
      livesLeft: this.lives,
      bestChain: this.bestChain,
      style: Math.round(this.totalStyle),
    });
  }

  // --- per frame ------------------------------------------------------------------------

  frame(dt: number) {
    const { camera, particles } = this.host;
    this.collection?.frame(dt, camera.position, !this.previewing && (this.phase === "explore" || this.phase === "arrive"), particles);
    if (!this.previewing && (this.phase === "explore" || this.phase === "arrive")) this.orbs.frame(dt, camera.position, particles);
    if (!this.previewing) this.phaseTime += dt;
    if (this.toast && (this.toastTime -= dt) <= 0) this.toast = null;
    if (this.stats.flap > 0) this.stamina = Math.min(2 + this.stats.flap, this.stamina + dt / 9);
    if (this.phase === "arrive" && this.phaseTime > 3) this.phase = "explore";

    if (this.phase === "lost") {
      // The last crash plays out, the view fades into light, then the summary
      this.host.whiteOut(ease((this.phaseTime - LOST_FADE_FROM) / LOST_FADE));
      this.host.portalHum(0);
      if (this.phaseTime >= LOST_FADE_FROM + LOST_FADE) this.finish(false);
      return;
    }

    if (this.phase === "finale" && this.finale) {
      if (!this.sparkled) {
        this.sparkled = true;
        screenSparkle(particles, camera, forward.set(0, 0, -1).applyQuaternion(camera.quaternion), SPARKLE.set("#ffe9a0"));
      }
      const f = this.finale.update(dt, camera, this.host.flight.position, particles);
      this.host.veil(f.veil);
      this.host.insideWormhole(f.space);
      this.host.whiteOut(f.white);
      this.group.visible = !f.space;
      if (f.done) this.finish();
      return;
    }

    // Through a portal: the screen blurs into sparkles, clears inside the wormhole, the
    // upgrade pick, waiting there for the next land, then blur and out into the new biome
    camera.getWorldDirection(forward);
    let veil = 0;
    let inside = false;
    let blend = 0;
    if (this.phase === "portal" && this.through) {
      const t = this.phaseTime;
      if (!this.sparkled) {
        this.sparkled = true;
        screenSparkle(particles, camera, forward, SPARKLE.set(this.host.world.palette.accent));
      }
      veil = t < BLUR_IN ? ease(t / BLUR_IN) : 1 - ease((t - BLUR_IN - 0.1) / BLUR_CLEAR);
      inside = t >= BLUR_IN;
      // Fully blurred and inside: build the next biome now (a hitch here is hidden by the blur)
      if (t >= BLUR_IN + 0.03 && !this.through.built) {
        this.buildNext();
        this.phaseTime = t;
      }
      if (t >= BLUR_IN + 0.1 + BLUR_CLEAR * 0.6) {
        this.phase = "pick";
        this.phaseTime = 0;
        this.events.offer?.(this.through.offers, this.through.next);
      }
    } else if (this.phase === "pick") {
      inside = true;
      blend = 0.25 + 0.1 * Math.sin(this.phaseTime * 0.5);
    } else if (this.phase === "portal") {
      blend = 1;
      if (!this.exiting) {
        // Under cover until the land near the start has arrived (or we've waited long enough)
        inside = true;
        this.blendSky(0);
        this.waited += dt;
        if (this.host.view.ready || this.waited > EXIT_WAIT) {
          this.exiting = true;
          this.exitTime = 0;
        }
      } else {
        // Blur, swap the wormhole for the new biome under it, clear while the sky cross-fades
        const t = (this.exitTime += dt);
        veil = t < BLUR_OUT ? ease(t / BLUR_OUT) : 1 - ease((t - BLUR_OUT) / RUN.tunnelFade);
        inside = t < BLUR_OUT;
        if (!inside) {
          this.blendSky(ease((t - BLUR_OUT) / RUN.tunnelFade));
          if (!this.unfrozen) {
            this.unfrozen = true;
            this.host.freeze(false);
          }
        }
        if (t >= BLUR_OUT + RUN.tunnelFade) {
          this.phase = "arrive";
          this.phaseTime = 0;
          this.skyFrom = null;
          this.exiting = false;
        }
      }
    }
    // Inside, the camera circles the pilot, who flies on down the tube; it swings back to the chase view on the way out
    const pilot = this.host.flight;
    if (inside) this.orbit.update(dt, camera, pilot.position, pilot.forward, this.exiting ? ease(this.exitTime / BLUR_OUT) : 0);
    else this.orbit.reset();
    this.wormhole.place(camera, pilot.position, pilot.forward, inside, blend, this.host.pixelHeight);
    this.host.insideWormhole(inside);
    // From inside, the portal you came through is gone too
    this.group.visible = !inside && !this.previewing;
    this.host.veil(veil);
    if (!inside) for (const p of this.portals) p.update(dt, particles, camera.position);
    // The portal hums as you near it, and falls silent once you're through
    let near = 0;
    if (!inside && !this.previewing && (this.phase === "explore" || this.phase === "arrive")) {
      for (const p of this.portals) if (p.open) near = Math.max(near, clamp(1 - p.position.distanceTo(camera.position) / 500, 0, 1));
    }
    this.host.portalHum(near);
  }

  /** Mixes the sky from the biome we left to the one we arrived in (k = 0 … 1) */
  private blendSky(k: number) {
    const from = this.skyFrom;
    const to = this.skyTo;
    if (!from || !to) return;
    const e = k * k * (3 - 2 * k);
    const now = this.skyNow;
    ATMOSPHERE.horizon.value.lerpColors(from.horizon, to.horizon, e);
    ATMOSPHERE.zenith.value.lerpColors(from.zenith, to.zenith, e);
    ATMOSPHERE.clouds.value.lerpColors(from.clouds, to.clouds, e);
    ATMOSPHERE.sunColor.value.lerpColors(from.sun, to.sun, e);
    ATMOSPHERE.mistColor.value.lerpColors(from.mist, to.mist, e);
    ATMOSPHERE.sunDirection.value.lerpVectors(from.sunDirection, to.sunDirection, e).normalize();
    ATMOSPHERE.night.value = from.night + (to.night - from.night) * e;
    ATMOSPHERE.mistDensity.value = from.mistDensity + (to.mistDensity - from.mistDensity) * e;
    const fog = this.host.scene.fog as THREE.Fog | null;
    now.fog.lerpColors(from.fog, to.fog, e);
    fog?.color.copy(now.fog);
    if (this.host.scene.background instanceof THREE.Color) this.host.scene.background.copy(now.fog);
  }

  // --- what the HUD shows ---------------------------------------------------------------

  hud(): RunHud {
    const world = this.host.world;
    const camera = this.host.camera;
    // The compass points at the nearest open portal
    let target: Portal | null = null;
    let best = Infinity;
    for (const p of this.portals) {
      if (!p.open) continue;
      const d = p.position.distanceTo(this.host.flight.position);
      if (d < best) {
        best = d;
        target = p;
      }
    }
    let compass: RunHud["compass"] = null;
    if (target) {
      // In camera space: x right, y up, the camera looking down -z
      toTarget.copy(target.position).applyMatrix4(camera.matrixWorldInverse);
      const ahead = toTarget.z < 0;
      // Ahead: the direction on screen; behind: turned downwards, so the arrow says "turn around"
      const angle = ahead ? Math.atan2(toTarget.x, toTarget.y) : Math.atan2(toTarget.x, -Math.abs(toTarget.y) - Math.abs(toTarget.z) * 0.5);
      compass = { angle, distance: Math.round(best), ahead };
    }
    const abilities: RunHud["abilities"] = [];
    if (this.stats.flap > 0) abilities.push({ id: "flap", name: "Wingbeat", key: "C", charge: this.stamina / (2 + this.stats.flap), ready: this.stamina >= 1, count: Math.floor(this.stamina) });
    abilities.push(...this.abilities.hud(this.host.flight));
    const objectives = [{ title: "Reach the portal", progress: compass ? `${compass.distance} m` : "", fraction: 0, done: false, failed: false }];
    return {
      seed: this.seed,
      level: this.level,
      checkpoint: this.checkpoint,
      length: RUN_LENGTH,
      biome: world.biome.name,
      mood: world.palette.name,
      phase: this.phase,
      score: this.score + (this.styleBanked ? 0 : Math.round(this.host.style)),
      lives: this.lives,
      maxLives: this.maxLives,
      chain: this.chain,
      objectives,
      compass,
      abilities,
      upgrades: [...this.picked],
      items: this.items.hud(),
      charm: this.charm.hud(),
      toast: this.toast,
    };
  }

  dispose() {
    this.disposeLevel();
    this.orbs.dispose();
    this.wormhole.dispose();
    this.finale?.dispose();
    this.group.removeFromParent();
    this.host.whiteOut(0);
    this.host.insideWormhole(false);
    this.host.veil(0);
  }
}
