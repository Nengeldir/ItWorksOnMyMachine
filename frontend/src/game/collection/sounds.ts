import type { Voice } from "./abilities";
import { loadSettings } from "../../storage";

// Synthesized signature sounds for the collection: every pet has its call,
// every rare cosmetic and keepsake its own little motif, and the market and
// the wheel their chimes. Nothing is recorded: tones, glides and filtered
// noise in Web Audio, soft and short, like Sky's chimes and Genshin's
// pickups. The game plays them through its own mixer (GameAudio.voice); the
// menus through a small page-wide synth (`playVoice`, `playChime`) that
// follows the player's mute and effects volume.

export class Synth {
  readonly ctx: AudioContext;
  private readonly out: AudioNode;
  private readonly noise: AudioBuffer;

  constructor(ctx: AudioContext, out: AudioNode, noise: AudioBuffer) {
    this.ctx = ctx;
    this.out = out;
    this.noise = noise;
  }

  /** A note with a quick attack and an exponential tail */
  tone(frequency: number, duration: number, type: OscillatorType, volume: number, delay = 0, vibrato = 0) {
    const start = this.ctx.currentTime + delay;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = type;
    osc.frequency.value = frequency;
    if (vibrato > 0) {
      const lfo = this.ctx.createOscillator();
      const depth = this.ctx.createGain();
      lfo.frequency.value = 5.5;
      depth.gain.value = frequency * vibrato;
      lfo.connect(depth).connect(osc.frequency);
      lfo.start(start);
      lfo.stop(start + duration + 0.05);
    }
    gain.gain.setValueAtTime(0, start);
    gain.gain.linearRampToValueAtTime(volume, start + Math.min(0.02, duration * 0.2));
    gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
    osc.connect(gain).connect(this.out);
    osc.start(start);
    osc.stop(start + duration + 0.05);
  }

  /** A note sliding from one pitch to another */
  glide(from: number, to: number, duration: number, type: OscillatorType, volume: number, delay = 0) {
    const start = this.ctx.currentTime + delay;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(from, start);
    osc.frequency.exponentialRampToValueAtTime(to, start + duration);
    gain.gain.setValueAtTime(0, start);
    gain.gain.linearRampToValueAtTime(volume, start + Math.min(0.03, duration * 0.25));
    gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
    osc.connect(gain).connect(this.out);
    osc.start(start);
    osc.stop(start + duration + 0.05);
  }

  /** Filtered noise sweeping from `from` to `to` Hz: wind, hiss, crackle, crunch */
  hiss(from: number, to: number, duration: number, volume: number, type: BiquadFilterType = "bandpass", delay = 0, q = 1) {
    const start = this.ctx.currentTime + delay;
    const source = this.ctx.createBufferSource();
    source.buffer = this.noise;
    source.loop = true;
    const filter = this.ctx.createBiquadFilter();
    filter.type = type;
    filter.Q.value = q;
    filter.frequency.setValueAtTime(from, start);
    filter.frequency.exponentialRampToValueAtTime(to, start + duration);
    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(volume, start + Math.min(0.05, duration * 0.3));
    gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
    source.connect(filter).connect(gain).connect(this.out);
    source.start(start, Math.random() * 1.5);
    source.stop(start + duration + 0.05);
  }

  /** Tiny clicks of crackling fire or ice: `count` bursts over `duration` */
  crackle(count: number, duration: number, volume: number, from = 2500, delay = 0) {
    for (let i = 0; i < count; i++) this.hiss(from * (0.7 + Math.random() * 0.8), from * 2, 0.03 + Math.random() * 0.04, volume * (0.5 + Math.random() * 0.5), "highpass", delay + Math.random() * duration);
  }
}

/** Brown-ish noise, shared by every synth on a context */
export function noiseBuffer(ctx: AudioContext): AudioBuffer {
  const length = ctx.sampleRate * 2;
  const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  let last = 0;
  for (let i = 0; i < length; i++) {
    last = (last + 0.02 * (Math.random() * 2 - 1)) / 1.02;
    data[i] = last * 3.5;
  }
  return buffer;
}

const C5 = 523.25, E5 = 659.25, G5 = 783.99, C6 = 1046.5, E6 = 1318.5, G6 = 1568, C7 = 2093;

