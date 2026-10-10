import { makeRng } from "../rng";

// Upgrades a roguelike run offers at every portal, as data. Each adds to a
// set of run stats per stack; the run turns the stats into flight changes
// (FlightMods), abilities and scoring rules. None of this reaches races.

export interface RunStats {
  dash: number; // ability level (Shift): a burst of speed
  flap: number; // ability level (Space): Sky-style wingbeats with stamina
  hover: number; // ability level (hold F): sink and gravity cancelled for a moment
  glideLock: number; // passive: let go of pitch and the glide holds itself
  drag: number; // multiplier
  sink: number; // multiplier
  stall: number; // multiplier
  proximity: number; // multiplier on the boost from skimming
  magnet: number; // metres added to gate rings and pickups
  lives: number; // extra feathers
  multiplier: number; // added to the style multiplier's cap
  gateBonus: number; // points added to every gate
}

export type UpgradeId =
  | "dash"
  | "flap"
  | "hover"
  | "glideLock"
  | "daredevil"
  | "magnet"
  | "feather"
  | "streamline"
  | "featherweight"
  | "showoff";

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
  { id: "dash", name: "Gale dash", icon: "💨", kind: "ability", key: "Shift", max: 3, effect: { dash: 1 }, description: "A burst of speed on demand. Each stack recharges it faster and pushes harder." },
  { id: "flap", name: "Wingbeat", icon: "🪽", kind: "ability", key: "Space", max: 3, effect: { flap: 1 }, description: "Beat your wings to climb and speed up, Sky style. Stamina refills at every gate." },
  { id: "hover", name: "Featherfall", icon: "🪶", kind: "ability", key: "hold F", max: 2, effect: { hover: 1 }, description: "Hold to hang in the air: no sink, no speed lost to climbing, for a moment." },
  { id: "glideLock", name: "Glide lock", icon: "🧭", kind: "passive", max: 1, effect: { glideLock: 1, drag: 0.92 }, description: "Let go of pitch and your wings hold an efficient shallow glide." },
  { id: "daredevil", name: "Daredevil", icon: "🔥", kind: "passive", max: 3, effect: { proximity: 1.5, multiplier: 1 }, description: "Skimming the land pushes you much harder, and your style multiplier goes higher." },
  { id: "magnet", name: "Gate magnet", icon: "🧲", kind: "passive", max: 3, effect: { magnet: 5 }, description: "Gates count from further away, and stars and seeds drift to you." },
  { id: "feather", name: "Spare feather", icon: "🤍", kind: "passive", max: 3, effect: { lives: 1 }, description: "One more crash before the run ends." },
  { id: "streamline", name: "Streamline", icon: "🏹", kind: "passive", max: 3, effect: { drag: 0.86 }, description: "Less drag: a higher top speed in every dive." },
  { id: "featherweight", name: "Featherweight", icon: "🕊️", kind: "passive", max: 2, effect: { stall: 0.72, sink: 0.72 }, description: "Fly slower without stalling, and sink less when you do." },
  { id: "showoff", name: "Showoff", icon: "✨", kind: "passive", max: 3, effect: { multiplier: 2, gateBonus: 50 }, description: "Bigger style multipliers and more points for every gate." },
];

const MULTIPLIED: (keyof RunStats)[] = ["drag", "sink", "stall", "proximity"];

export function baseStats(): RunStats {
  return { dash: 0, flap: 0, hover: 0, glideLock: 0, drag: 1, sink: 1, stall: 1, proximity: 1, magnet: 0, lives: 0, multiplier: 0, gateBonus: 0 };
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
export function offer(runSeed: number, level: number, picked: readonly UpgradeId[], secret: boolean): Upgrade[] {
  const rng = makeRng(runSeed, `upgrades/${level}/${secret ? "secret" : "main"}`);
  const open = UPGRADES.filter((u) => picked.filter((p) => p === u.id).length < u.max);
  // Abilities you don't have yet come up more often early on, so runs get interesting fast
  const weight = (u: Upgrade) => (u.kind === "ability" && !picked.includes(u.id) ? 2 : 1) * (secret && u.kind === "ability" ? 1.5 : 1);
  const choices: Upgrade[] = [];
  while (choices.length < (secret ? 4 : 3) && open.length) {
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
