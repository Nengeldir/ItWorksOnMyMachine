// Sounds in the world (plan F9): a pool of 16 panners, reused, so a node, an NPC or a splash is heard
// where it is without a new PannerNode per sound. HRTF at High quality, equal-power below; anything
// past 80 m isn't played at all. `pickPanner` is the pure choice; the engine owns the nodes.

export const SPATIAL = { panners: 16, cull: 80, refDistance: 6, rolloff: 1.2 };

export interface PannerSlot {
  /** When its last sound ends (s, the audio clock) */
  busyUntil: number;
  /** Distance of that sound to the listener (m) */
  distance: number;
}

/** True when a sound this far away (m) is worth playing */
export const audible = (distance: number) => distance <= SPATIAL.cull;

/**
 * The panner a new sound `distance` m away takes at `now`: a free one, else the one carrying the
 * farthest sound if the new one is nearer, else none (-1)
 */
export function pickPanner(slots: readonly PannerSlot[], now: number, distance: number): number {
  let far = -1;
  for (let i = 0; i < slots.length; i++) {
    if (slots[i].busyUntil <= now) return i;
    if (far < 0 || slots[i].distance > slots[far].distance) far = i;
  }
  return far >= 0 && slots[far].distance > distance ? far : -1;
}

export interface Vec3 { x: number; y: number; z: number }

export class SpatialPool {
  private readonly ctx: BaseAudioContext;
  private readonly slots: (PannerSlot & { node: PannerNode | null; out: AudioNode | null })[] = [];
  private listener: Vec3 = { x: 0, y: 0, z: 0 };
  private hrtf = true;

  constructor(ctx: BaseAudioContext) {
    this.ctx = ctx;
    for (let i = 0; i < SPATIAL.panners; i++) this.slots.push({ busyUntil: 0, distance: 0, node: null, out: null });
  }

  /** Quality 2 hears in HRTF (it costs a convolution per panner); below, equal-power panning */
  setQuality(quality: number) {
    this.hrtf = quality >= 2;
    for (const slot of this.slots) if (slot.node) slot.node.panningModel = this.hrtf ? "HRTF" : "equalpower";
  }

  /** The camera, each frame: where the ears are and where they face */
  setListener(position: Vec3, forward: Vec3, up: Vec3 = { x: 0, y: 1, z: 0 }) {
    this.listener = position;
    const l = this.ctx.listener;
    const t = this.ctx.currentTime;
    if (l.positionX) {
      l.positionX.setTargetAtTime(position.x, t, 0.02);
      l.positionY.setTargetAtTime(position.y, t, 0.02);
      l.positionZ.setTargetAtTime(position.z, t, 0.02);
      l.forwardX.setTargetAtTime(forward.x, t, 0.02);
      l.forwardY.setTargetAtTime(forward.y, t, 0.02);
      l.forwardZ.setTargetAtTime(forward.z, t, 0.02);
      l.upX.setTargetAtTime(up.x, t, 0.02);
      l.upY.setTargetAtTime(up.y, t, 0.02);
      l.upZ.setTargetAtTime(up.z, t, 0.02);
    } else {
      l.setPosition(position.x, position.y, position.z);
      l.setOrientation(forward.x, forward.y, forward.z, up.x, up.y, up.z);
    }
  }

  /**
   * A panner placed at `at`, feeding `out` (the sound's bus), for a sound lasting `duration` s; or null
   * (too far, or every panner busy with a nearer sound)
   */
  claim(at: Vec3, duration: number, out: AudioNode): AudioNode | null {
    const distance = Math.hypot(at.x - this.listener.x, at.y - this.listener.y, at.z - this.listener.z);
    if (!audible(distance)) return null;
    const now = this.ctx.currentTime;
    const i = pickPanner(this.slots, now, distance);
    if (i < 0) return null;
    const slot = this.slots[i];
    if (!slot.node) {
      slot.node = this.ctx.createPanner();
      slot.node.panningModel = this.hrtf ? "HRTF" : "equalpower";
      slot.node.distanceModel = "inverse";
      slot.node.refDistance = SPATIAL.refDistance;
      slot.node.rolloffFactor = SPATIAL.rolloff;
      slot.node.maxDistance = SPATIAL.cull;
    }
    if (slot.out !== out) {
      if (slot.out) slot.node.disconnect();
      slot.node.connect(out);
      slot.out = out;
    }
    slot.node.positionX.setValueAtTime(at.x, now);
    slot.node.positionY.setValueAtTime(at.y, now);
    slot.node.positionZ.setValueAtTime(at.z, now);
    slot.busyUntil = now + duration;
    slot.distance = distance;
    return slot.node;
  }
}