/** A collectible's signature, `level` 0..1 scales it down (an ambient pet call is quieter than a pick in the inventory) */
export function voice(s: Synth, v: Voice, level = 1) {
  const k = level;
  switch (v) {
    case "chirp": // the swallow: three quick rising chirps and a trill
      for (let i = 0; i < 3; i++) s.glide(2300 + i * 150, 3500 + i * 200, 0.07, "sine", 0.07 * k, i * 0.11);
      s.tone(3200, 0.25, "sine", 0.04 * k, 0.36, 0.08);
      break;
    case "hoot": // the owl: two soft, round hoots
      s.glide(430, 380, 0.32, "sine", 0.12 * k);
      s.glide(400, 360, 0.42, "sine", 0.1 * k, 0.42);
      s.hiss(300, 260, 0.6, 0.02 * k, "lowpass");
      break;
    case "crane": // the crane: a bright trumpeting call, twice
      for (const at of [0, 0.32]) {
        s.glide(780, 960, 0.22, "triangle", 0.08 * k, at);
        s.glide(1560, 1920, 0.22, "sine", 0.03 * k, at);
      }
      break;
    case "phoenix": // the phoenix: crackling flame under a rising, ringing trill
      s.crackle(10, 0.6, 0.05 * k);
      s.glide(900, 1900, 0.5, "triangle", 0.07 * k);
      s.tone(G6, 0.6, "sine", 0.04 * k, 0.35, 0.03);
      break;
    case "dragon": // the dragon: a cloudy rumble and a deep temple bell
      s.hiss(220, 120, 0.9, 0.1 * k, "lowpass");
      [C5 / 2, G5 / 2, C5].forEach((f, i) => s.tone(f, 1.6, "sine", 0.07 * k, 0.05 + i * 0.02));
      break;
    case "kirin": // the kirin: two clear bells with shimmering partials
      for (const [at, f] of [[0, E6], [0.28, G6]] as const) {
        s.tone(f, 1.2, "sine", 0.07 * k, at);
        s.tone(f * 2.01, 0.8, "sine", 0.025 * k, at);
        s.tone(f * 3.02, 0.5, "sine", 0.012 * k, at);
      }
      break;
    case "yip": // the fox: two little yips and a lantern's chime
      s.glide(700, 1350, 0.08, "triangle", 0.09 * k);
      s.glide(760, 1450, 0.08, "triangle", 0.08 * k, 0.14);
      s.tone(C7, 0.5, "sine", 0.03 * k, 0.3);
      break;
    case "screech": // the griffin: a hawk's cry over a lion's breath
      s.glide(1500, 950, 0.32, "sawtooth", 0.035 * k);
      s.hiss(1800, 900, 0.32, 0.05 * k, "bandpass", 0, 3);
      s.hiss(180, 120, 0.5, 0.06 * k, "lowpass", 0.05);
      break;
    case "shimmer":
      [C6, E6, G6, C7].forEach((f, i) => s.tone(f, 0.6, "sine", 0.05 * k, i * 0.05));
      break;
    case "gild": // gold: a bright, regal major arpeggio
      [C5, E5, G5, C6, E6].forEach((f, i) => s.tone(f, 0.55, "triangle", 0.05 * k, i * 0.06));
      break;
    case "ember": // embers: warm crackle and a low, glowing hum
      s.crackle(14, 0.7, 0.045 * k, 1800);
      s.tone(220, 0.8, "sine", 0.06 * k, 0, 0.01);
      s.glide(440, 660, 0.5, "triangle", 0.03 * k, 0.1);
      break;
    case "feather": // feathers: a soft whoosh and a tiny chime
      s.hiss(600, 2200, 0.35, 0.08 * k);
      s.tone(G6, 0.3, "sine", 0.03 * k, 0.18);
      break;
    case "stars": // starlight: scattered high twinkles
      for (let i = 0; i < 6; i++) s.tone([E6, G6, C7, 2637, 3136][i % 5], 0.35, "sine", 0.03 * k, i * 0.07 + Math.random() * 0.03);
      break;
    case "frost": // ice: glassy pings over a crunch of frost
      s.hiss(4000, 7000, 0.25, 0.05 * k, "highpass");
      [2637, 3136, 3951].forEach((f, i) => s.tone(f, 0.4, "sine", 0.035 * k, 0.05 + i * 0.05));
      break;
    case "spark": // a kick of flame
      s.hiss(400, 2400, 0.25, 0.12 * k);
      s.crackle(6, 0.25, 0.05 * k, 2200);
      break;
    case "glass": // crystal wings: a ringing glass chord
      [E6, G6 * 1.01, C7].forEach((f, i) => s.tone(f, 0.9, "sine", 0.035 * k, i * 0.02));
      break;
    case "zap": // lightning: a crackling fall and a buzz
      s.glide(3200, 180, 0.22, "sawtooth", 0.04 * k);
      s.crackle(8, 0.2, 0.06 * k, 3000);
      break;
    case "celestial": // the stars themselves: a slow, detuned chord swelling up
      [C5, G5, E6, C7].forEach((f, i) => { s.tone(f, 1.6, "sine", 0.04 * k, i * 0.08, 0.004); s.tone(f * 1.003, 1.6, "sine", 0.025 * k, i * 0.08); });
      break;
    case "crunch": // a bite of fruit or candy
      s.hiss(1800, 3200, 0.07, 0.12 * k, "bandpass", 0, 2);
      s.hiss(1600, 2800, 0.06, 0.09 * k, "bandpass", 0.12, 2);
      s.tone(C7, 0.25, "sine", 0.025 * k, 0.22);
      break;
    case "fizz": // a sparkling sweet
      s.hiss(3000, 8000, 0.5, 0.05 * k, "highpass");
      [E6, G6, C7].forEach((f, i) => s.tone(f, 0.3, "triangle", 0.03 * k, 0.1 + i * 0.06));
      break;
    case "fuse": // the firework: a hissing fuse
      s.hiss(5000, 7000, 1.6, 0.06 * k, "highpass");
      s.crackle(16, 1.6, 0.025 * k, 3500);
      break;
    case "choir": // the golden feather: a soft sung chord
      [C5, E5, G5, C6].forEach((f, i) => s.tone(f, 1.8, "sine", 0.035 * k, i * 0.04, 0.006));
      break;
    case "relic": // a relic waking: a magical rising chime
      s.glide(660, 1320, 0.4, "triangle", 0.05 * k);
      [E6, G6, C7].forEach((f, i) => s.tone(f, 0.5, "sine", 0.035 * k, 0.15 + i * 0.07));
      break;
  }
}

