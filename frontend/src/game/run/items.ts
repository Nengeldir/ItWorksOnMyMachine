import * as THREE from "three";
import type { Flight, FlightInput, FlightMods, HitPart } from "../flight";
import type { ItemId } from "../items/models";
import { clamp, smoothstep } from "../math";
import { segmentDistanceSq } from "./segments";
import { placePickups, pickupClear, PICKUP, PICKUP_PREFS, type Pickup } from "./pickups";
import type { Course } from "../world/course";
import { RARITY_ORDER, RARITY_STYLE } from "../collection/rarity";

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
  kiteTime: 5,
  kiteLift: 18,
  prismTime: 5,
  nectarStamina: 9,
  tetherTime: 1.5,
  tetherRange: 110,
  tetherPull: 85,
  phaseTime: 3,
  chimeTime: 12,
  chimeWiden: 5,
  padTime: 15,
  padDepth: 120,
  padRadius: 6,
  padHeight: 8,
  padSpeed: 48,
  hourglassTime: 4,
  worldSlow: 0.25,
  electroTime: 12,
  electroGap: 1.5,
  electroNear: 0.55,
  electroBonus: 120,
  electroRange: 35,
  tearTime: 6,
  tearThrust: 25,
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
  // Wind-Drinking Gourd: the hulu breathes in everything loose around you
  gourdTime: 8, // seconds
  gourdRange: 40, // metres: crystals, orbs, lights and items this close are drawn in
  gourdPull: 34, // m/s they fly towards you
  // Jade Foresight Talisman: a crash about to happen is foreseen, and the wind carries you
  guardTime: 2, // seconds on the safe line (Game's guard)
  guardLook: 0.45, // seconds ahead it looks for rock
  // Oil-Paper Umbrella: a parasol glide
  umbrellaTime: 6,
  umbrellaSink: 0.15, // multiplies the sink
  umbrellaDrag: 1.15, // …and the drag (it catches the air)
  umbrellaTurn: 1.15,
  // Golden Koi Charm: a run of fortune
  koiTime: 15,
  koiGates: 2, // gate points multiplied by this
  koiStyle: 1.5, // style points multiplied by this
  // Paper Crane Guide: the crane flies ahead and the gates it visits open wider
  craneGates: 3,
  craneWiden: 4, // metres
  craneTime: 25, // seconds at most
  // String of Firecrackers: quick pops of speed
  crackerPops: 4,
  crackerGap: 0.45, // seconds between pops
  crackerSurge: 7, // m/s each
};

export type RunItemId = "anemoCatcher" | "starflakeShield" | "gliderWax" | "cometFirework" | "spiritLantern" | "echoConch" | "phoenixFeather" | "silkRibbon" | "vortexGeode" | "aeroBoots" | "stormKite" | "glacialPrism" | "sunNectar" | "windTether" | "mothCape" | "resonantChimes" | "crystalUpdraft" | "duskHourglass" | "electroPrism" | "dragonTear" | "windGourd" | "foresightCharm" | "oilUmbrella" | "koiCharm" | "paperCrane" | "firecrackers";

/** How an item saved the pilot from a hit */
export type ItemSave = "starflake";

/** How rare (and how strong) an item is: common, uncommon, rare, legendary */
export type Rarity = 0 | 1 | 2 | 3;
/** The shared rarity palette (collection/rarity.ts), by index */
export const RARITIES = RARITY_ORDER.map((rarity) => RARITY_STYLE[rarity]);
/** Below this player level an item never turns up on the islands (legendary and the strongest rare ones) */
const MIN_LEVEL_BY_RARITY = [1, 1, 3, 6];

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
  /** The pilot level it starts turning up at (default by rarity) */
  minLevel?: number;
}

