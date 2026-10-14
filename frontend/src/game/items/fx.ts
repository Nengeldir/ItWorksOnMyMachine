import { PickupView } from "./pickups";
import * as THREE from "three";
import { RingQuads } from "../abilities/models";
import { funnelMesh } from "../abilities/models2";
import type { Avatar } from "../avatar";
import type { Flight } from "../flight";
import { Trail } from "../trail";
import { clamp, smoothstep } from "../math";
import { Kind, type Particles, fx } from "../particles";
import { ITEM, RARITIES, type Items, type RunItemId, runItem } from "../run/items";
import type { Charm } from "../run/charm";
import type { ItemId } from "./models";
import { ITEMS_FX } from "../tuning";
import { RelicFx } from "./relicFx";
import { auraMesh } from "./auras";
import type { Equipment } from "./equip";

// What the design list's items look like when used (their rules:
// run/items.ts). Looks only: this reads the items' state and drives the
// pilot's Equipment (taking the item out, holding it up, using it up) and the
// effects in the world. It never changes the flight.
//  - Anemo Catcher: the bottle is held up and uncorked with a pop; a column of
//    wind bursts up under the pilot, who rides it reaching for the sky, wisps
//    and leaves streaming up past.
//  - Starflake Shield: the crystal is held up and bursts into a faceted
//    bubble of ice round the pilot, frost glittering on its seams; the first
//    hit shatters it into a ring of shards.
//  - Luminescent Glider Wax: the tin is held up and the wax spreads over the
//    wings in a flash of gold; while it lasts, golden ribbons stream off the
//    wingtips and the wings shed glitter like honey in the sun.

export type ItemSound = "pickup" | "full" | "auto" | "uncork" | "shield" | "shatter" | "wax" | "fuse" | "ignite" | "douse" | "eat" | "pop" | "foresee";

export interface ItemFxHost {
  kick(degrees?: number): void;
  sound(kind: ItemSound, pitch?: number): void;
}

const TAU = Math.PI * 2;
const WHITE = new THREE.Color("#ffffff");
const ANEMO = new THREE.Color("#7df5d8");
const LEAF = new THREE.Color("#8ee8b0");
const ICE = new THREE.Color("#a8e4ff");
const FROST = new THREE.Color("#e8fbff");
const HONEY = new THREE.Color("#ffd36e");
const JADE = new THREE.Color("#8ff0cf");
const CRACKER = new THREE.Color("#ff5a4a");
const PICKED = new THREE.Color();
const UP = new THREE.Vector3(0, 1, 0);
const ORIGIN = new THREE.Vector3();

const at = new THREE.Vector3();
const vel = new THREE.Vector3();
const tmp = new THREE.Vector3();
const tipL = new THREE.Vector3();
const tipR = new THREE.Vector3();
const span = new THREE.Vector3();
const wingPoints = Array.from({ length: 10 }, () => new THREE.Vector3());
const matrix = new THREE.Matrix4();
const rand = (min: number, max: number) => min + Math.random() * (max - min);
const ease = (current: number, target: number, rate: number, dt: number) => current + (target - current) * (1 - Math.exp(-rate * dt));
/** `out` turned so its -z looks along `direction` */
const lookAlong = (out: THREE.Quaternion, direction: THREE.Vector3) =>
  out.setFromRotationMatrix(matrix.lookAt(ORIGIN, direction, Math.abs(direction.y) > 0.98 ? tmp.set(0, 0, 1) : UP));

/** How each item is taken out and used up in the hand (the firework and the boots are worn instead) */
const USE_STYLE: Partial<Record<RunItemId, "eat" | "raise" | "toss">> = {
  spiritLantern: "raise",
  echoConch: "raise",
  silkRibbon: "raise",
  vortexGeode: "raise",
  stormKite: "raise",
  glacialPrism: "raise",
  sunNectar: "eat",
  windTether: "raise",
  mothCape: "raise",
  resonantChimes: "raise",
  crystalUpdraft: "toss",
  duskHourglass: "raise",
  electroPrism: "raise",
  anemoCatcher: "raise",
  starflakeShield: "raise",
  gliderWax: "raise",
  windGourd: "raise",
  koiCharm: "raise",
  paperCrane: "toss",
  firecrackers: "toss",
};

