// The voice pool (plan F9), as pure bookkeeping: how many sounds of each family may play at once, and
// which one to cut when a new one comes. A family at its limit, or the whole mix at MAX_VOICES, gives
// up its weakest voice (loudness times what's left of it: the oldest and quietest go first). A new
// sound quieter than the weakest it would cut is dropped instead, so a pile of soft plucks never cuts
// a chord. The engine starts and stops the actual nodes.

export type Family = "pluck" | "chime" | "water" | "impact" | "ui" | "voice" | "combat" | "wing";

export const FAMILY_LIMITS: Record<Family, number> = { pluck: 6, chime: 8, water: 6, impact: 6, ui: 4, voice: 3, combat: 12, wing: 3 };
/** The plan's budget: at most 24 one-shots at once */
export const MAX_VOICES = 24;

interface Voice {
  id: number;
  family: Family;
  loudness: number;
  start: number;
  end: number;
}

export interface Claim {
  id: number;
  /** A voice to stop first (null: there was room) */
  steal: number | null;
}

export class VoicePool {
  private voices: Voice[] = [];
  private nextId = 1;
  private readonly limits: Record<Family, number>;
  private readonly max: number;

  constructor(limits: Record<Family, number> = FAMILY_LIMITS, max = MAX_VOICES) {
    this.limits = limits;
    this.max = max;
  }

  /** How strong a voice still is at `now`: its loudness, fading with the part of it already played */
  private weight(v: Voice, now: number) {
    const left = v.end > v.start ? Math.max(0, (v.end - now) / (v.end - v.start)) : 0;
    return v.loudness * left;
  }

  private weakest(list: Voice[], now: number): Voice | null {
    let weakest: Voice | null = null;
    let low = Infinity;
    for (const v of list) {
      const w = this.weight(v, now);
      if (w < low || (w === low && weakest && v.start < weakest.start)) {
        low = w;
        weakest = v;
      }
    }
    return weakest;
  }

  /**
   * Asks for a voice of `family`, `loudness` 0..1, lasting `duration` s from `now`. Null: dropped (too
   * quiet to cut anything). Otherwise its id, and maybe a voice to stop
   */
  claim(family: Family, loudness: number, now: number, duration: number): Claim | null {
    this.expire(now);
    const own = this.voices.filter((v) => v.family === family);
    let victim: Voice | null = null;
    if (own.length >= this.limits[family]) victim = this.weakest(own, now);
    else if (this.voices.length >= this.max) victim = this.weakest(this.voices, now);
    if (victim && loudness < this.weight(victim, now)) return null;
    if (victim) this.voices = this.voices.filter((v) => v !== victim);
    const voice = { id: this.nextId++, family, loudness, start: now, end: now + duration };
    this.voices.push(voice);
    return { id: voice.id, steal: victim?.id ?? null };
  }

  /** A voice that ended early (stopped by the engine) */
  release(id: number) {
    this.voices = this.voices.filter((v) => v.id !== id);
  }

  /** Forgets voices that have finished */
  expire(now: number) {
    if (this.voices.some((v) => v.end <= now)) this.voices = this.voices.filter((v) => v.end > now);
  }

  active(family?: Family): number {
    return family ? this.voices.filter((v) => v.family === family).length : this.voices.length;
  }
}

/**
 * Every one-shot plays a little differently (plan §3.4): pitch within ±4% and volume within ±2 dB, from
 * two random numbers in [0, 1)
 */
export function variation(r1: number, r2: number): { rate: number; gain: number } {
  return { rate: 1 + (r1 * 2 - 1) * 0.04, gain: 10 ** (((r2 * 2 - 1) * 2) / 20) };
}
