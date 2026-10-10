// Wind and event sounds are synthesized (filtered noise, short tones); the
// music (music.ts) and the wingbeat are recorded samples from public/audio.
// Browsers only start audio after a user gesture, so call start() from a click.

import { MusicPlayer } from "./music";
import { AUDIO } from "./tuning";
import type { BiomeId } from "./world/biomes/types";

const WINGBEAT = "audio/sfx/wingbeat.mp3";

/** A sample with where its sound really starts and how loud it is, so it lands on the beat at a known level */
interface Sample {
  buffer: AudioBuffer;
  offset: number; // seconds of leading silence to skip
  gain: number; // brings the loudest peak to 0.9
}

/** Finds the first audible moment (a recording usually starts with silence, which would delay the sound) and the peak */
function trimmed(buffer: AudioBuffer): Sample {
  let peak = 0;
  for (let c = 0; c < buffer.numberOfChannels; c++) {
    for (const v of buffer.getChannelData(c)) peak = Math.max(peak, Math.abs(v));
  }
  if (peak <= 0) return { buffer, offset: 0, gain: 1 };
  let first = buffer.length;
  for (let c = 0; c < buffer.numberOfChannels; c++) {
    const data = buffer.getChannelData(c);
    for (let i = 0; i < first; i++) {
      if (Math.abs(data[i]) > peak * 0.08) {
        first = i;
        break;
      }
    }
  }
  return { buffer, offset: Math.max(0, first / buffer.sampleRate - 0.005), gain: 0.9 / peak };
}

export class GameAudio {
  private ctx: AudioContext | null = null;
  private music: MusicPlayer | null = null;
  private wingbeat: Sample | null = null;
  private biome: { id: BiomeId; night: number } | null = null;
  private master: GainNode | null = null;
  private windGain: GainNode | null = null;
  private windFilter: BiquadFilterNode | null = null;
  private rushGain: GainNode | null = null;
  private noise: AudioBuffer | null = null;
  private muted = false;
  private paused = false;

  get isMuted(): boolean {
    return this.muted;
  }

  start() {
    if (this.ctx) {
      void this.ctx.resume();
      return;
    }
    const ctx = new AudioContext();
    this.ctx = ctx;
    this.master = ctx.createGain();
    this.master.gain.value = this.muted || this.paused ? 0 : 0.8;
    this.master.connect(ctx.destination);

    const length = ctx.sampleRate * 2;
    this.noise = ctx.createBuffer(1, length, ctx.sampleRate);
    const data = this.noise.getChannelData(0);
    // Brown-ish noise sounds more like wind than white noise
    let last = 0;
    for (let i = 0; i < length; i++) {
      last = (last + 0.02 * (Math.random() * 2 - 1)) / 1.02;
      data[i] = last * 3.5;
    }

    // Wind: louder and brighter with speed
    this.windFilter = ctx.createBiquadFilter();
    this.windFilter.type = "lowpass";
    this.windGain = ctx.createGain();
    this.windGain.gain.value = 0;
    this.loop().connect(this.windFilter).connect(this.windGain).connect(this.master);

    // Rush: a hiss when skimming the rock
    const rushFilter = ctx.createBiquadFilter();
    rushFilter.type = "bandpass";
    rushFilter.frequency.value = 2400;
    rushFilter.Q.value = 0.8;
    this.rushGain = ctx.createGain();
    this.rushGain.gain.value = 0;
    const rush = ctx.createBufferSource();
    const white = ctx.createBuffer(1, length, ctx.sampleRate);
    const whiteData = white.getChannelData(0);
    for (let i = 0; i < length; i++) whiteData[i] = Math.random() * 2 - 1;
    rush.buffer = white;
    rush.loop = true;
    rush.connect(rushFilter).connect(this.rushGain).connect(this.master);
    rush.start();

    this.music = new MusicPlayer(ctx, this.master);
    if (this.biome) this.music.setBiome(this.biome.id, this.biome.night);
    fetch(import.meta.env.BASE_URL + WINGBEAT)
      .then((res) => (res.ok ? res.arrayBuffer() : Promise.reject(new Error(res.statusText))))
      .then((data) => ctx.decodeAudioData(data))
      .then((buffer) => (this.wingbeat = trimmed(buffer)))
      .catch((e) => console.warn("Wingbeat sample not loaded, using the synthesized whoosh:", e));
  }

  /** The music file playing right now (null before audio starts or while it loads) */
  get track(): string | null {
    return this.music?.playing ?? null;
  }

  /** The level's biome and how dark it is: picks the music (call as often as you like) */
  setBiome(id: BiomeId, night: number) {
    this.biome = { id, night };
    this.music?.setBiome(id, night);
  }

  /**
   * One wing downstroke of the pilot, `strength` 0..1, called on the beat of the
   * animation. A soft feathery flap, never the same twice; harder effort is louder.
   */
  wing(strength: number) {
    this.sample(this.wingbeat, 0.5 + 0.4 * strength);
  }

