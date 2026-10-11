import * as THREE from "three";
import type { Avatar } from "../avatar";
import type { Flight } from "../flight";
import { Kind, type Particles, fx } from "../particles";
import type { RunController } from "../run/controller";
import { type Equipped, type Shed, type Voice, equippedKeys, powerOf } from "./abilities";

// How the collection shows itself in flight, looks and sounds only (CLAUDE.md
// rule 6): rare and legendary capes, hats and shoes shed their own light
// (starlight off the Aurora veil's hem, gilded flakes off the Cloud court,
// embers off the Phoenix mantle, frost off the walkers…), the powers flare
// when they act, and the companion calls out now and then in its own voice.
// Wings shed their particles in pilotfx.ts; pets their trails in pets/.

export interface CollectionFxHost {
  sound(voice: Voice, level?: number): void;
  kick(degrees?: number): void;
}

const at = new THREE.Vector3();
const vel = new THREE.Vector3();
const jitter = new THREE.Vector3();
const FLAME = new THREE.Color("#ffb066");
const EMBER = new THREE.Color("#ff7a3a");
const ICE = new THREE.Color("#d7f3ff");
const WHITE = new THREE.Color("#ffffff");
const JADE = new THREE.Color("#9fe6cf");
const STAR = new THREE.Color("#c4e5ff");
const rand = (min: number, max: number) => min + Math.random() * (max - min);

export class CollectionFx {
  private readonly avatar: Avatar;
  private readonly particles: Particles;
  private readonly host: CollectionFxHost;
  private sheds: { shed: Shed; debt: number; color: THREE.Color }[] = [];
  private pet: Voice | null = null;
  private petTimer = 8;
  private gateVoice: Voice | null = null;
  private readonly seen = { rekindle: 0, frost: 0, kick: 0, gate: 0 };
  private run: RunController | null = null;
  private foot = 0;

  constructor(avatar: Avatar, particles: Particles, host: CollectionFxHost) {
    this.avatar = avatar;
    this.particles = particles;
    this.host = host;
  }

  /** What's worn and carried: which particles to shed and which companion calls */
  setEquipped(equipped: Equipped) {
    this.sheds = [];
    for (const key of equippedKeys(equipped)) {
      const shed = powerOf(key)?.shed;
      if (shed) this.sheds.push({ shed, debt: 0, color: new THREE.Color(shed.color) });
    }
    this.pet = equipped.pet && equipped.pet !== "none" ? powerOf(`pet:${equipped.pet}`)?.voice ?? null : null;
    // Gate refills come from the dragon or the constellation wings: their voice rings at each one
    this.gateVoice = equipped.pet === "dragon" ? "dragon" : equipped.wings === "astral" ? "celestial" : null;
  }

  /** Each frame while flying (`moving`), after the avatar animated; `run`: the adventure, whose powers flare */
  update(dt: number, flight: Flight, run: RunController | null, moving: boolean) {
    if (run !== this.run) {
      this.run = run;
      if (run) Object.assign(this.seen, run.perkCue);
    }
    if (!moving || dt <= 0) return;
    const budget = this.particles.budget;
    for (const entry of this.sheds) {
      const { shed } = entry;
      // Some burn brighter while boosting (the Phoenix mantle)
      const rate = shed.rate * budget * (1 + (shed.boost ?? 0) * this.avatar.boost);
      entry.debt = Math.min(entry.debt + rate * dt, 6);
      for (; entry.debt >= 1; entry.debt--) {
        this.anchor(shed.from);
        at.add(jitter.set(rand(-0.15, 0.15), rand(-0.15, 0.15), rand(-0.15, 0.15)));
        vel.copy(flight.velocity).multiplyScalar(0.1).add(jitter.set(rand(-0.4, 0.4), rand(-0.2, 0.5), rand(-0.4, 0.4)));
        this.particles.emit(at, vel, fx(shed.life * rand(0.7, 1.2), shed.size * rand(0.8, 1.2), entry.color, shed.kind as Kind, shed.gravity, 1.3, 1.3));
      }
    }
    // The companion's call, every so often
    if (this.pet && (this.petTimer -= dt) <= 0) {
      this.petTimer = rand(11, 24);
      this.host.sound(this.pet, 0.5);
    }
    if (run) this.powers(run, flight);
  }

