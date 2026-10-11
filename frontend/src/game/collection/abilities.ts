import type { RunItemId } from "../run/items";
import type { Rarity } from "./rarity";

// What collecting gives you beyond looks. Every pet and every cosmetic of
// rare rarity or better carries a passive power while equipped, and every
// keepsake (the collection's items) has a power when carried as the charm.
// Powers work in adventures only: races, time trials and ghosts always fly
// the plain model (CLAUDE.md rule 6). Rarer things are stronger.
//
// This file is data: the run turns `stats` into flight changes and scoring
// (run/perks.ts, run/charm.ts), the looks read `fx` (collection/fx.ts) and the
// sounds `voice` (collection/sounds.ts), the inventory shows `description`.

/** Passive adventure modifiers. Multipliers default to 1, additions to 0 */
export interface PerkStats {
  drag: number; // × drag (lower: faster top speed)
  sink: number; // × sink (lower: floatier glide)
  turn: number; // × steering
  climb: number; // × gravity's pull while climbing (lower: climbs keep their speed)
  boostAccel: number; // + share of boost acceleration
  orbs: number; // × the boost a stamina orb restores (adventures have no natural recharge)
  proximity: number; // × the speed gained skimming the land
  magnet: number; // + metres a gate or portal counts from
  pickupRadius: number; // + metres items, crystals and treasures are collected from
  gatePoints: number; // × gate points
  gateBonus: number; // + points per gate
  styleCap: number; // + levels on the style multiplier
  styleRate: number; // × style points
  nightStyle: number; // × style points under a night sky
  lives: number; // + golden feathers per adventure
  gateRefill: number; // + boost reserve per gate
  gateStamina: number; // + wingbeats per gate
  dodgeCooldown: number; // × time between dodges
  dodgeDistance: number; // + metres per dodge
  dodgeBurst: number; // + m/s on every dodge
  revives: number; // crashes undone per level
  shields: number; // glancing hits shrugged off per level
}

export function plainPerks(): PerkStats {
  return {
    drag: 1, sink: 1, turn: 1, climb: 1, boostAccel: 0, orbs: 1, proximity: 1, magnet: 0, pickupRadius: 0,
    gatePoints: 1, gateBonus: 0, styleCap: 0, styleRate: 1, nightStyle: 1, lives: 0, gateRefill: 0, gateStamina: 0,
    dodgeCooldown: 1, dodgeDistance: 0, dodgeBurst: 0, revives: 0, shields: 0,
  };
}

const MULTIPLIED: (keyof PerkStats)[] = ["drag", "sink", "turn", "climb", "orbs", "proximity", "gatePoints", "styleRate", "nightStyle", "dodgeCooldown"];

/** Adds `stats` into `into` (multipliers multiply, the rest add) */
export function combine(into: PerkStats, stats: Partial<PerkStats>): PerkStats {
  for (const [key, value] of Object.entries(stats) as [keyof PerkStats, number][]) {
    if (MULTIPLIED.includes(key)) into[key] *= value;
    else into[key] += value;
  }
  return into;
}

/** A synthesized signature sound (collection/sounds.ts) */
export type Voice =
  | "chirp" | "hoot" | "crane" | "phoenix" | "dragon" | "kirin" | "yip" | "screech"
  | "shimmer" | "gild" | "ember" | "feather" | "stars" | "frost" | "spark" | "glass" | "zap" | "celestial"
  | "crunch" | "fizz" | "fuse" | "choir" | "relic";

/** Particles an equipped thing sheds in flight (collection/fx.ts): where from, and how they look */
export interface Shed {
  from: "hem" | "head" | "feet" | "wings";
  color: string;
  /** particles.ts Kind: 0 glow, 1 star, 2 shard, 3 wisp, 4 firefly */
  kind: number;
  rate: number; // per second, at full particle budget
  size: number; // metres
  life: number; // seconds
  gravity: number;
}