  private sample(sample: Sample | null, volume: number) {
    if (!this.ctx || !this.master || !sample) return;
    const source = this.ctx.createBufferSource();
    source.buffer = sample.buffer;
    source.playbackRate.value = 0.94 + Math.random() * 0.12;
    const gain = this.ctx.createGain();
    gain.gain.value = volume * sample.gain * AUDIO.sfx;
    source.connect(gain).connect(this.master);
    source.start(0, sample.offset); // from the first audible moment, so it lands with the stroke
  }

  private loop(): AudioBufferSourceNode {
    const source = this.ctx!.createBufferSource();
    source.buffer = this.noise;
    source.loop = true;
    source.start();
    return source;
  }

  toggleMute(): boolean {
    this.muted = !this.muted;
    this.updateVolume();
    return this.muted;
  }

  /** Silence gameplay during pause without changing the player's mute setting. */
  setPaused(paused: boolean) {
    this.paused = paused;
    this.updateVolume();
  }

  private updateVolume() {
    if (this.master && this.ctx) this.master.gain.setTargetAtTime(this.muted || this.paused ? 0 : 0.8, this.ctx.currentTime, 0.05);
  }

  /** Per frame: speed in m/s, proximity 0..1, flying = false while crashed or frozen */
  update(speed: number, proximity: number, flying: boolean) {
    if (!this.ctx || !this.windGain || !this.windFilter || !this.rushGain) return;
    const now = this.ctx.currentTime;
    const s = Math.min(1, Math.max(0, (speed - 10) / 90));
    this.windGain.gain.setTargetAtTime(flying ? 0.08 + 0.5 * s * s : 0.03, now, 0.1);
    this.windFilter.frequency.setTargetAtTime(250 + 2200 * s, now, 0.1);
    this.rushGain.gain.setTargetAtTime(flying ? 0.25 * proximity * proximity * (0.3 + s) : 0, now, 0.05);
    this.music?.update();
  }

  private tone(frequency: number, duration: number, type: OscillatorType, volume: number, delay = 0) {
    if (!this.ctx || !this.master) return;
    const start = this.ctx.currentTime + delay;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = type;
    osc.frequency.value = frequency;
    gain.gain.setValueAtTime(0, start);
    gain.gain.linearRampToValueAtTime(volume, start + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
    osc.connect(gain).connect(this.master);
    osc.start(start);
    osc.stop(start + duration + 0.05);
  }

  ring() {
    this.tone(880, 0.25, "triangle", 0.25);
    this.tone(1320, 0.35, "triangle", 0.2, 0.08);
  }

  finish() {
    [660, 880, 1100, 1320].forEach((f, i) => this.tone(f, 0.5, "triangle", 0.22, i * 0.11));
  }

  beep(final: boolean) {
    this.tone(final ? 1046 : 523, final ? 0.6 : 0.18, "square", 0.08);
  }

  /** The Wingbeat ability: a strong flap (the synthesized whoosh if the sample hasn't loaded) */
  flap() {
    if (this.wingbeat) return this.sample(this.wingbeat, 1);
    if (!this.ctx || !this.master || !this.noise) return;
    const now = this.ctx.currentTime;
    const source = this.ctx.createBufferSource();
    source.buffer = this.noise;
    const filter = this.ctx.createBiquadFilter();
    filter.type = "bandpass";
    filter.frequency.setValueAtTime(400, now);
    filter.frequency.exponentialRampToValueAtTime(1400, now + 0.25);
    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.5, now + 0.05);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.35);
    source.connect(filter).connect(gain).connect(this.master);
    source.start(now);
    source.stop(now + 0.4);
  }

  /** Short musical cues for the roguelike run */
  stinger(kind: "portal" | "upgrade" | "quest" | "item" | "dash") {
    if (kind === "item") {
      this.tone(1175, 0.18, "triangle", 0.16);
      this.tone(1568, 0.22, "triangle", 0.12, 0.05);
    } else if (kind === "quest") {
      // A rising major arpeggio
      [523, 659, 784, 1047, 1319].forEach((f, i) => this.tone(f, 0.45, "triangle", 0.18, i * 0.08));
    } else if (kind === "portal") {
      // A shimmering chord swelling up
      [392, 494, 587, 740].forEach((f, i) => this.tone(f, 1.4, "sine", 0.14, i * 0.04));
      [1568, 1976].forEach((f, i) => this.tone(f, 0.8, "triangle", 0.07, 0.3 + i * 0.1));
    } else if (kind === "upgrade") {
      [659, 988, 1319].forEach((f, i) => this.tone(f, 0.5, "triangle", 0.18, i * 0.06));
    } else {
      this.tone(220, 0.25, "sawtooth", 0.06);
      this.tone(440, 0.3, "triangle", 0.1, 0.03);
    }
  }

  crash() {
    if (!this.ctx || !this.master || !this.noise) return;
    const now = this.ctx.currentTime;
    const source = this.ctx.createBufferSource();
    source.buffer = this.noise;
    const filter = this.ctx.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.setValueAtTime(1800, now);
    filter.frequency.exponentialRampToValueAtTime(80, now + 0.8);
    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(1.2, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.9);
    source.connect(filter).connect(gain).connect(this.master);
    source.start(now);
    source.stop(now + 1);
    this.tone(90, 0.5, "sine", 0.5);
  }

  dispose() {
    void this.ctx?.close();
    this.ctx = null;
    this.music = null;
  }
}