interface Wave {
  t: number;
  life: number;
  center: THREE.Vector3;
  normal: THREE.Vector3 | null;
  radius: number;
  grow: number;
  tint: THREE.Color;
}

export class ItemFx {
  /** Everything placed in the world (the level's): hidden with it inside a wormhole */
  readonly group = new THREE.Group();
  /** Inside a wormhole the level is hidden, and so is everything in `group` */
  inWormhole = false;
  private readonly avatar: Avatar;
  private readonly equipment: Equipment;
  private readonly particles: Particles;
  private readonly host: ItemFxHost;
  private readonly disposables: { dispose(): void }[] = [];
  private readonly relics: RelicFx;
  private readonly pickups = new PickupView();
  private active = false;
  private version = -1;
  private readonly cue = { pickup: 0, use: 0, full: 0, auto: 0, shatter: 0, chime: 0, bounce: 0, pop: 0, foresight: 0 };
  /** The guard's wind (a foreseen crash): ribbons of jade wind round the pilot */
  private guardDebt = 0;
  private readonly rings = new RingQuads(16, true);
  private readonly waves: Wave[] = [];

  // Anemo Catcher
  private readonly column = funnelMesh({ mouth: 2.4, end: 1.3, color: "#7fe9cf", twist: 0.45, flow: 3.4, spin: 1.8, streaks: 7, rings: true });
  private columnT = -1;
  private riseDebt = 0;
  // Starflake Shield
  private readonly bubble = auraMesh(0, "#cfefff", "#ffffff");
  private shieldT = -1;
  private frostDebt = 0;
  // Luminescent Glider Wax
  private readonly waxTrails: Trail[];
  private waxShown = 0;
  private glitterDebt = 0;
  // Comet Tail Firework: the rocket this item strapped on (a firework worn any other way is left alone)
  private ownFirework = false;
  // The charm: its rocket (strapped on with the full swing over the shoulder) and its food
  private charmRocket = false;
  private readonly charmCue = { rocketOn: 0, rocketOff: 0, eat: 0 };
  private lit = false;

  constructor(scene: THREE.Scene, avatar: Avatar, equipment: Equipment, particles: Particles, host: ItemFxHost) {
    this.avatar = avatar;
    this.equipment = equipment;
    this.particles = particles;
    this.host = host;
    scene.add(this.group);
    this.relics = new RelicFx(avatar, equipment, particles);
    this.group.add(this.relics.group, this.pickups.group);
    this.group.add(this.column, this.bubble, this.rings.mesh);
    this.disposables.push(this.column.geometry, this.column.material, this.bubble.geometry, this.bubble.material, this.rings);
    this.waxTrails = [0, 1].map(() => {
      const trail = new Trail("#ffd36e", { width: 0.22, shimmer: 1.2, length: 1.6 });
      trail.setColor("#fff4c4", "#ffb84a");
      scene.add(trail.mesh);
      this.disposables.push(trail);
      return trail;
    });
  }

  /** Before the avatar animates: the items' poses (eased in and out) */
  pose(dt: number, items: Items | null) {
    if (dt <= 0) return;
    const st = this.avatar.stance;
    // Riding the updraft, the pilot reaches for the sky
    const climbing = items && items.time("anemoCatcher") >= 0 ? 1 : 0;
    if (items && items.time("stormKite") >= 0) this.equipment.lift = 1;
    if (climbing) st.climb = Math.max(st.climb, ease(st.climb, 1, 8, dt));
  }

  /** Not in a run, crashed, or in a race: nothing shows */
  hide() {
    if (!this.active) return;
    this.active = false;
    this.group.visible = false;
    this.equipment.lift = 0;
    this.equipment.setThrust(0);
    this.relics.hide();
    for (const trail of this.waxTrails) trail.opacity = 0;
  }