export const RUN_ITEMS: readonly RunItemInfo[] = [
  { id: "anemoCatcher", model: "anemoCatcher", name: "Anemo Catcher", icon: "🍶", rarity: 0, charges: 1, description: "Uncork a bottle of wind: an updraft lifts you straight up, for the gate you were about to miss." },
  { id: "starflakeShield", model: "starflakeShield", name: "Starflake Shield", icon: "❄️", rarity: 2, charges: 1, description: "A shimmering, fragile aura of ice: it shatters on the first thing you hit, and you glance off instead of crashing." },
  { id: "gliderWax", model: "gliderWax", name: "Luminescent Glider Wax", icon: "🍯", rarity: 1, charges: 1, description: "Wax your wings with sunlight: for eight seconds there is no drag and no sink. Hold your top speed without losing height." },
  { id: "cometFirework", model: "firework", name: "Comet Tail Firework", icon: "🎆", rarity: 2, charges: 1, description: "A giant rocket strapped to your back: a terrifying, barely steerable burst of speed and a tail of sparks.", minLevel: 4 },
  { id: "spiritLantern", model: "spiritLantern", name: "Spirit Lantern", icon: "🏮", rarity: 1, charges: 1, description: "Light the lantern for 15 seconds to reveal and collect hidden ghost gates worth 500 points." },
  { id: "echoConch", model: "echoConch", name: "Echoing Conch", icon: "🐚", rarity: 0, charges: 1, description: "A sonar song highlights a safe route through the next three gates." },
  { id: "phoenixFeather", model: "phoenixFeather", name: "Feather of the Great Phoenix", icon: "🔥", rarity: 3, charges: 1, auto: true, description: "Carried charm: a crash consumes the feather and revives you in mid-air with two seconds of protection.", minLevel: 8 },
  { id: "silkRibbon", model: "silkRibbon", name: "Cloud-Spun Silk Ribbon", icon: "🎀", rarity: 1, charges: 1, description: "Ten seconds of much tighter turns for threading narrow canyons." },
  { id: "vortexGeode", model: "vortexGeode", name: "Vortex Geode", icon: "💎", rarity: 1, charges: 1, description: "For six seconds, a gentle vortex draws nearby loose light and energy into you." },
  { id: "aeroBoots", model: "aeroBoots", name: "Aero-Boots of the Adepti", icon: "🥾", rarity: 2, charges: 3, description: "Three steps on the air. Each press gives a quick upward correction." },
  { id: "stormKite", model: "stormKite", name: "Stormcaller's Kite", icon: "🪁", rarity: 1, charges: 1, description: "An enchanted kite catches the high wind and tows you upward for five seconds." },
  { id: "glacialPrism", model: "glacialPrism", name: "Glacial Prism", icon: "🧊", rarity: 2, charges: 1, description: "Freeze the adventure level timer and the decay of your skim combo for five seconds." },
  { id: "sunNectar", model: "sunNectar", name: "Sun-Kissed Nectar", icon: "🌼", rarity: 0, charges: 1, description: "Drink golden nectar to refill your boost reserve and wingbeat stamina immediately." },
  { id: "windTether", model: "windTether", name: "Tether of the Wind Spirit", icon: "🪝", rarity: 2, charges: 1, description: "A hook of light pulls you into a sharp swing around a nearby gate. Find an anchor within 110 metres." },
  { id: "mothCape", model: "mothCape", name: "Illusory Moth Cape", icon: "🦋", rarity: 3, charges: 1, description: "Become a spirit for three seconds and pass through rock. Trees, water and the abyss still matter.", minLevel: 8 },
  { id: "resonantChimes", model: "resonantChimes", name: "Resonant Chimes", icon: "🎐", rarity: 1, charges: 1, description: "For twelve seconds, each gate sends a shockwave that widens the next gate." },
  { id: "crystalUpdraft", model: "crystalUpdraft", name: "Crystallized Updraft", icon: "🌪️", rarity: 1, charges: 1, description: "Drop a wind trampoline on the surface below. Dip toward it to bounce high into the sky." },
  { id: "duskHourglass", model: "duskHourglass", name: "Dusk-Weaver's Hourglass", icon: "⌛", rarity: 3, charges: 1, description: "For four seconds, scenery and the spirit manta move at a quarter pace while your flight stays normal.", minLevel: 10 },
  { id: "electroPrism", model: "electroPrism", name: "Electro-Charged Prism", icon: "⚡", rarity: 2, charges: 1, description: "Near misses release chain lightning and score bonus points for twelve seconds.", minLevel: 5 },
  { id: "dragonTear", model: "dragonTear", name: "Tear of the Dragon", icon: "💧", rarity: 2, charges: 1, description: "Hold the use button to dive straight down, for up to six seconds. Release to regain normal flight.", minLevel: 5 },
  { id: "windGourd", model: "windGourd", name: "Wind-Drinking Gourd", icon: "🏺", rarity: 1, charges: 1, description: "Uncork the hulu and it drinks the wind for eight seconds: crystals, stamina orbs, lights and items within 40 metres fly into it." },
  { id: "foresightCharm", model: "foresightCharm", name: "Jade Foresight Talisman", icon: "🧿", rarity: 2, charges: 1, auto: true, description: "Carried, it sees a crash coming before it happens: the wind takes you onto the safe line for two seconds, then the jade cracks.", minLevel: 3 },
  { id: "oilUmbrella", model: "oilUmbrella", name: "Oil-Paper Umbrella", icon: "☂️", rarity: 0, charges: 1, description: "Open it overhead for six seconds of parasol gliding: you barely sink and turn a little tighter, though the air holds you back." },
  { id: "koiCharm", model: "koiCharm", name: "Golden Koi Charm", icon: "🐟", rarity: 1, charges: 1, description: "Fifteen seconds of fortune: gates score double and style points flow half again as fast." },
  { id: "paperCrane", model: "paperCrane", name: "Paper Crane Guide", icon: "✉️", rarity: 0, charges: 1, description: "Release a paper crane. It flies ahead to the next three gates, and each one it visits opens 4 metres wider for you." },
  { id: "firecrackers", model: "firecrackers", name: "String of Firecrackers", icon: "🧨", rarity: 0, charges: 1, description: "Light the string: four pops of speed, each a little kick forward, half a second apart." },
];

