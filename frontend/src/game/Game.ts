import * as THREE from "three";
import { GameAudio } from "./audio";
import { CameraRig } from "./camera";
import { Debris } from "./effects";
import { FLIGHT, Flight, type FlightInput } from "./flight";
import { type GhostData, GhostRecorder, type GhostRun, ghostSamples } from "./ghost";
import { type ControlSettings, Input } from "./input";
import { INTERPOLATION_DELAY_MS, Pilot, type PilotSample } from "./pilots";
import { Trail } from "./trail";
import { WINGTIPS, createWingsuit } from "./wingsuit";
import { clamp } from "./math";
import { World } from "./world/World";
import { WorldView } from "./world/WorldView";

const STEP = 1 / 120; // physics runs at a fixed rate, rendering interpolates
const MAX_STEPS_PER_FRAME = 12;
const CRASH_DISTANCE = 0.7; // metres from a surface
const SCORE_RANGE = 10; // proximity counts within this many metres
const RESPAWN_DELAY = 1.4; // seconds
const START_SPEED = 32; // m/s
const HUD_INTERVAL = 100; // ms
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
  paletteName: string;
  speedKmh: number;
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
  seed: number;
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
}

const tmp = new THREE.Vector3();
const tmp2 = new THREE.Vector3();
const projected = new THREE.Vector3();

export class Game {
  private readonly container: HTMLElement;
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly rig: CameraRig;
  private readonly input: Input;
  private readonly audio = new GameAudio();
  private readonly flight = new Flight();
  private readonly prevPosition = new THREE.Vector3();
  private readonly prevQuaternion = new THREE.Quaternion();
  private readonly body: THREE.Mesh;
  private readonly trails: Trail[];
  private readonly debris: Debris;
  private readonly marker: HTMLDivElement;
  private readonly recorder = new GhostRecorder();
  private readonly live = new Map<string, Pilot>();
  private ghosts: Pilot[] = [];
  private readonly clock: () => number;
  private readonly events: GameEvents;
  private readonly attract: AttractMode | null;
  private driftZ = 0;
  private world!: World;
  private view!: WorldView;
  private selfId = "";
  private startSlot: number | null = null; // place on the start grid, null = alone
  private participants: Participant[] = [];

  private raceState: RaceState = "free";
  private startAt = 0;
  private checkpoints = 0;
  private finishMs: number | null = null;
  private crashedAt: number | null = null;
  private readonly crashPoint = new THREE.Vector3();
  private proximity = 0;
  private smoothProximity = 0;
  private style = 0;
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
    this.attract = options.attract ?? null;

    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance" });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.domElement.className = "game-canvas";
    container.appendChild(this.renderer.domElement);

    this.rig = new CameraRig(1);
    this.input = new Input(this.renderer.domElement, options.controls);
    this.input.onAction = (action) => {
      if (action === "respawn") this.respawnNow();
      if (action === "mute") this.audio.toggleMute();
    };
    if (!this.attract) {
      this.renderer.domElement.addEventListener("click", this.engage);
      // Audio may only start after a user gesture: take the first one, mouse or keyboard
      window.addEventListener("keydown", this.startAudio, { once: true });
      window.addEventListener("pointerdown", this.startAudio, { once: true });
    }

    this.body = createWingsuit(options.color);
    this.trails = WINGTIPS.map(() => new Trail("#ffffff", 0.12));
    this.debris = new Debris(options.color);
    this.scene.add(this.body, this.debris.mesh, ...this.trails.map((t) => t.mesh));

    this.marker = document.createElement("div");
    this.marker.className = "ring-marker";
    container.appendChild(this.marker);

    this.setSeed(options.seed);

    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(container);
    this.resize();
    this.frame = requestAnimationFrame(this.loop);

