import { Quaternion, Vector3 } from "three";
import type { PilotSample } from "./pilots";

/** A recorded run: samples of [t_ms, x, y, z, qx, qy, qz, qw], t from the race start */
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
const round = (value: number, digits: number) => Number(value.toFixed(digits));

export class GhostRecorder {
  private samples: number[][] = [];
  private nextAt = 0;

  reset() {
    this.samples = [];
    this.nextAt = 0;
  }

  record(timeMs: number, position: Vector3, quaternion: Quaternion) {
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
    ]);
  }

  /** The run so far, ending exactly at `endMs` */
  finish(endMs: number, position: Vector3, quaternion: Quaternion): GhostData {
    this.nextAt = 0;
    this.record(endMs, position, quaternion);
    return { hz: HZ, samples: this.samples };
  }
}

export function ghostSamples(ghost: GhostData): PilotSample[] {
  const samples: PilotSample[] = ghost.samples.map(([t, x, y, z, qx, qy, qz, qw]) => ({
    t,
    p: new Vector3(x, y, z),
    q: new Quaternion(qx, qy, qz, qw).normalize(),
    v: 0,
    cp: 0,
  }));
  // Speed isn't recorded; it only drives the trails, so derive it
  for (let i = 1; i < samples.length; i++) {
    const dt = (samples[i].t - samples[i - 1].t) / 1000;
    samples[i].v = dt > 0 ? samples[i].p.distanceTo(samples[i - 1].p) / dt : samples[i - 1].v;
  }
  return samples;
}
