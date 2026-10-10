import * as THREE from "three";
import type { Flight, FlightInput, FlightMods, HitPart } from "../flight";
import type { ItemId } from "../items/models";
import { clamp, smoothstep } from "../math";
import { segmentDistanceSq } from "./segments";
import type { Course } from "../world/course";

// The design list's items (CLAUDE.md, "Items and abilities"), for runs only:
// things you find on the islands and carry in a bag of three. Using one
// (Y, or the right mouse button) starts its effect; the run controller hands
// this the flight state every physics step and it answers with FlightMods,
// points and saves, like the abilities do. What items look like is in
// items/fx.ts, which only reads this.

/** Item physics and scoring. Shown in ?tune as "Run items", not saved (like FLIGHT) */
export const ITEM = {
  lanternTime: 15,
  ghostBonus: 500,
  conchTime: 8,
  phoenixGrace: 2,
  phoenixSpeed: 36,
  ribbonTime: 10,
  ribbonTurn: 2.1,
  vortexTime: 6,
  vortexRange: 28,
  vortexPull: 22,
  lightBonus: 40,
  lightEnergy: 0.15,
  bootTime: 0.4,
  bootLift: 32,
  bag: 3, // items carried at once
  // Anemo Catcher: a bottled updraft
  updraftTime: 1.6, // seconds
  updraftLift: 30, // m/s of climb added to the path…
  updraftHover: 0.85, // …while gravity barely pulls back along it
  updraftThrust: 6, // m/s²
  // Starflake Shield: an aura that takes one hit of any kind, then shatters
  shieldTime: 30, // seconds it lasts unused
  shieldPush: 1, // metres out of the rock
  shieldKeep: 0.72, // share of the speed kept
  // Luminescent Glider Wax: no drag and no sink for a while
  waxTime: 8, // seconds
  waxDrag: 0, // multiplies the drag…
  waxSink: 0, // …and the sink (0: none at all)
  // Comet Tail Firework: a terrifying, barely steerable burst forward
  fireTime: 3.2, // seconds of burn (after a short fuse)
  fireFuse: 0.35, // seconds from strapping it on to the flame
  fireThrust: 46, // m/s²…
  fireTop: 150, // …fading out by this speed
  fireTurn: 0.35, // multiplies how hard you can steer
  fireWobble: 0.45, // how hard it yanks the controls about
};

export type RunItemId = "anemoCatcher" | "starflakeShield" | "gliderWax" | "cometFirework" | "spiritLantern" | "echoConch" | "phoenixFeather" | "silkRibbon" | "vortexGeode" | "aeroBoots";

/** How an item saved the pilot from a hit */
export type ItemSave = "starflake";

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
  { id: "starflakeShield", model: "starflakeShield", name: "Starflake Shield", icon: "❄️", rarity: 2, charges: 1, description: "A shimmering, fragile aura of ice: it shatters on the first thing you hit, and you glance off instead of crashing." },
  { id: "gliderWax", model: "gliderWax", name: "Luminescent Glider Wax", icon: "🍯", rarity: 1, charges: 1, description: "Wax your wings with sunlight: for eight seconds there is no drag and no sink. Hold your top speed without losing height." },
  { id: "cometFirework", model: "firework", name: "Comet Tail Firework", icon: "🎆", rarity: 2, charges: 1, description: "A giant rocket strapped to your back: a terrifying, barely steerable burst of speed and a tail of sparks." },
  { id: "spiritLantern", model: "spiritLantern", name: "Spirit Lantern", icon: "🏮", rarity: 1, charges: 1, description: "Light the lantern for 15 seconds to reveal and collect hidden ghost gates worth 500 points." },
  { id: "echoConch", model: "echoConch", name: "Echoing Conch", icon: "🐚", rarity: 0, charges: 1, description: "A sonar song highlights a safe route through the next three gates." },
  { id: "phoenixFeather", model: "phoenixFeather", name: "Feather of the Great Phoenix", icon: "🔥", rarity: 3, charges: 1, auto: true, description: "Carried charm: a crash consumes the feather and revives you in mid-air with two seconds of protection." },
  { id: "silkRibbon", model: "silkRibbon", name: "Cloud-Spun Silk Ribbon", icon: "🎀", rarity: 1, charges: 1, description: "Ten seconds of much tighter turns for threading narrow canyons." },
  { id: "vortexGeode", model: "vortexGeode", name: "Vortex Geode", icon: "💎", rarity: 1, charges: 1, description: "For six seconds, a gentle vortex draws nearby loose light and energy into you." },
  { id: "aeroBoots", model: "aeroBoots", name: "Aero-Boots of the Adepti", icon: "🥾", rarity: 2, charges: 3, description: "Three steps on the air. Each press gives a quick upward correction." },
];