    if (new URLSearchParams(location.search).has("tune")) void this.openTuning();
    // Lets browser tests drive the game in development
    if (import.meta.env.DEV) Object.assign(window, { __game: this });
  }

  // --- public API --------------------------------------------------------------

  /** Call from a click: locks the mouse and starts audio (browsers need a gesture for both) */
  engage = () => {
    this.input.lockPointer();
    this.audio.start();
  };

  private startAudio = () => this.audio.start();

  /** Keeps the camera out of the rock */
  private clearance = (x: number, y: number, z: number) => this.world.rock.distance(x, y, z);

  get seed(): number {
    return this.world.seed;
  }

  /** Builds the world for a seed and puts you at the start, flying freely */
  setSeed(seed: number) {
    if (this.world?.seed === seed) return;
    if (this.view) {
      this.scene.remove(this.view.group);
      this.view.dispose();
    }
    this.world = new World(seed);
    this.view = new WorldView(this.world, this.scene);
    this.scene.add(this.view.group);
    this.setGhosts([]);
    this.style = 0;
    this.freeFlight(true);
  }

  setSelf(id: string, color: string) {
    this.selfId = id;
    (this.body.material as THREE.MeshLambertMaterial).color.set(color);
    this.debris.setColor(color);
  }

  setControls(controls: ControlSettings) {
    this.input.settings = controls;
  }

  /** No race: fly around, rings are just scenery */
  freeFlight(respawn: boolean) {
    this.startSlot = null;
    this.raceState = "free";
    this.checkpoints = 0;
    this.finishMs = null;
    this.view.setRings("free", 0);
    if (respawn) this.respawn(0);
  }

  /** Puts you on the start line (or grid slot 0, 1, … in a room), frozen until the clock reaches startAt */
  startCountdown(startAt: number, slot: number | null = null) {
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
        const pilot = new Pilot(player.id, player.name, player.color, false);
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
      const pilot = new Pilot(`ghost${i}`, run.name, "#ffffff", true);
      pilot.setSamples(ghostSamples(run.ghost));
      this.scene.add(pilot.group, ...pilot.trailMeshes);
      return pilot;
    });
  }

  netState(): NetState {
    const { position: p, quaternion: q, speed } = this.flight;
    return { p: [p.x, p.y, p.z], q: [q.x, q.y, q.z, q.w], v: speed, cp: this.checkpoints };
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
    this.view.dispose();
    this.live.forEach((p) => this.removePilot(p));
    this.ghosts.forEach((p) => this.removePilot(p));
    this.trails.forEach((t) => t.dispose());
    this.debris.dispose();
    (this.body.material as THREE.Material).dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
    this.marker.remove();
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
    this.flight.reset(position, direction, START_SPEED);
    this.prevPosition.copy(this.flight.position);
    this.prevQuaternion.copy(this.flight.quaternion);
    this.accumulator = 0;
    this.crashedAt = null;
    this.proximity = 0;
    this.combo = 0;
    this.body.visible = true;
    this.trails.forEach((t) => t.reset());
    this.rig.snap(this.flight.position, this.flight.forward, this.flight.up, this.flight.speed);
  }

  private respawnNow() {
    if (this.raceState === "countdown") return;
    this.respawn(this.raceState === "free" ? 0 : this.checkpoints);
  }

  private crash() {
    this.crashedAt = this.elapsed;
    this.crashPoint.copy(this.flight.position);
    this.body.visible = false;
    this.trails.forEach((t) => (t.opacity = 0));
    this.debris.burst(this.flight.position, this.flight.velocity);
    this.audio.crash();
    this.combo = 0;
  }

  private step(input: FlightInput) {
    this.prevPosition.copy(this.flight.position);
    this.prevQuaternion.copy(this.flight.quaternion);
    this.flight.step(STEP, input, this.proximity * this.proximity);

    const { x, y, z } = this.flight.position;
    const distance = this.world.distance(x, y, z);
    if (distance < CRASH_DISTANCE || this.world.lost(y, z)) {
      this.crash();
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
      this.recorder.record(this.clock() - this.startAt, this.flight.position, this.flight.quaternion);
      this.checkRing();
    }
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
    this.body.visible = false;
  }

  private get multiplier(): number {
    return 1 + Math.min(4, Math.floor(this.combo / 1.5));
  }

  /** Did the last step pass through the next ring? */
  private checkRing() {
    const ring = this.world.course.rings[this.checkpoints];
    if (!ring) return;
    const before = tmp.subVectors(this.prevPosition, ring.position).dot(ring.normal);
    const after = tmp.subVectors(this.flight.position, ring.position).dot(ring.normal);
    if (before >= 0 || after < 0) return;
    const hit = tmp.lerpVectors(this.prevPosition, this.flight.position, before / (before - after));
    if (hit.distanceTo(ring.position) > ring.radius + 1) return;

    this.checkpoints++;
    if (ring.finish) {
      const timeMs = Math.round(this.clock() - this.startAt);
      this.raceState = "finished";
      this.finishMs = timeMs;
      this.view.setRings("hidden", 0);
      this.audio.finish();
      const ghost = this.recorder.finish(timeMs, this.flight.position, this.flight.quaternion);
      this.events.finished?.({ timeMs, ghost });
    } else {
      this.audio.ring();
      this.view.setRings("race", this.checkpoints);
    }
  }

  // --- frame loop ----------------------------------------------------------------

  private loop = (now: number) => {
    this.frame = requestAnimationFrame(this.loop);
    const dt = this.lastFrame ? Math.min(0.1, (now - this.lastFrame) / 1000) : 0;
    this.lastFrame = now;
    this.elapsed += dt;
    const t = this.clock();

    if (this.raceState === "countdown") {
      const left = Math.ceil((this.startAt - t) / 1000);
      if (left <= 3 && left > 0 && left < this.lastBeep) this.audio.beep(false);
      this.lastBeep = Math.min(this.lastBeep, left);
      if (t >= this.startAt) {
        this.raceState = "racing";
        this.recorder.reset();
        this.audio.beep(true);
        this.events.raceStarted?.();
      }
    }

    this.input0 = this.attract === "chase" ? this.autopilot() : this.input.sample(dt);
    // Before a race, wait for the islands around you to show up: no flying into invisible rock
    const waiting = !this.view.ready && this.raceState === "free";
    if (this.crashedAt !== null) {
      if (this.elapsed - this.crashedAt > RESPAWN_DELAY) this.respawnNow();
    } else if (this.raceState !== "countdown" && !waiting && this.attract !== "drift") {
      this.accumulator += dt;
      let steps = 0;
      while (this.accumulator >= STEP && steps++ < MAX_STEPS_PER_FRAME) {
        this.step(this.input0);
        this.accumulator -= STEP;
        if (this.crashedAt !== null) break;
      }
      if (steps >= MAX_STEPS_PER_FRAME) this.accumulator = 0;
    }
    if (this.attract === "chase" && this.flight.position.z > this.world.course.endZ + 100) this.respawn(0);

    // Draw between the last two physics states
    const alpha = clamp(this.accumulator / STEP, 0, 1);
    this.body.position.lerpVectors(this.prevPosition, this.flight.position, alpha);
    this.body.quaternion.slerpQuaternions(this.prevQuaternion, this.flight.quaternion, alpha);
    this.smoothProximity += (this.proximity - this.smoothProximity) * (1 - Math.exp(-dt * 8));

    const crashed = this.crashedAt !== null;
    if (this.attract === "drift") {
      this.drift(dt);
    } else if (!crashed) {
      tmp2.set(0, 1, 0).applyQuaternion(this.body.quaternion);
      this.trails.forEach((trail, i) => {
        trail.push(tmp.copy(WINGTIPS[i]).applyQuaternion(this.body.quaternion).add(this.body.position), tmp2);
        trail.opacity = clamp((this.flight.speed - 40) / 40 + this.smoothProximity, 0, 0.7);
      });
      this.rig.update(
        dt,
        this.body.position,
        this.flight.forward,
        this.flight.up,
        this.flight.speed,
        this.smoothProximity,
        this.clearance,
      );
    } else {
      this.rig.watch(this.crashPoint, dt);
    }
    this.debris.update(dt);

    const camera = this.rig.camera;
    this.view.update(camera, this.elapsed);

    const liveTime = t - INTERPOLATION_DELAY_MS;
    this.live.forEach((pilot) => pilot.update(liveTime));
    const racing = this.raceState !== "free";
    this.ghosts.forEach((ghost) => ghost.update(racing ? t - this.startAt : -Infinity));

    this.audio.update(this.flight.speed, this.smoothProximity, !crashed && this.raceState !== "countdown");
    this.updateMarker();
    this.renderer.render(this.scene, camera);

    if (now - this.lastHud > HUD_INTERVAL) {
      this.lastHud = now;
      this.events.hud(this.hud(t));
    }
  };

  private hud(t: number): HudState {
    const { x, y, z } = this.body.position;
    const raceTimeMs =
      this.raceState === "racing"
        ? t - this.startAt
        : this.raceState === "finished"
          ? this.finishMs
          : null;
    return {
      seed: this.world.seed,
      paletteName: this.world.palette.name,
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

  private resize() {
    const width = this.container.clientWidth || 1;
    const height = this.container.clientHeight || 1;
    this.renderer.setSize(width, height, false);
    this.rig.resize(width / height);
  }

  private async openTuning() {
    const { default: GUI } = await import("lil-gui");
    const gui = new GUI({ title: "Flight tuning (?tune)" });
    for (const key of Object.keys(FLIGHT) as (keyof typeof FLIGHT)[]) gui.add(FLIGHT, key);
    this.gui = gui;
  }
}
