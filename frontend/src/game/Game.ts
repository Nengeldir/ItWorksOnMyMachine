import * as THREE from "three";
import type { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import type { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";
import { Ambient } from "./ambient";
import { GameAudio } from "./audio";
import { Avatar } from "./avatar";
import { CameraRig } from "./camera";
import { DISSOLVE_AT, type DeathKind, DeathFall, classifyCrash, fieldNormal } from "./death";
import { Debris } from "./effects";
import { FLIGHT, Flight, type FlightInput } from "./flight";
import { GlideIn } from "./glidein";
import { Equipment } from "./items/equip";
import type { ItemId, ItemSlot } from "./items/models";
import { type GhostData, GhostRecorder, type GhostRun, ghostSamples } from "./ghost";
import { type ControlSettings, Input } from "./input";
import { FX_LIGHT, Kind, Particles, fx, fxTime } from "./particles";
import { PilotFx } from "./pilotfx";
import { INTERPOLATION_DELAY_MS, Pilot, type PilotSample } from "./pilots";
// import { Trail } from "./trail";
// import { WINGTIPS, createAirplane } from "./airplane";
import { clamp } from "./math";
import { SpeedLines } from "./speedlines";
import { TOON_LIGHT } from "./toon";
import { FX, RANGES, RINGS, TUNING_GROUPS, WATER, loadTuning, resetTuning, saveTuning } from "./tuning";
import { RunController, type RunEvents, type RunHost } from "./run/controller";
import type { RunHud } from "./run/run";
import { type Level, levelId, raceLevel } from "./world/biomes";
import type { WaterKind } from "./world/terrain/river";
import { type WaterHit, World } from "./world/World";
import { WorldView } from "./world/WorldView";
import { reloadForNewBuild } from "../staleBuild";

const STEP = 1 / 120; // physics runs at a fixed rate, rendering interpolates
const MAX_STEPS_PER_FRAME = 12;
const CRASH_DISTANCE = 0.7; // metres from a surface
const SCORE_RANGE = 10; // proximity counts within this many metres
const RESPAWN_DELAY = 1.4; // seconds
const START_SPEED = 32; // m/s
const HUD_INTERVAL = 100; // ms
const GOLD = new THREE.Color("#ffd23f");
const WHITE = new THREE.Color("#ffffff");
const SPRAY = new THREE.Color("#e8f7ff");
const LAVA_SPARK = new THREE.Color("#ff9a3c");

/** 2: bloom and full resolution, 1: no bloom, 0: lower resolution and fewer particles */
type Quality = 0 | 1 | 2;
const QUALITY = [
  { pixelRatio: 1, particles: 0.4 },
  { pixelRatio: 1.5, particles: 0.75 },
  { pixelRatio: 2, particles: 1 },
] as const;
const DRIFT_SPEED = 14; // m/s along the course, for the menu's camera

export type RaceState = "free" | "countdown" | "racing" | "finished";

/** The game as a menu backdrop: "drift" glides a camera over the course, "chase" follows an autopiloted pilot */
export type AttractMode = "drift" | "chase";

export interface Participant {
  id: string;
  name: string;
  color: string;
  finishMs: number | null;
}

export interface Standing extends Participant {
  me: boolean;
  checkpoints: number;
}

export interface HudState {
  seed: number;
  /** The roguelike run, in run mode */
  run: RunHud | null;
  biomeName: string;
  paletteName: string;
  speedKmh: number;
  boostCharge: number;
  boosting: boolean;
  braking: boolean;
  clearance: number; // metres to the nearest rock or tree
  loading: boolean; // the islands near you are still being built
  raceState: RaceState;
  raceTimeMs: number | null;
  countdown: number | null; // whole seconds left
  checkpoints: number;
  totalCheckpoints: number;
  proximity: number; // 0..1
  style: number;
  multiplier: number;
  crashed: boolean;
  paused: boolean;
  locked: boolean;
  muted: boolean;
  standings: Standing[];
}

export interface FinishResult {
  timeMs: number;
  ghost: GhostData;
}

export interface GameEvents {
  hud(state: HudState): void;
  raceStarted?(): void;
  finished?(result: FinishResult): void;
}

export interface GameOptions {
  /** A race or time trial on this seed (Sky Isles), unless `level` is given */
  seed: number;
  level?: Level;
  /** Milliseconds; the server clock in rooms, so everyone starts together */
  clock: () => number;
  controls: ControlSettings;
  color: string;
  events: GameEvents;
  /** Set for a menu backdrop: no player input, no audio, flies itself */
  attract?: AttractMode;
}

/** Live state for the network: [x,y,z], [qx,qy,qz,qw], speed, checkpoints */
export interface NetState {
  p: [number, number, number];
  q: [number, number, number, number];
  v: number;
  cp: number;
  boost: number;
  brake: number;
  dodge: number;
}

const tmp = new THREE.Vector3();
const tmp2 = new THREE.Vector3();
const projected = new THREE.Vector3();
const at = new THREE.Vector3();
const vel = new THREE.Vector3();
const basisA = new THREE.Vector3();
const basisB = new THREE.Vector3();
const color = new THREE.Color();
const normal = new THREE.Vector3();
const surface = new THREE.Vector3();
const waterHit: WaterHit = { distance: 0, level: 0, kind: "water" };
const rand = (min: number, max: number) => min + Math.random() * (max - min);

export class Game implements RunHost {
  private readonly container: HTMLElement;
  private readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  private readonly rig: CameraRig;
  private readonly input: Input;
  private readonly audio = new GameAudio();
  readonly flight = new Flight();
  readonly prevPosition = new THREE.Vector3();
  private readonly prevVelocity = new THREE.Vector3();
  private readonly renderVelocity = new THREE.Vector3();
  private readonly prevQuaternion = new THREE.Quaternion();
  private readonly avatar: Avatar;
  private readonly fx: PilotFx;
  /** What the pilot carries (models and animations only, for now) */
  private readonly equipment: Equipment;
  readonly particles: Particles;
  /** Particles that blend instead of glowing: snow, leaves, ash, mist */
  private readonly softParticles: Particles;
  private readonly ambient: Ambient;
  private readonly speedLines: SpeedLines;
  private readonly debris: Debris;
  private readonly marker: HTMLDivElement;
  private readonly vignette: HTMLDivElement;
  private readonly crystalPoints: THREE.Vector3[] = [];
  private composer: EffectComposer | null = null;
  private bloomPass: UnrealBloomPass | null = null;
  private composerLoading = false;
  private quality: Quality = 2;
  private slowFrames = 0;
  private measured = 0;
  private flash = 0;
  private dustDebt = 0;
  private moteDebt = 0;
  private glintDebt = 0;
  private readonly recorder = new GhostRecorder();
  private readonly live = new Map<string, Pilot>();
  private ghosts: Pilot[] = [];
  private readonly clock: () => number;
  private readonly events: GameEvents;
  private readonly attract: AttractMode | null;
  private driftZ = 0;
  world!: World;
  view!: WorldView;
  /** The roguelike run, when this game is one (never in races) */
  private run: RunController | null = null;
  private frozen = false;
  private paused = false;
  private selfId = "";
  private startSlot: number | null = null; // place on the start grid, null = alone
  private participants: Participant[] = [];

  private raceState: RaceState = "free";
  private startAt = 0;
  private checkpoints = 0;
  private finishMs: number | null = null;
  private crashedAt: number | null = null;
  /** The pilot's tumble after a crash (looks only) */
  private readonly death = new DeathFall();
  private dissolved = false;
  /** Gliding in on rails while the land loads: no control, no physics, no scoring */
  private readonly glide = new GlideIn();
  private deathDebt = 0;
  private proximity = 0;
  private smoothProximity = 0;
  style = 0;
  private combo = 0;
  private comboIdle = 0;
  private lastBeep = 0;
  private input0: FlightInput = { pitch: 0, roll: 0 };

  private accumulator = 0;
  private lastFrame = 0;
  private elapsed = 0;
  private lastHud = 0;
  private frame = 0;
  private readonly resizeObserver: ResizeObserver;
  private gui: { destroy(): void } | null = null;

  constructor(container: HTMLElement, options: GameOptions) {
    this.container = container;
    this.clock = options.clock;
    this.events = options.events;
    loadTuning();
    this.attract = options.attract ?? null;

    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance" });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, QUALITY[this.quality].pixelRatio));
    this.renderer.domElement.className = "game-canvas";
    container.appendChild(this.renderer.domElement);

    this.rig = new CameraRig(1);
    this.input = new Input(this.renderer.domElement, options.controls);
    this.input.onAction = (action) => {
      if (this.attract) return;
      if (action === "pause") {
        this.togglePause();
        return;
      }
      if (this.paused && action !== "mute") return;
      if (action === "respawn") this.respawnNow();
      if (action === "mute") this.audio.toggleMute();
      if (action === "barrelLeft" || action === "barrelRight") this.barrelRoll(action === "barrelLeft" ? -1 : 1);
      if (action === "flap" && this.crashedAt === null && !this.glide.active) this.run?.ability(action);
    };
    if (!this.attract) {
      this.renderer.domElement.addEventListener("click", this.engage);
      // Audio may only start after a user gesture: take the first one, mouse or keyboard
      window.addEventListener("keydown", this.startAudio, { once: true });
      window.addEventListener("pointerdown", this.startAudio, { once: true });
    }

    this.particles = new Particles();
    this.softParticles = new Particles(3000, true);
    this.ambient = new Ambient(this.particles, this.softParticles);
    this.avatar = new Avatar(options.color);
    this.fx = new PilotFx(this.avatar, options.color, this.particles);
    if (!this.attract) {
      // Your own wings make a sound on each downstroke (the effects keep their own hook)
      const puff = this.avatar.onDownstroke;
      this.avatar.onDownstroke = (strength) => {
        puff?.(strength);
        if (!this.frozen && this.crashedAt === null) this.audio.wing(strength);
      };
    }
    this.equipment = new Equipment(this.avatar, this.particles);
    this.speedLines = new SpeedLines();
    this.debris = new Debris(options.color);
    this.scene.add(this.avatar.group, this.debris.mesh, this.particles.points, this.softParticles.points, this.speedLines.mesh, ...this.fx.meshes);

    this.vignette = document.createElement("div");
    this.vignette.className = "speed-vignette";
    container.appendChild(this.vignette);
    this.marker = document.createElement("div");
    this.marker.className = "ring-marker";
    container.appendChild(this.marker);

    this.setLevel(options.level ?? raceLevel(options.seed));

    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(container);
    this.resize();
    this.frame = requestAnimationFrame(this.loop);

    if (new URLSearchParams(location.search).has("tune")) void this.openTuning();
    // Lets browser tests drive the game in development
    if (import.meta.env.DEV) {
      Object.assign(window, { __game: this, __fxTime: fxTime, __tuning: Object.fromEntries(TUNING_GROUPS) });
      void import("./devtools").then(({ installDevtools }) => installDevtools());
    }
  }

  // --- public API --------------------------------------------------------------

  /** Call from a click: locks the mouse and starts audio (browsers need a gesture for both) */
  engage = () => {
    if (this.paused) return;
    this.input.lockPointer();
    this.audio.start();
  };

  private startAudio = () => this.audio.start();

  /** Freeze local gameplay; the server-validated race clock keeps running. */
  togglePause() {
    if (this.attract) return;
    this.paused = !this.paused;
    // Resume with a fresh frame delta instead of catching up on time spent paused.
    this.lastFrame = 0;
    this.input.reset();
    if (this.paused) this.input.releasePointer();
    this.audio.setPaused(this.paused);
    this.events.hud(this.hud(this.clock()));
  }

  // --- the roguelike run (RunHost) ---------------------------------------------------

  /** Turns this game into a roguelike run: levels, upgrades, portals (never used for races) */
  startRun(seed: number, events: RunEvents) {
    this.run?.dispose();
    this.run = new RunController(seed, this, events);
    this.run.start();
  }

  /** Holds the pilot on the start line until the player takes off */
  holdRun(hold: boolean) {
    if (this.paused) this.togglePause();
    this.freeze(hold);
    if (!hold) {
      this.respawn(0);
      this.run?.takeOff();
    }
  }

  /** The upgrade chosen at a portal */
  pickUpgrade(id: Parameters<RunController["pick"]>[0]) {
    if (this.paused) return;
    this.run?.pick(id);
  }

  // --- items (models and animations only: nothing here changes the flight) ----------------

  /** Pulls an item out of the inventory and puts it on (the firework on the back, helmets on the head, the rest in hand) */
  equip(id: ItemId) {
    this.equipment.equip(id);
  }

  unequip(slot: ItemSlot) {
    this.equipment.unequip(slot);
  }

  /** Eats or uses what's in the hand */
  useItem() {
    this.equipment.use();
  }

  /** The firework's flame, 0..1 (looks only; the boost itself comes later) */
  thrust(amount: number) {
    this.equipment.setThrust(amount);
  }

  get camera(): THREE.PerspectiveCamera {
    return this.rig.camera;
  }

  get hovering(): boolean {
    return this.input.hovering;
  }

  respawnAt(checkpoints: number) {
    this.respawn(checkpoints);
  }

  freeze(on: boolean) {
    this.frozen = on;
    if (on) { this.flight.releaseControls(); this.input.reset(); }
    this.accumulator = 0;
  }

  wingbeat() {
    this.avatar.beat();
    this.audio.flap();
    const amount = Math.round(24 * this.particles.budget);
    for (let k = 0; k < amount; k++) {
      this.particles.emit(
        at.copy(this.flight.position).addScaledVector(this.flight.right, rand(-1.6, 1.6)),
        vel.copy(this.flight.up).multiplyScalar(-rand(2, 6)).add(tmp2.set(rand(-1, 1), rand(-1, 1), rand(-1, 1))),
        fx(rand(0.5, 0.9), rand(0.3, 0.6), WHITE, Kind.Glow, 1, 2, 1.6),
      );
    }
  }

  stinger(kind: "portal" | "upgrade" | "dash") {
    this.audio.stinger(kind);
  }

  /** Keeps the camera out of the rock */
  private clearance = (x: number, y: number, z: number) => this.world.rock.distance(x, y, z);
  /** Everything solid: rock, trees, water */
  private field = (x: number, y: number, z: number) => this.world.distance(x, y, z);

  get seed(): number {
    return this.world.seed;
  }

  /** The music file playing right now (debug panel) */
  get musicTrack(): string | null {
    return this.audio.track;
  }

  get level(): Level {
    return this.world.level;
  }

  /** A race or time trial on `seed`: Sky Isles, the race map */
  setSeed(seed: number) {
    if (this.world?.seed === seed && !this.world.level.run) return;
    this.setLevel(raceLevel(seed));
  }

  /** Builds the world for a level and puts you at the start, flying freely */
  setLevel(level: Level) {
    // Already built (a run's first level, handed to the constructor): just start over
    if (this.world && levelId(this.world.level.key) === levelId(level.key) && this.world.level.run?.index === level.run?.index) {
      this.style = 0;
      this.freeFlight(true);
      return;
    }
    if (this.view) {
      this.scene.remove(this.view.group);
      this.view.dispose();
    }
    this.world = new World(level);
    this.view = new WorldView(this.world, this.scene);
    this.view.prepare(this.renderer);
    this.scene.add(this.view.group);
    // Compile the level's shaders now (behind the loading wait or the tunnel), not mid-flight
    this.renderer.compile(this.scene, this.rig.camera);
    this.particles.clear();
    this.softParticles.clear();
    this.ambient.setWorld(this.world);
    this.speedLines.setColor(this.world.palette.horizon);
    // How effects react to this biome's light: glows pop at night, and get a push in bright daylight
    const palette = this.world.palette;
    FX_LIGHT.boost.value = palette.glow;
    TOON_LIGHT.rimColor.value.set(palette.sun).lerp(WHITE, 0.35);
    TOON_LIGHT.glow.value = 0.15 + palette.night * 1.3;
    this.audio.setBiome(level.biome.id, palette.night);
    this.setGhosts([]);
    this.style = 0;
    this.freeFlight(true);
  }

  setSelf(id: string, color: string) {
    this.selfId = id;
    this.avatar.setColor(color);
    this.fx.setColor(color);
    this.debris.setColor(color);
  }

  setControls(controls: ControlSettings) {
    this.input.settings = controls;
  }

  /** No race: fly around, rings are just scenery */
  freeFlight(respawn: boolean) {
    if (this.paused) this.togglePause();
    this.startSlot = null;
    this.raceState = "free";
    this.checkpoints = 0;
    this.finishMs = null;
    this.view.setRings("free", 0);
    if (respawn) this.respawn(0);
  }

  /** Puts you on the start line (or grid slot 0, 1, … in a room), frozen until the clock reaches startAt */
  startCountdown(startAt: number, slot: number | null = null) {
    if (this.paused) this.togglePause();
    this.startSlot = slot;
    this.raceState = "countdown";
    this.startAt = startAt;
    this.checkpoints = 0;
    this.finishMs = null;
    this.style = 0;
    this.lastBeep = Infinity;
    this.recorder.reset();
    this.view.setRings("race", 0);
    this.respawn(0);
  }

  /** The other players in the room (everyone but you) */
  syncPilots(players: { id: string; name: string; color: string }[]) {
    const keep = new Set<string>();
    for (const player of players) {
      if (player.id === this.selfId) continue;
      keep.add(player.id);
      if (!this.live.has(player.id)) {
        const pilot = new Pilot(player.id, player.name, player.color, false, this.particles);
        this.live.set(player.id, pilot);
        this.scene.add(pilot.group, ...pilot.trailMeshes);
      }
    }
    for (const [id, pilot] of this.live) {
      if (!keep.has(id)) this.removePilot(pilot);
    }
    for (const id of [...this.live.keys()]) if (!keep.has(id)) this.live.delete(id);
  }

  setParticipants(participants: Participant[]) {
    this.participants = participants;
  }

  pushSample(id: string, sample: PilotSample) {
    this.live.get(id)?.push(sample);
  }

  setGhosts(runs: GhostRun[]) {
    this.ghosts.forEach((g) => this.removePilot(g));
    this.ghosts = runs.map((run, i) => {
      const pilot = new Pilot(`ghost${i}`, run.name, "#ffffff", true, this.particles);
      pilot.setSamples(ghostSamples(run.ghost));
      this.scene.add(pilot.group, ...pilot.trailMeshes);
      return pilot;
    });
  }

  netState(): NetState {
    const { position: p, quaternion: q, speed } = this.flight;
    return { p: [p.x, p.y, p.z], q: [q.x, q.y, q.z, q.w], v: speed, cp: this.checkpoints, boost: this.flight.boost, brake: this.flight.brake, dodge: this.flight.dodgePhase };
  }

  toggleMute(): boolean {
    return this.audio.toggleMute();
  }

  dispose() {
    cancelAnimationFrame(this.frame);
    this.resizeObserver.disconnect();
    this.renderer.domElement.removeEventListener("click", this.engage);
    window.removeEventListener("keydown", this.startAudio);
    window.removeEventListener("pointerdown", this.startAudio);
    this.input.dispose();
    this.audio.dispose();
    this.gui?.destroy();
    this.run?.dispose();
    this.view.dispose();
    this.live.forEach((p) => this.removePilot(p));
    this.ghosts.forEach((p) => this.removePilot(p));
    this.fx.dispose();
    this.equipment.dispose();
    this.avatar.dispose();
    this.particles.dispose();
    this.softParticles.dispose();
    this.speedLines.dispose();
    this.debris.dispose();
    this.composer?.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
    this.marker.remove();
    this.vignette.remove();
  }

  // --- flying ------------------------------------------------------------------

  private removePilot(pilot: Pilot) {
    this.scene.remove(pilot.group, ...pilot.trailMeshes);
    pilot.dispose();
  }

  private respawn(checkpoints: number) {
    const { position, direction } = this.world.spawnPoint(checkpoints);
    if (checkpoints === 0 && this.startSlot !== null) {
      // A start grid four abreast, so racers don't spawn inside each other
      const side = tmp.crossVectors(direction, THREE.Object3D.DEFAULT_UP).normalize();
      const column = (this.startSlot % 4) - 1.5;
      const row = Math.floor(this.startSlot / 4);
      position.addScaledVector(side, column * 9).addScaledVector(direction, -12 * row);
      position.y += 4 * row;
    }
    this.input.reset();
    this.avatar.resetMotion();
    this.flight.reset(position, direction, START_SPEED);
    this.glide.stop();
    this.prevPosition.copy(this.flight.position);
    this.prevQuaternion.copy(this.flight.quaternion);
    this.prevVelocity.copy(this.flight.velocity);
    this.accumulator = 0;
    this.crashedAt = null;
    this.proximity = 0;
    this.combo = 0;
    this.avatar.revive();
    this.avatar.visible = true;
    this.fx.reset();
    this.speedLines.reset();
    this.rig.snap(this.flight.position, this.flight.forward, this.flight.up, this.flight.speed);
  }

  private respawnNow() {
    if (this.raceState === "countdown") return;
    if (this.run) {
      if (this.run.frozen) return;
      this.respawn(this.run.checkpoint);
      return;
    }
    this.respawn(this.raceState === "free" ? 0 : this.checkpoints);
  }

  /** `lost`: fell below the islands rather than hitting something */
  private crash(lost: boolean) {
    const f = this.flight;
    this.crashedAt = this.elapsed;
    this.flight.releaseControls();
    // How the hit plays out depends on how you met the surface (seen from the last step, still outside it)
    fieldNormal(this.field, this.prevPosition, normal);
    const kind = classifyCrash(tmp.copy(f.velocity).normalize(), f.right, normal, lost);
    this.death.start(kind, this.prevPosition, f.velocity, f.quaternion, f.right, f.up, normal);
    this.avatar.die(kind, this.death.side);
    this.dissolved = false;
    this.deathDebt = 0;
    this.fx.hide();
    if (!lost) this.debris.burst(f.position, f.velocity);
    this.crashBurst(kind, normal);
    this.audio.crash();
    this.combo = 0;
    this.run?.crashed();
  }

  private step(input: FlightInput) {
    this.prevPosition.copy(this.flight.position);
    this.prevQuaternion.copy(this.flight.quaternion);
    this.prevVelocity.copy(this.flight.velocity);
    this.flight.step(STEP, input, this.proximity * this.proximity, FLIGHT, this.run ? this.run.flightMods : null);

    const { x, y, z } = this.flight.position;
    const distance = this.world.distance(x, y, z);
    if (distance < CRASH_DISTANCE || this.world.lost(y, z)) {
      this.crash(distance >= CRASH_DISTANCE);
      return;
    }
    this.proximity = clamp((SCORE_RANGE - distance) / (SCORE_RANGE - 1.5), 0, 1);

    // Style: points for flying close, with a multiplier that grows while you stay close
    if (this.proximity > 0.15) {
      this.combo += STEP;
      this.comboIdle = 0;
    } else if ((this.comboIdle += STEP) > 1.2) {
      this.combo = 0;
    }
    this.style += this.proximity ** 2 * this.flight.speed * STEP * this.multiplier * 0.5;

    if (this.raceState === "racing") {
      this.recorder.record(this.clock() - this.startAt, this.flight.position, this.flight.quaternion, this.flight.boost, this.flight.brake, this.flight.dodgePhase);
      this.checkRing();
    } else if (this.run) {
      this.run.step(STEP);
    } else if (this.raceState === "free") {
      // No race, but flying through a gate still makes it shine
      const rings = this.world.course.rings;
      for (let i = 0; i < rings.length; i++) {
        if (!this.view.gates.passing(i) && this.crossed(i)) this.gateBurst(i);
      }
    }
  }

  /** Did the last physics step fly through ring `index`? */
  private crossed(index: number): boolean {
    const ring = this.world.course.rings[index];
    const before = tmp.subVectors(this.prevPosition, ring.position).dot(ring.normal);
    const after = tmp.subVectors(this.flight.position, ring.position).dot(ring.normal);
    if (before >= 0 || after < 0) return false;
    const hit = tmp.lerpVectors(this.prevPosition, this.flight.position, before / (before - after));
    return hit.distanceTo(ring.position) <= ring.radius + 1;
  }

  /** One frame of the glide-in: the pilot moves on rails, nothing scores, the run's clock keeps going */
  private glideIn(dt: number) {
    if (!this.glide.active) this.glide.start(this.flight, this.world.course.rings);
    this.glide.update(dt, this.flight, this.field);
    this.prevPosition.copy(this.flight.position);
    this.prevQuaternion.copy(this.flight.quaternion);
    this.accumulator = 0;
    this.proximity = 0;
    this.run?.wait(dt);
  }

  /** The land has arrived: the player flies from where the glide got to, at the start speed */
  private handOver() {
    this.glide.stop();
    this.flight.reset(this.flight.position, this.glide.heading, START_SPEED);
    this.prevPosition.copy(this.flight.position);
    this.prevQuaternion.copy(this.flight.quaternion);
    this.accumulator = 0;
  }

  /** Steers along the racing line, like a player who never misses */
  private autopilot(): FlightInput {
    const f = this.flight;
    const target = this.world.course.pointAt(f.position.z + 35, tmp).sub(f.position);
    const ahead = Math.max(target.dot(f.forward), 1);
    const bank = clamp(2.2 * Math.atan2(target.dot(f.right), ahead), -1.1, 1.1);
    return { roll: clamp(2.5 * (bank - f.bank), -1, 1), pitch: clamp(3 * Math.atan2(target.dot(f.up), ahead), -1, 1) };
  }

  /** Glides the camera high over the course, looking ahead and down at the islands */
  private drift(dt: number) {
    const { course } = this.world;
    this.driftZ += dt * DRIFT_SPEED;
    if (this.driftZ > course.endZ) this.driftZ = course.start.z;
    const camera = this.rig.camera;
    course.pointAt(this.driftZ, camera.position).add(tmp.set(0, 90, -150));
    camera.up.set(0, 1, 0);
    camera.lookAt(course.pointAt(this.driftZ + 450, tmp).add(tmp2.set(0, -110, 0)));
    if (camera.fov !== 55) {
      camera.fov = 55;
      camera.updateProjectionMatrix();
    }
    this.flight.releaseControls();
    this.avatar.visible = false;
    this.fx.hide();
  }

  private get multiplier(): number {
    return 1 + Math.min(this.run ? this.run.multiplierCap : 4, Math.floor(this.combo / 1.5));
  }

  /** Did the last step pass through the next ring? */
  private checkRing() {
    const index = this.checkpoints;
    const ring = this.world.course.rings[index];
    if (!ring || !this.crossed(index)) return;

    this.checkpoints++;
    if (ring.finish) {
      const timeMs = Math.round(this.clock() - this.startAt);
      this.raceState = "finished";
      this.finishMs = timeMs;
      this.view.setRings("hidden", 0);
      this.gateBurst(index);
      this.audio.finish();
      const ghost = this.recorder.finish(timeMs, this.flight.position, this.flight.quaternion, this.flight.boost, this.flight.brake, this.flight.dodgePhase);
      this.events.finished?.({ timeMs, ghost });
    } else {
      this.audio.ring();
      this.view.setRings("race", this.checkpoints);
      this.gateBurst(index);
    }
  }

  // --- effects -------------------------------------------------------------------

  private barrelRoll(dir: 1 | -1) {
    if (this.crashedAt !== null || this.raceState === "countdown" || this.frozen || !this.view.ready) return;
    this.flight.dodge(dir);
  }

  /** A gate was passed: it flares (WorldView), and shards, stars and light burst out of it */
  gateBurst(index: number) {
    const ring = this.world.course.rings[index];
    this.view.passRing(index);
    this.rig.kick();
    this.flash = 1;
    const amount = this.particles.budget * RINGS.shatter;
    if (amount <= 0) return;
    const tint = ring.finish ? GOLD : color.set(this.world.palette.accent);
    const forward = ring.normal;
    const crystals = this.view.gates.crystalPositions(index, this.crystalPoints);
    for (const p of crystals) {
      const outward = tmp.subVectors(p, ring.position).normalize();
      for (let k = 0; k < Math.round(3 * amount); k++) {
        this.particles.emit(
          at.copy(p).addScaledVector(outward, rand(-0.6, 0.6)),
          vel
            .copy(outward)
            .multiplyScalar(rand(5, 15))
            .addScaledVector(forward, rand(2, 6) + this.flight.speed * 0.15)
            .add(tmp2.set(rand(-2, 2), rand(-2, 2), rand(-2, 2))),
          fx(rand(1, 1.9), rand(0.45, 0.95), k % 2 ? WHITE : tint, Kind.Shard, 4, 1.1, 2.8),
        );
      }
    }
    // Stars around the rim and a puff of light around the pilot
    for (let k = 0; k < Math.round(70 * amount); k++) {
      const p = crystals[k % crystals.length];
      at.lerpVectors(ring.position, p, rand(0.85, 1.05));
      tmp.subVectors(at, ring.position).normalize();
      this.particles.emit(at, vel.copy(tmp).multiplyScalar(rand(1, 5)).addScaledVector(forward, rand(-2, 4)), fx(rand(1.2, 2.2), rand(0.6, 1.2), tint, Kind.Star, -0.5, 1.5, 3));
    }
    for (let k = 0; k < Math.round(30 * amount); k++) {
      this.particles.emit(
        this.flight.position,
        vel.set(rand(-1, 1), rand(-1, 1), rand(-1, 1)).normalize().multiplyScalar(rand(4, 10)).addScaledVector(this.flight.velocity, 0.6),
        fx(rand(0.5, 0.9), rand(0.5, 1.1), WHITE, Kind.Glow, 0, 3, 2),
      );
    }
  }

  /** Stars and puffs off the impact, thrown away from the surface; each kind of crash adds its own */
  private crashBurst(kind: DeathKind, away: THREE.Vector3) {
    const amount = this.particles.budget;
    const p = this.flight.position;
    color.set(this.world.palette.accent);
    // Fewer and smaller than they'd be for a vanishing pilot: the body stays on screen
    for (let k = 0; k < Math.round(40 * amount); k++) {
      vel.set(rand(-1, 1), rand(-0.3, 1), rand(-1, 1)).normalize().addScaledVector(away, 0.8).normalize();
      this.particles.emit(
        p,
        vel.multiplyScalar(rand(8, 20)).addScaledVector(this.flight.velocity, -0.1),
        k % 3
          ? fx(rand(0.4, 0.8), rand(0.25, 0.5), WHITE, Kind.Star, 6, 2, 2)
          : fx(rand(0.6, 1), rand(1, 2), color, Kind.Wisp, -1, 2.5, 0.6),
      );
    }
    if (kind === "headfirst") {
      // Seeing stars: a little ring of gold twinkles around the head
      for (let k = 0; k < Math.round(14 * amount); k++) {
        const a = (k / 14) * Math.PI * 2;
        at.set(Math.cos(a) * 0.9, 0.8, Math.sin(a) * 0.9).add(p);
        this.particles.emit(at, vel.set(-Math.sin(a) * 2.5, 1.2, Math.cos(a) * 2.5).addScaledVector(away, 2), fx(1.2, 0.3, GOLD, Kind.Star, 1.5, 1, 2));
      }
    }
    if (kind !== "fall") {
      // A puff of dust (or spray) off the surface itself
      color.set(this.world.palette.cloud).lerp(WHITE, 0.4);
      surface.copy(p).addScaledVector(away, -0.5);
      for (let k = 0; k < Math.round(14 * amount); k++) {
        vel.set(rand(-1, 1), rand(-1, 1), rand(-1, 1)).addScaledVector(away, 0.6).normalize().multiplyScalar(rand(3, 8));
        this.softParticles.emit(surface, vel, fx(rand(0.7, 1.2), rand(0.7, 1.4), color, Kind.Glow, -0.3, 2.5, 0.45));
      }
    }
  }

  /** While the crash plays out: dust off a rolling body, light shed by a spinning one, and the final dissolve */
  private deathEffects(dt: number) {
    const d = this.death;
    const p = this.avatar.group.position;
    const amount = this.particles.budget;
    if (!this.dissolved) {
      this.deathDebt += (d.grounded ? 18 : d.kind === "wing" ? 30 : 8) * amount * dt;
      for (; this.deathDebt >= 1; this.deathDebt--) {
        if (d.grounded) {
          color.set(this.world.palette.cloud).lerp(WHITE, 0.4);
          at.copy(p).addScaledVector(d.normal, -0.4).add(tmp.set(rand(-0.5, 0.5), rand(-0.5, 0.5), rand(-0.5, 0.5)));
          this.softParticles.emit(at, vel.copy(d.normal).multiplyScalar(rand(1, 3)).addScaledVector(d.velocity, -0.2), fx(rand(0.6, 1.1), rand(0.5, 1.1), color, Kind.Glow, -0.2, 2, 0.45));
        } else {
          at.copy(p).add(tmp.set(rand(-0.8, 0.8), rand(-0.4, 0.4), rand(-0.8, 0.8)));
          this.particles.emit(at, vel.set(rand(-1, 1), rand(0, 1.5), rand(-1, 1)), fx(rand(0.6, 1.1), rand(0.2, 0.4), WHITE, Kind.Glow, -0.5, 1.5, 1.8));
        }
      }
    }
    // At the end the pilot dissolves into light, like a Sky child returning home
    if (!this.dissolved && d.time >= DISSOLVE_AT) {
      this.dissolved = true;
      color.set(this.world.palette.accent).lerp(WHITE, 0.5);
      for (let k = 0; k < Math.round(70 * amount); k++) {
        at.copy(p).add(tmp.set(rand(-0.6, 0.6), rand(-0.6, 0.6), rand(-0.6, 0.6)));
        vel.set(rand(-1, 1), rand(-0.2, 1), rand(-1, 1)).normalize().multiplyScalar(rand(1, 5));
        this.particles.emit(at, vel, k % 3 ? fx(rand(0.8, 1.6), rand(0.25, 0.5), color, Kind.Glow, -2, 1.5, 2.4) : fx(rand(0.9, 1.6), rand(0.4, 0.7), WHITE, Kind.Star, -1.5, 1.5, 2.6));
      }
    }
  }

  /** Spray off the rock while skimming it, and sparks when really close */
  private skimSpray(dt: number) {
    if (this.smoothProximity < 0.2 || FX.skimDust <= 0) return;
    const { x, y, z } = this.flight.position;
    const rock = this.world.rock;
    const gap = rock.distance(x, y, z);
    const water = this.world.waterNear(x, y, z, waterHit);
    if (water && water.distance < 9 && water.distance < gap) {
      this.waterSpray(dt, water.distance, water.level, water.kind);
      return;
    }
    if (gap > 9) return;
    // The rock's surface normal from the distance field's gradient; the nearest surface point is along it
    const e = 0.5;
    normal.set(
      rock.distance(x + e, y, z) - rock.distance(x - e, y, z),
      rock.distance(x, y + e, z) - rock.distance(x, y - e, z),
      rock.distance(x, y, z + e) - rock.distance(x, y, z - e),
    );
    if (normal.lengthSq() < 1e-8) return;
    normal.normalize();
    surface.copy(this.flight.position).addScaledVector(normal, -gap);
    this.dustDebt += this.smoothProximity * 110 * FX.skimDust * this.particles.budget * dt;
    const close = clamp((5 - gap) / 4, 0, 1);
    color.set(this.world.palette.cloud).lerp(WHITE, 0.4);
    for (; this.dustDebt >= 1; this.dustDebt--) {
      at.copy(surface)
        .add(tmp.set(rand(-2.5, 2.5), rand(-2.5, 2.5), rand(-2.5, 2.5)))
        .addScaledVector(normal, rand(0.2, 0.8));
      const spark = Math.random() < close * 0.35;
      this.particles.emit(
        at,
        vel
          .copy(this.flight.velocity)
          .multiplyScalar(spark ? 0.5 : 0.25)
          .addScaledVector(normal, rand(2, 7))
          .add(tmp.set(rand(-3, 3), rand(-3, 3), rand(-3, 3))),
        spark
          ? fx(rand(0.3, 0.6), rand(0.25, 0.45), GOLD, Kind.Star, 12, 1, 2.5)
          : fx(rand(0.6, 1.1), rand(1, 2.2), color, Kind.Wisp, 3, 2.2, 0.55),
      );
    }
  }

  /** Skimming water: a wake of droplets and mist (or sparks off lava) */
  private waterSpray(dt: number, gap: number, level: number, kind: WaterKind) {
    const close = clamp((7 - gap) / 6, 0, 1);
    this.dustDebt += (0.3 + close) * 140 * WATER.spray * this.particles.budget * dt;
    const lava = kind === "lava";
    for (; this.dustDebt >= 1; this.dustDebt--) {
      at.set(this.flight.position.x + rand(-1.5, 1.5), level + 0.2, this.flight.position.z + rand(-1.5, 1.5));
      const droplet = Math.random() < 0.6;
      vel.copy(this.flight.velocity).multiplyScalar(droplet ? 0.35 : 0.15).add(tmp.set(rand(-3, 3), rand(3, 9) * (0.4 + close), rand(-3, 3)));
      if (lava) {
        this.particles.emit(at, vel, fx(rand(0.5, 1), rand(0.25, 0.45), LAVA_SPARK, Kind.Star, 9, 0.8, 2.6));
      } else if (droplet) {
        this.particles.emit(at, vel, fx(rand(0.5, 1), rand(0.18, 0.35), SPRAY, Kind.Glow, 12, 0.6, 1.5));
      } else {
        this.softParticles.emit(at, vel, fx(rand(0.8, 1.4), rand(1.5, 3), WHITE, Kind.Glow, -0.5, 2, 0.85));
      }
    }
  }

  /** Crystals catch the light: brief star glints on the gates near you */
  private gateGlints(dt: number) {
    const rings = this.world.course.rings;
    const camera = this.rig.camera.position;
    this.glintDebt += 10 * this.particles.budget * dt;
    if (this.glintDebt < 1) return;
    // Start at a random gate, so nearby gates share the glints
    const first = Math.floor(Math.random() * rings.length);
    for (let n = 0; n < rings.length && this.glintDebt >= 1; n++) {
      const i = (first + n) % rings.length;
      const d = rings[i].position.distanceToSquared(camera);
      if (d > 350 * 350 || !this.view.gates.shown(i)) continue;
      const crystals = this.view.gates.crystalPositions(i, this.crystalPoints);
      const p = crystals[Math.floor(Math.random() * crystals.length)];
      if (!p) continue;
      this.glintDebt--;
      this.particles.emit(at.copy(p).add(tmp.set(rand(-0.8, 0.8), rand(-0.8, 0.8), rand(-0.8, 0.8))), vel.set(0, 0, 0), fx(rand(0.35, 0.6), rand(1.2, 2.2), WHITE, Kind.Star, 0, 0, 2.6));
    }
    this.glintDebt = Math.min(this.glintDebt, 2);
  }

  /** Glitter drifting around the next gate, so it sparkles from afar */
  private gateMotes(dt: number) {
    if (this.raceState !== "racing" && this.raceState !== "countdown") return;
    const ring = this.world.course.rings[this.checkpoints];
    if (!ring || ring.position.distanceToSquared(this.flight.position) > 600 * 600) return;
    this.moteDebt += 30 * this.particles.budget * dt;
    const n = ring.normal;
    if (Math.abs(n.y) < 0.95) basisA.crossVectors(n, THREE.Object3D.DEFAULT_UP).normalize();
    else basisA.set(1, 0, 0);
    basisB.crossVectors(n, basisA);
    const tint = ring.finish ? GOLD : color.set(this.world.palette.accent);
    for (; this.moteDebt >= 1; this.moteDebt--) {
      const angle = Math.random() * Math.PI * 2;
      const r = ring.radius * rand(0.9, 1.25);
      at.copy(ring.position)
        .addScaledVector(basisA, Math.cos(angle) * r)
        .addScaledVector(basisB, Math.sin(angle) * r);
      this.particles.emit(at, vel.copy(n).multiplyScalar(rand(-1.5, 1.5)), fx(rand(1.5, 2.6), rand(0.5, 1), tint, Kind.Star, -0.4, 0.8, 2.2));
    }
  }

  // --- frame loop ----------------------------------------------------------------

  private loop = (now: number) => {
    this.frame = requestAnimationFrame(this.loop);
    const dt = this.lastFrame ? Math.min(0.1, (now - this.lastFrame) / 1000) : 0;
    this.lastFrame = now;
    const t = this.clock();

    if (this.raceState === "countdown") {
      const left = Math.ceil((this.startAt - t) / 1000);
      if (!this.paused && left <= 3 && left > 0 && left < this.lastBeep) this.audio.beep(false);
      this.lastBeep = Math.min(this.lastBeep, left);
      if (t >= this.startAt) {
        this.raceState = "racing";
        this.recorder.reset();
        if (!this.paused) this.audio.beep(true);
        this.events.raceStarted?.();
      }
    }

    if (this.paused) {
      // Poll gamepad buttons so presses made while paused aren't queued for resume.
      this.input.sample(0);
      // Redraw the frozen scene so resizing the canvas still works.
      this.render();
      if (now - this.lastHud > HUD_INTERVAL) {
        this.lastHud = now;
        this.events.hud(this.hud(t));
      }
      return;
    }
    this.elapsed += dt;
    fxTime.value = this.elapsed;
    this.adaptQuality(dt);

    this.input0 = this.attract === "chase" ? this.autopilot() : this.input.sample(dt);
    // Outside races, the land around you must be on screen before you fly: no flying into
    // invisible rock. Until it is, the pilot glides in on rails, without control (glidein.ts)
    const loading = !this.view.ready && this.raceState === "free" && this.attract !== "drift";
    // Held still: a run's start line, the tunnel between biomes
    const waiting = this.frozen;
    if (waiting || loading || this.raceState === "countdown") this.flight.releaseControls();
    if (this.crashedAt !== null) {
      if (this.elapsed - this.crashedAt > RESPAWN_DELAY) this.respawnNow();
    } else if (loading && !waiting) {
      this.glideIn(dt);
    } else if (this.raceState !== "countdown" && !waiting && this.attract !== "drift") {
      if (this.glide.active) this.handOver();
      this.accumulator += dt;
      let steps = 0;
      while (this.accumulator >= STEP && steps < MAX_STEPS_PER_FRAME) {
        steps++;
        this.step(this.input0);
        this.accumulator -= STEP;
        if (this.crashedAt !== null) break;
      }
      // Drop only whole excess steps; preserve the fractional rendering phase.
      if (this.accumulator >= STEP) this.accumulator %= STEP;
    }
    if (this.attract === "chase" && this.flight.position.z > this.world.course.endZ + 100) this.respawn(0);

    // Draw between the last two physics states
    const alpha = clamp(this.accumulator / STEP, 0, 1);
    const body = this.avatar.group;
    body.position.lerpVectors(this.prevPosition, this.flight.position, alpha);
    body.quaternion.slerpQuaternions(this.prevQuaternion, this.flight.quaternion, alpha);
    this.renderVelocity.lerpVectors(this.prevVelocity, this.flight.velocity, alpha);
    this.smoothProximity += (this.proximity - this.smoothProximity) * (1 - Math.exp(-dt * 8));

    const crashed = this.crashedAt !== null;
    if (this.attract === "drift") {
      this.drift(dt);
    } else if (!crashed) {
      this.avatar.setDodge(this.flight.dodgePhase);
      this.avatar.setSpeedControls(this.flight.boost, this.flight.brake);
      this.avatar.update(dt, this.flight.speed, this.smoothProximity);
      this.equipment.update(dt);
      // Frozen on the start line or in the tunnel: no motes, or they pile up into a glowing ball
      const moving = this.raceState !== "countdown" && !waiting;
      this.fx.update(dt, this.flight.speed, this.flight.velocity, this.smoothProximity, moving);
      this.skimSpray(dt);
      this.rig.update(
        dt,
        body.position,
        tmp.set(0, 0, -1).applyQuaternion(body.quaternion),
        tmp2.set(0, 1, 0).applyQuaternion(body.quaternion),
        this.flight.speed,
        this.smoothProximity,
        this.clearance,
        this.renderVelocity,
        this.flight.boost,
      );
    } else {
      // The crash plays out: the tumble moves the body, the camera keeps it in view
      this.death.update(dt, this.field);
      body.position.copy(this.death.position);
      body.quaternion.copy(this.death.quaternion);
      this.avatar.update(dt, this.death.speed, 0);
      this.equipment.update(dt);
      this.deathEffects(dt);
      this.rig.follow(body.position, dt, this.clearance);
    }
    this.debris.update(dt);

    const camera = this.rig.camera;
    camera.updateMatrixWorld();
    this.view.update(camera, dt);
    this.run?.frame(dt);
    this.gateMotes(dt);
    this.gateGlints(dt);
    const flying = !crashed && this.raceState !== "countdown" && !waiting && this.attract !== "drift";
    this.speedLines.update(dt, body.position, flying ? this.flight.velocity : tmp.set(0, 0, 0), camera, this.particles.budget);
    this.ambient.update(dt, camera.position, flying ? this.flight.velocity : tmp.set(0, 0, 0), this.particles.budget);

    const liveTime = t - INTERPOLATION_DELAY_MS;
    this.live.forEach((pilot) => pilot.update(liveTime, dt, camera.position));
    const racing = this.raceState !== "free";
    this.ghosts.forEach((ghost) => ghost.update(racing ? t - this.startAt : -Infinity, dt, camera.position));
    this.particles.update();
    this.softParticles.update();

    this.audio.update(this.flight.speed, this.smoothProximity, flying, this.flight.boost, this.flight.brake);
    this.updateMarker();
    this.updateVignette(dt, flying);
    this.render();

    if (now - this.lastHud > HUD_INTERVAL) {
      this.lastHud = now;
      this.events.hud(this.hud(t));
    }
  };

  private hud(t: number): HudState {
    const { x, y, z } = this.avatar.group.position;
    const raceTimeMs =
      this.raceState === "racing"
        ? t - this.startAt
        : this.raceState === "finished"
          ? this.finishMs
          : null;
    return {
      seed: this.world.seed,
      run: this.run ? this.run.hud() : null,
      biomeName: this.world.biome.name,
      paletteName: this.world.palette.name,
      boostCharge: this.flight.boostCharge,
      boosting: this.flight.boost > 0.05,
      braking: this.flight.brake > 0.05,
      speedKmh: Math.round(this.flight.speed * 3.6),
      clearance: Math.max(0, Math.round(this.world.distance(x, y, z))),
      loading: !this.view.ready,
      raceState: this.raceState,
      raceTimeMs,
      countdown: this.raceState === "countdown" ? Math.max(0, Math.ceil((this.startAt - t) / 1000)) : null,
      checkpoints: this.checkpoints,
      totalCheckpoints: this.world.course.rings.length,
      proximity: this.smoothProximity,
      style: Math.round(this.style),
      multiplier: this.multiplier,
      crashed: this.crashedAt !== null,
      paused: this.paused,
      locked: this.input.locked,
      muted: this.audio.isMuted,
      standings: this.standings(),
    };
  }

  private standings(): Standing[] {
    if (!this.participants.length || this.raceState === "free") return [];
    const rings = this.world.course.rings;
    const progress = (checkpoints: number, position: THREE.Vector3 | undefined) => {
      if (!position) return -Infinity;
      const ring = rings[Math.min(checkpoints, rings.length - 1)];
      return checkpoints * 1e6 - position.distanceTo(ring.position);
    };
    return this.participants
      .map((p) => {
        const me = p.id === this.selfId;
        const pilot = this.live.get(p.id);
        const checkpoints = me ? this.checkpoints : (pilot?.checkpoints ?? 0);
        const finishMs = me ? (this.finishMs ?? p.finishMs) : p.finishMs;
        const score =
          finishMs !== null
            ? 1e12 - finishMs
            : progress(checkpoints, me ? this.flight.position : pilot?.visible ? pilot.position : undefined);
        return { standing: { ...p, me, checkpoints, finishMs }, score };
      })
      .sort((a, b) => b.score - a.score)
      .map(({ standing }) => standing);
  }

  /** A marker on screen (or at its edge) pointing at the next ring */
  private updateMarker() {
    const racing = this.raceState === "countdown" || this.raceState === "racing";
    const ring = racing && this.crashedAt === null ? this.world.course.rings[this.checkpoints] : undefined;
    if (!ring) {
      this.marker.style.display = "none";
      return;
    }
    const camera = this.rig.camera;
    const behind = tmp.subVectors(ring.position, camera.position).dot(camera.getWorldDirection(tmp2)) < 0;
    projected.copy(ring.position).project(camera);
    let px = projected.x;
    let py = projected.y;
    if (behind) {
      px = -px;
      py = -py;
    }
    const onScreen = !behind && Math.abs(px) < 0.92 && Math.abs(py) < 0.88;
    if (!onScreen) {
      const m = Math.max(Math.abs(px) / 0.92, Math.abs(py) / 0.88, 1e-6);
      px /= m;
      py /= m;
    }
    const width = this.container.clientWidth;
    const height = this.container.clientHeight;
    this.marker.style.display = "block";
    this.marker.style.transform = `translate(${((px + 1) / 2) * width}px, ${((1 - py) / 2) * height}px)`;
    this.marker.classList.toggle("offscreen", !onScreen);
    this.marker.classList.toggle("finish", ring.finish);
    const text = `${Math.round(this.flight.position.distanceTo(ring.position))} m`;
    if (this.marker.textContent !== text) this.marker.textContent = text;
  }

  private updateVignette(dt: number, flying: boolean) {
    this.flash *= Math.exp(-dt * 3);
    const rush = flying ? clamp((this.flight.speed - 55) / 50, 0, 1) * 0.55 + this.smoothProximity * 0.25 : 0;
    const opacity = clamp((rush + this.flash * 0.6) * FX.vignette, 0, 1);
    const text = opacity.toFixed(2);
    if (this.vignette.style.opacity !== text) this.vignette.style.opacity = text;
  }

  // --- rendering -------------------------------------------------------------------

  private get bloomOn(): boolean {
    return this.quality === 2 && FX.bloom > 0;
  }

  private render() {
    const camera = this.rig.camera;
    // Particle sizes are in metres: keep the conversion in step with the zooming FOV
    this.particles.setViewport(this.renderer.domElement.height, camera.fov);
    this.softParticles.setViewport(this.renderer.domElement.height, camera.fov);
    if (this.bloomOn && !this.composer) void this.createComposer();
    if (this.bloomOn && this.composer && this.bloomPass) {
      this.bloomPass.strength = FX.bloom * (1 + this.world.palette.night * 0.6);
      this.bloomPass.radius = FX.bloomRadius;
      this.bloomPass.threshold = FX.bloomThreshold;
      this.composer.render();
    } else {
      this.renderer.render(this.scene, camera);
    }
  }

  /** Bloom post-processing: loaded on first use, so the low-quality path never downloads it */
  private async createComposer() {
    if (this.composerLoading) return;
    this.composerLoading = true;
    let modules;
    try {
      modules = await Promise.all([
        import("three/examples/jsm/postprocessing/EffectComposer.js"),
        import("three/examples/jsm/postprocessing/RenderPass.js"),
        import("three/examples/jsm/postprocessing/UnrealBloomPass.js"),
        import("three/examples/jsm/postprocessing/OutputPass.js"),
      ]);
    } catch (error) {
      // Leaves composerLoading set, so this frame loop doesn't retry every frame
      reloadForNewBuild(error);
      return;
    }
    const [{ EffectComposer }, { RenderPass }, { UnrealBloomPass }, { OutputPass }] = modules;
    this.composerLoading = false;
    if (!this.bloomOn || this.composer) return;
    const size = this.renderer.getDrawingBufferSize(new THREE.Vector2());
    // Half floats keep colors above 1, so only really bright things bloom; 4× MSAA keeps edges clean
    // Half floats keep colors above 1 for the bloom; FX.bloomMsaa sets the antialiasing samples
    const target = new THREE.WebGLRenderTarget(size.x, size.y, { type: THREE.HalfFloatType, samples: FX.bloomMsaa });
    const composer = new EffectComposer(this.renderer, target);
    composer.setPixelRatio(Math.min(this.renderer.getPixelRatio(), FX.bloomResolution));
    composer.setSize(this.container.clientWidth || 1, this.container.clientHeight || 1);
    composer.addPass(new RenderPass(this.scene, this.rig.camera));
    this.bloomPass = new UnrealBloomPass(new THREE.Vector2(size.x, size.y), FX.bloom, FX.bloomRadius, FX.bloomThreshold);
    composer.addPass(this.bloomPass);
    composer.addPass(new OutputPass());
    this.composer = composer;
  }

  /** Drops the bloom composer so it is rebuilt with the current FX settings */
  rebuildBloom() {
    this.composer?.dispose();
    this.bloomPass?.dispose();
    this.composer = null;
    this.bloomPass = null;
  }

  private setQuality(quality: Quality) {
    this.quality = quality;
    if (!this.bloomOn && this.composer) {
      this.composer.dispose();
      this.bloomPass?.dispose();
      this.composer = null;
      this.bloomPass = null;
    }
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, QUALITY[quality].pixelRatio));
    this.particles.budget = QUALITY[quality].particles;
    this.resize();
  }

  /** Steps the quality down if frames keep taking too long (never back up, so it can't flicker) */
  private adaptQuality(dt: number) {
    this.measured += dt;
    if (!FX.autoQuality || this.quality === 0 || this.measured < 5 || dt >= 0.1) return;
    this.slowFrames = dt > 1 / 40 ? this.slowFrames + dt : Math.max(0, this.slowFrames - dt * 0.5);
    if (this.slowFrames > 2.5) {
      this.slowFrames = 0;
      this.measured = 0;
      this.setQuality((this.quality - 1) as Quality);
      if (import.meta.env.DEV) console.info(`[wingrace] frame rate low, quality now ${this.quality}`);
    }
  }

  private resize() {
    const width = this.container.clientWidth || 1;
    const height = this.container.clientHeight || 1;
    this.renderer.setSize(width, height, false);
    this.composer?.setPixelRatio(Math.min(this.renderer.getPixelRatio(), FX.bloomResolution));
    this.composer?.setSize(width, height);
    this.rig.resize(width / height);
    this.particles.setViewport(height * this.renderer.getPixelRatio(), this.rig.camera.fov);
    this.softParticles.setViewport(height * this.renderer.getPixelRatio(), this.rig.camera.fov);
  }

  private async openTuning() {
    const { default: GUI } = await import("lil-gui").catch((error: unknown) => {
      reloadForNewBuild(error);
      throw error;
    });
    const gui = new GUI({ title: "Tuning (?tune)", width: 300 });
    const save = () => saveTuning();

    const view = gui.addFolder("Quality");
    const settings = { quality: this.quality };
    view
      .add(settings, "quality", { High: 2, Medium: 1, Low: 0 })
      .name("quality")
      .onChange((q: Quality) => this.setQuality(q))
      .listen();
    view.add(FX, "autoQuality").name("auto quality").onChange(save);
    const syncQuality = setInterval(() => (settings.quality = this.quality), 500);

    // Physics isn't saved: a forgotten tweak shouldn't follow you into races
    const flight = gui.addFolder("Flight physics (not saved)");
    for (const key of Object.keys(FLIGHT) as (keyof typeof FLIGHT)[]) flight.add(FLIGHT, key);
    flight.close();

    for (const [title, group] of TUNING_GROUPS) {
      const folder = gui.addFolder(title);
      for (const key of Object.keys(group)) {
        if (key === "autoQuality") continue;
        const range = RANGES[key];
        const controller =
          typeof group[key] === "boolean" || !range
            ? folder.add(group, key)
            : folder.add(group, key, range[0], range[1], range[2] ?? (range[1] - range[0]) / 200);
        controller.onChange(() => {
          save();
          // The bloom's render targets are built with these: rebuild them
          if (key === "bloomResolution" || key === "bloomMsaa") this.rebuildBloom();
        });
      }
      folder.close();
    }

    const actions = {
      barrelLeft: () => this.barrelRoll(-1),
      barrelRight: () => this.barrelRoll(1),
      copy: () => void navigator.clipboard?.writeText(JSON.stringify({ FLIGHT, ...Object.fromEntries(TUNING_GROUPS) }, null, 2)),
      reset: () => {
        resetTuning();
        gui.controllersRecursive().forEach((c) => c.updateDisplay());
      },
    };
    gui.add(actions, "barrelLeft").name("Barrel roll left (Q)");
    gui.add(actions, "barrelRight").name("Barrel roll right (E)");
    gui.add(actions, "copy").name("Copy settings as JSON");
    gui.add(actions, "reset").name("Reset looks to defaults");
    this.gui = {
      destroy: () => {
        clearInterval(syncQuality);
        gui.destroy();
      },
    };
  }
}
