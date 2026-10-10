import * as THREE from "three";
import type { Flight, FlightMods } from "../flight";
import { plainMods } from "../flight";
import { clamp } from "../math";
import { Kind, type Particles, fx } from "../particles";
import { RUN } from "../tuning";
import { ATMOSPHERE } from "../world/atmosphere";
import { BIOMES, type BiomeId, type Level, runLevel } from "../world/biomes";
import type { World } from "../world/World";
import type { WorldView } from "../world/WorldView";
import { Portal, Tunnel } from "./portal";
import { type Quest, Rescue, createQuests } from "./quests";
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
  destinations,
  runOrder,
} from "./run";
import { type RunStats, type Upgrade, type UpgradeId, UPGRADES, baseStats, offer, statsFor } from "./upgrades";

// One roguelike run, from the first level to the last portal: it loads each
// biome, scores gates, style and sidequests, keeps the lives, runs the
// abilities (handing the flight model its FlightMods), and plays the portal,
// the upgrade pick and the tunnel to the next biome. Game calls it only in
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
  readonly hovering: boolean;
  /** Style points flown in this level so far */
  readonly style: number;
  setLevel(level: Level): void;
  /** Puts the pilot back after `checkpoints` gates (0: the start) */
  respawnAt(checkpoints: number): void;
  /** Holds the pilot still (in the tunnel) */
  freeze(on: boolean): void;
  gateBurst(index: number): void;
  wingbeat(): void;
  stinger(kind: "portal" | "upgrade" | "quest" | "item" | "dash"): void;
}

export interface RunEvents {
  /** The portal was entered: choose one of these */
  offer?(upgrades: Upgrade[], secret: boolean, next: BiomeId | null): void;
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
const toTarget = new THREE.Vector3();
const forward = new THREE.Vector3();
const DASH_COLOR = new THREE.Color("#bff4ff");

export class RunController {
  readonly seed: number;
  phase: RunPhase = "arrive";
  private readonly host: RunHost;
  private readonly events: RunEvents;
  private readonly group = new THREE.Group();
  private readonly mods: FlightMods = plainMods();
  private readonly tunnel = new Tunnel();
  private level = 1;
  private readonly path: BiomeId[] = [];
  private readonly picked: UpgradeId[] = [];
  private stats: RunStats = baseStats();
  private score = 0;
  private lives = START_LIVES;
  private chain = 0;
  private sidequestsDone = 0;
  private readonly passed = new Set<number>();
  private lastGate = 0; // checkpoints: how many gates to respawn after
  private quests: Quest[] = [];
  private portals: Portal[] = [];
  private secretOpened = false;
  private levelTime = 0;
  private phaseTime = 0;
  private dashTime = 0;
  private dashCooldown = 0;
  private stamina = 0;
  private hoverFuel = 0;
  private toast: RunHud["toast"] = null;
  private toastTime = 0;
  private toastId = 0;
  private through: { secret: boolean; next: BiomeId | null } | null = null;
  private skyFrom: Sky | null = null;
  private skyTo: Sky | null = null;
  private readonly skyNow: Sky;
  private ended = false;
  private styleBanked = false; // this level's style is already in the score (we're through the portal)
  private exiting = false; // fading out of the tunnel

  constructor(seed: number, host: RunHost, events: RunEvents) {
    this.seed = seed;
    this.host = host;
    this.events = events;
    host.scene.add(this.group, this.tunnel.mesh);
    this.skyNow = captureSky(host.scene);
  }

  /** Flight changes from upgrades and abilities, for this physics step */
  get flightMods(): FlightMods {
    return this.mods;
  }

  /** Extra levels on the style multiplier */
  get multiplierCap(): number {
    return 4 + this.stats.multiplier;
  }

  /** Gates to respawn after */
  get checkpoint(): number {
    return this.lastGate;
  }

  get frozen(): boolean {
    return this.phase === "portal" || this.phase === "pick" || this.phase === "over" || this.phase === "won";
  }

  start() {
    this.loadLevel(runOrder(this.seed)[0]);
  }

  /** Taking off from the intro: the title card plays from here */
  takeOff() {
    this.phase = "arrive";
    this.phaseTime = 0;
    this.levelTime = 0;
  }

  // --- levels --------------------------------------------------------------------

