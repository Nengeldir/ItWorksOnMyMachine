import type { Flight, FlightInput, FlightMods } from "../flight";
import type { ItemId } from "../items/models";
import { smoothstep } from "../math";
import type { Course } from "../world/course";

// The design list's items (CLAUDE.md, "Items and abilities"), for runs only:
// things you find on the islands and carry in a bag of three. Using one
// (Y, or the right mouse button) starts its effect; the run controller hands
// this the flight state every physics step and it answers with FlightMods,
// points and saves, like the abilities do. What items look like is in
// items/fx.ts, which only reads this.

/** Item physics and scoring. Shown in ?tune as "Run items", not saved (like FLIGHT) */
export const ITEM = {
  bag: 3, // items carried at once
  // Anemo Catcher: a bottled updraft
  updraftTime: 1.6, // seconds
  updraftLift: 30, // m/s of climb added to the path…
  updraftHover: 0.85, // …while gravity barely pulls back along it
  updraftThrust: 6, // m/s²
};

export type RunItemId = "anemoCatcher";

/** How rare (and how strong) an item is: common, uncommon, rare, legendary */
export type Rarity = 0 | 1 | 2 | 3;
export const RARITIES = [
  { name: "Common", color: "#9be3a5" },
  { name: "Uncommon", color: "#8fc8ff" },
  { name: "Rare", color: "#c9a2ff" },
  { name: "Legendary", color: "#ffd36e" },
] as const;

export interface RunItemInfo {
  id: RunItemId;
  /** Its model (items/models.ts) */
  model: ItemId;
  name: string;
  icon: string;
  rarity: Rarity;
  /** Uses before it's gone */
  charges: number;
  /** Works by itself while carried: never "used" */
  auto?: boolean;
  description: string;
}

export const RUN_ITEMS: readonly RunItemInfo[] = [
  { id: "anemoCatcher", model: "anemoCatcher", name: "Anemo Catcher", icon: "🍶", rarity: 0, charges: 1, description: "Uncork a bottle of wind: an updraft lifts you straight up, for the gate you were about to miss." },
];

export const runItem = (id: RunItemId): RunItemInfo => RUN_ITEMS.find((i) => i.id === id)!;

/** How long each item's effect lasts once used (seconds) */
const DURATION: Record<RunItemId, () => number> = {
  anemoCatcher: () => ITEM.updraftTime,
};

/** Effects that move the pilot: they end on a crash or a respawn */
const FLIGHT_EFFECTS: RunItemId[] = ["anemoCatcher"];

export interface Carried {
  id: RunItemId;
  charges: number;
}

/** What a level gives the items: its seed, the racing line and the solid world */
export interface ItemWorld {
  readonly seed: number;
  readonly course: Course;
  distance(x: number, y: number, z: number): number;
}

/** What the HUD shows of the items */
export interface ItemsHud {
  bag: { id: RunItemId; icon: string; name: string; rarity: Rarity; charges: number; auto: boolean }[];
  selected: number;
  active: { id: RunItemId; icon: string; name: string; charge: number }[];
}

export class Items {
  /** What's carried, oldest first */
  readonly bag: Carried[] = [];
  /** The bag's slot that the use key uses */
  selected = 0;
  /** Seconds since each item's effect began (absent: not under way) */
  readonly active = new Map<RunItemId, number>();
  /** One-off moments, counted so the looks can tell a new one happened */
  readonly cue = { pickup: 0, use: 0, full: 0, auto: 0 };
  /** The item last picked up, and last used */
  picked: RunItemId | null = null;
  used: RunItemId | null = null;
  /** Bonus points earned since the controller last took them */
  points = 0;
  /** Bumped when the level changes, so the looks rebuild what depends on it */
  version = 0;
  /** The level the items are in */
  world: ItemWorld | null = null;

  setLevel(world: ItemWorld) {
    this.world = world;
    this.active.clear();
    this.version++;
  }

  /** The item the use key would use */
  get current(): Carried | null {
    return this.bag[this.selected] ?? null;
  }

  /** Puts an item in the bag; false if the bag is full */
  give(id: RunItemId): boolean {
    if (this.bag.length >= ITEM.bag) {
      this.cue.full++;
      return false;
    }
    this.bag.push({ id, charges: runItem(id).charges });
    if (this.bag.length === 1) this.selected = 0;
    this.picked = id;
    this.cue.pickup++;
    return true;
  }

  /** The next item in the bag becomes the one to use */
  cycle() {
    if (this.bag.length > 1) this.selected = (this.selected + 1) % this.bag.length;
  }

  /** Uses the selected item: its effect starts. Returns what was used, or null */
  use(flight: Flight): RunItemId | null {
    const carried = this.current;
    if (!carried) return null;
    const info = runItem(carried.id);
    if (info.auto) {
      // It works by itself; pressing only reminds you it's there
      this.cue.auto++;
      return null;
    }
    if (!this.start(carried.id, flight)) return null;
    carried.charges--;
    if (carried.charges <= 0) {
      this.bag.splice(this.selected, 1);
      if (this.selected >= this.bag.length) this.selected = 0;
    }
    this.used = carried.id;
    this.cue.use++;
    return carried.id;
  }

  /** Starts an item's effect; false if it can't be used right now */
  private start(id: RunItemId, flight: Flight): boolean {
    void flight;
    this.active.set(id, 0);
    return true;
  }

  /** Seconds into an item's effect, or -1 */
  time(id: RunItemId): number {
    return this.active.get(id) ?? -1;
  }

  /** After a crash or a respawn: whatever was moving the pilot stops */
  reset() {
    for (const id of FLIGHT_EFFECTS) this.active.delete(id);
  }

  /** Per physics step, after the flight moved: the next step's mods */
  step(dt: number, input: FlightInput, proximity: number, flight: Flight, mods: FlightMods) {
    void input;
    void proximity;
    void flight;
    for (const [id, t] of this.active) {
      const next = t + dt;
      if (next > DURATION[id]()) this.active.delete(id);
      else this.active.set(id, next);
    }

    // Anemo Catcher: the bottled updraft lifts the path and holds the speed while it lasts
    const updraft = this.time("anemoCatcher");
    if (updraft >= 0) {
      const k = smoothstep(0, 0.15, updraft) * (1 - smoothstep(ITEM.updraftTime - 0.4, ITEM.updraftTime, updraft));
      mods.lift += ITEM.updraftLift * k;
      mods.hover = Math.max(mods.hover, ITEM.updraftHover * k);
      mods.thrust += ITEM.updraftThrust * k;
    }
  }

  /** The input actually flown this step (some items take the controls a little) */
  steer(input: FlightInput): FlightInput {
    return input;
  }

  hud(): ItemsHud {
    const active: ItemsHud["active"] = [];
    for (const [id, t] of this.active) {
      const info = runItem(id);
      active.push({ id, icon: info.icon, name: info.name, charge: 1 - t / Math.max(0.01, DURATION[id]()) });
    }
    return {
      bag: this.bag.map((c) => {
        const info = runItem(c.id);
        return { id: c.id, icon: info.icon, name: info.name, rarity: info.rarity, charges: c.charges, auto: !!info.auto };
      }),
      selected: this.selected,
      active,
    };
  }
}