/** Chimes of the collection's moments: a treasure by its rarity, a purchase, the wheel's ticks and prizes */
export type Chime = "treasure0" | "treasure1" | "treasure2" | "treasure3" | "buy" | "tick" | "nothing" | "win" | "jackpot" | "duplicate" | "denied";

export function chime(s: Synth, c: Chime) {
  switch (c) {
    case "treasure0":
      s.tone(C7, 0.2, "triangle", 0.06);
      s.tone(2637, 0.25, "triangle", 0.04, 0.05);
      break;
    case "treasure1":
      [C6, E6, G6].forEach((f, i) => s.tone(f, 0.35, "triangle", 0.06, i * 0.05));
      break;
    case "treasure2":
      [G5, C6, E6, G6].forEach((f, i) => s.tone(f, 0.5, "triangle", 0.06, i * 0.06));
      s.hiss(3000, 7000, 0.5, 0.03, "highpass", 0.2);
      break;
    case "treasure3":
      [C5, G5, C6, E6, G6, C7].forEach((f, i) => s.tone(f, 0.9, "triangle", 0.06, i * 0.07));
      [C5 / 2, G5 / 2].forEach((f) => s.tone(f, 1.6, "sine", 0.08, 0.1));
      s.hiss(2000, 8000, 1, 0.04, "highpass", 0.3);
      break;
    case "buy":
      [E6, C7].forEach((f, i) => s.tone(f, 0.3, "triangle", 0.07, i * 0.07));
      s.crackle(6, 0.2, 0.02, 4000, 0.05);
      break;
    case "tick":
      s.tone(2400, 0.03, "square", 0.025);
      break;
    case "nothing":
      [G5, E5].forEach((f, i) => s.tone(f, 0.35, "sine", 0.06, i * 0.15));
      break;
    case "win":
      [C6, E6, G6, C7].forEach((f, i) => s.tone(f, 0.6, "triangle", 0.07, i * 0.08));
      break;
    case "jackpot":
      [C5, E5, G5, C6, E6, G6, C7].forEach((f, i) => s.tone(f, 1.2, "triangle", 0.06, i * 0.08));
      [C5 / 2, G5 / 2, C5].forEach((f) => s.tone(f, 2.2, "sine", 0.07, 0.2));
      s.hiss(2000, 9000, 1.6, 0.05, "highpass", 0.5);
      break;
    case "duplicate":
      [E6, C6].forEach((f, i) => s.tone(f, 0.3, "sine", 0.05, i * 0.1));
      break;
    case "denied":
      s.tone(220, 0.18, "square", 0.03);
      break;
  }
}

// --- the menus' own synth ------------------------------------------------------------

let page: { synth: Synth; gain: GainNode } | null = null;

function pageSynth(): Synth | null {
  const settings = loadSettings();
  const volume = settings.effectsVolume ?? 1;
  if (settings.muted || volume <= 0) return null;
  try {
    if (!page) {
      const ctx = new AudioContext();
      const gain = ctx.createGain();
      gain.connect(ctx.destination);
      page = { synth: new Synth(ctx, gain, noiseBuffer(ctx)), gain };
    }
    if (page.synth.ctx.state === "suspended") void page.synth.ctx.resume();
    page.gain.gain.value = 0.9 * volume;
    return page.synth;
  } catch {
    return null;
  }
}

/** A collectible's signature, from a menu (call from a click: browsers need a gesture to start audio) */
export function playVoice(v: Voice, level = 1) {
  const synth = pageSynth();
  if (synth) voice(synth, v, level);
}

export function playChime(c: Chime) {
  const synth = pageSynth();
  if (synth) chime(synth, c);
}
