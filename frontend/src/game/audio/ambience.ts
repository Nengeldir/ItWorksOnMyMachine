// Ambience beds (plan F9): looping layers of wind, birds, water, a cave's hum and a town's wind chimes,
// mixed by where the pilot is. Each region of the Reaches names how much of each bed it has
// (`REGION_BEDS`); standing between two regions blends them by weight. The beds are synthesized into
// small loops (22 kHz mono, ~1.4 MB decoded in all) whose ends are crossfaded into their starts
// (`seamlessLoop`), so the loop point never clicks.

export type Bed = "wind" | "birds" | "water" | "cave" | "town";
export const BEDS: readonly Bed[] = ["wind", "birds", "water", "cave", "town"];

/** Per region of shared/catalog/regions.json, plus the hub */
export const REGION_BEDS: Record<string, Partial<Record<Bed, number>>> = {
  lanternhaven: { town: 0.8, wind: 0.25, birds: 0.35 },
  meadow_rise: { birds: 0.8, wind: 0.4 },
  lantern_wood: { birds: 0.45, wind: 0.2, town: 0.15 },
  starfall_summit: { wind: 0.9 },
  frostspine: { wind: 0.85, cave: 0.15 },
  cinder_steps: { wind: 0.5, cave: 0.35 },
  old_isles: { wind: 0.6, birds: 0.3 },
  cloudsea_isles: { wind: 0.7, water: 0.3 },
  drowned_garden: { water: 0.8, cave: 0.2 },
  shellshore: { water: 0.9, birds: 0.35 },
  hollow_deeps: { cave: 0.95, water: 0.15 },
};

/** Each bed's level for weights per region (summed, capped at 1); regions not listed add nothing */
export function bedLevels(regionWeights: Readonly<Record<string, number>>): Record<Bed, number> {
  const out: Record<Bed, number> = { wind: 0, birds: 0, water: 0, cave: 0, town: 0 };
  for (const [region, weight] of Object.entries(regionWeights)) {
    const beds = REGION_BEDS[region];
    if (!beds || !(weight > 0)) continue;
    for (const bed of BEDS) out[bed] += (beds[bed] ?? 0) * weight;
  }
  for (const bed of BEDS) out[bed] = Math.min(1, out[bed]);
  return out;
}

/**
 * Makes `data` loop without a click: the result is `fade` samples shorter, and its first `fade` samples
 * crossfade (equal power) from the original's tail into its head. So the loop's last sample runs on into
 * its first exactly as the original ran on past that point
 */
export function seamlessLoop(data: Float32Array, fade: number): Float32Array {
  const f = Math.max(1, Math.min(Math.floor(fade), Math.floor(data.length / 2)));
  const length = data.length - f;
  const out = new Float32Array(length);
  out.set(data.subarray(0, length));
  for (let i = 0; i < f; i++) {
    const k = i / f;
    out[i] = data[i] * Math.sin((k * Math.PI) / 2) + data[length + i] * Math.cos((k * Math.PI) / 2);
  }
  return out;
}

const RATE = 22050;

function buffer(ctx: BaseAudioContext, data: Float32Array): AudioBuffer {
  const b = ctx.createBuffer(1, data.length, RATE);
  b.getChannelData(0).set(data);
  return b;
}

/** Brown noise, `seconds` long, looping */
function noiseLoop(seconds: number): Float32Array {
  const raw = new Float32Array(Math.floor(RATE * (seconds + 0.25)));
  let last = 0;
  for (let i = 0; i < raw.length; i++) {
    last = (last + 0.02 * (Math.random() * 2 - 1)) / 1.02;
    raw[i] = last * 3.5;
  }
  return seamlessLoop(raw, RATE * 0.25);
}

/** A sine sweep added into `data` at `at` s: a bird's chirp or a chime's ring */
function addTone(data: Float32Array, at: number, from: number, to: number, seconds: number, volume: number, decay: number) {
  const start = Math.floor(at * RATE);
  const n = Math.floor(seconds * RATE);
  let phase = 0;
  for (let i = 0; i < n && start + i < data.length; i++) {
    const k = i / n;
    phase += (2 * Math.PI * (from + (to - from) * k)) / RATE;
    const envelope = Math.min(1, i / (RATE * 0.004)) * Math.exp(-decay * k);
    data[start + i] += Math.sin(phase) * volume * envelope;
  }
}