  /** After the avatar and its effects animated: everything else; `charm`: the keepsake carried */
  update(dt: number, items: Items, flight: Flight, flying: boolean, charm: Charm | null = null, guarding = false) {
    this.active = true;
    this.group.visible = !this.inWormhole;
    const budget = this.particles.budget * (flying ? 1 : 0);
    if (items.version !== this.version) {
      this.version = items.version;
      this.columnT = -1;
      this.waves.length = 0;
    }
    if(!this.inWormhole)this.pickups.update(dt,items,flight.position,this.particles);
    this.rings.begin();
    this.cues(items, flight, budget);
    this.anemoCatcher(dt, items, budget);
    this.starflake(dt, items, budget);
    this.gliderWax(dt, items, flight, budget);
    this.relics.group.visible = true;
    this.relics.update(dt, items, flight, flying);
    this.charmLooks(charm, budget);
    // Only the rockets the Comet Tail item or the charm put on burn and come off with them: one put
    // on from the test fitting room (or any other way) keeps its own flame and stays on the back
    if (this.ownFirework || this.charmRocket) {
      const worn = this.equipment.wearing("back") === "firework";
      if (!worn) this.ownFirework = this.charmRocket = false;
      else {
        if (this.ownFirework && items.time("cometFirework") < 0) {
          this.ownFirework = false;
          // The charm's rocket stays strapped on after a Comet Tail burnt in it
          if (!this.charmRocket) this.equipment.unequip("back");
        }
        const flame = Math.max(this.ownFirework ? items.burn : 0, this.charmRocket ? charm?.flame ?? 0 : 0);
        this.equipment.setThrust(flame);
        if (flame > 0.2 && !this.lit) {
          this.lit = true;
          this.host.sound("ignite");
          this.host.kick(5);
        } else if (flame < 0.05) this.lit = false;
      }
    }
    // A foreseen crash: the wind spirals round the pilot while it carries them on the safe line
    this.guardDebt += guarding ? 70 * budget * dt : 0;
    for (; this.guardDebt >= 1; this.guardDebt--) {
      const a = Math.random() * TAU, pilot = this.avatar.group.position;
      at.copy(pilot).add(tmp.set(Math.cos(a) * 1.8, rand(-0.6, 0.6), Math.sin(a) * 1.8));
      vel.set(-Math.sin(a) * 6, rand(0, 1.5), Math.cos(a) * 6).addScaledVector(flight.velocity, 0.85);
      this.particles.emit(at, vel, fx(rand(0.4, 0.7), rand(0.3, 0.55), Math.random() < 0.7 ? JADE : WHITE, Kind.Wisp, 0, 2, 0.8));
    }
    this.updateWaves(dt);
    this.rings.end();
  }

  // --- one-off moments ----------------------------------------------------------------

