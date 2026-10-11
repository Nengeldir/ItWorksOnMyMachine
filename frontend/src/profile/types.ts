import type { Appearance } from "../game/cosmetics/storage";
export type Rarity = "common" | "uncommon" | "rare" | "legendary";
export interface Collectible {
  key: string;
  kind: "item" | "cape" | "hat" | "shoes" | "wings" | "pet" | "crystal";
  asset: string;
  name: string;
  rarity: Rarity;
  xp: number;
  slot?: keyof Appearance | null;
}
export interface Profile {
  version: number;
  user_id: string;
  name: string;
  xp: number;
  crystals: number;
  level: number;
  level_xp: number;
  next_level_xp: number;
  inventory: Record<string, number>;
  equipped: Appearance;
  revision: number;
  catalog: Collectible[];
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
  accepted: { id: string; name: string; duplicate: boolean }[];
  xp: number;
  crystals: number;
  levels: number;
}
