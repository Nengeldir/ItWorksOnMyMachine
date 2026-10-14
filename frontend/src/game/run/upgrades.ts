import { makeRng } from "../rng";

// Upgrades a roguelike run offers at every portal, as data. Each adds to a
// set of run stats per stack; the run turns the stats into flight changes
// (FlightMods), abilities and scoring rules. None of this reaches races.

export interface RunStats {
  dash: number; // upgrade level (Shift): stronger held boost
  flap: number; // ability level (C): Sky-style wingbeats with stamina
  glideLock: number; // passive: let go of pitch and the glide holds itself
  drag: number; // multiplier
  sink: number; // multiplier
  stall: number; // multiplier
  proximity: number; // multiplier on the boost from skimming
  magnet: number; // metres added to gate rings and pickups
  multiplier: number; // added to the style multiplier's cap
  gateBonus: number; // points added to every gate
  lives: number; // lives gained (the run adds each one as it's picked)
  // The abilities of the design list (run/abilities.ts has their rules)
  featherfalling: number; // passive: less sink and drag (the multipliers above), a halo of down
  skimBooster: number; // passive: skimming the land refills the boost
  cloudSurf: number; // passive: cloud lanes along the line restore and push you
  plunge: number; // ability (X): a steep dive; a gate in it is a strike
  windShear: number; // ability (Q / E): the dodge becomes an instant blink
  thermalVision: number; // passive: gates, portals, lanes and spirits glow from afar
  slipstream: number; // passive: a spirit manta to draft behind
  galeForce: number; // ability (G): an elemental burst, a wind tunnel ahead
  acrobatic: number; // passive: a clipped wing rolls away instead of crashing
  hoverStall: number; // ability (F): stop, hang and turn, then off again
  moth: number; // passive: a gate passed near its heart sends you out faster
  zenith: number; // passive: climbs keep their speed longer
  resonance: number; // ability (T): a song that turns the gates ahead to face you
  leyLine: number; // passive: five gates in quick succession, then endless boost until the chain breaks
  aeroBrake: number; // ability (brake): a hard flare of cape and wings, and much tighter turns for a moment
  draftWeave: number; // passive: tight spirals spin up a little tornado that shields one glancing hit
  ascension: number; // ability (G): all of the speed, turned straight up
  falcon: number; // stance (H): wings tucked, fast and stiff
  butterfly: number; // stance (H): cape spread, slow, floaty and nimble
  echoTrail: number; // passive: close a circle across your own ribbon of light for a wind ring
  guardianGale: number; // passive: a crash about to happen is foreseen, and the wind carries you on the safe line
  gourdBreath: number; // passive: crystals, orbs, lights and items drift in from further away
  cloudCushion: number; // passive: once per level a fall into the abyss bounces off a cloud
}

export type UpgradeId =
  | "dash"
  | "flap"
  | "glideLock"
  | "daredevil"
  | "magnet"
  | "streamline"
  | "showoff"
  | "spareFeather"
  | "featherfalling"
  | "skimBooster"
  | "cloudSurf"
  | "plunge"
  | "windShear"
  | "thermalVision"
  | "slipstream"
  | "galeForce"
  | "acrobatic"
  | "hoverStall"
  | "moth"
  | "zenith"
  | "resonance"
  | "leyLine"
  | "aeroBrake"
  | "draftWeave"
  | "ascension"
  | "falcon"
  | "butterfly"
  | "echoTrail"
  | "guardianGale"
  | "gourdBreath"
  | "cloudCushion";

export interface Upgrade {
  id: UpgradeId;
  name: string;
  description: string;
  icon: string;
  kind: "ability" | "passive";
  key?: string; // for abilities: how to use it
  max: number; // stacks
  /** Added to the stats per stack, except drag, sink, stall and proximity, which multiply */
  effect: Partial<RunStats>;
  /** The strongest abilities wait for experienced pilots: offered from this pilot level (default 1) */
  minLevel?: number;
}