export const runItem = (id: RunItemId): RunItemInfo => RUN_ITEMS.find((i) => i.id === id)!;

/** The pilot level an item starts turning up at */
export const itemLevel = (item: RunItemInfo): number => item.minLevel ?? MIN_LEVEL_BY_RARITY[item.rarity];

/** The items a pilot of this level can find (test mode passes Infinity: all of them) */
export const itemsFor = (playerLevel: number): RunItemInfo[] => RUN_ITEMS.filter((item) => itemLevel(item) <= playerLevel);

/** How long each item's effect lasts once used (seconds) */
const DURATION: Record<RunItemId, () => number> = {
  dragonTear: () => ITEM.tearTime,
  electroPrism: () => ITEM.electroTime,
  duskHourglass: () => ITEM.hourglassTime,
  crystalUpdraft: () => ITEM.padTime,
  resonantChimes: () => ITEM.chimeTime,
  mothCape: () => ITEM.phaseTime,
  windTether: () => ITEM.tetherTime,
  sunNectar: () => 0.8,
  glacialPrism: () => ITEM.prismTime,
  stormKite: () => ITEM.kiteTime,
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
  windGourd: () => ITEM.gourdTime,
  foresightCharm: () => ITEM.guardTime,
  oilUmbrella: () => ITEM.umbrellaTime,
  koiCharm: () => ITEM.koiTime,
  paperCrane: () => ITEM.craneTime,
  firecrackers: () => ITEM.crackerPops * ITEM.crackerGap + 0.1,
};

/** Effects that move the pilot: they end on a crash or a respawn */
const FLIGHT_EFFECTS: RunItemId[] = ["anemoCatcher", "cometFirework", "silkRibbon", "aeroBoots", "stormKite", "windTether", "dragonTear", "oilUmbrella", "firecrackers"];

/** A push along the path, fading out as the speed nears its own top speed */
const push = (amount: number, top: number, speed: number) => amount * clamp((top - speed) / 15, 0, 1);

export interface Carried {
  id: RunItemId;
  charges: number;
}