  private loadLevel(biome: BiomeId) {
    this.disposeLevel();
    this.path.push(biome);
    this.host.setLevel(runLevel(this.seed, this.level, biome));
    const world = this.host.world;
    this.passed.clear();
    this.lastGate = 0;
    this.chain = 0;
    this.levelTime = 0;
    this.secretOpened = false;
    this.styleBanked = false;
    this.host.view.setRings("race", 0);
    const accent = new THREE.Color(world.palette.accent);
    this.quests = createQuests(world.biome.sidequests, {
      world,
      group: this.group,
      particles: this.host.particles,
      stats: this.stats,
      accent,
      notify: (text, points) => this.notify(text, points),
      chime: (big) => this.host.stinger(big ? "quest" : "item"),
    });
    // The main portal stands at the last gate; a secret one off the line, opened by a sidequest
    const { course, biome: spec } = world;
    const finish = course.rings[course.rings.length - 1];
    const dest = destinations(this.seed, this.level, this.path);
    const last = this.level >= RUN_LENGTH;
    this.portals = [new Portal(finish.position.clone().addScaledVector(finish.normal, 3), finish.normal, 15, last ? "#ffe9a0" : BIOMES[dest.main].portals.color, false)];
    if (spec.portals.secret && !last) {
      const z = course.start.z + (course.endZ - course.start.z) * 0.72;
      const side = course.tangentAt(z, new THREE.Vector3()).cross(THREE.Object3D.DEFAULT_UP).normalize();
      const at = course.pointAt(z, new THREE.Vector3()).addScaledVector(side, 70).add(tmp.set(0, -18, 0));
      // Make sure it hangs in clear air
      for (let i = 0; i < 12 && world.distance(at.x, at.y, at.z) < 20; i++) at.addScaledVector(side, -5).y += 2;
      this.portals.push(new Portal(at, course.tangentAt(z, new THREE.Vector3()), 12, BIOMES[dest.secret].portals.color, true));
    }
    for (const portal of this.portals) this.group.add(portal.group);
    // Abilities start charged
    this.stamina = 2 + this.stats.flap;
    this.hoverFuel = this.hoverMax;
    this.dashCooldown = 0;
    this.phase = "arrive";
    this.phaseTime = 0;
    this.events.arrived?.(this.level, biome);
  }

  private disposeLevel() {
    this.quests.forEach((q) => q.dispose());
    this.quests = [];
    this.portals.forEach((p) => p.dispose());
    this.portals = [];
  }

  private get hoverMax(): number {
    return this.stats.hover > 0 ? 1 + 0.7 * this.stats.hover : 0;
  }

  // --- the pilot's moves ----------------------------------------------------------

  /** Shift and Space: dash and wingbeat, if the upgrades are there */
  ability(action: "dash" | "flap") {
    if (this.frozen) return;
    if (action === "dash" && this.stats.dash > 0 && this.dashCooldown <= 0) {
      this.dashTime = 0.55;
      this.dashCooldown = Math.max(1.6, 5 - this.stats.dash * 1.1);
      this.host.stinger("dash");
    } else if (action === "flap" && this.stats.flap > 0 && this.stamina >= 1) {
      this.stamina -= 1;
      this.host.flight.flap(5 + this.stats.flap * 1.5, 0.1);
      this.host.wingbeat();
    }
  }

  /** Per physics step, after the flight moved: gates, sidequests, portals */
  step(dt: number, proximity: number) {
    const { flight, prevPosition } = this.host;
    // This step's flight changes, for the next one
    const m = this.mods;
    m.drag = this.stats.drag;
    m.sink = this.stats.sink;
    m.stall = this.stats.stall;
    m.proximityBoost = this.stats.proximity;
    m.glideLock = this.stats.glideLock > 0;
    m.boost = this.dashTime > 0 ? 34 + 8 * this.stats.dash : 0;
    m.hover = 0;
    if (this.host.hovering && this.hoverFuel > 0 && this.stats.hover > 0) {
      m.hover = 1;
      this.hoverFuel = Math.max(0, this.hoverFuel - dt);
    }
    m.lift = 0;
    for (const q of this.quests) m.lift = Math.max(m.lift, q.lift(flight.position));
    if (m.lift > 0) m.boost += 6;
    if (this.phase !== "explore" && this.phase !== "arrive") return;
    this.levelTime += dt;

    // Gates: any gate passed scores; in a row without crashing, more and more
    const rings = this.host.world.course.rings;
    for (let i = 0; i < rings.length - 1; i++) {
      if (this.passed.has(i)) continue;
      const ring = rings[i];
      const before = tmp.subVectors(prevPosition, ring.position).dot(ring.normal);
      const after = tmp.subVectors(flight.position, ring.position).dot(ring.normal);
      if (before >= 0 || after < 0) continue;
      tmp.lerpVectors(prevPosition, flight.position, before / (before - after));
      if (tmp.distanceTo(ring.position) > ring.radius + 1 + this.stats.magnet) continue;
      this.passed.add(i);
      this.chain = Math.min(CHAIN_MAX, this.chain + 1);
      this.lastGate = Math.max(this.lastGate, i + 1);
      this.score += (GATE_POINTS + this.stats.gateBonus) * this.chain;
      // Every gate refills a wingbeat
      this.stamina = Math.min(2 + this.stats.flap, this.stamina + 1);
      let next = 0;
      while (this.passed.has(next)) next++;
      this.host.view.setRings("race", next);
      this.host.gateBurst(i);
    }

    for (const q of this.quests) {
      const wasDone = q.done;
      q.step(prevPosition, flight.position, flight.speed, proximity, dt);
      if (q.done && !wasDone) {
        this.sidequestsDone++;
        if (!this.secretOpened && this.portals[1]) {
          this.secretOpened = true;
          this.portals[1].open = true;
          this.notify("A secret portal has opened!", 0);
        }
      }
    }

    for (const portal of this.portals) {
      if (portal.crossed(prevPosition, flight.position, this.stats.magnet)) {
        this.enterPortal(portal.secret);
        break;
      }
    }
  }