  /** Where a shed comes from, into `at` */
  private anchor(from: Shed["from"]) {
    const avatar = this.avatar;
    if (from === "hem") avatar.capeTip(at);
    else if (from === "head") avatar.slots.head.getWorldPosition(at);
    else if (from === "feet") avatar.feet[(this.foot = 1 - this.foot)].getWorldPosition(at);
    else {
      avatar.wingtips(at, jitter);
      if (Math.random() < 0.5) at.copy(jitter);
    }
  }

  /** A power just acted: its flare of light and its sound */
  private powers(run: RunController, flight: Flight) {
    const cue = run.perkCue;
    const seen = this.seen;
    const budget = this.particles.budget;
    const pilot = this.avatar.group.position;
    if (cue.rekindle !== seen.rekindle) {
      seen.rekindle = cue.rekindle;
      // The phoenix pulls you out of the flames: a pillar of fire and feathers of light
      for (let k = 0; k < Math.round(80 * budget); k++) {
        vel.set(rand(-1, 1), rand(0.2, 1.6), rand(-1, 1)).normalize().multiplyScalar(rand(3, 11));
        this.particles.emit(pilot, vel, k % 3 ? fx(rand(0.7, 1.3), rand(0.3, 0.6), k % 2 ? FLAME : EMBER, Kind.Wisp, -2, 1, 1.6) : fx(rand(0.8, 1.4), rand(0.25, 0.45), WHITE, Kind.Star, -1, 1, 2.2));
      }
      this.host.sound("phoenix");
      this.host.kick(7);
    }
    if (cue.frost !== seen.frost) {
      seen.frost = cue.frost;
      // Frost skate: an ice ramp shatters behind you
      const point = run.items.savePoint;
      const normal = run.items.saveNormal;
      for (let k = 0; k < Math.round(50 * budget); k++) {
        vel.set(rand(-1, 1), rand(-1, 1), rand(-1, 1)).normalize().multiplyScalar(rand(3, 9)).addScaledVector(normal, rand(2, 5));
        this.particles.emit(point, vel, k % 2 ? fx(rand(0.6, 1.1), rand(0.2, 0.4), ICE, Kind.Shard, 6, 1.2, 1.6) : fx(rand(0.5, 0.9), rand(0.2, 0.35), WHITE, Kind.Star, 1, 1.5, 2));
      }
      this.host.sound("frost");
      this.host.kick(5);
    }
    if (cue.kick !== seen.kick) {
      seen.kick = cue.kick;
      // Ember kick: flame bursts from both heels
      for (let k = 0; k < Math.round(28 * budget); k++) {
        this.avatar.feet[k % 2].getWorldPosition(at);
        vel.copy(flight.velocity).multiplyScalar(-0.15).add(jitter.set(rand(-2, 2), rand(-1, 2), rand(-2, 2)));
        this.particles.emit(at, vel, fx(rand(0.4, 0.7), rand(0.15, 0.3), k % 3 ? EMBER : FLAME, Kind.Glow, -1, 2, 1.8));
      }
      this.host.sound("spark", 0.8);
    }
    if (cue.gate !== seen.gate) {
      seen.gate = cue.gate;
      // The dragon or the constellation wings refill the boost: a spiral of glints
      const tint = this.gateVoice === "dragon" ? JADE : STAR;
      for (let k = 0; k < Math.round(24 * budget); k++) {
        const a = (k / 24) * Math.PI * 4;
        at.copy(pilot).add(vel.set(Math.cos(a) * 1.4, (k / 24) * 2 - 1, Math.sin(a) * 1.4));
        this.particles.emit(at, vel.set(-Math.sin(a) * 2, 1.2, Math.cos(a) * 2), fx(0.8, 0.18, tint, Kind.Star, -0.5, 1.5, 1.8));
      }
      if (this.gateVoice) this.host.sound(this.gateVoice, 0.4);
    }
  }
}