/** What a level gives the items: its seed, the racing line and the solid world */
export interface ItemWorld {
  readonly seed: number;
  readonly rock?: { distance(x: number, y: number, z: number): number };
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
  readonly cue = { pickup: 0, use: 0, full: 0, auto: 0, shatter: 0, phoenix: 0, chime: 0, bounce: 0, lightning: 0, pop: 0, foresight: 0 };
  /** The gates the paper crane visits (their ring indices), and how many pops the firecrackers have left */
  readonly craneGates: number[] = [];
  private pops = 0;
  /** The item last picked up, and last used */
  picked: RunItemId | null = null;
  used: RunItemId | null = null;
  /** Bonus points earned since the controller last took them */
  points = 0;
  /** Wingbeat stamina to hand back to the controller. */
  restore = 0;
  /** Bumped when the level changes, so the looks rebuild what depends on it */
  version = 0;
  /** Where the last save happened, and the surface's normal there */
  readonly savePoint = new THREE.Vector3();
  readonly saveNormal = new THREE.Vector3(0, 1, 0);
  readonly lights: { position: THREE.Vector3; energy: boolean; collected: boolean }[] = [];
  readonly ghostGates: { position: THREE.Vector3; normal: THREE.Vector3; radius: number; collected: boolean }[] = [];
  readonly path: THREE.Vector3[] = [];
  readonly pickups: Pickup[] = [];
  private clearanceTime = 0;
  chimeTarget = -1;
  readonly boltTargets: THREE.Vector3[] = [];
  private electroWait = 0;
  readonly pad = new THREE.Vector3();
  private readonly up = new THREE.Vector3(0,1,0);
  readonly anchor = new THREE.Vector3();
  readonly previous = new THREE.Vector3();
  private sampled = false;
  private readonly crossing = new THREE.Vector3();
  private readonly steered: FlightInput = { pitch: 0, roll: 0 };
  /** The level the items are in */
  world: ItemWorld | null = null;
  /** The pilot's level: items above it never turn up on the islands */
  playerLevel = Infinity;
  /** Metres added to the pickup radius (the fox, the stargazer hat) */
  reach = 0;
  /** The rarity of the item last picked up, for its burst of light */
  pickedRarity: Rarity = 0;

  setLevel(world: ItemWorld) {
    this.world = world;
    this.active.clear();
    this.chimeTarget=-1;
    this.version++;
    this.sampled = false;
    this.ghostGates.length = 0;
    this.lights.length = 0;
    this.pickups.splice(0, this.pickups.length, ...placePickups(world, itemsFor(this.playerLevel)));
    this.clearanceTime = 0;
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
    this.pickedRarity = runItem(id).rarity;
    this.cue.pickup++;
    return true;
  }

  /**
   * The charm's relic (a keepsake carried on adventures): starts that item's effect without
   * taking anything from the bag. The looks and sounds follow as for an item used from the bag
   */
  activate(id: RunItemId, flight: Flight): boolean {
    if (runItem(id).auto || !this.start(id, flight)) return false;
    this.used = id;
    this.cue.use++;
    return true;
  }