  private cues(items: Items, flight: Flight, budget: number) {
    const c = items.cue;
    const seen = this.cue;
    if(c.chime !== seen.chime){
      seen.chime=c.chime;
      const gate=items.world?.course.rings[items.chimeTarget-1];
      if(gate)this.wave(gate.position,gate.normal,gate.radius,2,0.9,HONEY);
      this.host.sound("uncork",1.4);
    }
    if(c.bounce !== seen.bounce){
      seen.bounce=c.bounce;
      this.wave(items.pad,UP,ITEM.padRadius,1.5,0.7,ANEMO);
      for(let k=0;k<Math.round(32*budget);k++){
        vel.set(rand(-3,3),rand(8,16),rand(-3,3));
        this.particles.emit(items.pad,vel,fx(0.8,0.3,ANEMO,Kind.Wisp,0,1,0.7));
      }
      this.host.sound("uncork");
    }
    if(c.pickup !== seen.pickup){
      seen.pickup=c.pickup;
      // A burst of light in the item's rarity color: rarer finds ring wider and shower more sparks
      const rarity = items.pickedRarity;
      const tint = PICKED.set(RARITIES[rarity].light);
      this.host.sound("pickup", 1 + rarity * 0.12);
      const pilot = this.avatar.group.position;
      this.wave(pilot,null,0.8,2 + rarity,0.5 + rarity * 0.15,tint);
      if (rarity >= 2) this.wave(pilot,UP,1.2,3 + rarity,0.7,tint);
      for(let i=0;i<Math.round((18 + rarity * 22)*budget);i++){
        vel.set(rand(-2,2),rand(0,3 + rarity),rand(-2,2)).multiplyScalar(1 + rarity * 0.35);
        this.particles.emit(pilot,vel,fx(0.8 + rarity * 0.15,0.2 + rarity * 0.04,i % 3 ? tint : WHITE,Kind.Star,-1,1,1.5 + rarity * 0.2));
      }
      // Legendary: a column of light rising out of the pilot
      for (let i = 0; rarity === 3 && i < Math.round(30 * budget); i++) {
        at.copy(pilot).add(tmp.set(rand(-0.6, 0.6), rand(-1, 1), rand(-0.6, 0.6)));
        this.particles.emit(at, vel.set(0, rand(6, 14), 0), fx(rand(0.6, 1.1), rand(0.15, 0.3), tint, Kind.Glow, 0, 0.8, 2.2));
      }
    }
    if (c.pop !== seen.pop) {
      seen.pop = c.pop;
      // A firecracker bursts behind: red paper and gold sparks
      const pilot = this.avatar.group.position;
      at.copy(pilot).addScaledVector(flight.forward, -1.5);
      for (let k = 0; k < Math.round(26 * budget); k++) {
        vel.set(rand(-1, 1), rand(-1, 1), rand(-1, 1)).normalize().multiplyScalar(rand(3, 9)).addScaledVector(flight.velocity, 0.6);
        this.particles.emit(at, vel, k % 3 ? fx(rand(0.3, 0.6), rand(0.12, 0.22), k % 2 ? CRACKER : HONEY, Kind.Shard, 4, 1.5, 1.8) : fx(0.35, 0.3, WHITE, Kind.Star, 0, 2, 2.4));
      }
      this.wave(at, null, 0.4, 3, 0.25, HONEY);
      this.host.sound("pop", 0.9 + Math.random() * 0.25);
      this.host.kick(3);
    }
    if (c.foresight !== seen.foresight) {
      seen.foresight = c.foresight;
      // The jade talisman cracks into light
      const pilot = this.avatar.group.position;
      this.wave(pilot, null, 0.6, 5, 0.6, JADE);
      for (let k = 0; k < Math.round(40 * budget); k++) {
        vel.set(rand(-1, 1), rand(-0.5, 1), rand(-1, 1)).normalize().multiplyScalar(rand(2, 7)).addScaledVector(flight.velocity, 0.7);
        this.particles.emit(pilot, vel, k % 2 ? fx(rand(0.5, 0.9), rand(0.15, 0.3), JADE, Kind.Shard, 3, 1.4, 1.8) : fx(0.7, 0.2, WHITE, Kind.Star, -1, 1.5, 2));
      }
      this.host.sound("foresee");
    }
    if (c.full !== seen.full) {
      seen.full = c.full;
      this.host.sound("full");
    }
    if (c.auto !== seen.auto) {
      seen.auto = c.auto;
      this.host.sound("auto");
    }
    if (c.shatter !== seen.shatter) {
      seen.shatter = c.shatter;
      // The shield shatters: a ring of ice shards thrown off the hit, the shell gone in a flash
      this.shieldT = -1;
      this.bubble.visible = false;
      const pilot = this.avatar.group.position;
      this.wave(items.savePoint, items.saveNormal, 1, 6, 0.6, FROST);
      this.wave(pilot, null, 2.2, 1.6, 0.4, ICE);
      for (let k = 0; k < Math.round(70 * budget); k++) {
        vel.set(rand(-1, 1), rand(-1, 1), rand(-1, 1)).normalize();
        at.copy(pilot).addScaledVector(vel, 2.2);
        vel.multiplyScalar(rand(4, 12)).addScaledVector(items.saveNormal, rand(2, 6)).addScaledVector(flight.velocity, 0.5);
        this.particles.emit(at, vel, k % 3 ? fx(rand(0.7, 1.3), rand(0.25, 0.5), k % 2 ? ICE : FROST, Kind.Shard, 6, 1.2, 1.6) : fx(rand(0.5, 0.9), rand(0.3, 0.5), WHITE, Kind.Star, 2, 1.5, 2.4));
      }
      this.host.sound("shatter");
      this.host.kick(8);
    }
    if (c.use !== seen.use) {
      seen.use = c.use;
      const id = items.used;
      if (!id) return;
      const style = USE_STYLE[id];
      if (style) {
        this.equipment.equip(runItem(id).model);
        this.equipment.use(style);
      }
      this.used(id, flight, budget);
    }
  }