  /** A crash: one feather less. Returns false when the run is over */
  crashed(): boolean {
    this.chain = 0;
    this.lives--;
    this.dashTime = 0;
    if (this.lives < 0) {
      this.lives = 0;
      this.score += Math.round(this.host.style);
      this.styleBanked = true;
      this.finish(false);
      return false;
    }
    this.notify(this.lives === 0 ? "Last feather!" : `${this.lives} feather${this.lives > 1 ? "s" : ""} left`, 0);
    return true;
  }

  private notify(text: string, points: number) {
    this.score += points;
    this.toast = { text, points, id: ++this.toastId };
    this.toastTime = 2.6;
  }

  // --- portals, the upgrade pick and the tunnel -----------------------------------------

  private enterPortal(secret: boolean) {
    // Clearing the level: a bonus, more for a fast one
    const par = (this.host.world.course.endZ - this.host.world.course.start.z) / 42;
    this.score += LEVEL_BONUS + Math.round(Math.max(0, par - this.levelTime) * PAR_POINTS) + Math.round(this.host.style);
    this.styleBanked = true;
    this.host.stinger("portal");
    if (this.level >= RUN_LENGTH) {
      this.finish(true);
      return;
    }
    const dest = destinations(this.seed, this.level, this.path);
    this.through = { secret, next: secret ? dest.secret : dest.main };
    this.phase = "portal";
    this.phaseTime = 0;
    this.host.freeze(true);
    this.tunnel.colors(this.host.world.palette.accent, BIOMES[this.through.next!].portals.color);
    this.skyFrom = captureSky(this.host.scene, this.skyFrom ?? undefined);
  }

  /** The player chose an upgrade: on to the next biome */
  pick(id: UpgradeId) {
    if (this.phase !== "pick" || !this.through) return;
    this.picked.push(id);
    this.stats = statsFor(this.picked);
    const extra = UPGRADES.find((u) => u.id === id)?.effect.lives ?? 0;
    this.lives += extra;
    this.host.stinger("upgrade");
    this.level++;
    // Build the next biome while the tunnel hides everything
    this.loadLevel(this.through.next!);
    this.host.respawnAt(0);
    this.host.freeze(true);
    this.skyTo = captureSky(this.host.scene, this.skyTo ?? undefined);
    this.phase = "portal";
    this.phaseTime = 1; // past the tunnel's way in: now waiting for the land, then out
    this.through = null;
  }

  private finish(won: boolean) {
    if (this.ended) return;
    this.ended = true;
    this.phase = won ? "won" : "over";
    this.host.freeze(true);
    this.events.ended?.({
      seed: this.seed,
      score: this.score,
      levels: this.level,
      path: [...this.path],
      upgrades: [...this.picked],
      sidequests: this.sidequestsDone,
      won,
    });
  }

  // --- per frame ------------------------------------------------------------------------