  /** Test mode only: the oldest item leaves a full bag, so the next one handed out always fits */
  makeRoom() {
    if (this.bag.length < ITEM.bag) return;
    this.bag.shift();
    this.selected = Math.max(0, this.selected - 1);
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
    if(id === "sunNectar"){ flight.refillBoost(1); this.restore=ITEM.nectarStamina; }
    if(id === "windTether"){
      let found=false, nearest=ITEM.tetherRange**2;
      for(const ring of this.world?.course.rings ?? []){
        const distance=ring.position.distanceToSquared(flight.position);
        if(distance<9 || distance>=nearest)continue;
        let clear=true;
        for(let t=0.1;t<1;t+=0.1){this.crossing.lerpVectors(flight.position,ring.position,t);if(this.world!.distance(this.crossing.x,this.crossing.y,this.crossing.z)<2){clear=false;break;}}
        if(clear){this.anchor.copy(ring.position);nearest=distance;found=true;}
      }
      if(!found)return false;
    }
    if(id === "crystalUpdraft"){
      if(!this.world)return false;
      let found=false;
      for(let down=2;down<ITEM.padDepth;down+=2){
        const y=flight.position.y-down;
        if(this.world.distance(flight.position.x,y,flight.position.z)<=0){
          let low=y,high=y+2;
          for(let j=0;j<8;j++){const middle=(low+high)/2;if(this.world.distance(flight.position.x,middle,flight.position.z)>0) high=middle;else low=middle;}
          this.pad.set(flight.position.x,high+0.2,flight.position.z);found=true;break;
        }
      }
      if(!found)return false;
    }
    if (id === "paperCrane") {
      this.craneGates.length = 0;
      const rings = this.world?.course.rings ?? [];
      for (let i = 0; i < rings.length - 1 && this.craneGates.length < ITEM.craneGates; i++) {
        if (rings[i].position.z > flight.position.z + 5) this.craneGates.push(i);
      }
      if (!this.craneGates.length) return false;
    }
    if (id === "firecrackers") this.pops = 0;
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

  /** Bounce before the next flight step can collide with the surface. */
  beforeFlight(flight: Flight) {
    if(!this.active.has("crystalUpdraft"))return;
    const height=flight.position.y-this.pad.y;
    const horizontal=(flight.position.x-this.pad.x)**2+(flight.position.z-this.pad.z)**2;
    if(height>=0 && height<=ITEM.padHeight && horizontal<=ITEM.padRadius**2 && flight.velocity.y<0){
      flight.place(flight.position,this.up,ITEM.padSpeed,0);
      this.active.delete("crystalUpdraft");this.cue.bounce++;
    }
  }

  /** A gate passed under the chimes widens the following gate. */
  gate(index: number) {
    if(this.active.has("resonantChimes")){this.chimeTarget=index+1;this.cue.chime++;}
    // The crane moves on once you've flown its gate; with none left it settles into your hand
    const crane = this.craneGates.indexOf(index);
    if (crane >= 0) {
      this.craneGates.splice(0, crane + 1);
      if (!this.craneGates.length) this.active.delete("paperCrane");
    }
  }
  widening(index: number): number {
    return (this.active.has("resonantChimes") && index===this.chimeTarget ? ITEM.chimeWiden : 0)
      + (this.active.has("paperCrane") && this.craneGates.includes(index) ? ITEM.craneWiden : 0);
  }

  /** Gate points multiplied by this (the koi) */
  get gateMultiplier(): number { return this.active.has("koiCharm") ? ITEM.koiGates : 1; }

  /** Style points multiplied by this (the koi) */
  get styleMultiplier(): number { return this.active.has("koiCharm") ? ITEM.koiStyle : 1; }

  /** Extra metres crystals and stamina orbs are drawn in from (the gourd) */
  get gourdReach(): number { return this.active.has("windGourd") ? ITEM.gourdRange : 0; }

  /**
   * A crash is foreseen: a talisman in the bag takes it (it cracks, and the wind carries the pilot
   * on the safe line). False if there's none
   */
  foresee(): boolean {
    const index = this.bag.findIndex((c) => c.id === "foresightCharm");
    if (index < 0) return false;
    this.bag.splice(index, 1);
    this.selected = Math.min(this.selected, Math.max(0, this.bag.length - 1));
    this.active.set("foresightCharm", 0);
    return true;
  }

  /** A carried Phoenix feather revives from terrain or the abyss onto the clear course tube. */
  revive(flight: Flight): boolean {
    const index = this.bag.findIndex(c => c.id === "phoenixFeather");
    if (index < 0 || !this.world) return false;
    this.bag.splice(index, 1);
    this.selected = Math.min(this.selected, Math.max(0, this.bag.length - 1));
    return this.rekindle(flight);
  }

  /**
   * The phoenix's revival itself (a carried feather, the charm, or the phoenix pet): back on the
   * clear course tube, briefly untouchable
   */
  rekindle(flight: Flight): boolean {
    if (!this.world) return false;
    const z = clamp(flight.position.z, this.world.course.start.z, this.world.course.endZ - 25);
    const position = this.world.course.pointAt(z);
    flight.reset(position, this.world.course.tangentAt(z), ITEM.phoenixSpeed);
    this.reset();
    this.active.set("phoenixFeather", 0);
    this.cue.phoenix++;
    return true;
  }

  get worldRate(): number { return this.active.has("duskHourglass") ? ITEM.worldSlow : 1; }

  get phasing(): boolean { return this.active.has("mothCape"); }

  get frozenCombo(): boolean { return this.active.has("glacialPrism"); }

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
    this.clearanceTime -= dt;
    const checkClearance = this.clearanceTime <= 0;
    if (checkClearance) this.clearanceTime = 0.5;
    for (const pickup of this.pickups) {
      if (pickup.collected || PICKUP_PREFS.crystalsOnly) continue;
      // Trees arrive with streamed land; recheck nearby air as it arrives.
      if (checkClearance && pickup.position.distanceToSquared(flight.position)<200**2)
        pickup.blocked = !pickupClear(this.world!,pickup.position);
      const touching = !pickup.blocked && (this.sampled ? segmentDistanceSq(pickup.position,this.previous,flight.position) : pickup.position.distanceToSquared(flight.position)) <= (PICKUP.radius + this.reach)**2;
      if (touching && (this.bag.length<ITEM.bag || !pickup.touching)) pickup.collected = this.give(pickup.id);
      pickup.touching = touching;
    }
    this.previous.copy(flight.position); this.sampled = true;
    if(this.active.has("silkRibbon")) mods.turn *= ITEM.ribbonTurn;
    if(this.active.has("aeroBoots")) { mods.lift += ITEM.bootLift; mods.hover = Math.max(mods.hover,0.8); }
    if(this.active.has("stormKite")){ mods.lift+=ITEM.kiteLift; mods.hover=Math.max(mods.hover,0.7); mods.turn*=0.8; }
    if(this.active.has("windTether")) {
      if(flight.position.distanceToSquared(this.anchor)<9) this.active.delete("windTether");
      else flight.pullToward(this.anchor,dt,ITEM.tetherPull);
    }
    this.electroWait=Math.max(0,this.electroWait-dt);
    if(this.active.has("electroPrism") && proximity>ITEM.electroNear && flight.speed>20 && this.electroWait===0){
      this.electroWait=ITEM.electroGap;this.cue.lightning++;this.points+=ITEM.electroBonus;
      this.boltTargets.length=0;
      for(const light of this.lights){
        if(!light.collected && light.position.distanceToSquared(flight.position)<ITEM.electroRange**2 && this.boltTargets.length<3){
          this.boltTargets.push(light.position.clone());light.collected=true;
          if(light.energy)flight.refillBoost(ITEM.lightEnergy);else this.points+=ITEM.lightBonus;
        }
      }
      if(!this.boltTargets.length)this.boltTargets.push(flight.position.clone().add(new THREE.Vector3(0,-Math.max(3,(1-proximity)*12),0)));
    }
    const tear=this.time("dragonTear");
    if(tear>=0){
      if((input.use ?? 0)<=0 && tear>0.05)this.active.delete("dragonTear");
      else { mods.dive=1;mods.diveAngle=Math.PI/2;mods.thrust+=ITEM.tearThrust;mods.turn*=0.6; }
    }
    // ITEM RULES
    // Wind-Drinking Gourd: loose light and items fly into the hulu (crystals and orbs: `gourdReach`)
    if (this.active.has("windGourd")) {
      for (const light of this.lights) {
        if (light.collected || light.position.distanceToSquared(flight.position) > ITEM.gourdRange ** 2) continue;
        light.position.lerp(flight.position, Math.min(1, ITEM.gourdPull * dt / Math.max(1, light.position.distanceTo(flight.position))));
      }
      for (const pickup of this.pickups) {
        if (pickup.collected || pickup.blocked || pickup.position.distanceToSquared(flight.position) > ITEM.gourdRange ** 2 || this.bag.length >= ITEM.bag) continue;
        pickup.position.lerp(flight.position, Math.min(1, ITEM.gourdPull * dt / Math.max(1, pickup.position.distanceTo(flight.position))));
      }
    }
    // Oil-Paper Umbrella: a parasol over your head
    if (this.active.has("oilUmbrella")) {
      mods.sink *= ITEM.umbrellaSink;
      mods.drag *= ITEM.umbrellaDrag;
      mods.turn *= ITEM.umbrellaTurn;
      mods.hover = Math.max(mods.hover, 0.25);
    }
    // String of Firecrackers: a pop every so often
    const crackers = this.time("firecrackers");
    if (crackers >= 0 && this.pops < ITEM.crackerPops && crackers >= this.pops * ITEM.crackerGap + 0.15) {
      this.pops++;
      flight.surge(ITEM.crackerSurge);
      this.cue.pop++;
    }
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