  /** An item was just used */
  private used(id: RunItemId, flight: Flight, budget: number) {
    this.relics.used(id);
    const hand = this.avatar.slots.hand.getWorldPosition(at);
    if (id === "anemoCatcher") {
      this.columnT = 0;
      // The cork pops and the wind rushes out of the bottle
      for (let k = 0; k < Math.round(30 * budget); k++) {
        vel.set(rand(-1, 1), rand(0.5, 2), rand(-1, 1)).normalize().multiplyScalar(rand(3, 9)).addScaledVector(flight.velocity, 0.8);
        this.particles.emit(hand, vel, k % 3 ? fx(rand(0.5, 0.9), rand(0.4, 0.8), ANEMO, Kind.Wisp, -2, 2, 0.6) : fx(rand(0.6, 1), rand(0.2, 0.35), WHITE, Kind.Star, -1, 1.5, 2.2));
      }
      this.host.sound("uncork");
      this.host.kick(4);
    } else if (id === "starflakeShield") {
      this.shieldT = 0;
    } else if (id === "cometFirework") {
      // Burns in the charm's rocket if one is already strapped on
      if (this.equipment.wearing("back") !== "firework") this.equipment.equip("firework", true);
      this.ownFirework = true;
      this.host.sound("uncork");
      this.host.kick(9);
    } else if (id === "gliderWax") {
      this.waxShown = 0;
      for (const trail of this.waxTrails) trail.reset();
      this.host.sound("wax");
    }
  }

  // --- the charm ---------------------------------------------------------------------------

  /** The charm's moments: the rocket strapped on (and lit by the flame logic) or taken off, food eaten */
  private charmLooks(charm: Charm | null, budget: number) {
    if (!charm) return;
    const seen = this.charmCue;
    if (charm.cue.rocketOn !== seen.rocketOn) {
      seen.rocketOn = charm.cue.rocketOn;
      // The full pull-out: in the hand, over the shoulder, strapped on; the fuse hisses meanwhile
      if (this.equipment.wearing("back") !== "firework") this.equipment.equip("firework");
      this.charmRocket = true;
      this.host.sound("fuse");
    }
    if (charm.cue.rocketOff !== seen.rocketOff) {
      seen.rocketOff = charm.cue.rocketOff;
      if (this.charmRocket && !this.ownFirework) this.equipment.unequip("back");
      this.charmRocket = false;
      this.host.sound("douse");
    }
    if (charm.cue.eat !== seen.eat) {
      seen.eat = charm.cue.eat;
      if (charm.id) {
        this.equipment.equip(charm.id as ItemId);
        this.equipment.use("eat");
      }
      this.host.sound("eat");
      const hand = this.avatar.slots.hand.getWorldPosition(at);
      for (let k = 0; k < Math.round(16 * budget); k++) {
        vel.set(rand(-1.5, 1.5), rand(0.5, 2.5), rand(-1.5, 1.5));
        this.particles.emit(hand, vel, fx(rand(0.5, 0.9), rand(0.1, 0.2), k % 2 ? HONEY : WHITE, Kind.Star, -0.5, 1.5, 1.6));
      }
    }
  }

  // --- Anemo Catcher ---------------------------------------------------------------------