  frame(dt: number) {
    const { camera, particles } = this.host;
    this.phaseTime += dt;
    if (this.toast && (this.toastTime -= dt) <= 0) this.toast = null;
    this.dashTime = Math.max(0, this.dashTime - dt);
    this.dashCooldown = Math.max(0, this.dashCooldown - dt);
    if (!this.host.hovering) this.hoverFuel = Math.min(this.hoverMax, this.hoverFuel + dt * 0.35);
    if (this.stats.flap > 0) this.stamina = Math.min(2 + this.stats.flap, this.stamina + dt / 9);
    if (this.phase === "arrive" && this.phaseTime > 3) this.phase = "explore";

    for (const q of this.quests) q.update(dt, camera.position, this.host.flight.position);
    for (const q of this.quests) if (q instanceof Rescue) q.follow(this.host.flight.position, this.host.flight.quaternion, dt, this.host.flight.speed);
    for (const p of this.portals) p.update(dt, particles, camera.position);

    // A dash trails light
    if (this.dashTime > 0) {
      for (let i = 0; i < 3; i++) {
        particles.emit(this.host.flight.position, tmp.copy(this.host.flight.velocity).multiplyScalar(-0.2).add(forward.set(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5)), fx(0.5, 1, DASH_COLOR, Kind.Wisp, 0, 2, 1.4));
      }
    }

    // The tunnel: in, wait for the pick (and the next land), out with the palettes cross-fading
    camera.getWorldDirection(forward);
    if (this.phase === "portal" && this.through) {
      const t = clamp(this.phaseTime / 0.7, 0, 1);
      this.tunnel.place(camera.position, forward, t, 0);
      if (t >= 1 && this.phase === "portal") {
        this.phase = "pick";
        const secret = this.through.secret;
        this.events.offer?.(offer(this.seed, this.level, this.picked, secret), secret, this.through.next);
      }
    } else if (this.phase === "pick") {
      this.tunnel.place(camera.position, forward, 1, 0.2 + 0.1 * Math.sin(this.phaseTime));
    } else if (this.phase === "portal") {
      // Waiting for the new land under cover, then fading out of the tunnel into it
      // (once the fade has begun it carries on, even as more land streams in)
      if (!this.host.view.ready && !this.exiting) {
        this.phaseTime = 1;
        this.tunnel.place(camera.position, forward, 1, 1);
        this.blendSky(0);
      } else {
        this.exiting = true;
        const out = clamp((this.phaseTime - 1) / RUN.tunnelFade, 0, 1);
        this.tunnel.place(camera.position, forward, 1 - out, 1);
        this.blendSky(out);
        if (out > 0.15) this.host.freeze(false);
        if (out >= 1) {
          this.phase = "arrive";
          this.phaseTime = 0;
          this.skyFrom = null;
          this.exiting = false;
        }
      }
    } else {
      this.tunnel.place(camera.position, forward, 0, 0);
    }
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
    // The compass points at the open secret portal if it's nearer, else the main one
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
      compass = { angle, distance: Math.round(best), ahead, secret: target.secret };
    }
    const abilities: RunHud["abilities"] = [];
    if (this.stats.dash > 0) abilities.push({ id: "dash", name: "Dash", key: "Shift", charge: 1 - this.dashCooldown / Math.max(1.6, 5 - this.stats.dash * 1.1), ready: this.dashCooldown <= 0 });
    if (this.stats.flap > 0) abilities.push({ id: "flap", name: "Wingbeat", key: "Space", charge: this.stamina / (2 + this.stats.flap), ready: this.stamina >= 1, count: Math.floor(this.stamina) });
    if (this.stats.hover > 0) abilities.push({ id: "hover", name: "Hover", key: "F", charge: this.hoverFuel / Math.max(0.01, this.hoverMax), ready: this.hoverFuel > 0.05 });
    const objectives = this.quests.map((q) => q.objective());
    objectives.push({ title: this.secretOpened ? "Fly into a portal" : "Reach the portal", progress: compass ? `${compass.distance} m` : "", fraction: 0, done: false, failed: false });
    let timer: number | null = null;
    for (const q of this.quests) timer = q.timer() ?? timer;
    return {
      seed: this.seed,
      level: this.level,
      length: RUN_LENGTH,
      biome: world.biome.name,
      mood: world.palette.name,
      phase: this.phase,
      score: this.score + (this.styleBanked ? 0 : Math.round(this.host.style)),
      lives: this.lives,
      chain: this.chain,
      objectives,
      compass,
      secretOpen: this.secretOpened,
      abilities,
      upgrades: [...this.picked],
      timer,
      toast: this.toast,
    };
  }

  dispose() {
    this.disposeLevel();
    this.tunnel.dispose();
    this.group.removeFromParent();
    this.tunnel.mesh.removeFromParent();
  }
}
