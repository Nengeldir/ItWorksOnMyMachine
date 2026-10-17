import type { Family } from "./pool";

// The open world's sound families (plan §3.4) as synthesized recipes: plucks (leaf, wood, fruit),
// chimes (crystal, starlight), water (cast, plop, splash, reel), soft impacts (purify, shield), UI
// (glass tap, coin trickle, harp) and NPC babble. Soft and short, like Sky's chimes and Genshin's
// pickups. A recorded sample of the same name (samples.ts) plays instead once its sheet is loaded.

export interface SynthOut {
  ctx: BaseAudioContext;
  out: AudioNode;
  /** A looping noise buffer (shared) */
  noise: AudioBuffer;
}

/** Plays at `when`, pitched by `rate`, `variant` 0..1 picks a flavour (an NPC's voice); returns seconds */
type Recipe = (s: SynthOut, when: number, rate: number, variant: number) => number;

function tone(s: SynthOut, when: number, frequency: number, duration: number, volume: number, type: OscillatorType = "sine", glideTo?: number) {
  const osc = s.ctx.createOscillator();
  const gain = s.ctx.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(frequency, when);
  if (glideTo) osc.frequency.exponentialRampToValueAtTime(glideTo, when + duration * 0.8);
  gain.gain.setValueAtTime(0.0001, when);
  gain.gain.exponentialRampToValueAtTime(volume, when + 0.008);
  gain.gain.exponentialRampToValueAtTime(0.0001, when + duration);
  osc.connect(gain).connect(s.out);
  osc.start(when);
  osc.stop(when + duration + 0.02);
}

function hiss(s: SynthOut, when: number, duration: number, volume: number, type: BiquadFilterType, frequency: number, q = 0.8, sweepTo?: number) {
  const source = s.ctx.createBufferSource();
  source.buffer = s.noise;
  source.loop = true;
  const filter = s.ctx.createBiquadFilter();
  filter.type = type;
  filter.Q.value = q;
  filter.frequency.setValueAtTime(frequency, when);
  if (sweepTo) filter.frequency.exponentialRampToValueAtTime(sweepTo, when + duration);
  const gain = s.ctx.createGain();
  gain.gain.setValueAtTime(0.0001, when);
  gain.gain.exponentialRampToValueAtTime(volume, when + Math.min(0.02, duration / 4));
  gain.gain.exponentialRampToValueAtTime(0.0001, when + duration);
  source.connect(filter).connect(gain).connect(s.out);
  // Each play starts somewhere else in the noise, so no two sound the same
  source.start(when, Math.random() * Math.max(0, s.noise.duration - duration - 0.1));
  source.stop(when + duration + 0.02);
}

// A gentle pentatonic (C major) the chimes and the harp pick from
const PENTA = [523.25, 587.33, 659.25, 783.99, 880, 1046.5, 1174.66, 1318.51, 1567.98, 1760];

