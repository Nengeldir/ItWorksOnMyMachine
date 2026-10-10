// Wind and event sounds are synthesized (filtered noise, short tones); the
// music (music.ts) and the wingbeat are recorded samples from public/audio.
// Browsers only start audio after a user gesture, so call start() from a click.

import type { AbilitySound2 } from "./abilities/fx2";
import { MusicPlayer } from "./music";
import { AUDIO } from "./tuning";
import type { BiomeId } from "./world/biomes/types";

const WINGBEAT = "audio/sfx/wingbeat.mp3";

export class GameAudio {
  private ctx: AudioContext | null = null;
  private music: MusicPlayer | null = null;
  private wingbeat: AudioBuffer | null = null;
  private biome: { id: BiomeId; night: number } | null = null;
  private master: GainNode | null = null;
  private effects: GainNode | null = null;
  private musicVolume = 1;
  private effectsVolume = 1;
  private windGain: GainNode | null = null;
  private windFilter: BiquadFilterNode | null = null;
  private rushGain: GainNode | null = null;
  private noise: AudioBuffer | null = null;
  private muted = false;
  private paused = false;
  private boosting = false;
  private hum: { gain: GainNode; oscillators: OscillatorNode[] } | null = null;

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
    this.effects = ctx.createGain();
    this.effects.gain.value = this.effectsVolume;
    this.effects.connect(this.master);

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
    this.loop().connect(this.windFilter).connect(this.windGain).connect(this.effects!);

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
    rush.connect(rushFilter).connect(this.rushGain).connect(this.effects!);
    rush.start();

    this.music = new MusicPlayer(ctx, this.master);
    this.music.volume = this.musicVolume;
    if (this.biome) this.music.setBiome(this.biome.id, this.biome.night);
    fetch(import.meta.env.BASE_URL + WINGBEAT)
      .then((res) => (res.ok ? res.arrayBuffer() : Promise.reject(new Error(res.statusText))))
      .then((data) => ctx.decodeAudioData(data))
      .then((buffer) => (this.wingbeat = buffer))
      .catch(() => {}); // the synthesized whoosh stays
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

  /** One wing downstroke of the pilot, `strength` 0..1: a soft feathery flap, never the same twice */
  wing(strength: number) {
    this.sample(this.wingbeat, 0.12 + 0.3 * strength);
  }

  private sample(buffer: AudioBuffer | null, volume: number) {
    if (!this.ctx || !this.master || !buffer) return;
    const source = this.ctx.createBufferSource();
    source.buffer = buffer;
    source.playbackRate.value = 0.92 + Math.random() * 0.16;
    const gain = this.ctx.createGain();
    gain.gain.value = volume * AUDIO.sfx;
    source.connect(gain).connect(this.effects!);
    source.start();
  }

  private loop(): AudioBufferSourceNode {
    const source = this.ctx!.createBufferSource();
    source.buffer = this.noise;
    source.loop = true;
    source.start();
    return source;
  }

  setPreferences(music: number, effects: number, muted?: boolean) {
    this.musicVolume = music; this.effectsVolume = effects;
    if (muted !== undefined) this.muted = muted;
    if (this.music) { this.music.volume = music; this.music.update(); }
    if (this.effects && this.ctx) this.effects.gain.setTargetAtTime(effects, this.ctx.currentTime, 0.05);
    this.updateVolume();
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
  update(speed: number, proximity: number, flying: boolean, boost = 0, brake = 0) {
    if (!this.ctx || !this.windGain || !this.windFilter || !this.rushGain) return;
    if (flying && boost > 0.1 && !this.boosting) this.flap();
    this.boosting = flying && boost > 0.1;
    const now = this.ctx.currentTime;
    const s = Math.min(1, Math.max(0, (speed - 10) / 90));
    this.windGain.gain.setTargetAtTime(flying ? 0.08 + 0.5 * s * s + boost * 0.12 : 0.03, now, 0.1);
    this.windFilter.frequency.setTargetAtTime(250 + 2200 * s, now, 0.1);
    this.rushGain.gain.setTargetAtTime(flying ? 0.25 * proximity * proximity * (0.3 + s) + brake * s * 0.12 : 0, now, 0.05);
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
    osc.connect(gain).connect(this.effects!);
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
    if (this.wingbeat) return this.sample(this.wingbeat, 0.8);
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
    source.connect(filter).connect(gain).connect(this.effects!);
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
      // A rising whoosh, then a shimmering chord swelling up
      this.sweep(200, 2400, 0.9, 0.55);
      [392, 494, 587, 740].forEach((f, i) => this.tone(f, 2.2, "sine", 0.3, i * 0.04));
      [196, 98].forEach((f) => this.tone(f, 2.2, "triangle", 0.3));
      [1568, 1976, 2349].forEach((f, i) => this.tone(f, 1.2, "triangle", 0.14, 0.3 + i * 0.1));
    } else if (kind === "upgrade") {
      [659, 988, 1319].forEach((f, i) => this.tone(f, 0.5, "triangle", 0.18, i * 0.06));
    } else {
      this.tone(220, 0.25, "sawtooth", 0.06);
      this.tone(440, 0.3, "triangle", 0.1, 0.03);
    }
  }