/** What using a keepsake as the charm does */
export type CharmUse =
  /** A run item's own effect, once per level (with that item's charges) */
  | { kind: "relic"; item: RunItemId }
  /** Strap the giant firework on and light it: a lasting push until it is taken off again */
  | { kind: "rocket" }
  /** Eaten once per level */
  | { kind: "food"; effect: "boost" | "lift" | "trickle" | "burst" | "points" | "turn" | "endless" | "style"; amount: number; seconds: number }
  /** Works by itself, all adventure */
  | { kind: "passive" };

export interface Power {
  /** The catalog key: "pet:fox", "cape:aurora", "item:apple" */
  key: string;
  name: string;
  description: string;
  stats?: Partial<PerkStats>;
  charm?: CharmUse;
  voice: Voice;
  /** Particles shed in flight while equipped (pets have their own trails in pets/models.ts) */
  shed?: Shed;
}

const P = (power: Power) => power;

export const POWERS: readonly Power[] = [
  // --- pets: every companion helps a little, the rarest a lot ---------------------------------------
  P({ key: "pet:swallow", name: "Tailwind", description: "The swallow rides your slipstream and lends you its own: 5% less drag.", stats: { drag: 0.95 }, voice: "chirp" }),
  P({ key: "pet:owl", name: "Night watch", description: "The owl spots every near miss: style points +10%, and +30% under a night sky.", stats: { styleRate: 1.1, nightStyle: 1.3 / 1.1 }, voice: "hoot" }),
  P({ key: "pet:crane", name: "Graceful glide", description: "Glide like the crane: 15% less sink, so you hold your height longer.", stats: { sink: 0.85 }, voice: "crane" }),
  P({ key: "pet:fox", name: "Foxfire fetch", description: "The fox darts out for loot: items, crystals and treasures are collected from 4 m further away.", stats: { pickupRadius: 4 }, voice: "yip" }),
  P({ key: "pet:griffin", name: "Sun's might", description: "The griffin's roar fills your wings: boost accelerates 20% harder.", stats: { boostAccel: 0.2 }, voice: "screech" }),
  P({ key: "pet:phoenix", name: "Rekindle", description: "Once per level the phoenix undoes a crash: you rise from the flames back over the line, briefly untouchable.", stats: { revives: 1 }, voice: "phoenix" }),
  P({ key: "pet:dragon", name: "Cloud rider", description: "Every gate the dragon passes with you refills 20% of your boost and a wingbeat.", stats: { gateRefill: 0.2, gateStamina: 1 }, voice: "dragon" }),
  P({ key: "pet:kirin", name: "Lucky star", description: "The kirin's blessing: gates score 50% more, and you start every adventure with one extra golden feather.", stats: { gatePoints: 1.5, lives: 1 }, voice: "kirin" }),

  // --- cosmetics, rare and legendary ---------------------------------------------------------------
  P({ key: "cape:aurora", name: "Starlit drift", description: "Starlight woven into the hem keeps you aloft: 12% less sink.", stats: { sink: 0.88 }, voice: "stars",
    shed: { from: "hem", color: "#cfe6ff", kind: 1, rate: 14, size: 0.12, life: 1.1, gravity: -0.2 } }),
  P({ key: "cape:royal", name: "Regal bearing", description: "Fly like royalty: the style multiplier climbs one level higher, and every gate is worth 25 more points.", stats: { styleCap: 1, gateBonus: 25 }, voice: "gild",
    shed: { from: "hem", color: "#ffe39a", kind: 2, rate: 10, size: 0.09, life: 0.9, gravity: 0.6 } }),
  P({ key: "cape:ember", name: "Molten wake", description: "The phoenix mantle burns behind you: boost accelerates 20% harder and stamina orbs restore 60% more.", stats: { boostAccel: 0.2, orbs: 1.6 }, voice: "ember",
    shed: { from: "hem", color: "#ff9a52", kind: 0, rate: 22, size: 0.11, life: 0.8, gravity: -0.9 } }),
  P({ key: "hat:wingedHelm", name: "Hermes' step", description: "Little wings at your temples: dodges come back 35% sooner and carry you 2 m further.", stats: { dodgeCooldown: 0.65, dodgeDistance: 2 }, voice: "feather",
    shed: { from: "head", color: "#fff1c4", kind: 3, rate: 6, size: 0.18, life: 0.6, gravity: 0 } }),
  P({ key: "hat:starwitch", name: "Star sight", description: "The stargazer's eye catches every glint: style points +15% and treasures are collected from 2 m further.", stats: { styleRate: 1.15, pickupRadius: 2 }, voice: "stars",
    shed: { from: "head", color: "#d8c8ff", kind: 1, rate: 8, size: 0.1, life: 1.2, gravity: -0.3 } }),
  P({ key: "shoes:frost", name: "Frost skate", description: "Once per level a glancing hit freezes into an ice ramp and you skate off it instead of crashing.", stats: { shields: 1 }, voice: "frost",
    shed: { from: "feet", color: "#d7f3ff", kind: 2, rate: 10, size: 0.08, life: 0.9, gravity: 0.8 } }),
  P({ key: "shoes:ember", name: "Ember kick", description: "Every dodge kicks off a burst of flame: +6 m/s.", stats: { dodgeBurst: 6 }, voice: "spark",
    shed: { from: "feet", color: "#ffb36b", kind: 0, rate: 12, size: 0.08, life: 0.6, gravity: -0.6 } }),
  P({ key: "wings:frost", name: "Crystal glide", description: "Wings of ice slice the air: 7% less drag.", stats: { drag: 0.93 }, voice: "glass" }),
  P({ key: "wings:ember", name: "Sunrise lift", description: "Flame feathers rise on their own heat: climbs keep their speed 10% longer.", stats: { climb: 1 / 1.1 }, voice: "ember" }),
  P({ key: "wings:storm", name: "Static charge", description: "Lightning in the feathers: skimming the land pushes you 35% harder.", stats: { proximity: 1.35 }, voice: "zap" }),
  P({ key: "wings:astral", name: "Constellation", description: "Stars bend to your course: gates count from 3 m further away and each one refills 15% boost.", stats: { magnet: 3, gateRefill: 0.15 }, voice: "celestial" }),

  // --- keepsakes, carried as the charm ---------------------------------------------------------------
  P({ key: "item:firework", name: "Rocket strap", description: "Press the charm key to pull the giant firework out, swing it onto your back and light it: a lasting push of speed (fading out near 380 km/h) until you press the key again to take it off. Steering is a little stiffer while it burns.", charm: { kind: "rocket" }, voice: "fuse" }),
  P({ key: "item:goldenFeather", name: "Winged light", description: "A golden feather of Sky's winged light: start every adventure with one extra life.", stats: { lives: 1 }, charm: { kind: "passive" }, voice: "choir" }),
  P({ key: "item:aviatorCap", name: "Aviator goggles", description: "Clear eyes for the glow: stamina orbs restore 25% more boost.", stats: { orbs: 1.25 }, charm: { kind: "passive" }, voice: "feather" }),
  P({ key: "item:wingedHelm", name: "Gate sense", description: "The helm hums near gates: they count from 3 m further away.", stats: { magnet: 3 }, charm: { kind: "passive" }, voice: "gild" }),
  P({ key: "item:candyWrapped", name: "Sugar rush", description: "Eat once per level: the next three gates are worth 60 more points each.", charm: { kind: "food", effect: "points", amount: 60, seconds: 3 }, voice: "crunch" }),
  P({ key: "item:lollipop", name: "Swirl spin", description: "Eat once per level: five seconds of 35% sharper steering.", charm: { kind: "food", effect: "turn", amount: 1.35, seconds: 5 }, voice: "crunch" }),
  P({ key: "item:apple", name: "Crisp bite", description: "Eat once per level: half your boost reserve comes back at once.", charm: { kind: "food", effect: "boost", amount: 0.5, seconds: 0 }, voice: "crunch" }),
  P({ key: "item:peach", name: "Soft lift", description: "Eat once per level: a warm updraft lifts you for three seconds.", charm: { kind: "food", effect: "lift", amount: 9, seconds: 3 }, voice: "crunch" }),
  P({ key: "item:grapes", name: "Sweet cluster", description: "Eat once per level: 45% of your boost reserve trickles back over six seconds.", charm: { kind: "food", effect: "trickle", amount: 0.45, seconds: 6 }, voice: "crunch" }),
  P({ key: "item:cherries", name: "Twin pop", description: "Eat once per level: two quick bursts of speed, +7 m/s each, a second apart.", charm: { kind: "food", effect: "burst", amount: 7, seconds: 1 }, voice: "crunch" }),
  P({ key: "item:starCandy", name: "Star burst", description: "Eat once per level: a full boost reserve that doesn't drain for four seconds.", charm: { kind: "food", effect: "endless", amount: 1, seconds: 4 }, voice: "fizz" }),
  P({ key: "item:starfruit", name: "Starfruit glow", description: "Eat once per level: eight seconds of double style points.", charm: { kind: "food", effect: "style", amount: 2, seconds: 8 }, voice: "fizz" }),
  ...([
    ["anemoCatcher", "Bottled wind"], ["echoConch", "Sonar song"], ["sunNectar", "Golden sip"], ["gliderWax", "Sunlit wax"],
    ["spiritLantern", "Ghost light"], ["silkRibbon", "Silk turns"], ["vortexGeode", "Little vortex"], ["stormKite", "High wind"],
    ["resonantChimes", "Ringing gates"], ["crystalUpdraft", "Wind trampoline"], ["starflakeShield", "Ice aura"],
    ["aeroBoots", "Air steps"], ["glacialPrism", "Frozen moment"], ["windTether", "Spirit hook"], ["electroPrism", "Chain lightning"],
    ["dragonTear", "Dragon dive"], ["phoenixFeather", "Phoenix rebirth"], ["mothCape", "Moth phase"], ["duskHourglass", "Slow dusk"],
  ] as [RunItemId, string][]).map(([item, name]) => P({
    key: `item:${item}`, name,
    description: item === "phoenixFeather"
      ? "Carried as the charm, it revives you from one crash per level, like the feather found on the islands."
      : "Carried as the charm, you can use its adventure effect once per level with the charm key, like the one found on the islands.",
    charm: { kind: "relic", item }, voice: "relic",
  })),
];