export const RECIPES = {
  pluck_leaf: (s, t, r) => {
    hiss(s, t, 0.12, 0.35, "bandpass", 2600 * r, 1.4, 1500 * r);
    tone(s, t, 880 * r, 0.08, 0.06, "triangle", 620 * r);
    return 0.14;
  },
  pluck_wood: (s, t, r) => {
    tone(s, t, 190 * r, 0.22, 0.4, "sine", 95 * r);
    hiss(s, t, 0.08, 0.25, "lowpass", 1400 * r, 0.7);
    return 0.24;
  },
  pluck_fruit: (s, t, r) => {
    tone(s, t, 640 * r, 0.12, 0.22, "sine", 300 * r);
    hiss(s, t + 0.01, 0.06, 0.12, "bandpass", 3200 * r, 2);
    return 0.14;
  },
  chime_crystal: (s, t, r) => {
    tone(s, t, 1567.98 * r, 1.1, 0.12);
    tone(s, t, 2349.32 * r * 1.003, 0.8, 0.06);
    tone(s, t + 0.04, 3135.96 * r, 0.5, 0.025);
    return 1.12;
  },
  chime_star: (s, t, r) => {
    [0, 0.07, 0.14].forEach((d, i) => tone(s, t + d, PENTA[5 + i * 2] * r, 0.9, 0.08));
    return 1.05;
  },
  water_cast: (s, t, r) => {
    hiss(s, t, 0.35, 0.18, "highpass", 900 * r, 0.5, 3800 * r);
    return 0.36;
  },
  water_plop: (s, t, r) => {
    tone(s, t, 920 * r, 0.14, 0.2, "sine", 280 * r);
    hiss(s, t + 0.02, 0.18, 0.12, "lowpass", 900 * r, 0.6);
    return 0.2;
  },
  water_splash: (s, t, r) => {
    hiss(s, t, 0.6, 0.3, "lowpass", 3000 * r, 0.4, 500 * r);
    tone(s, t, 420 * r, 0.2, 0.08, "sine", 160 * r);
    return 0.62;
  },
  water_reel: (s, t, r) => {
    for (let i = 0; i < 6; i++) hiss(s, t + i * 0.045, 0.02, 0.18, "bandpass", 4200 * r, 6);
    return 0.3;
  },
  impact_purify: (s, t, r) => {
    tone(s, t, 130 * r, 0.35, 0.45, "sine", 62 * r);
    [0, 0.05, 0.1].forEach((d, i) => tone(s, t + 0.06 + d, PENTA[6 + i] * r, 0.6, 0.05));
    return 0.75;
  },
  impact_shield: (s, t, r) => {
    hiss(s, t, 0.5, 0.16, "bandpass", 500 * r, 1.2, 2400 * r);
    tone(s, t, 392 * r, 0.6, 0.1, "triangle");
    tone(s, t, 587.33 * r, 0.6, 0.06, "sine");
    return 0.62;
  },
  ui_tap: (s, t, r) => {
    tone(s, t, 2200 * r, 0.07, 0.08);
    tone(s, t, 3300 * r, 0.05, 0.035);
    return 0.08;
  },
  ui_coin: (s, t, r) => {
    for (let i = 0; i < 5; i++) tone(s, t + i * 0.05, PENTA[5 + ((i * 3) % 5)] * 2 * r, 0.12, 0.05);
    return 0.36;
  },
  ui_harp: (s, t, r) => {
    [0, 2, 4, 5, 7].forEach((n, i) => tone(s, t + i * 0.065, PENTA[n] * r, 1.1, 0.08, "triangle"));
    return 1.4;
  },
  voice_babble: (s, t, r, variant) => {
    // Animal Crossing-like syllables: a few soft square blips through a vowel-ish band, the NPC's own pitch
    const base = (180 + variant * 260) * r;
    const syllables = 4 + Math.floor(Math.random() * 3);
    for (let i = 0; i < syllables; i++) {
      const when = t + i * 0.085;
      const osc = s.ctx.createOscillator();
      const band = s.ctx.createBiquadFilter();
      const gain = s.ctx.createGain();
      osc.type = "square";
      osc.frequency.setValueAtTime(base * (1 + (Math.random() - 0.5) * 0.25), when);
      band.type = "bandpass";
      band.frequency.value = 700 + Math.random() * 1400;
      band.Q.value = 3;
      gain.gain.setValueAtTime(0.0001, when);
      gain.gain.exponentialRampToValueAtTime(0.09, when + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.0001, when + 0.07);
      osc.connect(band).connect(gain).connect(s.out);
      osc.start(when);
      osc.stop(when + 0.08);
    }
    return syllables * 0.085 + 0.05;
  },
} satisfies Record<string, Recipe>;

export type SoundName = keyof typeof RECIPES;

/** The family a sound counts against in the voice pool: its name's first word */
export function familyOf(name: SoundName): Family {
  return name.slice(0, name.indexOf("_")) as Family;
}

/** Every sound by family, for the dev page */
export function soundsByFamily(): Record<string, SoundName[]> {
  const out: Record<string, SoundName[]> = {};
  for (const name of Object.keys(RECIPES) as SoundName[]) (out[familyOf(name)] ??= []).push(name);
  return out;
}