  /** A filtered rush of noise: `from` → `to` Hz over `duration`, peaking at `volume` */
  private whoosh(from: number, to: number, duration: number, volume: number, type: BiquadFilterType = "bandpass") {
    if (!this.ctx || !this.effects || !this.noise) return;
    const now = this.ctx.currentTime;
    const source = this.ctx.createBufferSource();
    source.buffer = this.noise;
    const filter = this.ctx.createBiquadFilter();
    filter.type = type;
    filter.frequency.setValueAtTime(from, now);
    filter.frequency.exponentialRampToValueAtTime(to, now + duration);
    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(volume, now + Math.min(0.06, duration * 0.3));
    gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);
    source.connect(filter).connect(gain).connect(this.effects);
    source.start(now);
    source.stop(now + duration + 0.05);
  }

  /** Filtered noise sweeping from `from` to `to` Hz */
  private sweep(from: number, to: number, duration: number, volume: number) {
    if (!this.ctx || !this.noise || !this.effects) return;
    const now = this.ctx.currentTime;
    const source = this.ctx.createBufferSource();
    source.buffer = this.noise;
    const filter = this.ctx.createBiquadFilter();
    filter.type = "bandpass";
    filter.Q.value = 1.2;
    filter.frequency.setValueAtTime(from, now);
    filter.frequency.exponentialRampToValueAtTime(to, now + duration);
    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(volume, now + duration * 0.4);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);
    source.connect(filter).connect(gain).connect(this.effects);
    source.start(now);
    source.stop(now + duration + 0.05);
  }

  /** A tone gliding from one pitch to another */
  private glide(from: number, to: number, duration: number, type: OscillatorType, volume: number, delay = 0) {
    if (!this.ctx || !this.effects) return;
    const start = this.ctx.currentTime + delay;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(from, start);
    osc.frequency.exponentialRampToValueAtTime(to, start + duration);
    gain.gain.setValueAtTime(0, start);
    gain.gain.linearRampToValueAtTime(volume, start + 0.04);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
    osc.connect(gain).connect(this.effects);
    osc.start(start);
    osc.stop(start + duration + 0.05);
  }

  /** The run's abilities (game/abilities/fx.ts) */
  ability(kind: "plunge" | "strike" | "shear" | "burst" | "recover" | "hang" | "launch" | "manta") {
    switch (kind) {
      case "plunge":
        // A falling star's whistle
        this.glide(1500, 380, 0.7, "sine", 0.1);
        this.whoosh(600, 2400, 0.6, 0.35);
        break;
      case "strike":
        // A deep thump, a ringing chime over it
        this.glide(140, 45, 0.6, "sine", 0.45);
        this.whoosh(2400, 200, 0.7, 0.6, "lowpass");
        [1568, 2093, 2637].forEach((f, i) => this.tone(f, 0.7, "triangle", 0.1, 0.03 + i * 0.05));
        break;
      case "shear":
        this.whoosh(900, 4200, 0.2, 0.55, "highpass");
        this.tone(1760, 0.12, "triangle", 0.05);
        break;
      case "burst":
        // Wind swelling up under a bright open chord
        this.whoosh(200, 1800, 1.3, 0.7);
        [523, 784, 1047, 1319].forEach((f, i) => this.tone(f, 1.2, "triangle", 0.11, i * 0.07));
        break;
      case "recover":
        this.whoosh(700, 2600, 0.3, 0.4);
        [1760, 2349].forEach((f, i) => this.tone(f, 0.3, "triangle", 0.1, i * 0.07));
        break;
      case "hang":
        [784, 988, 1175].forEach((f, i) => this.tone(f, 0.9, "sine", 0.08, i * 0.06));
        break;
      case "launch":
        this.flap();
        this.whoosh(400, 1600, 0.45, 0.45);
        break;
      case "manta":
        // A soft call from far off, like Sky's mantas
        this.glide(330, 494, 1.1, "sine", 0.07);
        this.glide(220, 330, 1.3, "sine", 0.05, 0.15);
        break;
    }
  }

  /** The design list's abilities 11 to 20 (game/abilities/fx2.ts); `pitch` scales chimes */
  ability2(kind: AbilitySound2, pitch = 1) {
    switch (kind) {
      case "moth":
        // Wings of light fluttering past: two soft sparkles
        this.tone(1319 * pitch, 0.25, "sine", 0.06);
        this.tone(1760 * pitch, 0.3, "sine", 0.05, 0.07);
        this.whoosh(1800, 4200, 0.25, 0.12, "highpass");
        break;
      case "bullseye":
        [1047, 1319, 1568, 2093].forEach((f, i) => this.tone(f, 0.8, "triangle", 0.09, i * 0.045));
        this.glide(2093, 3136, 0.4, "sine", 0.05, 0.2);
        break;
      case "apex":
        [1568, 2093, 2637].forEach((f, i) => this.tone(f, 0.6, "sine", 0.07, i * 0.06));
        break;
      case "sing":
        // A call like Sky's: two voices gliding up together, a breath of air under them
        this.glide(523, 784, 0.7, "sine", 0.13);
        this.glide(659, 988, 0.75, "sine", 0.08, 0.05);
        this.glide(262, 392, 0.8, "triangle", 0.05);
        this.whoosh(500, 2200, 0.6, 0.18);
        break;
      case "attune":
        this.tone(880 * pitch, 0.7, "triangle", 0.07);
        this.tone(1320 * pitch, 0.55, "sine", 0.05, 0.04);
        break;
      case "ley":
        [392, 523, 659, 784, 1047].forEach((f, i) => this.tone(f, 0.9, "sine", 0.1, i * 0.07));
        this.glide(98, 196, 1.4, "triangle", 0.12);
        break;
      case "leyEnd":
        [1047, 784, 587].forEach((f, i) => this.tone(f, 0.35, "triangle", 0.06, i * 0.07));
        break;
      case "flare":
        // Cloth snapping open against the wind
        this.whoosh(2400, 260, 0.55, 0.6, "lowpass");
        this.whoosh(300, 1000, 0.22, 0.35);
        break;
      case "tornado":
        this.whoosh(300, 1600, 1, 0.35);
        this.tone(784, 0.6, "sine", 0.05, 0.2);
        break;
      case "shield":
        this.whoosh(2200, 200, 0.6, 0.55, "lowpass");
        [1175, 1760].forEach((f, i) => this.tone(f, 0.45, "triangle", 0.09, i * 0.06));
        break;
      case "ascend":
        this.whoosh(200, 2600, 1.2, 0.7);
        this.glide(220, 880, 0.9, "sine", 0.1);
        break;
      case "falcon":
        // A far-off falcon's cry, twice
        this.glide(2600, 1800, 0.35, "sine", 0.06);
        this.glide(2400, 1500, 0.45, "sine", 0.05, 0.4);
        this.whoosh(900, 3600, 0.5, 0.3, "highpass");
        break;
      case "butterfly":
        [1568, 1976, 2349, 2637].forEach((f, i) => this.tone(f, 0.5, "sine", 0.05, i * 0.08));
        break;
      case "stanceOff":
        [880, 660].forEach((f, i) => this.tone(f, 0.3, "sine", 0.06, i * 0.06));
        break;
      case "echo":
        this.whoosh(300, 2400, 0.8, 0.5);
        [523, 659, 784, 1047].forEach((f, i) => this.tone(f, 1, "triangle", 0.09, i * 0.05));
        break;
      case "echoPass":
        this.whoosh(600, 2400, 0.4, 0.45);
        this.tone(1319, 0.4, "triangle", 0.07);
        break;
    }
  }

  /** A humming drone that swells as you near a portal (`near` 0..1, 0 = silent) */
  portalHum(near: number) {
    if (!this.ctx || !this.effects) return;
    if (!this.hum) {
      if (near <= 0) return;
      const gain = this.ctx.createGain();
      gain.gain.value = 0;
      gain.connect(this.effects);
      const oscillators = [110, 165, 220.7].map((f) => {
        const osc = this.ctx!.createOscillator();
        osc.type = "sine";
        osc.frequency.value = f;
        osc.connect(gain);
        osc.start();
        return osc;
      });
      this.hum = { gain, oscillators };
    }
    const now = this.ctx.currentTime;
    this.hum.gain.gain.setTargetAtTime(near * near * 0.22, now, 0.15);
    // Rises in pitch as you close in
    this.hum.oscillators.forEach((osc, i) => osc.frequency.setTargetAtTime([110, 165, 220.7][i] * (1 + near * 0.35), now, 0.2));
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
    source.connect(filter).connect(gain).connect(this.effects!);
    source.start(now);
    source.stop(now + 1);
    this.tone(90, 0.5, "sine", 0.5);
  }

  dispose() {
    void this.ctx?.close();
    this.ctx = null;
    this.hum = null;
    this.music = null;
  }
}
