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
}

export type UpgradeId =
  | "dash"
  | "flap"
  | "glideLock"
  | "daredevil"
  | "magnet"
  | "streamline"
  | "showoff"
  | "featherfalling"
  | "skimBooster"
  | "cloudSurf"
  | "plunge"
  | "windShear"
  | "thermalVision"
  | "slipstream"
  | "galeForce"
  | "acrobatic"
  | "hoverStall";

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
}

export const UPGRADES: readonly Upgrade[] = [
  { id: "dash", name: "Gale boost", icon: "💨", kind: "ability", key: "Shift", max: 3, effect: { dash: 1 }, description: "Your held boost accelerates 25% harder per stack." },
  { id: "flap", name: "Wingbeat", icon: "🪽", kind: "ability", key: "C", max: 3, effect: { flap: 1 }, description: "Beat your wings to climb and speed up, Sky style. Stamina refills at every gate." },
  { id: "glideLock", name: "Glide lock", icon: "🧭", kind: "passive", max: 1, effect: { glideLock: 1, drag: 0.92 }, description: "Let go of pitch and your wings hold an efficient shallow glide." },
  { id: "daredevil", name: "Daredevil", icon: "🔥", kind: "passive", max: 3, effect: { proximity: 1.5, multiplier: 1 }, description: "Skimming the land pushes you much harder, and your style multiplier goes higher." },
  { id: "magnet", name: "Gate magnet", icon: "🧲", kind: "passive", max: 3, effect: { magnet: 5 }, description: "Gates and portals count from further away." },
  { id: "streamline", name: "Streamline", icon: "🏹", kind: "passive", max: 3, effect: { drag: 0.86 }, description: "Less drag: a higher top speed in every dive." },
  { id: "showoff", name: "Showoff", icon: "✨", kind: "passive", max: 3, effect: { multiplier: 2, gateBonus: 50 }, description: "Bigger style multipliers and more points for every gate." },
  // The design list's abilities (CLAUDE.md, "Items and abilities")
  { id: "featherfalling", name: "Featherfalling", icon: "🪶", kind: "passive", max: 2, effect: { featherfalling: 1, sink: 0.55, stall: 0.8, drag: 0.92 }, description: "Gravity lets go a little: you sink far less, stall later and slip through the air." },
  { id: "skimBooster", name: "Skim-Booster", icon: "⚡", kind: "passive", max: 2, effect: { skimBooster: 1 }, description: "Skimming the land fills you with thrill: your boost refills as long as you stay dangerously close." },
  { id: "cloudSurf", name: "Cloud-Surfing", icon: "☁️", kind: "passive", max: 1, effect: { cloudSurf: 1 }, description: "Rivers of cloud gather along the line. Surf just over them to refill boost and wingbeats, and pick up speed." },
  { id: "plunge", name: "Plunging Attack", icon: "☄️", kind: "ability", key: "X", max: 1, effect: { plunge: 1 }, description: "Dive like a falling star. Strike a gate on the way down for a shockwave of bonus points. Pull up to stop." },
  { id: "windShear", name: "Wind-Shear Dash", icon: "🍃", kind: "ability", key: "Q / E", max: 1, effect: { windShear: 1 }, description: "Your dodge becomes an instant blink: further, faster and ready again sooner." },
  { id: "thermalVision", name: "Thermal Vision", icon: "👁️", kind: "passive", max: 1, effect: { thermalVision: 1 }, description: "Gates, portals, rising air and wind currents glow warm from much further away, even through rock." },
  { id: "slipstream", name: "Slipstream Rider", icon: "🌬️", kind: "passive", max: 1, effect: { slipstream: 1 }, description: "A spirit manta glides the line ahead of you. Ride right behind it and its wake pulls you along." },
  { id: "galeForce", name: "Gale Force", icon: "🌀", kind: "ability", key: "G", max: 1, effect: { galeForce: 1 }, description: "Elemental burst: gates charge it. Unleash a wind tunnel ahead that hurls you forward and widens every gate inside." },
  { id: "acrobatic", name: "Acrobatic Recovery", icon: "🤸", kind: "passive", max: 1, effect: { acrobatic: 1 }, description: "Clip rock with a wingtip and you barrel roll away instead of crashing. Recharges in a few seconds." },
  { id: "hoverStall", name: "Hover-Stall", icon: "🕊️", kind: "ability", key: "F", max: 1, effect: { hoverStall: 1 }, description: "Stop dead and hover for two seconds to turn on the spot, then launch off where you look." },
];

const MULTIPLIED: (keyof RunStats)[] = ["drag", "sink", "stall", "proximity"];

export function baseStats(): RunStats {
  return {
    dash: 0, flap: 0, glideLock: 0, drag: 1, sink: 1, stall: 1, proximity: 1, magnet: 0, multiplier: 0, gateBonus: 0,
    featherfalling: 0, skimBooster: 0, cloudSurf: 0, plunge: 0, windShear: 0, thermalVision: 0, slipstream: 0, galeForce: 0, acrobatic: 0, hoverStall: 0,
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

/** Three upgrades to choose from at a portal: the same for everyone on the same run and path */
export function offer(runSeed: number, level: number, picked: readonly UpgradeId[]): Upgrade[] {
  const rng = makeRng(runSeed, `upgrades/${level}/main`);
  const open = UPGRADES.filter((u) => picked.filter((p) => p === u.id).length < u.max);
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
