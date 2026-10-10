import * as THREE from "three";
import { Avatar, createLabel, disposeLabel } from "./avatar";
import type { Particles } from "./particles";
import { PilotFx } from "./pilotfx";

export interface PilotSample {
  t: number; // ms: server time for live players, race time for ghosts
  p: THREE.Vector3;
  q: THREE.Quaternion;
  v: number;
  cp: number;
  boost?: number;
  brake?: number;
}

// Draw live players this far in the past, so there is usually a newer sample to blend towards
export const INTERPOLATION_DELAY_MS = 120;
const MAX_EXTRAPOLATION_MS = 300;
const STALE_MS = 3000;
const MAX_LIVE_SAMPLES = 60;

const tmp = new THREE.Vector3();

/** Another pilot drawn from timed samples: a live player or a recorded ghost */
export class Pilot {
  readonly id: string;
  readonly group = new THREE.Group();
  readonly name: string;
  readonly color: string;
  readonly ghost: boolean;
  private readonly avatar: Avatar;
  private readonly label: THREE.Sprite;
  private readonly fx: PilotFx;
  private readonly samples: PilotSample[] = [];
  private readonly lastPosition = new THREE.Vector3();
  private readonly velocity = new THREE.Vector3();
  /** Latest drawn state, for standings and the HUD */
  readonly position = new THREE.Vector3();
  get quaternion(): THREE.Quaternion {
    return this.avatar.group.quaternion;
  }
  checkpoints = 0;
  speed = 0;
  visible = false;

  constructor(id: string, name: string, color: string, ghost: boolean, particles: Particles | null) {
    this.id = id;
    this.name = name;
    this.color = color;
    this.ghost = ghost;
    this.avatar = new Avatar(ghost ? "#dfe9ff" : color, { ghost });
    this.label = createLabel(ghost ? `${name} (ghost)` : name, color);
    this.label.position.set(0, 2.6, 0);
    // Ghosts are quieter: thinner trails, fewer motes
    this.fx = new PilotFx(this.avatar, ghost ? "#ffffff" : color, particles, { share: ghost ? 0.25 : 0.5, ghost });
    this.group.add(this.avatar.group, this.label);
    this.group.visible = false;
  }

  /** Trails live in world space, so they are added to the scene separately */
  get trailMeshes(): THREE.Object3D[] {
    return this.fx.meshes;
  }

  push(sample: PilotSample) {
    const last = this.samples[this.samples.length - 1];
    if (last && sample.t <= last.t) return; // out of order or duplicate
    this.samples.push(sample);
    if (!this.ghost && this.samples.length > MAX_LIVE_SAMPLES) this.samples.shift();
  }

  setSamples(samples: PilotSample[]) {
    this.samples.length = 0;
    this.samples.push(...samples);
  }

  /** Index of the last sample at or before t (binary search) */
  private indexAt(t: number): number {
    let lo = 0;
    let hi = this.samples.length - 1;
    if (hi < 0 || this.samples[0].t > t) return -1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (this.samples[mid].t <= t) lo = mid;
      else hi = mid - 1;
    }
    return lo;
  }

  /** Draws the pilot at `time`; `dt` and the camera position drive its animation */
  update(time: number, dt: number, camera: THREE.Vector3) {
    const i = this.indexAt(time);
    const last = this.samples[this.samples.length - 1];
    const stale = !last || (!this.ghost && time - last.t > STALE_MS) || (this.ghost && time > last.t + 1500);
    if (i < 0 || stale) {
      this.setVisible(false);
      return;
    }

    const a = this.samples[i];
    const b = this.samples[i + 1];
    if (b) {
      const f = (time - a.t) / (b.t - a.t);
      this.group.position.lerpVectors(a.p, b.p, f);
      this.avatar.group.quaternion.slerpQuaternions(a.q, b.q, f);
      this.speed = a.v + (b.v - a.v) * f;
    } else {
      // No newer sample yet: keep going in the same direction for a moment
      const prev = this.samples[i - 1];
      const ahead = Math.min(time - a.t, MAX_EXTRAPOLATION_MS);
      this.group.position.copy(a.p);
      if (prev && a.t > prev.t) {
        tmp.subVectors(a.p, prev.p).multiplyScalar(ahead / (a.t - prev.t));
        this.group.position.add(tmp);
      }
      this.avatar.group.quaternion.copy(a.q);
      this.speed = a.v;
    }
    this.checkpoints = a.cp;
    const appeared = !this.visible;
    this.position.copy(this.group.position);
    this.setVisible(true);

    // Velocity from how far we moved, smoothed (samples only come 15 times a second)
    if (appeared || dt <= 0) {
      this.velocity.set(0, 0, 0);
    } else {
      tmp.subVectors(this.position, this.lastPosition).divideScalar(dt);
      if (tmp.lengthSq() < 200 * 200) this.velocity.lerp(tmp, 1 - Math.exp(-dt * 8));
    }
    if (appeared || this.position.distanceTo(this.lastPosition) > 40) this.avatar.resetMotion();
    this.lastPosition.copy(this.position);
    const blend = b ? Math.min(1, Math.max(0, (time - a.t) / (b.t - a.t))) : 0;
    this.avatar.setSpeedControls((a.boost ?? 0) + ((b?.boost ?? a.boost ?? 0) - (a.boost ?? 0)) * blend,
      (a.brake ?? 0) + ((b?.brake ?? a.brake ?? 0) - (a.brake ?? 0)) * blend);
    this.avatar.update(dt, this.speed, 0, camera.distanceTo(this.position));
    this.fx.update(dt, this.speed, this.velocity, 0);
  }

  private setVisible(visible: boolean) {
    if (visible === this.visible) return;
    this.visible = visible;
    this.group.visible = visible;
    if (!visible) {
      this.fx.reset();
      this.fx.hide();
    }
  }

  dispose() {
    this.avatar.dispose();
    disposeLabel(this.label);
    this.fx.dispose();
  }
}