export const UPGRADES: readonly Upgrade[] = [
  { id: "dash", name: "Gale boost", icon: "💨", kind: "ability", key: "Shift", max: 3, effect: { dash: 1 }, description: "Your held boost accelerates 25% harder per stack." },
  { id: "flap", name: "Wingbeat", icon: "🪽", kind: "ability", key: "C", max: 3, effect: { flap: 1 }, description: "Beat your wings to climb and speed up, Sky style. Stamina refills at every gate." },
  { id: "glideLock", name: "Glide lock", icon: "🧭", kind: "passive", max: 1, effect: { glideLock: 1, drag: 0.92 }, description: "Let go of pitch and your wings hold an efficient shallow glide." },
  { id: "daredevil", name: "Daredevil", icon: "🔥", kind: "passive", max: 3, effect: { proximity: 1.5, multiplier: 1 }, description: "Skimming the land pushes you much harder, and your style multiplier goes higher." },
  { id: "magnet", name: "Gate magnet", icon: "🧲", kind: "passive", max: 3, effect: { magnet: 5 }, description: "Gates and portals count from further away." },
  { id: "streamline", name: "Streamline", icon: "🏹", kind: "passive", max: 3, effect: { drag: 0.86 }, description: "Less drag: a higher top speed in every dive." },
  { id: "showoff", name: "Showoff", icon: "✨", kind: "passive", max: 3, effect: { multiplier: 2, gateBonus: 50 }, description: "Bigger style multipliers and more points for every gate.", minLevel: 2 },
  { id: "spareFeather", name: "Spare feather", icon: "🪶", kind: "passive", max: 3, effect: { lives: 1 }, description: "One more golden feather: the run survives one more crash.", minLevel: 3 },
  // The design list's abilities (CLAUDE.md, "Items and abilities")
  { id: "featherfalling", name: "Featherfalling", icon: "🪶", kind: "passive", max: 2, effect: { featherfalling: 1, sink: 0.55, stall: 0.8, drag: 0.92 }, description: "Gravity lets go a little: you sink far less, stall later and slip through the air." },
  { id: "skimBooster", name: "Skim-Booster", icon: "⚡", kind: "passive", max: 2, effect: { skimBooster: 1 }, description: "Skimming the land fills you with thrill: your boost refills as long as you stay dangerously close.", minLevel: 2 },
  { id: "cloudSurf", name: "Cloud-Surfing", icon: "☁️", kind: "passive", max: 1, effect: { cloudSurf: 1 }, description: "Rivers of cloud gather along the line. Surf just over them to refill boost and wingbeats, and pick up speed.", minLevel: 2 },
  { id: "plunge", name: "Plunging Attack", icon: "☄️", kind: "ability", key: "X", max: 1, effect: { plunge: 1 }, description: "Dive like a falling star. Strike a gate on the way down for a shockwave of bonus points. Pull up to stop.", minLevel: 3 },
  { id: "windShear", name: "Wind-Shear Dash", icon: "🍃", kind: "ability", key: "Q / E", max: 1, effect: { windShear: 1 }, description: "Your dodge becomes an instant blink: further, faster and ready again sooner.", minLevel: 2 },
  { id: "thermalVision", name: "Thermal Vision", icon: "👁️", kind: "passive", max: 1, effect: { thermalVision: 1 }, description: "Gates, portals, rising air and wind currents glow warm from much further away, even through rock." },
  { id: "slipstream", name: "Slipstream Rider", icon: "🌬️", kind: "passive", max: 1, effect: { slipstream: 1 }, description: "A spirit manta glides the line ahead of you. Ride right behind it and its wake pulls you along.", minLevel: 4 },
  { id: "galeForce", name: "Gale Force", icon: "🌀", kind: "ability", key: "G", max: 1, effect: { galeForce: 1 }, description: "Elemental burst: gates charge it. Unleash a wind tunnel ahead that hurls you forward and widens every gate inside.", minLevel: 6 },
  { id: "acrobatic", name: "Acrobatic Recovery", icon: "🤸", kind: "passive", max: 1, effect: { acrobatic: 1 }, description: "Clip rock with a wingtip and you barrel roll away instead of crashing. Recharges in a few seconds.", minLevel: 5 },
  { id: "hoverStall", name: "Hover-Stall", icon: "🕊️", kind: "ability", key: "F", max: 1, effect: { hoverStall: 1 }, description: "Stop dead and hover for two seconds to turn on the spot, then launch off where you look.", minLevel: 3 },
  { id: "moth", name: "Moth's Attraction", icon: "🦋", kind: "passive", max: 1, effect: { moth: 1 }, description: "Spirit moths gather at every gate's heart. The closer to it you pass, the faster you fly out.", minLevel: 2 },
  { id: "zenith", name: "Zenith Climber", icon: "🌄", kind: "passive", max: 1, effect: { zenith: 1 }, description: "Climbs hold their speed 20% longer: point the nose at the sky and scale the cliffs.", minLevel: 2 },
  { id: "resonance", name: "Resonance", icon: "🎶", kind: "ability", key: "T", max: 1, effect: { resonance: 1 }, description: "Sing out a wave of light. Every gate it reaches ahead turns to face you.", minLevel: 4 },
  { id: "leyLine", name: "Ley-Line Surger", icon: "🔮", kind: "passive", max: 1, effect: { leyLine: 1 }, description: "Fly five gates in quick succession to wake a ley line: endless boost until the chain breaks.", minLevel: 8 },
  { id: "aeroBrake", name: "Aero-Braking", icon: "🪂", kind: "ability", key: "Space", max: 1, effect: { aeroBrake: 1 }, description: "Brake throws your cape and wings forward: a hard stop and much tighter turns, for hairpins.", minLevel: 3 },
  { id: "draftWeave", name: "Draft-Weaving", icon: "🌪️", kind: "passive", max: 1, effect: { draftWeave: 1 }, description: "Spiral tightly or barrel roll to spin up a little tornado. It shields you from one glancing hit.", minLevel: 7 },
  { id: "ascension", name: "Ascension", icon: "⬆️", kind: "ability", key: "G", max: 1, effect: { ascension: 1 }, description: "Give up all your forward speed to shoot straight up on a column of wind.", minLevel: 5 },
  { id: "falcon", name: "Falcon Stance", icon: "🦅", kind: "ability", key: "H", max: 1, effect: { falcon: 1 }, description: "Toggle: wings tucked like a stooping falcon. You fall much faster and go faster, but steer stiffly.", minLevel: 4 },
  { id: "butterfly", name: "Butterfly Stance", icon: "🌸", kind: "ability", key: "H", max: 1, effect: { butterfly: 1 }, description: "Toggle: cape and wings spread wide. You fall slowest and turn tightest, but slowly.", minLevel: 4 },
  { id: "echoTrail", name: "Echo-Trail", icon: "➰", kind: "passive", max: 1, effect: { echoTrail: 1 }, description: "You leave a ribbon of light. Close a full circle across it and it becomes a wind ring that hurls you on.", minLevel: 6 },
  { id: "guardianGale", name: "Guardian Gale", icon: "🛡️", kind: "passive", max: 1, effect: { guardianGale: 1 }, description: "The wind watches over you. When a crash is about to happen it takes you onto the safe line for two seconds. Rests 20 seconds after.", minLevel: 3 },
  { id: "gourdBreath", name: "Gourd's Breath", icon: "🏺", kind: "passive", max: 2, effect: { gourdBreath: 1 }, description: "A little hulu at your belt breathes in: crystals, stamina orbs, lights and items reach you from 6 metres further per stack." },
  { id: "cloudCushion", name: "Cloud Cushion", icon: "🌥️", kind: "passive", max: 1, effect: { cloudCushion: 1 }, description: "Once per level, falling into the abyss or the sea lands you on a cloud that bounces you back up over the line.", minLevel: 2 },
];

