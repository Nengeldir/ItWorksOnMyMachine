import * as THREE from "three";
import { Trail } from "./trail";
import { WINGTIPS, createLabel, createWingsuit, disposeObject } from "./wingsuit";

export interface PilotSample {
  t: number; // ms: server time for live players, race time for ghosts
  p: THREE.Vector3;
  q: THREE.Quaternion;
  v: number;
  cp: number;
}

// Draw live players this far in the past, so there is usually a newer sample to blend towards
export const INTERPOLATION_DELAY_MS = 120;
const MAX_EXTRAPOLATION_MS = 300;
const STALE_MS = 3000;
const MAX_LIVE_SAMPLES = 60;

const tmp = new THREE.Vector3();
const side = new THREE.Vector3();

/** Another pilot drawn from timed samples: a live player or a recorded ghost */
export class Pilot {
  readonly id: string;
  readonly group = new THREE.Group();
  readonly name: string;
  readonly color: string;
  readonly ghost: boolean;
  private readonly body: THREE.Mesh;
  private readonly label: THREE.Sprite;
  private readonly trails: Trail[];
  private readonly samples: PilotSample[] = [];
  /** Latest drawn state, for standings and the HUD */
  readonly position = new THREE.Vector3();
  get quaternion(): THREE.Quaternion {
    return this.body.quaternion;
  }
  checkpoints = 0;
  speed = 0;
  visible = false;

  constructor(id: string, name: string, color: string, ghost: boolean) {
    this.id = id;
    this.name = name;
    this.color = color;
    this.ghost = ghost;
    this.body = createWingsuit(color, ghost);
    this.label = createLabel(ghost ? `${name} (ghost)` : name, color);
    this.label.position.set(0, 2.6, 0);
    this.trails = WINGTIPS.map(() => new Trail(ghost ? "#ffffff" : color, 0.12));
    this.group.add(this.body, this.label);
    this.group.visible = false;
  }

  /** Trails live in world space, so they are added to the scene separately */
  get trailMeshes(): THREE.Object3D[] {
    return this.trails.map((t) => t.mesh);
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

  update(time: number) {
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
      this.body.quaternion.slerpQuaternions(a.q, b.q, f);
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
      this.body.quaternion.copy(a.q);
      this.speed = a.v;
    }
    this.checkpoints = a.cp;
    this.position.copy(this.group.position);
    this.setVisible(true);

    side.set(0, 1, 0).applyQuaternion(this.body.quaternion);
    this.trails.forEach((trail, k) => {
      trail.push(tmp.copy(WINGTIPS[k]).applyQuaternion(this.body.quaternion).add(this.group.position), side);
      trail.opacity = THREE.MathUtils.clamp((this.speed - 35) / 30, 0, 0.6);
    });
  }

  private setVisible(visible: boolean) {
    if (visible === this.visible) return;
    this.visible = visible;
    this.group.visible = visible;
    if (!visible) {
      this.trails.forEach((t) => {
        t.reset();
        t.opacity = 0;
      });
    }
  }

  dispose() {
    disposeObject(this.group);
    this.trails.forEach((t) => t.dispose());
  }
}