  private anemoCatcher(dt: number, items: Items, budget: number) {
    this.column.visible = this.columnT >= 0;
    if (this.columnT < 0) return;
    this.columnT += dt;
    const t = this.columnT;
    const on = items.time("anemoCatcher") >= 0;
    if (!on && t > 0.3 && this.column.material.uniforms.opacity.value < 0.01) {
      this.columnT = -1;
      this.column.visible = false;
      return;
    }
    // A column of wind under the pilot, rushing up past them; it follows them up, then thins away
    const pilot = this.avatar.group.position;
    this.column.position.copy(pilot).addScaledVector(UP, -18);
    lookAlong(this.column.quaternion, UP);
    this.column.scale.set(1.1, 1.1, 26);
    const u = this.column.material.uniforms;
    u.reach.value = smoothstep(0, 0.3, t);
    u.opacity.value = ease(u.opacity.value, on ? 0.55 * ITEMS_FX.wind : 0, on ? 10 : 4, dt);
    if (!on) return;
    // Wisps and leaves streaming up round the pilot
    this.riseDebt += 70 * budget * dt * ITEMS_FX.wind;
    for (; this.riseDebt >= 1; this.riseDebt--) {
      const angle = rand(0, TAU);
      const r = rand(1.2, 2.4);
      at.copy(pilot).add(tmp.set(Math.cos(angle) * r, rand(-6, -1), Math.sin(angle) * r));
      vel.set(-Math.sin(angle) * 5, rand(24, 38), Math.cos(angle) * 5);
      this.particles.emit(at, vel, Math.random() < 0.7 ? fx(rand(0.4, 0.7), rand(0.5, 0.9), ANEMO, Kind.Wisp, 0, 2, 0.45) : fx(rand(0.8, 1.2), rand(0.3, 0.45), LEAF, Kind.Shard, 0, 1.5, 1.2));
    }
  }

  // --- Starflake Shield -------------------------------------------------------------------

  private starflake(dt: number, items: Items, budget: number) {
    const left = items.time("starflakeShield");
    if (left < 0 && this.shieldT >= 0 && this.shieldT > 1) {
      // It ran out: the ice melts away in a glitter
      this.shieldT = -1;
      const pilot = this.avatar.group.position;
      for (let k = 0; k < Math.round(30 * budget); k++) {
        vel.set(rand(-1, 1), rand(-1, 1), rand(-1, 1)).normalize();
        this.particles.emit(at.copy(pilot).addScaledVector(vel, 2.2), vel.multiplyScalar(rand(0.5, 2)), fx(rand(0.8, 1.4), rand(0.2, 0.35), FROST, Kind.Star, -0.5, 1, 2));
      }
    }
    if (this.shieldT < 0 || left < 0) {
      this.bubble.visible = false;
      return;
    }
    this.shieldT += dt;
    const t = this.shieldT;
    // The crystal bursts at the top of the raise (0.45 s), and the bubble swells out of it
    const grow = smoothstep(0.42, 0.85, t);
    if (t >= 0.45 && t - dt < 0.45) {
      this.host.sound("shield");
      this.wave(this.avatar.slots.hand.getWorldPosition(at), null, 0.4, 5, 0.5, FROST);
    }
    this.bubble.visible = grow > 0;
    if (!this.bubble.visible) return;
    const pilot = this.avatar.group.position;
    this.bubble.position.copy(pilot);
    this.bubble.quaternion.copy(this.avatar.group.quaternion);
    this.bubble.rotateY(t * 0.4);
    this.bubble.scale.setScalar(2.3 * (0.6 + 0.4 * grow) * (1 + 0.025 * Math.sin(t * 5)));
    // In its last seconds it flickers, thinning
    const ending = clamp((3 - this.shieldLeft(items)) / 3, 0, 1);
    const flicker = 1 - ending * (0.5 + 0.5 * Math.sin(t * 22));
    this.bubble.material.uniforms.opacity.value = grow * flicker * ITEMS_FX.shield;
    // Frost glittering on its seams
    this.frostDebt += 14 * budget * dt * ITEMS_FX.shield;
    for (; this.frostDebt >= 1; this.frostDebt--) {
      vel.set(rand(-1, 1), rand(-1, 1), rand(-1, 1)).normalize();
      this.particles.emit(at.copy(pilot).addScaledVector(vel, 2.3), vel.set(0, 0, 0), fx(rand(0.4, 0.8), rand(0.15, 0.3), FROST, Kind.Star, 0, 0, 2.2));
    }
  }

