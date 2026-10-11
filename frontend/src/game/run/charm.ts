import type { Flight, FlightMods } from "../flight";
import type { CharmUse, Power } from "../collection/abilities";
import { clamp, smoothstep } from "../math";
import { type Items, runItem } from "./items";

// The charm: one keepsake from the collection carried on every adventure,
// used with its own key (K by default). Run mode only, like the items and
// abilities: it answers each physics step with FlightMods and never touches
// races. Its looks live in items/fx.ts (the rocket, the food) and follow the
// cues counted here.
//  - relic keepsakes: their adventure item's effect, once per level (with
//    that item's charges, e.g. the Aero-Boots' three steps);
//  - food: eaten once per level, a short treat;
//  - the giant firework: strapped on, lit, and pushing until taken off;
//  - passive ones (the golden feather…): their power is in the perks.

/** The giant firework as a charm: a lasting push, tamer than the Comet Tail item */
export const ROCKET = {
  strap: 1.5, // seconds to pull it out and swing it over the shoulder (items/equip.ts)
  fuse: 0.35, // seconds from strapped on to lit
  thrust: 12, // m/s² while it burns…
  top: 105, // …fading out by this speed
  turn: 0.9, // steering while it burns
};

const push = (amount: number, top: number, speed: number) => amount * clamp((top - speed) / 15, 0, 1);

export type RocketState = "off" | "strapping" | "burning";

export class Charm {
  id: string | null = null;
  use: CharmUse | null = null;
  power: Power | null = null;
  /** Uses left in this level (relics and food) */
  left = 0;
  /** Per level: how many uses a level starts with */
  private perLevel = 0;
  rocket: RocketState = "off";
  /** Seconds since the rocket was strapped on */
  rocketTime = 0;
  /** A food effect under way: seconds into it (-1: none) */
  eating = -1;
  /** Sugar rush: gates left that score extra */
  sweetGates = 0;
  private burstLeft = 0;
  private burstWait = 0;
  /** Bumped on each moment the looks and sounds react to */
  readonly cue = { use: 0, eat: 0, rocketOn: 0, rocketOff: 0, empty: 0 };

  /** The keepsake carried (null: none) */
  set(id: string | null, power: Power | null) {
    if (id === this.id) return;
    if (this.rocket !== "off") this.cue.rocketOff++;
    this.id = id;
    this.power = power;
    this.use = power?.charm ?? null;
    this.rocket = "off";
    this.eating = -1;
    const use = this.use;
    this.perLevel = !use ? 0 : use.kind === "relic" ? runItem(use.item).charges : use.kind === "food" ? 1 : 0;
    this.left = this.perLevel;
  }

  /** A new level: relics and food are ready again (the rocket keeps burning) */
  newLevel() {
    this.left = this.perLevel;
    this.eating = -1;
    this.sweetGates = 0;
    this.burstLeft = 0;
  }

  /** After a crash: food treats end; the rocket stays strapped on */
  reset() {
    this.eating = -1;
    this.burstLeft = 0;
  }

  /** Whether pressing the charm key would do something now */
  get ready(): boolean {
    const use = this.use;
    if (!use || use.kind === "passive") return false;
    if (use.kind === "rocket") return true;
    if (use.kind === "relic" && runItem(use.item).auto) return false;
    return this.left > 0;
  }

  /** The charm key. Returns true when something happened */
  press(flight: Flight, items: Items): boolean {
    const use = this.use;
    if (!use) return false;
    if (use.kind === "rocket") {
      if (this.rocket === "off") {
        this.rocket = "strapping";
        this.rocketTime = 0;
        this.cue.rocketOn++;
      } else {
        this.rocket = "off";
        this.cue.rocketOff++;
      }
      return true;
    }
    if (use.kind === "passive" || this.left <= 0) {
      this.cue.empty++;
      return false;
    }
    if (use.kind === "relic") {
      if (!items.activate(use.item, flight)) return false;
      this.left--;
      this.cue.use++;
      return true;
    }
    this.left--;
    this.eating = 0;
    this.cue.eat++;
    if (use.effect === "boost") flight.refillBoost(use.amount);
    else if (use.effect === "endless") flight.refillBoost(1);
    else if (use.effect === "points") this.sweetGates = 3;
    else if (use.effect === "burst") {
      flight.surge(use.amount);
      this.burstLeft = 1;
      this.burstWait = use.seconds;
    }
    return true;
  }

  /** The rocket's flame, 0..1 (only once strapped on and lit) */
  get flame(): number {
    if (this.rocket === "off") return 0;
    return smoothstep(ROCKET.strap + ROCKET.fuse, ROCKET.strap + ROCKET.fuse + 0.3, this.rocketTime);
  }

  /** Extra points for a gate (Sugar rush) */
  gate(): number {
    if (this.sweetGates <= 0 || this.use?.kind !== "food") return 0;
    this.sweetGates--;
    return this.use.amount;
  }

  /** Multiplier on style points right now (Starfruit) */
  get style(): number {
    const use = this.use;
    return use?.kind === "food" && use.effect === "style" && this.eating >= 0 ? use.amount : 1;
  }

  /** Per physics step: the charm's flight changes */
  step(dt: number, flight: Flight, mods: FlightMods) {
    if (this.rocket !== "off") {
      this.rocketTime += dt;
      if (this.rocket === "strapping" && this.rocketTime >= ROCKET.strap + ROCKET.fuse) this.rocket = "burning";
      const flame = this.flame;
      if (flame > 0) {
        mods.thrust += push(ROCKET.thrust * flame, ROCKET.top, flight.speed);
        mods.turn *= 1 - (1 - ROCKET.turn) * flame;
      }
    }
    const use = this.use;
    if (this.eating < 0 || use?.kind !== "food") return;
    this.eating += dt;
    if (this.eating > use.seconds && this.burstLeft <= 0) {
      this.eating = -1;
      return;
    }
    if (use.effect === "lift") {
      const k = smoothstep(0, 0.3, this.eating) * (1 - smoothstep(use.seconds - 0.5, use.seconds, this.eating));
      mods.lift += use.amount * k;
      mods.hover = Math.max(mods.hover, 0.5 * k);
    } else if (use.effect === "turn") mods.turn *= use.amount;
    else if (use.effect === "trickle") flight.refillBoost((use.amount / Math.max(0.1, use.seconds)) * dt);
    else if (use.effect === "endless") flight.refillBoost(1);
    else if (use.effect === "burst" && this.burstLeft > 0 && (this.burstWait -= dt) <= 0) {
      this.burstLeft = 0;
      flight.surge(use.amount);
      this.cue.use++;
    }
  }

  /** What the HUD shows */
  hud(): { id: string; name: string; state: "ready" | "used" | "burning" | "strapping" | "passive"; left: number } | null {
    if (!this.id || !this.power) return null;
    const use = this.use;
    const state = !use || use.kind === "passive" || (use.kind === "relic" && runItem(use.item).auto) ? "passive"
      : use.kind === "rocket" ? (this.rocket === "off" ? "ready" : this.rocket)
      : this.left > 0 ? "ready" : "used";
    return { id: this.id, name: this.power.name, state, left: this.left };
  }
}