/** How rare an ability reads in the UI (its border): by the pilot level it waits for */
export function upgradeRarity(upgrade: Upgrade): 0 | 1 | 2 | 3 {
  const level = upgrade.minLevel ?? 1;
  return level >= 7 ? 3 : level >= 4 ? 2 : level >= 2 ? 1 : 0;
}

const MULTIPLIED: (keyof RunStats)[] = ["drag", "sink", "stall", "proximity"];

export function baseStats(): RunStats {
  return {
    dash: 0, flap: 0, glideLock: 0, drag: 1, sink: 1, stall: 1, proximity: 1, magnet: 0, multiplier: 0, gateBonus: 0, lives: 0,
    featherfalling: 0, skimBooster: 0, cloudSurf: 0, plunge: 0, windShear: 0, thermalVision: 0, slipstream: 0, galeForce: 0, acrobatic: 0, hoverStall: 0,
    moth: 0, zenith: 0, resonance: 0, leyLine: 0, aeroBrake: 0, draftWeave: 0, ascension: 0, falcon: 0, butterfly: 0, echoTrail: 0,
    guardianGale: 0, gourdBreath: 0, cloudCushion: 0,
  };
}

/** The stats a list of picked upgrades adds up to */
export function statsFor(picked: readonly UpgradeId[]): RunStats {
  const stats = baseStats();
  for (const id of picked) {
    const upgrade = UPGRADES.find((u) => u.id === id);
    if (!upgrade) continue;
    for (const [key, value] of Object.entries(upgrade.effect) as [keyof RunStats, number][]) {
      if (MULTIPLIED.includes(key)) stats[key] *= value;
      else stats[key] += value;
    }
  }
  return stats;
}

/** The pilot level an upgrade starts being offered at */
export const upgradeLevel = (upgrade: Upgrade): number => upgrade.minLevel ?? 1;

/**
 * Three upgrades to choose from at a portal: the same for everyone on the same run and path who
 * has reached the same pilot level (`playerLevel`; abilities above it are never offered)
 */
export function offer(runSeed: number, level: number, picked: readonly UpgradeId[], playerLevel = Infinity): Upgrade[] {
  const rng = makeRng(runSeed, `upgrades/${level}/main`);
  const open = UPGRADES.filter((u) => upgradeLevel(u) <= playerLevel && picked.filter((p) => p === u.id).length < u.max);
  // Abilities you don't have yet come up more often early on, so runs get interesting fast
  const weight = (u: Upgrade) => (u.kind === "ability" && !picked.includes(u.id) ? 2 : 1);
  const choices: Upgrade[] = [];
  while (choices.length < 3 && open.length) {
    const total = open.reduce((a, u) => a + weight(u), 0);
    let r = rng() * total;
    let index = 0;
    for (; index < open.length - 1; index++) {
      r -= weight(open[index]);
      if (r <= 0) break;
    }
    choices.push(open.splice(index, 1)[0]);
  }
  return choices;
}
