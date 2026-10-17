// Audio buses (plan F9): every sound goes into one of six buses, each with its own volume (a settings
// slider) and a ducker, all summed into the output. Music dips under a level-up or a boss's tell with
// `duck("music", 4, 1.5)`.

export const BUSES = ["music", "ambience", "world", "combat", "ui", "voice"] as const;
export type BusId = (typeof BUSES)[number];

/** -4 dB -> 0.63 */
export const dbToGain = (db: number) => 10 ** (db / 20);

export class AudioBuses {
  /** Where a bus's sources connect */
  readonly input: Record<BusId, GainNode>;
  private readonly ducker: Record<BusId, GainNode>;
  private readonly ctx: BaseAudioContext;
  /** Until when each bus is ducked, and how deep (gain), so overlapping ducks keep the deepest */
  private ducked: Partial<Record<BusId, { until: number; gain: number }>> = {};

  constructor(ctx: BaseAudioContext, out: AudioNode) {
    this.ctx = ctx;
    const input = {} as Record<BusId, GainNode>;
    const ducker = {} as Record<BusId, GainNode>;
    for (const bus of BUSES) {
      input[bus] = ctx.createGain();
      ducker[bus] = ctx.createGain();
      input[bus].connect(ducker[bus]).connect(out);
    }
    this.input = input;
    this.ducker = ducker;
  }

  /** A bus's volume, 0..1 (eased over 50 ms, so a slider never clicks) */
  setVolume(bus: BusId, volume: number) {
    this.input[bus].gain.setTargetAtTime(Math.max(0, Math.min(1, volume)), this.ctx.currentTime, 0.05);
  }

  setVolumes(volumes: Partial<Record<BusId, number>>) {
    for (const bus of BUSES) if (volumes[bus] !== undefined) this.setVolume(bus, volumes[bus]!);
  }

  /** Lowers `bus` by `db` for `seconds`, easing in over 80 ms and back over 400 ms */
  duck(bus: BusId, db: number, seconds: number) {
    const now = this.ctx.currentTime;
    const gain = dbToGain(-Math.abs(db));
    const was = this.ducked[bus];
    const deepest = was && was.until > now ? Math.min(was.gain, gain) : gain;
    const until = Math.max(was && was.until > now ? was.until : 0, now + seconds);
    this.ducked[bus] = { until, gain: deepest };
    const param = this.ducker[bus].gain;
    param.cancelScheduledValues(now);
    param.setTargetAtTime(deepest, now, 0.08 / 3);
    param.setTargetAtTime(1, until, 0.4 / 3);
  }
}
