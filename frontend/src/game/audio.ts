// All sound is synthesized: filtered noise for wind, short tones for events.
// Browsers only start audio after a user gesture, so call start() from a click.

export class GameAudio {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private windGain: GainNode | null = null;
  private windFilter: BiquadFilterNode | null = null;
  private rushGain: GainNode | null = null;
  private noise: AudioBuffer | null = null;
  private muted = false;

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
    this.master.gain.value = this.muted ? 0 : 0.8;
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
    if (this.master && this.ctx) this.master.gain.setTargetAtTime(this.muted ? 0 : 0.8, this.ctx.currentTime, 0.05);
    return this.muted;
  }

  /** Per frame: speed in m/s, proximity 0..1, flying = false while crashed or frozen */
  update(speed: number, proximity: number, flying: boolean) {
    if (!this.ctx || !this.windGain || !this.windFilter || !this.rushGain) return;
    const now = this.ctx.currentTime;
    const s = Math.min(1, Math.max(0, (speed - 10) / 90));
    this.windGain.gain.setTargetAtTime(flying ? 0.08 + 0.5 * s * s : 0.03, now, 0.1);
    this.windFilter.frequency.setTargetAtTime(250 + 2200 * s, now, 0.1);
    this.rushGain.gain.setTargetAtTime(flying ? 0.25 * proximity * proximity * (0.3 + s) : 0, now, 0.05);
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

  /** A whoosh of wind for a wingbeat */
  flap() {
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
  }
}