export const runItem = (id: RunItemId): RunItemInfo => RUN_ITEMS.find((i) => i.id === id)!;

/** How long each item's effect lasts once used (seconds) */
const DURATION: Record<RunItemId, () => number> = {
  aeroBoots: () => ITEM.bootTime,
  vortexGeode: () => ITEM.vortexTime,
  silkRibbon: () => ITEM.ribbonTime,
  phoenixFeather: () => ITEM.phoenixGrace,
  echoConch: () => ITEM.conchTime,
  spiritLantern: () => ITEM.lanternTime,
  anemoCatcher: () => ITEM.updraftTime,
  starflakeShield: () => ITEM.shieldTime,
  gliderWax: () => ITEM.waxTime,
  cometFirework: () => ITEM.fireFuse + ITEM.fireTime,
};

/** Effects that move the pilot: they end on a crash or a respawn */
const FLIGHT_EFFECTS: RunItemId[] = ["anemoCatcher", "cometFirework", "silkRibbon", "aeroBoots"];

/** A push along the path, fading out as the speed nears its own top speed */
const push = (amount: number, top: number, speed: number) => amount * clamp((top - speed) / 15, 0, 1);

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
  readonly cue = { pickup: 0, use: 0, full: 0, auto: 0, shatter: 0, phoenix: 0 };
  /** The item last picked up, and last used */
  picked: RunItemId | null = null;
  used: RunItemId | null = null;
  /** Bonus points earned since the controller last took them */
  points = 0;
  /** Bumped when the level changes, so the looks rebuild what depends on it */
  version = 0;
  /** Where the last save happened, and the surface's normal there */
  readonly savePoint = new THREE.Vector3();
  readonly saveNormal = new THREE.Vector3(0, 1, 0);
  readonly lights: { position: THREE.Vector3; energy: boolean; collected: boolean }[] = [];
  readonly ghostGates: { position: THREE.Vector3; normal: THREE.Vector3; radius: number; collected: boolean }[] = [];
  readonly path: THREE.Vector3[] = [];
  readonly previous = new THREE.Vector3();
  private sampled = false;
  private readonly crossing = new THREE.Vector3();
  private readonly steered: FlightInput = { pitch: 0, roll: 0 };
  /** The level the items are in */
  world: ItemWorld | null = null;

  setLevel(world: ItemWorld) {
    this.world = world;
    this.active.clear();
    this.version++;
    this.sampled = false;
    this.ghostGates.length = 0;
    this.lights.length = 0;
    for(const ring of world.course.rings) for(let j=0;j<3;j++){
      const position=world.course.pointAt(ring.position.z-30+j*8).add(new THREE.Vector3((j-1)*3,1,0));
      if(world.distance(position.x,position.y,position.z)>3) this.lights.push({position,energy:j===1,collected:false});
    }
    for (let i = 2; i < world.course.rings.length - 1; i += 4) {
      const ring = world.course.rings[i];
      const position = ring.position.clone().add(new THREE.Vector3(i % 2 ? -6 : 6, 2, 0));
      if (world.distance(position.x, position.y, position.z) >= 4)
        this.ghostGates.push({ position, normal: ring.normal.clone(), radius: 3, collected: false });
    }
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
    if (id === "echoConch") {
      this.path.length = 0;
      for (const ring of this.world?.course.rings ?? []) {
        if (ring.position.z > flight.position.z && this.path.length < 3) this.path.push(ring.position.clone());
      }
      if (!this.path.length) return false;
    }
    if(id === "aeroBoots" && this.active.has(id)) return false;
    // ITEM STARTS
    // A shield already up would be wasted
    if (id === "starflakeShield" && this.active.has(id)) return false;
    this.active.set(id, 0);
    return true;
  }

  /** Something touched: can an item save the pilot? The Starflake Shield takes any hit. Null: no */
  save(part: HitPart | null, normal: THREE.Vector3, direction: THREE.Vector3): ItemSave | null {
    void normal;
    void direction;
    if (part !== null && this.active.has("starflakeShield")) return "starflake";
    return null;
  }

  /** The save happened at `at`, off a surface facing `normal` */
  saved(how: ItemSave, at: THREE.Vector3, normal: THREE.Vector3) {
    this.savePoint.copy(at);
    this.saveNormal.copy(normal);
    if (how === "starflake") {
      this.active.delete("starflakeShield");
      this.cue.shatter++;
    }
  }

  /** A carried Phoenix feather revives from terrain or the abyss onto the clear course tube. */
  revive(flight: Flight): boolean {
    const index = this.bag.findIndex(c => c.id === "phoenixFeather");
    if (index < 0 || !this.world) return false;
    this.bag.splice(index, 1);
    this.selected = Math.min(this.selected, Math.max(0, this.bag.length - 1));
    const z = clamp(flight.position.z, this.world.course.start.z, this.world.course.endZ - 25);
    const position = this.world.course.pointAt(z);
    flight.reset(position, this.world.course.tangentAt(z), ITEM.phoenixSpeed);
    this.reset();
    this.active.set("phoenixFeather", 0);
    this.cue.phoenix++;
    return true;
  }

  get invulnerable(): boolean { return this.active.has("phoenixFeather"); }

  /** Seconds into an item's effect, or -1 */
  time(id: RunItemId): number {
    return this.active.get(id) ?? -1;
  }

  /** After a crash or a respawn: whatever was moving the pilot stops */
  reset() {
    this.sampled = false;
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

    if (this.sampled && this.active.has("spiritLantern")) {
      for (const gate of this.ghostGates) {
        if (gate.collected) continue;
        const before = this.crossing.subVectors(this.previous, gate.position).dot(gate.normal);
        const after = this.crossing.subVectors(flight.position, gate.position).dot(gate.normal);
        if (before < 0 && after >= 0 && this.crossing.lerpVectors(this.previous, flight.position, before / (before - after)).distanceTo(gate.position) <= gate.radius) {
          gate.collected = true; this.points += ITEM.ghostBonus;
        }
      }
    }
    for(const light of this.lights){
      if(light.collected) continue;
      if(this.active.has("vortexGeode") && light.position.distanceToSquared(flight.position)<ITEM.vortexRange**2){
        const next = this.crossing.copy(light.position).lerp(flight.position,Math.min(1,ITEM.vortexPull*dt/Math.max(1,light.position.distanceTo(flight.position))));
        if(!this.world || this.world.distance(next.x,next.y,next.z)>2) light.position.copy(next);
      }
      if((this.sampled ? segmentDistanceSq(light.position,this.previous,flight.position) : light.position.distanceToSquared(flight.position))<2.5**2){
        light.collected=true;
        if(light.energy) flight.boostCharge=Math.min(1,flight.boostCharge+ITEM.lightEnergy);
        else this.points+=ITEM.lightBonus;
      }
    }
    this.previous.copy(flight.position); this.sampled = true;
    if(this.active.has("silkRibbon")) mods.turn *= ITEM.ribbonTurn;
    if(this.active.has("aeroBoots")) { mods.lift += ITEM.bootLift; mods.hover = Math.max(mods.hover,0.8); }
    // ITEM RULES
    // Anemo Catcher: the bottled updraft lifts the path and holds the speed while it lasts
    const updraft = this.time("anemoCatcher");
    if (updraft >= 0) {
      const k = smoothstep(0, 0.15, updraft) * (1 - smoothstep(ITEM.updraftTime - 0.4, ITEM.updraftTime, updraft));
      mods.lift += ITEM.updraftLift * k;
      mods.hover = Math.max(mods.hover, ITEM.updraftHover * k);
      mods.thrust += ITEM.updraftThrust * k;
    }

    // Luminescent Glider Wax: the air lets go of the wings (dives still gain speed, climbs still spend it)
    if (this.active.has("gliderWax")) {
      mods.drag *= ITEM.waxDrag;
      mods.sink *= ITEM.waxSink;
    }

    // Comet Tail Firework: after the fuse, a roaring push along the path; steering goes stiff
    const fire = this.burn;
    if (fire > 0) {
      mods.thrust += push(ITEM.fireThrust * fire, ITEM.fireTop, flight.speed);
      mods.turn *= 1 - (1 - ITEM.fireTurn) * fire;
    }
  }

  /** The firework's burn, 0..1 (0 before the fuse has burnt down and after it's spent) */
  get burn(): number {
    const t = this.time("cometFirework") - ITEM.fireFuse;
    if (t < 0) return 0;
    return smoothstep(0, 0.2, t) * (1 - smoothstep(ITEM.fireTime - 0.4, ITEM.fireTime, t));
  }

  /** The input actually flown this step (some items take the controls a little) */
  steer(input: FlightInput): FlightInput {
    const fire = this.burn;
    if (fire <= 0) return input;
    // The firework bucks and yaws under you
    const t = this.time("cometFirework") * 7;
    const wobble = ITEM.fireWobble * fire;
    const out = this.steered;
    out.pitch = clamp(input.pitch + wobble * (Math.sin(t * 1.3) * 0.6 + Math.sin(t * 3.1 + 1) * 0.4), -1, 1);
    out.roll = clamp(input.roll + wobble * (Math.sin(t * 0.9 + 2) * 0.7 + Math.sin(t * 2.3) * 0.3), -1, 1);
    out.boost = input.boost;
    out.brake = input.brake;
    out.use = input.use;
    return out;
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