  // --- Luminescent Glider Wax -----------------------------------------------------------------

  private gliderWax(dt: number, items: Items, flight: Flight, budget: number) {
    const t = items.time("gliderWax");
    const on = t >= 0.35;
    // The wax spreads over the wings in a flash of gold as the tin bursts
    if (on && t - dt < 0.35) {
      this.avatar.wingPoints(wingPoints);
      for (let k = 0; k < Math.round(40 * budget); k++) {
        at.copy(wingPoints[k % 10]).applyMatrix4(this.avatar.group.matrixWorld);
        vel.set(rand(-1, 1), rand(-1, 1), rand(-1, 1)).multiplyScalar(2).addScaledVector(flight.velocity, 0.7);
        this.particles.emit(at, vel, fx(rand(0.5, 0.9), rand(0.25, 0.45), k % 2 ? HONEY : WHITE, Kind.Star, 0, 2, 2.4));
      }
    }
    const left = ITEM.waxTime - t;
    this.waxShown = ease(this.waxShown, on ? (left < 1.5 ? 0.4 + 0.4 * Math.sin(t * 18) : 1) : 0, 6, dt);
    this.avatar.wingtips(tipL, tipR);
    this.avatar.span(span);
    this.waxTrails[0].push(tipL, span, 1);
    this.waxTrails[1].push(tipR, span, 1);
    for (const trail of this.waxTrails) trail.opacity = this.waxShown * 0.9 * ITEMS_FX.wax;
    if (this.waxShown < 0.05) return;
    // Glitter shed off the wings, more the faster you go
    this.glitterDebt += (12 + flight.speed * 0.5) * this.waxShown * budget * dt * ITEMS_FX.wax;
    if (this.glitterDebt < 1) return;
    this.avatar.wingPoints(wingPoints);
    for (; this.glitterDebt >= 1; this.glitterDebt--) {
      const a = wingPoints[Math.floor(rand(0, 10))];
      const b = wingPoints[Math.floor(rand(0, 10))];
      at.lerpVectors(a, b, Math.random()).applyMatrix4(this.avatar.group.matrixWorld);
      vel.copy(flight.velocity).multiplyScalar(0.2).add(tmp.set(rand(-0.5, 0.5), rand(-0.5, 0.5), rand(-0.5, 0.5)));
      this.particles.emit(at, vel, fx(rand(0.5, 1), rand(0.12, 0.24), Math.random() < 0.7 ? HONEY : WHITE, Kind.Star, 0.5, 1, 2.2));
    }
  }

  private shieldLeft(items: Items): number {
    return ITEM.shieldTime - items.time("starflakeShield");
  }

  // --- rings of light ------------------------------------------------------------------------

  private wave(center: THREE.Vector3, normal: THREE.Vector3 | null, radius: number, grow: number, life: number, tint: THREE.Color) {
    let wave = this.waves.find((w) => w.t >= w.life);
    if (!wave) {
      if (this.waves.length >= 12) return;
      wave = { t: 0, life, center: new THREE.Vector3(), normal: null, radius, grow, tint: new THREE.Color() };
      this.waves.push(wave);
    }
    wave.t = 0;
    wave.life = life;
    wave.center.copy(center);
    wave.normal = normal ? (wave.normal ?? new THREE.Vector3()).copy(normal) : null;
    wave.radius = radius;
    wave.grow = grow;
    wave.tint.copy(tint);
  }

  private updateWaves(dt: number) {
    for (const w of this.waves) {
      if (w.t >= w.life) continue;
      w.t += dt;
      const k = clamp(w.t / w.life, 0, 1);
      const out = 1 - (1 - k) * (1 - k) * (1 - k);
      this.rings.add(w.center, w.normal, w.radius * (1 + w.grow * out), Math.pow(1 - k, 1.5), 0.03 + 0.05 * k, 3, w.tint);
    }
  }

  dispose() {
    this.pickups.dispose();
    this.relics.dispose();
    this.group.removeFromParent();
    for (const d of this.disposables) d.dispose();
  }
}
