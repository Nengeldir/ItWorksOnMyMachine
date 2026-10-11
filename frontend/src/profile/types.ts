import type { Appearance } from "../game/cosmetics/storage";
import type { Rarity } from "../game/collection/rarity";
export type { Rarity } from "../game/collection/rarity";

/** What's equipped: the looks, and the keepsake carried as the charm ("none": nothing) */
export interface Equipment extends Appearance { charm: string }
export type EquipSlot = keyof Equipment;

export interface Collectible {
  key: string;
  kind: "item" | "cape" | "hat" | "shoes" | "wings" | "pet" | "crystal";
  asset: string;
  name: string;
  rarity: Rarity;
  xp: number;
  slot?: EquipSlot | null;
  /** The pilot level it starts turning up at (pickups, the market, the wheel) */
  min_level?: number;
  /** In crystals, at the market */
  price?: number;
}

export interface ProfileStats {
  gates: number;
  adventures: number;
  completed: number;
  flawless: number;
  playtime_ms: number;
  best_adventure_ms: number | null;
  best_score: number;
  races: number;
  spins: number;
  purchases: number;
  crystals_earned: number;
  fastest_race_ms: number | null;
}

export interface Profile {
  version: number;
  user_id: string;
  public_id: string;
  name: string;
  xp: number;
  crystals: number;
  level: number;
  level_xp: number;
  next_level_xp: number;
  inventory: Record<string, number>;
  equipped: Equipment;
  revision: number;
  catalog: Collectible[];
  pet_names: Record<string, string>;
  style: 1 | 2;
  stats: ProfileStats;
}

export interface Reward extends Collectible {
  id: string;
  level: number;
  anchor: number;
  angle: number;
  crystals: number;
}
export interface Adventure { token: string; seed: number; rewards: Reward[] }
export interface ClaimResult {
  profile: Profile;
  accepted: { id: string; key?: string; name: string; rarity?: Rarity; kind?: string; duplicate: boolean; crystals?: number }[];
  xp: number;
  crystals: number;
  levels: number;
}

/** A finished (or abandoned) adventure as reported, and what it earned */
export interface RunReport { score: number; levels: number; completed: boolean; gates: number; time_ms: number; crashes: number }
export interface RunReward { profile: Profile; xp: number; crystals: number; levels: number; repeated: boolean }

export interface ShopOffer extends Collectible { owned: boolean }
export interface WheelSegment { id: string; label: string; weight: number; crystals: number; rarity: number | null }
export interface Shop {
  day: string;
  resets_at: number;
  offers: ShopOffer[];
  spin_ready: boolean;
  wheel: WheelSegment[];
  profile: Profile;
}
export interface SpinResult {
  segment: number;
  id: string;
  label: string;
  prize: Collectible | null;
  duplicate: boolean;
  crystals: number;
  profile: Profile;
}

/** The public leaderboard and pilot pages */
export interface PilotSummary {
  rank: number;
  public_id: string;
  name: string;
  verified: boolean;
  level: number;
  xp: number;
  level_xp: number;
  next_level_xp: number;
  equipped: Equipment;
  style: 1 | 2;
  best_score: number;
}
export interface Achievement { id: string; name: string; description: string; done: boolean }
export interface PilotPage extends Omit<PilotSummary, "best_score"> {
  stats: ProfileStats;
  discoveries: number;
  catalog_size: number;
  pets: { asset: string; name: string; rarity: Rarity; nickname?: string | null }[];
  races: { seed: number; best_ms: number }[];
  achievements: Achievement[];
}