function birdsLoop(seconds: number): Float32Array {
  const raw = new Float32Array(Math.floor(RATE * (seconds + 0.3)));
  for (let t = 0.2; t < seconds; t += 0.35 + Math.random() * 1.1) {
    const pitch = 2200 + Math.random() * 2600;
    const notes = 1 + Math.floor(Math.random() * 4);
    for (let n = 0; n < notes; n++) addTone(raw, t + n * 0.09, pitch * (1 + Math.random() * 0.15), pitch * (0.75 + Math.random() * 0.5), 0.07, 0.12, 3);
  }
  return seamlessLoop(raw, RATE * 0.3);
}

function chimesLoop(seconds: number): Float32Array {
  const raw = new Float32Array(Math.floor(RATE * (seconds + 0.5)));
  const notes = [1046.5, 1174.66, 1318.51, 1567.98, 1760, 2093];
  for (let t = 0.1; t < seconds; t += 0.4 + Math.random() * 0.9) {
    const f = notes[Math.floor(Math.random() * notes.length)];
    addTone(raw, t, f, f, 1.6, 0.05, 4);
    addTone(raw, t, f * 2.76, f * 2.76, 0.6, 0.012, 6);
  }
  return seamlessLoop(raw, RATE * 0.5);
}

interface BedNodes {
  gain: GainNode;
  stop: () => void;
}

export class Ambience {
  private readonly ctx: BaseAudioContext;
  private readonly out: AudioNode;
  private beds: Partial<Record<Bed, BedNodes>> = {};
  private noise: AudioBuffer | null = null;

  constructor(ctx: BaseAudioContext, out: AudioNode) {
    this.ctx = ctx;
    this.out = out;
  }

  private loop(data: AudioBuffer, ...chain: AudioNode[]): AudioBufferSourceNode {
    const source = this.ctx.createBufferSource();
    source.buffer = data;
    source.loop = true;
    let node: AudioNode = source;
    for (const next of chain) node = node.connect(next);
    source.start(0, Math.random() * data.duration);
    return source;
  }

  /** A slow swell on a gain: the bed breathes instead of droning */
  private swell(param: AudioParam, rate: number, depth: number): OscillatorNode {
    const lfo = this.ctx.createOscillator();
    const amount = this.ctx.createGain();
    lfo.frequency.value = rate;
    amount.gain.value = depth;
    lfo.connect(amount).connect(param);
    lfo.start();
    return lfo;
  }

  private build(bed: Bed): BedNodes {
    const ctx = this.ctx;
    const gain = ctx.createGain();
    gain.gain.value = 0;
    gain.connect(this.out);
    const noise = (this.noise ??= buffer(ctx, noiseLoop(4)));
    const stops: (() => void)[] = [];
    const shaped = ctx.createGain();
    shaped.gain.value = 0.7;
    shaped.connect(gain);
    if (bed === "wind" || bed === "water" || bed === "cave") {
      const filter = ctx.createBiquadFilter();
      filter.type = bed === "water" ? "bandpass" : "lowpass";
      filter.frequency.value = bed === "wind" ? 520 : bed === "water" ? 900 : 180;
      filter.Q.value = bed === "water" ? 0.7 : 0.5;
      const source = this.loop(noise, filter, shaped);
      const lfo = this.swell(shaped.gain, bed === "wind" ? 0.07 : bed === "water" ? 0.31 : 0.05, bed === "cave" ? 0.15 : 0.3);
      stops.push(() => source.stop(), () => lfo.stop());
      if (bed === "cave") {
        for (const f of [55, 82.4]) {
          const osc = ctx.createOscillator();
          const level = ctx.createGain();
          osc.frequency.value = f;
          level.gain.value = 0.05;
          osc.connect(level).connect(gain);
          osc.start();
          stops.push(() => osc.stop());
        }
      }
    } else {
      const source = this.loop(buffer(ctx, bed === "birds" ? birdsLoop(6) : chimesLoop(6)), shaped);
      stops.push(() => source.stop());
    }
    return { gain, stop: () => stops.forEach((stop) => stop()) };
  }

  /** Where the pilot is, as weights per region (they needn't add to 1); beds fade over ~1.5 s */
  setWeights(regionWeights: Readonly<Record<string, number>>) {
    const levels = bedLevels(regionWeights);
    const now = this.ctx.currentTime;
    for (const bed of BEDS) {
      if (levels[bed] <= 0 && !this.beds[bed]) continue;
      const nodes = (this.beds[bed] ??= this.build(bed));
      nodes.gain.gain.setTargetAtTime(levels[bed] * 0.35, now, 0.5);
    }
  }

  dispose() {
    for (const bed of BEDS) this.beds[bed]?.stop();
    this.beds = {};
  }
}