const BY_KEY = new Map(POWERS.map((power) => [power.key, power]));

/** The power of a collectible, if it has one (common and uncommon cosmetics are looks only) */
export function powerOf(key: string): Power | null {
  return BY_KEY.get(key) ?? null;
}

/** What's equipped: the looks and the charm, as the profile stores them */
export interface Equipped {
  cape: string;
  hat: string;
  shoes: string;
  wings: string;
  pet: string;
  charm?: string;
}

/** The keys of everything equipped that can carry a power */
export function equippedKeys(equipped: Equipped): string[] {
  const keys = [`cape:${equipped.cape}`, `hat:${equipped.hat}`, `shoes:${equipped.shoes}`, `wings:${equipped.wings}`];
  if (equipped.pet && equipped.pet !== "none") keys.push(`pet:${equipped.pet}`);
  if (equipped.charm && equipped.charm !== "none") keys.push(`item:${equipped.charm}`);
  return keys;
}

/** Everything equipped, added up: the run's passive powers */
export function perksFor(equipped: Equipped): PerkStats {
  const perks = plainPerks();
  for (const key of equippedKeys(equipped)) {
    const power = powerOf(key);
    if (power?.stats) combine(perks, power.stats);
  }
  return perks;
}

/** The charm keepsake's use, if a keepsake is equipped */
export function charmOf(equipped: Equipped): { id: string; use: CharmUse; power: Power } | null {
  if (!equipped.charm || equipped.charm === "none") return null;
  const power = powerOf(`item:${equipped.charm}`);
  return power?.charm ? { id: equipped.charm, use: power.charm, power } : null;
}

/** Whether a collectible's power depends on rarity: shown in the inventory as "Rare power", etc. */
export const POWER_RARITIES: readonly Rarity[] = ["rare", "legendary"];
