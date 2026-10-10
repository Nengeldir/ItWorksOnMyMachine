import { Quaternion, Vector3 } from "three";
import type { PilotSample } from "./pilots";

/** A recorded run: samples of [t_ms, x, y, z, qx, qy, qz, qw, boost, brake, dodge], t from the race start */
export interface GhostData {
  hz: number;
  samples: number[][];
}

export interface GhostRun {
  name: string;
  time_ms: number;
  ghost: GhostData;
}

const HZ = 15;
const MAX_SAMPLES = 15 * 600; // the server's limit
const round = (value: number, digits: number) => Number(value.toFixed(digits));

export class GhostRecorder {
  private samples: number[][] = [];
  private nextAt = 0;

  reset() {
    this.samples = [];
    this.nextAt = 0;
  }

  record(timeMs: number, position: Vector3, quaternion: Quaternion, boost = 0, brake = 0, dodge = 0) {
    if (timeMs < this.nextAt) return;
    this.nextAt = timeMs + 1000 / HZ;
    this.samples.push([
      Math.round(timeMs),
      round(position.x, 2),
      round(position.y, 2),
      round(position.z, 2),
      round(quaternion.x, 4),
      round(quaternion.y, 4),
      round(quaternion.z, 4),
      round(quaternion.w, 4),
      round(boost, 2),
      round(brake, 2),
      round(dodge, 4),
    ]);
  }

  /** The run so far, ending exactly at `endMs` */
  finish(endMs: number, position: Vector3, quaternion: Quaternion, boost = 0, brake = 0, dodge = 0): GhostData {
    this.nextAt = 0;
    this.record(endMs, position, quaternion, boost, brake, dodge);
    // Very long runs keep every n-th sample (and the last), at a lower rate
    const every = Math.ceil(this.samples.length / MAX_SAMPLES);
    if (every <= 1) return { hz: HZ, samples: this.samples };
    const samples = this.samples.filter((_, i) => i % every === 0);
    const last = this.samples[this.samples.length - 1];
    if (samples[samples.length - 1] !== last) {
      if (samples.length === MAX_SAMPLES) samples.pop();
      samples.push(last);
    }
    return { hz: Math.max(1, Math.floor(HZ / every)), samples };
  }
}

export function ghostSamples(ghost: GhostData): PilotSample[] {
  const samples: PilotSample[] = [];
  for (const [t, x, y, z, qx, qy, qz, qw, boost = 0, brake = 0, dodge = 0] of ghost.samples) {
    // Interpolation needs strictly increasing times
    if (samples.length && t <= samples[samples.length - 1].t) continue;
    samples.push({ t, p: new Vector3(x, y, z), q: new Quaternion(qx, qy, qz, qw).normalize(), v: 0, cp: 0, boost, brake, dodge });
  }
  // Speed isn't recorded; it only drives the trails, so derive it
  for (let i = 1; i < samples.length; i++) {
    const dt = (samples[i].t - samples[i - 1].t) / 1000;
    samples[i].v = dt > 0 ? samples[i].p.distanceTo(samples[i - 1].p) / dt : samples[i - 1].v;
  }
  return samples;
}
