import { TestPlayback } from "./testPlayback";
import { bindingLabel } from "./bindings";
import * as THREE from "three";
import type { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import type { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";
import { AbilityFx } from "./abilities/fx";
import { AbilityFx2 } from "./abilities/fx2";
import { Ambient } from "./ambient";
import { Autopilot } from "./autopilot";
import { GameAudio } from "./audio";
import { Avatar } from "./avatar";
import { APPEARANCE_EVENT, validateAppearance, type Appearance } from "./cosmetics/storage";
import { profileClient } from "../profile/client";
import { Companion } from "./pets/companion";
import { CameraRig } from "./camera";
import { DISSOLVE_AT, type DeathKind, DeathFall, classifyCrash, fieldNormal } from "./death";
import { Debris } from "./effects";
import { TouchControls } from "./touch";
import { FLIGHT, Flight, type FlightInput, type HitPart, hitboxWorld, touching } from "./flight";
import { GlideIn } from "./glidein";
import { Equipment } from "./items/equip";
import { ItemFx } from "./items/fx";
import type { ItemId, ItemSlot } from "./items/models";
import { type GhostData, GhostRecorder, type GhostRun, ghostSamples } from "./ghost";
import { type ControlSettings, type InputObserver, type TestAction, Input, controlsBlocked } from "./input";
import { FX_LIGHT, Kind, Particles, fx, fxTime, sceneryTime } from "./particles";
import { PilotFx } from "./pilotfx";
import { INTERPOLATION_DELAY_MS, Pilot, type PilotSample } from "./pilots";
import { clamp } from "./math";
import { SpeedLines } from "./speedlines";
import { TOON_LIGHT } from "./toon";
import { FX, RANGES, RINGS, TUNING_GROUPS, WATER, loadTuning, resetTuning, saveTuning } from "./tuning";
import { ABILITY } from "./run/abilities";
import { PICKUP, PICKUP_PREFS } from "./run/pickups";
import { ITEM, RUN_ITEMS, type RunItemId } from "./run/items";
import { ORB } from "./run/orbs";
import { portalFlash } from "./run/portal";
import { RunController, type RunEvents, type RunHost, type RunOptions } from "./run/controller";
import type { Equipped } from "./collection/abilities";
import { CollectionFx } from "./collection/fx";
import { type Rarity, rarityIndex } from "./collection/rarity";
import type { UpgradeId } from "./run/upgrades";
import type { RunHud } from "./run/run";
import { type Level, levelId, seedLevel } from "./world/biomes";
import type { WaterKind } from "./world/terrain/river";
import { type WaterHit, World } from "./world/World";
import { WorldView } from "./world/WorldView";
import type { Palette } from "./world/palette";
import { reloadForNewBuild } from "../staleBuild";
import { onHold } from "./hold";

const STEP = 1 / 120; // physics runs at a fixed rate, rendering interpolates
const MAX_STEPS_PER_FRAME = 12;
const SCORE_RANGE = 10; // proximity counts within this many metres
const RESPAWN_DELAY = 1.4; // seconds
/**
 * Zen: after a crash you come back where the tumble rolled to, a little further on its way: these
 * steps on (m) and these heights above it (m) are tried in turn for a spot with room to fly
 */
const ZEN_AHEAD = [18, 10, 28, 0];
const ZEN_ABOVE = [12, 20, 30, 44];
const ZEN_ROOM = 9; // metres clear of rock, trees and water all round the spot…
const ZEN_RUNWAY = 30; // …and nothing this close ahead in the way you set off
const START_SPEED = 32; // m/s
/** The autopilot starts the course again this far past the finish (the line runs on, down towards a sea) */
const AUTOPILOT_LOOP = 40;
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
const ATTRACT_KEEP = 2; // maps the menu's backdrop keeps built besides its own and the one on screen
const MARKER_EDGE = 8; // px the ring marker keeps from the screen edge

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
  /** Zen: the level goes on for ever, and a crash puts you back nearby */
  /** Zen's open world: a crash brings you back nearby */
  openWorld: boolean;
  palette: Palette; // the level's lighting mood: the UI takes its colors from it
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
  testSpeed?(rate: number): void;
  raceStarted?(): void;
  finished?(result: FinishResult): void;
  /** The player steered during a run's opening autopilot: hand over (RunSession.begin) */
  takeOver?(): void;
}

export interface GameOptions {
  /** A race or time trial on the map this seed stands for, unless `level` is given */
  seed: number;
  level?: Level;
  /** Milliseconds; the server clock in rooms, so everyone starts together */
  clock: () => number;
  controls: ControlSettings;
  color: string;
  events: GameEvents;
  /** Set for a menu backdrop: no player input, no audio, flies itself */
  attract?: AttractMode;
  /** Local sandbox shortcuts and playback controls, enabled only by ?test. */
  testMode?: boolean;
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
const hitLocal = new THREE.Vector3();
const hitPoint = new THREE.Vector3();
const ORIGIN = new THREE.Vector3();
// The hitbox in world space, now and one step ago (for sweeps), and where the land was hit
const ball = new THREE.Vector3();
const ballBefore = new THREE.Vector3();
const wings = Array.from({ length: 8 }, () => new THREE.Vector3());
const wingsBefore = Array.from({ length: 8 }, () => new THREE.Vector3());
const rightWing = wings.slice(0, 4);
const leftWing = wings.slice(4, 8);
const landHit = { point: new THREE.Vector3(), normal: new THREE.Vector3() };
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
  private readonly companion: Companion;
  private testLook: Appearance | null = null;
  /** Test mode's charm, tried from the fitting room (undefined: the profile's own) */
  private testCharm: string | undefined = undefined;
  /** What the pilot wears and carries: the profile's, or the test fitting room's */
  private equipped(): Equipped {
    const own = profileClient.equipped();
    return { ...(this.testLook ?? own), charm: this.testCharm ?? own.charm ?? "none" };
  }
  private readonly appearanceChanged = () => {
    const appearance = this.testLook ?? profileClient.appearance();
    this.avatar.setAppearance(appearance);
    this.companion.set(appearance.pet);
    const equipped = this.equipped();
    this.collectionFx.setEquipped(equipped);
    this.run?.setEquipped(equipped);
  };
  private readonly fx: PilotFx;
  /** What the pilot carries (models and animations only, for now) */
  private readonly equipment: Equipment;
  /** What the run's abilities look like (game/abilities/) */
  private readonly abilityFx: AbilityFx;
  /** …and of the design list's abilities 11 to 20 */
  private readonly abilityFx2: AbilityFx2;
  /** What the design list's items look like when used (items/fx.ts) */
  private readonly itemFx: ItemFx;
  /** The collection in flight: rare cosmetics' light, the powers' flares, the companion's calls */
  private readonly collectionFx: CollectionFx;
  /** Test mode's Shift+I hands out the items in turn */
  private nextTestItem = 0;
  readonly particles: Particles;
  /** Particles that blend instead of glowing: snow, leaves, ash, mist */
  private readonly softParticles: Particles;
  private readonly ambient: Ambient;
  private readonly speedLines: SpeedLines;
  private readonly debris: Debris;
  private readonly marker: HTMLDivElement;
  private markerBox: { left: number; top: number; width: number; height: number } | null = null;
  private readonly vignette: HTMLDivElement;
  /** Blur and sparkles over the screen while passing through a portal */
  private readonly portalVeil: HTMLDivElement;
  private veilAmount = 0;
  private veilFlash = -1;
  /** White light over everything (the end of a run's finale) */
  private readonly whiteLight: HTMLDivElement;
  private white = 0;
  /** After a run: the pilot flies the default map by itself and the player controls nothing */
  private autopiloting = false;
  /** A run's opening: the pilot glides the racing line until the player steers; no gates, nothing scored */
  private introAutopilot = false;
  /** Flies the racing line on rails while nobody plays (the chase backdrop, the victory lap) */
  private readonly rails = new Autopilot();
  /** When the white light after the finale began to clear (null: not clearing) */
  private clearWhiteFrom: number | null = null;
  /** Inside a portal's wormhole: the level is hidden */
  private inWormhole = false;
  private readonly crystalPoints: THREE.Vector3[] = [];
  private composer: EffectComposer | null = null;
  private bloomPass: UnrealBloomPass | null = null;
  private composerLoading = false;
  private bloomFailed = false;
  /** Stands in for the bloom's target while shaders are compiled (see compileShaders) */
  private readonly compileTarget = new THREE.WebGLRenderTarget(1, 1);
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
  /**
   * The menu's backdrop keeps maps it showed, parked (the map select goes back and forth, then back to
   * the landing's own course, `home`, which is never let go); oldest first. Games keep none.
   */
  private readonly kept = new Map<string, { world: World; view: WorldView }>();
  private home: string | null = null;
  /** The roguelike run, when this game is one (never in races) */
  private run: RunController | null = null;
  private frozen = false;
  private paused = false;
  private pausedByHold = false; // paused because an overlay holds the game (hold.ts), not by the player
  private unhold: (() => void) | null = null;
  private selfId = "";
  private startSlot: number | null = null; // place on the start grid, null = alone
  private participants: Participant[] = [];

  private raceState: RaceState = "free";
  private startAt = 0;
  private checkpoints = 0;
  private finishMs: number | null = null;
  private crashedAt: number | null = null;
  /** Where a crash happened and which way you were flying (Zen comes back along the tumble) */
  private readonly crashFrom = new THREE.Vector3();
  private readonly crashHeading = new THREE.Vector3();
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
  /** Did the last hit test touch the land as drawn (`landHit`), rather than a distance field (`hitLocal`)? */
  private hitLand = false;
  /** Acrobatic Recovery's roll away from the rock */
  private readonly recoverRoll = { ...FLIGHT };
  private accumulator = 0;
  private lastFrame = 0;
  private elapsed = 0;
  private sceneryClock = 0;
  private readonly testPlayback?: TestPlayback;
  private lastHud = 0;
  private frame = 0;
  private readonly resizeObserver: ResizeObserver;
  private gui: { destroy(): void } | null = null;
  /** The on-screen stick and buttons of phones and tablets */
  private touch: TouchControls | null = null;

  constructor(container: HTMLElement, options: GameOptions) {
    this.container = container;
    this.clock = options.clock;
    this.events = options.events;
    loadTuning();
    this.attract = options.attract ?? null;

    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance" });
    // Checking every program's link log stalls the frame its shader is first used in
    this.renderer.debug.checkShaderErrors = import.meta.env.DEV;
    this.renderer.setPixelRatio(this.pixelRatio());
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
      if (action === "mute") this.audio.toggleMute();
      // Any move during the opening autopilot takes the controls (and the move happens)
      if (this.introAutopilot && action !== "mute" && action !== "respawn") this.takeOver();
      // On autopilot after a run, nothing else answers
      if (this.autopiloting) return;
      if (action === "respawn") this.respawnNow();
      if (action === "barrelLeft" || action === "barrelRight") this.barrelRoll(action === "barrelLeft" ? -1 : 1);
      if ((action === "flap" || action === "hover" || action === "plunge" || action === "burst" || action === "resonance" || action === "ascend" || action === "stance") && this.crashedAt === null && !this.glide.active) this.run?.ability(action);
      if (action === "useItem" && this.crashedAt === null && !this.glide.active) this.run?.useItem();
      if (action === "nextItem") this.run?.nextItem();
      if (action === "charm" && this.crashedAt === null && !this.glide.active) this.run?.useCharm();
    };
    if (options.testMode) {
      this.testPlayback = new TestPlayback(container.parentElement ?? container);
      this.input.onTestAction = (action) => {
        if (action === "speed") {
          const rate = this.testPlayback!.toggle();
          this.events.testSpeed?.(rate);
        }
        else if (action === "win") {
          if (this.paused) this.togglePause();
          this.run?.testWin();
        } else if (action === "item") {
          // Every item in turn; a full bag lets its oldest go, so all twenty stay reachable
          const id = RUN_ITEMS[this.nextTestItem++ % RUN_ITEMS.length].id;
          this.run?.items.makeRoom();
          if (this.run && !this.run.giveItem(id)) this.nextTestItem--;
        } else if (!this.paused && this.crashedAt === null) this.run?.spawnTestPortal();
      };
    }
    if (!this.attract) {
      this.touch = new TouchControls(container, this.renderer.domElement, this.input);
      this.renderer.domElement.addEventListener("click", this.engage);
      // Audio may only start after a user gesture: take the first one, mouse or keyboard
      window.addEventListener("keydown", this.startAudio, { once: true });
      window.addEventListener("pointerdown", this.startAudio, { once: true });
    }

    this.particles = new Particles();
    this.softParticles = new Particles(3000, true);
    this.ambient = new Ambient(this.particles, this.softParticles);
    this.avatar = new Avatar(options.color);
    this.companion = new Companion(this.scene, this.particles);
    this.collectionFx = new CollectionFx(this.avatar, this.particles, {
      sound: (voice, level) => { if (!this.attract) this.audio.voice(voice, level); },
      kick: (degrees) => this.rig.kick(degrees),
    });
    this.appearanceChanged();
    window.addEventListener(APPEARANCE_EVENT, this.appearanceChanged);
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
    this.abilityFx = new AbilityFx(this.scene, this.avatar, this.particles, this.softParticles, {
      kick: (degrees) => this.rig.kick(degrees),
      sound: (kind) => this.audio.ability(kind),
    });
    this.abilityFx2 = new AbilityFx2(this.scene, this.avatar, this.particles, this.softParticles, {
      kick: (degrees) => this.rig.kick(degrees),
      sound: (kind, pitch) => this.audio.ability2(kind, pitch),
      turnGate: (index, normal) => this.view.gates.orient(index, normal),
    });
    this.itemFx = new ItemFx(this.scene, this.avatar, this.equipment, this.particles, {
      kick: (degrees) => this.rig.kick(degrees),
      sound: (kind, pitch) => this.audio.item(kind, pitch),
    });
    this.speedLines = new SpeedLines();
    this.debris = new Debris(options.color);
    this.scene.add(this.avatar.group, this.debris.mesh, this.particles.points, this.softParticles.points, this.speedLines.mesh, ...this.fx.meshes);

    this.vignette = document.createElement("div");
    this.vignette.className = "speed-vignette";
    container.appendChild(this.vignette);
    this.marker = document.createElement("div");
    this.marker.className = "ring-marker";
    container.appendChild(this.marker);
    this.portalVeil = document.createElement("div");
    this.portalVeil.className = "portal-veil";
    container.appendChild(this.portalVeil);
    this.whiteLight = document.createElement("div");
    this.whiteLight.className = "white-light";
    container.appendChild(this.whiteLight);

    this.setLevel(options.level ?? seedLevel(options.seed));

    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(container);
    this.setControls(options.controls);
    this.audio.setPreferences(options.controls.musicVolume ?? 1, options.controls.effectsVolume ?? 1, options.controls.muted ?? false);
    this.resize();
    this.frame = requestAnimationFrame(this.loop);
    if (!this.attract) this.unhold = onHold((held) => this.hold(held));

    if (new URLSearchParams(location.search).has("tune")) void this.openTuning();
    // Lets browser tests drive the game in development
    if (import.meta.env.DEV) {
      Object.assign(window, { __game: this, __fxTime: fxTime, __tuning: Object.fromEntries(TUNING_GROUPS) });
      const itemShot = new URLSearchParams(location.search).get("itemShot");
      void import("./devtools").then(({ installDevtools }) => {
        if((window as unknown as {__game: Game}).__game===this)installDevtools(itemShot);
      });
    }
  }

  // --- public API --------------------------------------------------------------

  /** Call from a click: locks the mouse and starts audio (browsers need a gesture for both) */
  engage = (event?: Event) => {
    if (this.paused) return;
    // Clicking the view during the opening autopilot takes the controls
    if (this.introAutopilot) this.takeOver();
    // A finger has no pointer to lock
    if (!this.autopiloting && (event as PointerEvent | undefined)?.pointerType !== "touch") this.input.lockPointer();
    this.audio.start();
  };

  private startAudio = () => this.audio.start();

  /** An overlay over the game pauses it while open, and lets go only of a pause it made itself */
  private hold(held: boolean) {
    // Mark the pause first: togglePause reports it to the HUD straight away
    if (held && !this.paused) {
      this.pausedByHold = true;
      this.togglePause();
    } else if (!held && this.pausedByHold) {
      this.pausedByHold = false;
      if (this.paused) this.togglePause();
    }
  }

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

  /**
   * Turns this game into a roguelike run: levels, upgrades, portals (never used for races).
   * `options`: lives, the pilot's level and what they wear (the collection's powers)
   */
  startRun(seed: number, events: RunEvents, initial?: Level, options: RunOptions = {}) {
    this.run?.dispose();
    this.autopiloting = false;
    this.introAutopilot = false;
    this.clearWhiteFrom = null;
    this.whiteOut(0);
    if (this.paused) this.togglePause();
    this.freeze(false);
    this.equipment.clearWorn();
    this.run = new RunController(seed, this, events, { equipped: this.equipped(), ...options });
    this.run.start(initial);
  }

  /**
   * After the finale's white light: the run is over, the default sky map
   * (today's map on `seed`, the menu's) is built under the white, the pilot
   * flies it on autopilot with every control locked, and the white clears
   */
  victoryLap(seed: number) {
    this.run?.dispose();
    this.run = null;
    this.introAutopilot = false;
    this.autopiloting = true;
    if (document.pointerLockElement) document.exitPointerLock();
    this.freeze(false);
    this.setLevel(seedLevel(seed));
    this.whiteOut(1);
    this.clearWhiteFrom = this.elapsed;
  }

  /**
   * A run's opening: the pilot glides the racing line on rails (no gates, nothing scored,
   * the level clock stopped) until the player steers or takes off. Control is then handed
   * over where the pilot is, at the rail's speed, and the gates ahead grow in
   */
  holdRun(hold: boolean) {
    if (this.paused) this.togglePause();
    this.freeze(false);
    if (hold) {
      this.introAutopilot = this.autopiloting = true;
      this.input.reset();
      this.input.releasePointer();
      this.view.setRings("hidden", 0);
      this.run?.preview();
      return;
    }
    const preview = this.introAutopilot;
    this.introAutopilot = this.autopiloting = false;
    if (!preview) {
      this.respawn(0);
      this.run?.takeOff();
      return;
    }
    this.rails.reset();
    this.run?.takeOff(this.flight.position);
  }

  /** The player steered (or clicked, or pressed a move) during the opening autopilot */
  private takeOver() {
    if (!this.introAutopilot) return;
    if (this.events.takeOver) this.events.takeOver();
    else this.holdRun(false);
  }

  /** The adventure so far (null outside a run): reported when a pilot leaves before the end */
  runSnapshot() {
    return this.run?.snapshot() ?? null;
  }

  /** Dev tools: give the running run an upgrade now, e.g. `__game.grant("slipstream")` */
  grant(id: UpgradeId) {
    this.run?.grant(id);
  }

  /** Dev tools: put an item in the run's bag now, e.g. `__game.giveItem("anemoCatcher")` */
  giveItem(id: RunItemId) {
    this.run?.giveItem(id);
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

  /** ?test only, local to this Game: no inventory writes or unlock checks. */
  testAppearance(look: Appearance | null) {
    if (!this.testPlayback) return;
    this.testLook = look ? validateAppearance(look) : null;
    this.appearanceChanged();
  }

  /** ?test only: carry a keepsake as the charm (null: back to the profile's own) */
  testCharmItem(id: string | null) {
    if (!this.testPlayback) return;
    this.testCharm = id ?? undefined;
    this.appearanceChanged();
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

  stinger(kind: "portal" | "upgrade" | "dash" | "gate" | "finish" | "item" | "orb") {
    if (kind === "gate") this.audio.ring();
    else if (kind === "finish") this.audio.finish();
    else this.audio.stinger(kind);
  }

  treasure(rarity: Rarity) {
    this.audio.treasure(rarityIndex(rarity));
  }

  portalHum(near: number) {
    this.audio.portalHum(near);
  }

  veil(amount: number) {
    // Gentler under a night sky, where the same brightening glares
    const flash = portalFlash(this.world.palette.night);
    if (this.veilFlash !== flash) {
      this.veilFlash = flash;
      this.portalVeil.style.setProperty("--portal-flash", flash.toFixed(3));
    }
    if (Math.abs(amount - this.veilAmount) < 0.002) return;
    this.veilAmount = amount;
    this.portalVeil.style.setProperty("--veil", amount.toFixed(3));
    this.portalVeil.classList.toggle("on", amount > 0.002);
  }

  whiteOut(amount: number) {
    this.white = amount;
    const text = amount.toFixed(3);
    if (this.whiteLight.style.opacity !== text) this.whiteLight.style.opacity = text;
  }

  /** The finale's Enter: skip to the end */
  skipFinale() {
    this.run?.skipFinale();
  }

  insideWormhole(on: boolean) {
    if (this.inWormhole === on) return;
    this.inWormhole = on;
    if (on && this.companion.group) this.companion.group.visible = false;
    this.view.group.visible = !on;
    this.abilityFx.group.visible = !on;
    this.abilityFx2.group.visible = !on;
    this.itemFx.group.visible = !on;
    this.abilityFx.inWormhole = this.abilityFx2.inWormhole = this.itemFx.inWormhole = on;
    this.softParticles.points.visible = !on;
    this.speedLines.mesh.visible = !on;
    if (on) this.debris.mesh.visible = false;
  }

  get pixelHeight(): number {
    return this.renderer.domElement.height;
  }

  /** Gates the run has passed (Thermal Vision marks the rest) */
  private passedGate = (index: number) => this.run?.passedGate(index) ?? false;

  /** Keeps the camera out of the rock */
  private clearance = (x: number, y: number, z: number) => this.world.rock.distance(x, y, z);
  /** Everything solid: rock, trees, water */
  private field = (x: number, y: number, z: number) => this.world.distance(x, y, z);
  /** Everything solid but the rock (trees, water): the land itself collides as drawn (`landTouched`) */
  private others = (x: number, y: number, z: number) => this.world.otherDistance(x, y, z);

  /** Is the land around the hitbox on screen? Until it is, collisions there use the distance field */
  private landShown(): boolean {
    const r = FLIGHT.hitWingTo + 1;
    const { x, y, z } = this.flight.position;
    const view = this.view;
    for (let i = 0; i < 8; i++) {
      if (!view.covers(x + (i & 1 ? r : -r), y + (i & 2 ? r : -r), z + (i & 4 ? r : -r))) return false;
    }
    return true;
  }

  /**
   * The hitbox against the land exactly as drawn: the body ball and both
   * wings' rectangles where they are now, and the paths the ball and the
   * wingtips swept since the last step (nothing slips through a thin sheet of
   * rock between steps). The touch goes to `landHit`
   */
  private landTouched(): HitPart | null {
    const land = this.view.collider;
    hitboxWorld(this.prevPosition, this.prevQuaternion, ballBefore, wingsBefore);
    hitboxWorld(this.flight.position, this.flight.quaternion, ball, wings);
    if (land.sphere(ball, FLIGHT.hitBody, landHit) || land.segment(ballBefore, ball, landHit)) return "body";
    if (land.quad(rightWing, landHit) || land.segment(wingsBefore[1], wings[1], landHit)) return "right";
    if (land.quad(leftWing, landHit) || land.segment(wingsBefore[5], wings[5], landHit)) return "left";
    return null;
  }

  /**
   * The crash tumble's contacts: the signed distance from `p` to the nearest
   * surface within about `radius`, with the way out of it in `out`. The land
   * as drawn where it's on screen, the distance field elsewhere, and trees
   * and water from their own colliders
   */
  private contact = (p: THREE.Vector3, radius: number, out: THREE.Vector3): number => {
    let d: number;
    if (this.view.covers(p.x, p.y, p.z)) {
      // Far enough to still find the face behind a point that went in deep (a wingtip in the rock at the crash)
      d = this.view.collider.nearest(p, radius + 3, landHit);
      if (d < Infinity) out.copy(landHit.normal);
    } else {
      d = this.world.rock.distance(p.x, p.y, p.z);
      if (d < radius) fieldNormal(this.clearance, p, out);
    }
    const other = this.world.otherDistance(p.x, p.y, p.z);
    if (other < radius && other < d) {
      d = other;
      fieldNormal(this.others, p, out);
    }
    return d;
  };

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

  /** True once the land around the camera has arrived */
  get landReady(): boolean {
    return this.view.ready;
  }

  /**
   * The view right now as a JPEG data URL, `width` pixels wide and cut to `aspect` (width / height)
   * around the middle: map-select card art. Renders a frame first, since WebGL clears what it showed.
   */
  snapshot(width: number, aspect: number): string | null {
    const source = this.renderer.domElement;
    if (!source.width || !source.height) return null;
    this.render();
    const height = Math.round(width / aspect);
    const crop = Math.min(source.height, source.width / aspect);
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d");
    if (!context) return null;
    context.drawImage(source, 0, (source.height - crop) / 2, source.width, crop, 0, 0, width, height);
    return canvas.toDataURL("image/jpeg", 0.85);
  }

  /** A race or time trial on `seed`: the map that seed stands for (`seedLevel`, any biome) */
  setSeed(seed: number) {
    if (this.world?.seed === seed && !this.world.level.run) return;
    this.setLevel(seedLevel(seed));
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
      if (this.attract) {
        this.view.park();
        this.kept.set(levelId(this.world.level.key), { world: this.world, view: this.view });
      } else this.view.dispose();
    }
    const id = levelId(level.key);
    const kept = this.attract ? this.kept.get(id) : undefined;
    if (kept) {
      this.kept.delete(id);
      this.world = kept.world;
      this.view = kept.view;
      this.view.resume(this.scene);
    } else {
      this.world = new World(level);
      this.view = new WorldView(this.world, this.scene);
      this.view.prepare(this.renderer);
    }
    if (this.attract) {
      this.home ??= id;
      const others = [...this.kept.keys()].filter((key) => key !== this.home);
      for (const key of others.slice(0, Math.max(0, others.length - ATTRACT_KEEP))) {
        this.kept.get(key)!.view.dispose();
        this.kept.delete(key);
      }
    }
    this.scene.add(this.view.group);
    // Compile the level's shaders now (behind the loading wait or the wormhole), not mid-flight
    this.compileShaders();
    this.view.group.visible = !this.inWormhole;
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

  testAction(action: TestAction) {
    if (controlsBlocked()) return;
    this.input.reset();
    this.input.onTestAction?.(action);
  }

  observeInput(observer: InputObserver): () => void {
    return this.input.observe({
      sample: (input) => { if (!this.paused) observer.sample?.(input); },
      action: (action) => { if (!this.paused) observer.action?.(action); },
    });
  }

  setControls(controls: ControlSettings) {
    const previous = this.input.settings;
    this.input.settings = controls;
    this.input.reset();
    this.rig.reducedMotion = !!controls.reducedMotion;
    this.avatar.setStyle(controls.pilotStyle ?? 1);
    PICKUP_PREFS.crystalsOnly = !!controls.crystalsOnly;
    this.audio.setPreferences(controls.musicVolume ?? 1, controls.effectsVolume ?? 1,
      controls.muted ?? false);
    const mode = controls.quality ?? "auto";
    if (previous.quality !== controls.quality || this.frame === 0) {
      this.setQuality(mode === "low" ? 0 : mode === "medium" ? 1 : 2);
      this.slowFrames = this.measured = 0;
    }
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
    this.unhold?.();
    this.resizeObserver.disconnect();
    this.renderer.domElement.removeEventListener("click", this.engage);
    window.removeEventListener("keydown", this.startAudio);
    window.removeEventListener("pointerdown", this.startAudio);
    this.testPlayback?.dispose();
    this.touch?.dispose();
    this.input.dispose();
    this.audio.dispose();
    this.gui?.destroy();
    this.run?.dispose();
    this.view.dispose();
    this.kept.forEach(({ view }) => view.dispose());
    this.kept.clear();
    this.live.forEach((p) => this.removePilot(p));
    this.ghosts.forEach((p) => this.removePilot(p));
    this.fx.dispose();
    this.abilityFx.dispose();
    this.abilityFx2.dispose();
    this.itemFx.dispose();
    this.equipment.dispose();
    window.removeEventListener(APPEARANCE_EVENT, this.appearanceChanged);
    this.companion.dispose();
    this.avatar.dispose();
    this.particles.dispose();
    this.softParticles.dispose();
    this.speedLines.dispose();
    this.debris.dispose();
    this.composer?.dispose();
    this.compileTarget.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
    this.marker.remove();
    this.vignette.remove();
    this.portalVeil.remove();
    this.whiteLight.remove();
  }

  // --- flying ------------------------------------------------------------------

  private removePilot(pilot: Pilot) {
    this.scene.remove(pilot.group, ...pilot.trailMeshes);
    pilot.dispose();
  }

  private respawn(checkpoints: number, spawn = this.world.spawnPoint(checkpoints)) {
    const { position, direction } = spawn;
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
    this.rails.reset();
    this.glide.stop();
    this.prevPosition.copy(this.flight.position);
    this.prevQuaternion.copy(this.flight.quaternion);
    this.prevVelocity.copy(this.flight.velocity);
    this.accumulator = 0;
    this.crashedAt = null;
    this.proximity = 0;
    this.combo = 0;
    this.run?.abilities.reset();
    this.run?.items.reset();
    this.run?.orbs.reset();
    this.avatar.revive();
    this.avatar.visible = true;
    this.fx.reset();
    this.speedLines.reset();
    this.rig.snap(this.flight.position, this.flight.forward, this.flight.up, this.flight.speed);
  }

  private respawnNow() {
    if (this.raceState === "countdown") return;
    if (this.world.open) {
      this.respawn(0, this.zenSpawn());
      return;
    }
    if (this.run) {
      if (this.run.frozen) return;
      this.respawn(this.run.checkpoint);
      return;
    }
    this.respawn(this.raceState === "free" ? 0 : this.checkpoints);
  }

  /**
   * Zen: where to come back after a crash (or on asking to respawn): near where the tumble rolled
   * to, a little on along the way it rolled, in open air, setting off that way if it's clear (else
   * the way you were facing). Fell into the abyss, or no room anywhere near: straight up from
   * there to the first open air.
   */
  private zenSpawn(): { position: THREE.Vector3; direction: THREE.Vector3 } {
    const crashed = this.crashedAt !== null;
    const from = (crashed ? this.death.position : this.flight.position).clone();
    // The way the tumble went (from the hit to where it stopped), else the way you were flying
    const way = crashed ? from.clone().sub(this.crashFrom).setY(0) : this.flight.velocity.clone().setY(0);
    if (crashed && way.lengthSq() < 4) way.copy(this.crashHeading);
    const { course } = this.world;
    const along = this.flight.forward.clone().setY(0);
    if (along.lengthSq() < 0.01) along.copy(course.startDirection);
    along.normalize();
    if (way.lengthSq() < 0.01) way.copy(along);
    way.normalize();
    const world = this.world;
    const room = (p: THREE.Vector3) => world.distance(p.x, p.y, p.z) > ZEN_ROOM && !world.lost(p.y - 30, p.z);
    const runway = (p: THREE.Vector3, d: THREE.Vector3) => {
      for (let t = 6; t <= ZEN_RUNWAY; t += 6) {
        if (world.distance(p.x + d.x * t, p.y + d.y * t - t * 0.2, p.z + d.z * t) < ZEN_ROOM * 0.6) return false;
      }
      return true;
    };
    const spot = new THREE.Vector3();
    if (!world.lost(from.y, from.z)) {
      for (const above of ZEN_ABOVE) {
        for (const ahead of ZEN_AHEAD) {
          spot.copy(from).addScaledVector(way, ahead);
          spot.y += above;
          if (!room(spot)) continue;
          if (runway(spot, way)) return { position: spot, direction: way };
          if (runway(spot, along)) return { position: spot, direction: along.clone() };
        }
      }
    }
    // Straight up from there (from y = 0 out of the abyss) to the first open air
    spot.set(from.x, Math.max(from.y, course.y(from.z)), from.z);
    for (let i = 0; i < 80 && !room(spot); i++) spot.y += 12;
    return { position: spot, direction: along };
  }

  /**
   * `part` hit something, or null: fell below the islands. `land`: it hit the
   * land drawn (`landHit` has where, and the face's normal); otherwise the hit
   * is at `hitLocal` in the pilot's frame, on the distance field
   */
  private crash(part: HitPart | null, land = false) {
    const f = this.flight;
    const lost = part === null;
    this.crashedAt = this.elapsed;
    this.crashFrom.copy(this.prevPosition);
    this.crashHeading.copy(f.velocity).setY(0);
    this.flight.releaseControls();
    // How the hit plays out depends on how that part met the surface
    if (land) {
      hitPoint.copy(landHit.point);
      normal.copy(landHit.normal);
    } else {
      // Seen from the last step, still outside it
      hitPoint.copy(lost ? ORIGIN : hitLocal).applyQuaternion(this.prevQuaternion).add(this.prevPosition);
      fieldNormal(this.field, hitPoint, normal);
    }
    const kind = classifyCrash(tmp.copy(f.velocity).normalize(), f.right, normal, lost, part);
    this.death.start(kind, this.prevPosition, f.velocity, f.quaternion, f.right, f.up, normal, part === "left" ? -1 : part === "right" ? 1 : undefined);
    this.avatar.wingPoints(this.death.wing);
    this.avatar.die(kind, this.death.side);
    this.rig.startFall(this.prevPosition);
    this.dissolved = false;
    this.deathDebt = 0;
    this.fx.hide();
    if (!lost) this.debris.burst(hitPoint, f.velocity);
    this.crashBurst(kind, normal, hitPoint);
    this.audio.crash();
    this.combo = 0;
    this.run?.crashed();
  }

  private step(input: FlightInput) {
    this.prevPosition.copy(this.flight.position);
    this.prevQuaternion.copy(this.flight.quaternion);
    this.prevVelocity.copy(this.flight.velocity);
    this.run?.items.beforeFlight(this.flight);
    // In a run, some items take the controls a little (the input scored and recorded stays the player's)
    this.flight.step(STEP, this.run ? this.run.steer(input) : input, this.proximity * this.proximity, FLIGHT, this.run ? this.run.flightMods : null);

    const { x, y, z } = this.flight.position;
    const rock = this.world.rock.distance(x, y, z);
    const other = this.world.otherDistance(x, y, z);
    const distance = Math.min(rock, other);
    // The hitbox: a ball for the body, a rectangle for each wing (flight.ts). The land collides as
    // drawn once it is on screen (before that, as the distance field), trees and water by their fields.
    // In a run, Acrobatic Recovery can turn a clipped wingtip into a roll away from the rock
    let part: HitPart | null;
    if(this.run?.items.invulnerable) part=null;
    else if(this.run?.items.phasing){this.hitLand=false;part=touching(this.others,this.flight.position,this.flight.quaternion,other,hitLocal);}
    else part=this.hitTest(other,distance);
    if ((part || this.world.lost(y,z)) && this.run?.revive(this.flight)) {
      this.prevPosition.copy(this.flight.position);
      this.prevQuaternion.copy(this.flight.quaternion);
      this.prevVelocity.copy(this.flight.velocity);
      this.avatar.revive();
      this.rig.snap(this.flight.position, this.flight.forward, this.flight.up, this.flight.speed);
      return;
    }
    if (part && this.run && this.rescue(part)) {
      // Rolled away, or the tornado took the hit
    } else if (part || this.world.lost(y, z)) {
      this.crash(part, this.hitLand);
      return;
    }
    this.proximity = clamp((SCORE_RANGE - distance) / (SCORE_RANGE - 1.5), 0, 1);

    // Style: points for flying close, with a multiplier that grows while you stay close
    if (this.proximity > 0.15) {
      this.combo += STEP;
      this.comboIdle = 0;
    } else if (!this.run?.items.frozenCombo && (this.comboIdle += STEP) > 1.2) {
      this.combo = 0;
    }
    this.style += this.proximity ** 2 * this.flight.speed * STEP * this.multiplier * 0.5 * (this.run?.styleRate ?? 1);

    if (this.raceState === "racing") {
      this.recorder.record(this.clock() - this.startAt, this.flight.position, this.flight.quaternion, this.flight.boost, this.flight.brake, this.flight.dodgePhase);
      this.checkRing();
    } else if (this.run) {
      this.run.step(STEP, this.proximity, input);
    } else if (this.raceState === "free") {
      // No race, but flying through a gate still makes it shine
      const rings = this.world.course.rings;
      for (let i = 0; i < rings.length; i++) {
        if (!this.view.gates.passing(i) && this.crossed(i)) this.gateBurst(i);
      }
    }
  }

  /** The hitbox against everything solid where the pilot is now; `hitLand` says what was hit */
  private hitTest(other: number, distance: number): HitPart | null {
    const shown = this.landShown();
    const land = shown ? this.landTouched() : null;
    this.hitLand = land !== null;
    return land ?? touching(shown ? this.others : this.field, this.flight.position, this.flight.quaternion, shown ? other : distance, hitLocal);
  }

  /**
   * A run's abilities may save the pilot from a hit (run mode): Acrobatic
   * Recovery (a wingtip clipped the rock: glance off it, out of the rock, and
   * barrel roll away from it) or Draft-Weaving's tornado (a glancing hit:
   * glance off it). False if no ability saves it, or the pilot can't be got
   * clear (then it's a crash after all)
   */
  private rescue(part: HitPart): boolean {
    const f = this.flight;
    if (this.hitLand) {
      hitPoint.copy(landHit.point);
      normal.copy(landHit.normal);
    } else {
      hitPoint.copy(hitLocal).applyQuaternion(f.quaternion).add(f.position);
      fieldNormal(this.field, hitPoint, normal);
    }
    const abilities = this.run!.abilities;
    const items = this.run!.items;
    const direction = tmp.copy(f.velocity).normalize();
    // The abilities first (they come back by themselves), then an item that's used up by it, then a
    // collection power that comes back each level (Frost skate)
    const how = abilities.save(part, normal, direction) ?? items.save(part, normal, direction) ?? this.run!.perkSave(part, normal, direction);
    if (!how) return false;
    if (how === "roll") f.deflect(normal, ABILITY.recoverPush, ABILITY.recoverKeep);
    else if (how === "shield") f.deflect(normal, ABILITY.weavePush, ABILITY.weaveKeep);
    else f.deflect(normal, ITEM.shieldPush, ITEM.shieldKeep);
    // Teleported out: no sweep from where we were, and a few more nudges if anything still touches
    for (let i = 0; ; i++) {
      this.prevPosition.copy(f.position);
      this.prevQuaternion.copy(f.quaternion);
      const { x, y, z } = f.position;
      const other = this.world.otherDistance(x, y, z);
      if (!this.hitTest(other, Math.min(this.world.rock.distance(x, y, z), other))) break;
      if (i === 4) return false;
      f.position.addScaledVector(normal, 0.5);
    }
    if (how === "roll") {
      Object.assign(this.recoverRoll, FLIGHT, { dodgeDistance: 3, dodgeDuration: 0.55 });
      f.dodge(normal.dot(f.right) >= 0 ? 1 : -1, this.recoverRoll, true);
    }
    if (how === "roll" || how === "shield") abilities.saved(how, hitPoint, normal);
    else if (how === "frost") this.run!.perkSaved(how, hitPoint, normal);
    else items.saved(how, hitPoint, normal);
    return true;
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
    this.prevVelocity.copy(this.flight.velocity);
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
    this.prevVelocity.copy(this.flight.velocity);
    this.accumulator = 0;
  }

  /**
   * One fixed step of the autopilot: along the racing line, through the middle of every gate,
   * never near rock (autopilot.ts). Nothing is scored; gates shine as it passes them
   */
  private autopilotStep() {
    this.prevPosition.copy(this.flight.position);
    this.prevQuaternion.copy(this.flight.quaternion);
    this.prevVelocity.copy(this.flight.velocity);
    this.rails.step(STEP, this.flight, this.world.course);
    const { x, y, z } = this.flight.position;
    const distance = Math.min(this.world.rock.distance(x, y, z), this.world.otherDistance(x, y, z));
    this.proximity = clamp((SCORE_RANGE - distance) / (SCORE_RANGE - 1.5), 0, 1);
    // The opening glide flies before the gates have grown in
    if (this.introAutopilot) return;
    const rings = this.world.course.rings;
    for (let i = 0; i < rings.length; i++) {
      if (!this.view.gates.passing(i) && this.crossed(i)) this.gateBurst(i);
    }
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
    // In a run, Wind-Shear Dash turns the dodge into a blink; never while hover-stalling
    const run = this.run;
    if (run && (run.abilities.hang >= 0 || run.abilities.ascend >= 0)) return;
    if (this.flight.dodge(dir, run ? run.dodgeParams() : FLIGHT)) run?.dodged(dir, this.flight);
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
      for (let k = 0; k < Math.round(2 * amount); k++) {
        this.particles.emit(
          at.copy(p).addScaledVector(outward, rand(-0.6, 0.6)),
          vel
            .copy(outward)
            .multiplyScalar(rand(5, 15))
            .addScaledVector(forward, rand(2, 6) + this.flight.speed * 0.15)
            .add(tmp2.set(rand(-2, 2), rand(-2, 2), rand(-2, 2))),
          fx(rand(0.7, 1.2), rand(0.22, 0.45), k % 2 ? WHITE : tint, Kind.Shard, 4, 1.1, 1.5),
        );
      }
    }
    // Fine stars around the rim and scattered grains around the pilot
    for (let k = 0; k < Math.round(48 * amount); k++) {
      const p = crystals[k % crystals.length];
      at.lerpVectors(ring.position, p, rand(0.85, 1.05));
      tmp.subVectors(at, ring.position).normalize();
      this.particles.emit(at, vel.copy(tmp).multiplyScalar(rand(1, 5)).addScaledVector(forward, rand(-2, 4)), fx(rand(0.7, 1.2), rand(0.22, 0.45), tint, Kind.Star, -0.5, 1.5, 1.5));
    }
    for (let k = 0; k < Math.round(18 * amount); k++) {
      this.particles.emit(
        at.copy(this.flight.position).add(tmp2.set(rand(-0.6, 0.6), rand(-0.6, 0.6), rand(-0.6, 0.6))),
        vel.set(rand(-1, 1), rand(-1, 1), rand(-1, 1)).normalize().multiplyScalar(rand(4, 10)).addScaledVector(this.flight.velocity, 0.6),
        fx(rand(0.4, 0.65), rand(0.12, 0.25), WHITE, Kind.Glow, 0, 3, 1),
      );
    }
  }

  /** Stars and puffs off the impact, thrown away from the surface; each kind of crash adds its own */
  private crashBurst(kind: DeathKind, away: THREE.Vector3, p: THREE.Vector3) {
    const amount = this.particles.budget;
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
    // Never negative: hand-stepped frames (dev tools) can interleave with the browser's own
    const realDt = this.lastFrame ? clamp((now - this.lastFrame) / 1000, 0, 0.1) : 0;
    const dt = realDt * (this.testPlayback?.rate ?? 1);
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
    const worldDt=dt * (this.run?.items.worldRate ?? 1);
    this.sceneryClock+=worldDt;sceneryTime.value=this.sceneryClock;
    this.adaptQuality(realDt);

    if (this.introAutopilot) {
      // Steering, boost or brake ends the opening autopilot; tilt and sticks need a clear push
      const probe = this.input.sample(dt);
      if (Math.abs(probe.pitch) > 0.25 || Math.abs(probe.roll) > 0.25 || (probe.boost ?? 0) > 0.5 || (probe.brake ?? 0) > 0.5) this.takeOver();
    }
    const selfFlying = this.attract === "chase" || this.autopiloting;
    if (!selfFlying) {
      this.touch?.update();
      this.input0 = this.input.sample(dt);
    }
    if (this.clearWhiteFrom !== null) {
      // The white after the finale clears once the map is there (or after a few seconds)
      if (this.view.ready || this.elapsed - this.clearWhiteFrom > 4) {
        this.whiteOut(Math.max(0, this.white - dt / 2.2));
        if (this.white <= 0) this.clearWhiteFrom = null;
      }
    }
    // Outside races, the land around you must be on screen before you fly: no flying into
    // invisible rock. Until it is, the pilot glides in on rails, without control (glidein.ts)
    const loading = !this.view.ready && this.raceState === "free" && this.attract !== "drift";
    // Held still: a run's start line, the tunnel between biomes
    const waiting = this.frozen;
    if (waiting || loading || this.raceState === "countdown") this.flight.releaseControls();
    if (this.crashedAt !== null) {
      if (this.elapsed - this.crashedAt > RESPAWN_DELAY) this.respawnNow();
    } else if (selfFlying && !waiting) {
      // On rails along the line: it never needs the land to steer clear of it, so no glide-in
      if (this.glide.active) this.glide.stop();
      this.accumulator += dt;
      let steps = 0;
      while (this.accumulator >= STEP && steps < MAX_STEPS_PER_FRAME) {
        steps++;
        this.autopilotStep();
        this.accumulator -= STEP;
      }
      if (this.accumulator >= STEP) this.accumulator %= STEP;
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
    if (selfFlying && this.flight.position.z > this.world.course.endZ + AUTOPILOT_LOOP) this.respawn(0);
    // The opening glide starts over before the last gates, so taking over always leaves a course to fly
    if (this.introAutopilot) {
      const rings = this.world.course.rings;
      const last = rings[Math.max(0, rings.length - 3)];
      if (last && tmp.subVectors(this.flight.position, last.position).dot(last.normal) > 0) this.respawn(0);
    }

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
      this.abilityFx.pose(dt, this.run && !waiting ? this.run.abilities : null);
      this.abilityFx2.pose(dt, this.run && !waiting ? this.run.abilities : null);
      this.itemFx.pose(dt, this.run && !waiting ? this.run.items : null);
      this.avatar.setDodge(this.flight.dodgePhase);
      this.avatar.setSpeedControls(this.flight.boost, this.flight.brake);
      this.avatar.update(dt, this.flight.speed, this.smoothProximity);
      this.equipment.update(dt);
      // Frozen on the start line or in the tunnel: no motes, or they pile up into a glowing ball
      const moving = this.raceState !== "countdown" && !waiting;
      this.fx.update(dt, this.flight.speed, this.flight.velocity, this.smoothProximity, moving);
      this.skimSpray(dt);
      if (this.run) {
        this.abilityFx.update(dt, this.run.abilities, this.world, this.flight, this.rig.camera, this.passedGate, moving);
        this.abilityFx2.update(dt, this.run.abilities, this.world, this.flight, this.rig.camera, this.passedGate, moving);
        this.itemFx.update(dt, this.run.items, this.flight, moving, this.run.charm);
        this.collectionFx.update(dt, this.flight, this.run, moving && !this.inWormhole);
      } else {
        this.abilityFx.hide();
        this.abilityFx2.hide();
        this.itemFx.hide();
        // Outside adventures the cosmetics still shine (looks only), but no power acts
        this.collectionFx.update(dt, this.flight, null, moving && !this.attract);
      }
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
      // The crash plays out: the pose first (the wings flail), then the tumble moves the body and
      // keeps that pose out of the rock, so what's drawn is always resolved; the camera keeps it in view
      this.avatar.update(dt, this.death.speed, 0);
      this.avatar.wingPoints(this.death.wing);
      this.death.update(dt, this.contact);
      this.avatar.foldWings(this.death.wedged[0], this.death.wedged[1], dt);
      body.position.copy(this.death.position);
      body.quaternion.copy(this.death.quaternion);
      this.abilityFx.hide();
      this.abilityFx2.hide();
      this.itemFx.hide();
      this.equipment.update(dt);
      this.deathEffects(dt);
      this.rig.fall(body.position, dt, this.field);
    }
    this.avatar.showCosmeticHat(this.equipment.wearing("head") === null);
    this.companion.update(dt, body, !crashed && !this.inWormhole && !waiting && this.attract !== "drift", this.world.course, this.flight.speed);
    this.debris.update(dt);

    const camera = this.rig.camera;
    camera.updateMatrixWorld();
    this.view.update(camera, worldDt, crashed ? undefined : this.flight.velocity);
    this.run?.frame(dt);
    if (!this.inWormhole) {
      this.gateMotes(dt);
      this.gateGlints(dt);
    }
    const flying = !crashed && this.raceState !== "countdown" && !waiting && this.attract !== "drift";
    this.speedLines.update(dt, body.position, flying ? this.flight.velocity : tmp.set(0, 0, 0), camera, this.particles.budget);
    if (!this.inWormhole) this.ambient.update(worldDt, camera.position, flying ? this.flight.velocity : tmp.set(0, 0, 0), this.particles.budget);

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
    const crashed = this.crashedAt !== null;
    const raceTimeMs =
      this.raceState === "racing"
        ? t - this.startAt
        : this.raceState === "finished"
          ? this.finishMs
          : null;
    const runHud = this.run?.hud() ?? null;
    let flap = false, hover = false, plunge = false, gale = false;
    if (runHud) for (const ability of runHud.abilities) {
      const bindings = this.input.settings.bindings;
      if (ability.id === "flap") ability.key = bindingLabel(bindings, "flap");
      else if (ability.id === "hoverStall") ability.key = bindingLabel(bindings, "hover");
      else if (ability.id === "plunge") ability.key = bindingLabel(bindings, "plunge");
      else if (ability.id === "galeForce") ability.key = bindingLabel(bindings, "burst");
      else if (ability.id === "windShear") ability.key = `${bindingLabel(bindings, "barrelLeft")} / ${bindingLabel(bindings, "barrelRight")}`;
      else if (ability.id === "resonance") ability.key = bindingLabel(bindings, "resonance");
      else if (ability.id === "ascension") ability.key = bindingLabel(bindings, "ascend");
      else if (ability.id === "aeroBrake") ability.key = bindingLabel(bindings, "brake");
      else if (ability.id === "falcon" || ability.id === "butterfly") ability.key = bindingLabel(bindings, "stance");
      flap ||= ability.id === "flap";
      hover ||= ability.id === "hoverStall";
      plunge ||= ability.id === "plunge";
      gale ||= ability.id === "galeForce";
    }
    const bag = runHud?.items.bag ?? [];
    const lit = bag[runHud?.items.selected ?? 0];
    const charm = runHud?.charm;
    this.touch?.sync(this.paused, (!this.autopiloting || this.introAutopilot) && !this.frozen, {
      flap, hover, plunge, gale,
      item: lit && !lit.auto ? lit.icon : undefined,
      nextItem: bag.length > 1,
      charm: charm && charm.state !== "passive" ? (charm.state === "burning" || charm.state === "strapping" ? "Rocket off" : "Charm") : undefined,
    });
    return {
      seed: this.world.seed,
      run: runHud,
      biomeName: this.world.biome.name,
      openWorld: this.world.open,
      paletteName: this.world.palette.name,
      palette: this.world.palette,
      boostCharge: this.flight.boostCharge,
      boosting: this.flight.boost > 0.05,
      braking: this.flight.brake > 0.05,
      // The flight state freezes at the moment of a crash; the pilot isn't flying any more
      speedKmh: crashed ? 0 : Math.round(this.flight.speed * 3.6),
      clearance: Math.max(0, Math.round(this.world.distance(x, y, z))),
      loading: !this.view.ready,
      raceState: this.raceState,
      raceTimeMs,
      countdown: this.raceState === "countdown" ? Math.max(0, Math.ceil((this.startAt - t) / 1000)) : null,
      checkpoints: this.checkpoints,
      totalCheckpoints: this.world.course.rings.length,
      proximity: crashed ? 0 : this.smoothProximity,
      style: Math.round(this.style),
      multiplier: this.multiplier,
      crashed,
      // An overlay's pause (hold.ts) explains itself: no "Paused" over it
      paused: this.paused && !this.pausedByHold,
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
    this.marker.classList.toggle("offscreen", !onScreen);
    this.marker.classList.toggle("finish", ring.finish);
    const text = `${Math.round(this.flight.position.distanceTo(ring.position))} m`;
    if (this.marker.textContent !== text) this.marker.textContent = text;

    // Keep the whole label on screen, not just the point it marks
    const box = this.markerBox ?? this.measureMarker();
    const x = clamp(((px + 1) / 2) * width, MARKER_EDGE - box.left, width - box.left - box.width - MARKER_EDGE);
    const y = clamp(((1 - py) / 2) * height, MARKER_EDGE - box.top, height - box.top - box.height - MARKER_EDGE);
    this.marker.style.transform = `translate(${x}px, ${y}px)`;
  }

  /** Where the marker's box sits around its point. The CSS fixes its size, so this runs once. */
  private measureMarker() {
    const style = getComputedStyle(this.marker);
    this.markerBox = {
      left: parseFloat(style.marginLeft),
      top: parseFloat(style.marginTop),
      width: this.marker.offsetWidth,
      height: this.marker.offsetHeight,
    };
    return this.markerBox;
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
    return this.quality === 2 && FX.bloom > 0 && !this.bloomFailed;
  }

  /**
   * Builds the scene's shader programs ahead of their first use. A program is built for the
   * color space it writes: what is drawn into the bloom's (linear) target is another program
   * than what is drawn straight to the screen, so compile with the kind of target in use, or
   * every shader is built a second time in the frame its object first shows up
   */
  private compileShaders() {
    if (this.bloomOn) this.renderer.setRenderTarget(this.compileTarget);
    this.renderer.compile(this.scene, this.rig.camera);
    this.renderer.setRenderTarget(null);
  }

  private render() {
    const camera = this.rig.camera;
    // Particle sizes are in metres: keep the conversion in step with the zooming FOV
    this.particles.setViewport(this.renderer.domElement.height, camera.fov);
    this.softParticles.setViewport(this.renderer.domElement.height, camera.fov);
    if (this.bloomOn && !this.composer) {
      // Nothing is drawn for the moment the bloom's modules take to load: drawing straight to
      // the screen meanwhile would build every shader for the screen, then again for the bloom
      void this.createComposer();
      return;
    }
    if (this.bloomOn && this.composer && this.bloomPass) {
      this.bloomPass.strength = FX.bloom * (1 + this.world.palette.night * 0.25);
      this.bloomPass.radius = FX.bloomRadius;
      this.bloomPass.threshold = FX.bloomThreshold;
      // Radius alone still includes the broad low-resolution blur layers.
      // Keep a close glow; suppress those layers so lamps retain their silhouette.
      for (let i = 0; i < this.bloomPass.bloomTintColors.length; i++) {
        this.bloomPass.bloomTintColors[i].setScalar(i < 2 ? 1 : FX.bloomHalo);
      }
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
        import("three/examples/jsm/postprocessing/FXAAPass.js"),
      ]);
    } catch (error) {
      // No bloom then: draw straight to the screen
      this.bloomFailed = true;
      this.composerLoading = false;
      reloadForNewBuild(error);
      return;
    }
    const [{ EffectComposer }, { RenderPass }, { UnrealBloomPass }, { OutputPass }, { FXAAPass }] = modules;
    this.composerLoading = false;
    if (!this.bloomOn || this.composer) return;
    const size = this.renderer.getDrawingBufferSize(new THREE.Vector2());
    // Half floats keep colors above 1 for the bloom. Multisampling a float target is by far the
    // dearest part of the frame on integrated GPUs (it is resolved twice a frame), so edges are
    // smoothed by an FXAA pass at the end instead; FX.bloomSamples > 0 brings the samples back
    const target = new THREE.WebGLRenderTarget(size.x, size.y, { type: THREE.HalfFloatType, samples: FX.bloomSamples });
    const composer = new EffectComposer(this.renderer, target);
    composer.setPixelRatio(this.renderer.getPixelRatio());
    composer.setSize(this.container.clientWidth || 1, this.container.clientHeight || 1);
    composer.addPass(new RenderPass(this.scene, this.rig.camera));
    this.bloomPass = new UnrealBloomPass(new THREE.Vector2(size.x, size.y), FX.bloom, FX.bloomRadius, FX.bloomThreshold);
    composer.addPass(this.bloomPass);
    composer.addPass(new OutputPass());
    if (FX.bloomSamples === 0) composer.addPass(new FXAAPass());
    this.composer = composer;
  }

  /** Drops the bloom composer so it is rebuilt with the current FX settings */
  rebuildBloom() {
    this.composer?.dispose();
    this.bloomPass?.dispose();
    this.composer = null;
    this.bloomPass = null;
    this.renderer.setPixelRatio(this.pixelRatio());
    this.resize();
  }

  /**
   * The canvas's pixel ratio at a quality level. With bloom the whole frame is drawn at
   * FX.bloomResolution at most, canvas included: the page scales it up for free, where a
   * bigger canvas would run the last full-screen passes over up to four times the pixels
   */
  private pixelRatio(quality: Quality = this.quality): number {
    const bloom = quality === 2 && FX.bloom > 0 && !this.bloomFailed;
    return Math.min(window.devicePixelRatio, QUALITY[quality].pixelRatio, bloom ? FX.bloomResolution : Infinity);
  }

  private setQuality(quality: Quality) {
    const bloomWas = this.bloomOn;
    this.quality = quality;
    if (!this.bloomOn && this.composer) {
      this.composer.dispose();
      this.bloomPass?.dispose();
      this.composer = null;
      this.bloomPass = null;
    }
    this.renderer.setPixelRatio(this.pixelRatio(quality));
    this.particles.budget = QUALITY[quality].particles;
    this.resize();
    // With or without bloom is another set of programs: build them now, not one by one in flight
    if (bloomWas !== this.bloomOn) this.compileShaders();
  }

  /** Steps the quality down if frames keep taking too long (never back up, so it can't flicker) */
  private adaptQuality(dt: number) {
    this.measured += dt;
    if ((this.input.settings.quality ?? "auto") !== "auto" || !FX.autoQuality || this.quality === 0 || this.measured < 5 || dt >= 0.1) return;
    this.slowFrames = dt > 1 / 40 ? this.slowFrames + dt : Math.max(0, this.slowFrames - dt * 0.5);
    if (this.slowFrames > 2.5) {
      this.slowFrames = 0;
      this.measured = 0;
      this.setQuality((this.quality - 1) as Quality);
      if (import.meta.env.DEV) console.info(`[windrider] frame rate low, quality now ${this.quality}`);
    }
  }

  private resize() {
    const width = this.container.clientWidth || 1;
    const height = this.container.clientHeight || 1;
    this.renderer.setSize(width, height, false);
    this.composer?.setPixelRatio(this.renderer.getPixelRatio());
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
    const abilities = gui.addFolder("Run abilities (not saved)");
    for (const key of Object.keys(ABILITY) as (keyof typeof ABILITY)[]) abilities.add(ABILITY, key);
    abilities.close();
    const items = gui.addFolder("Run items (not saved)");
    for (const key of Object.keys(ITEM) as (keyof typeof ITEM)[]) items.add(ITEM, key);
    const orbs = gui.addFolder("Stamina orbs (next level, not saved)");
    for (const key of Object.keys(ORB) as (keyof typeof ORB)[]) orbs.add(ORB, key);
    orbs.close();
    const pickups = gui.addFolder("Island pickups (next level, not saved)");
    for(const key of Object.keys(PICKUP) as (keyof typeof PICKUP)[]) pickups.add(PICKUP,key);
    items.close();
    pickups.close();

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
          if (key === "bloomResolution" || key === "bloomSamples") this.rebuildBloom();
        });
      }
      folder.close();
    }

    const actions = {
      barrelLeft: () => this.barrelRoll(-1),
      barrelRight: () => this.barrelRoll(1),
      copy: () => void navigator.clipboard?.writeText(JSON.stringify({ FLIGHT, ABILITY, ITEM, ...Object.fromEntries(TUNING_GROUPS) }, null, 2)),
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
