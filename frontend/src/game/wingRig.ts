import * as THREE from "three";
import type { WingRig } from "./cosmetics/catalog";
import { clamp, smoothstep } from "./math";
import { ANIM } from "./tuning";

// How wings move, beyond the avatar's base pose (looks only, CLAUDE.md rule 6:
// the flight hitbox never reads any of this). The avatar poses each wing's two
// joints, the shoulder (`wing`) and the wrist (`wingOuter`), for the flap, the
// sweep, the stances and the turns; `articulate` then reshapes that pose the
// way the wing's build would move:
//
//  - feather: a bird's wing. The downstroke is made fully spread with the
//    leading edge tipped down; on the upstroke the wrist folds the hand back
//    and the primaries twist open to let the air through, then flick out
//    again. The primaries are bones of their own (skinned): they fan out on
//    the downstroke and when gliding slowly (slotted tips), stack up when the
//    wing folds or sweeps, and bend against the motion, so the tips trail
//    each beat. In a bank the inside wing tucks a little.
//  - sail: one flexible membrane (silk, leaves, fins, a dragon's skin): the
//    outer half lags further behind and ripples at speed, no feathers.
//  - jointed: machinery. Servo-like strokes that snap and hold at the ends,
//    the outer plate locked in step with the inner, a faint motor buzz, and
//    plates (bones) that fan out in steps.
//  - rigid: one piece (cardboard, a sparrow's little wings): the whole wing
//    moves as one; small ones flutter fast, cardboard ones wobble.

/** A feather's bone: its root in the part's own space (the right wing's) and the direction it points */
export interface FeatherBone {
  position: [number, number, number];
  /** Radians in the wing's plane, from the span (+x) towards the head (+y) */
  angle: number;
}

/**
 * A skinned mesh whose parts follow `feathers` (bone 0 is the root, at the origin), with its ink outline
 * on the same skeleton. Bound in its own frame: call before it is put on anything
 */
export function skinnedMesh(geometry: THREE.BufferGeometry, material: THREE.Material, ink: THREE.Material | null, feathers: readonly FeatherBone[]) {
  const mesh = new THREE.SkinnedMesh(geometry, material);
  const root = new THREE.Bone();
  mesh.add(root);
  const bones = [root];
  for (const feather of feathers) {
    const bone = new THREE.Bone();
    bone.position.set(...feather.position);
    bone.rotation.order = "ZYX";
    bone.rotation.z = feather.angle;
    root.add(bone);
    bones.push(bone);
  }
  const skeleton = new THREE.Skeleton(bones);
  mesh.bind(skeleton);
  // Skinned bounds go stale as the feathers move; the pilot is always on screen anyway
  mesh.frustumCulled = false;
  let outline: THREE.SkinnedMesh | null = null;
  if (ink) {
    outline = new THREE.SkinnedMesh(geometry, ink);
    outline.bind(skeleton, mesh.bindMatrix);
    outline.frustumCulled = false;
    mesh.add(outline);
  }
  return { mesh, outline, bones: bones.slice(1), rest: feathers.map((f) => f.angle) };
}

/** What drives a wing this frame (from the avatar's animation state) */
export interface WingDrive {
  /** The flap's phase (radians) and how far it beats (radians of travel) */
  phase: number;
  amp: number;
  /** Seconds, for flutter, and this frame's step */
  time: number;
  dt: number;
  /** 1 when the wing is fully spread, 0 when it is folded (stances, standing, a crash) */
  open: number;
  /** 0 slow … 1 fast */
  speed: number;
  /** How far the wing is swept back (radians, the avatar's sweep) */
  sweep: number;
  /** The body's lean into the turn, signed (positive: banking right) */
  lean: number;
  /** A crash: the wing goes limp */
  limp: boolean;
}

/** A wing's articulated parts: its two joints and, for feather wings, the primaries' bones */
export interface WingParts {
  wing: THREE.Object3D;
  wingOuter: THREE.Object3D;
  /** The outer part's primaries (or plates), root to trailing edge; empty for wings without them */
  bones: readonly THREE.Bone[];
  rest: readonly number[];
}

/**
 * Reshapes a wing's base pose (already on its joints) the way its build moves. `side` is 1 for the
 * right wing, -1 for the left. Feather bones are built for the right wing and mirrored, so they take
 * the same angles on both sides
 */
export function articulate(rig: WingRig, parts: WingParts, side: 1 | -1, drive: WingDrive) {
  const { wing, wingOuter, bones, rest } = parts;
  const s = side;
  const flap = clamp(drive.amp / Math.max(0.01, ANIM.flapAngle), 0, 1.3);
  const rising = Math.cos(drive.phase); // > 0: the wing is going up
  const up = smoothstep(-0.15, 0.75, rising) * flap;
  const down = smoothstep(-0.15, 0.75, -rising) * flap;
  const open = clamp(drive.open, 0, 1);
  const fold = 1 - open;
  // Banking: the wing on the inside of the turn tucks in a little
  const inside = Math.max(0, -s * drive.lean);
  const t = drive.time;

  if (rig === "feather") {
    // Twist: leading edge down into the downstroke, up (supinated) on the way back
    wing.rotation.x = (0.24 * rising * flap + s * drive.lean * 0.16) * open;
    // The wrist folds the hand back on the upstroke, and tucks in the inside wing of a turn
    wingOuter.rotation.z += -s * (0.5 * up + 0.22 * inside) * open;
    wingOuter.rotation.x = (-0.3 * up + 0.12 * down) * open;
    const n = bones.length;
    // Spread: wide on the downstroke and when gliding slowly (slotted tips), stacked when folded or swept
    const spread = clamp(0.5 * down + 0.35 * (1 - drive.speed) * (1 - flap * 0.5) - 0.4 * up - 1.2 * fold - 0.5 * clamp(drive.sweep, 0, 1.2), -1, 1);
    for (let i = 0; i < n; i++) {
      const k = n > 1 ? i / (n - 1) : 0;
      const bone = bones[i];
      bone.rotation.z = rest[i] - (i * 0.11) * spread + (drive.limp ? Math.sin(t * 9 + i) * 0.08 : 0);
      // Each primary twists open on the upstroke, the outer ones most
      bone.rotation.x = (0.55 * up - 0.1 * down) * (0.35 + 0.65 * (1 - k)) * open;
      // They bend against the motion (tips trailing each beat) and curl up under lift in a glide
      const flutter = Math.sin(t * 23 + i * 1.7) * 0.025 * drive.speed;
      bone.rotation.y = (0.24 * rising * flap * (0.4 + 0.6 * (1 - k)) - 0.09 * (1 - flap) * open + flutter) * (drive.limp ? 0.3 : 1);
    }
  } else if (rig === "sail") {
    // A membrane bends: the outer half trails the beat, with a soft ripple at speed
    wing.rotation.x = (0.12 * rising * flap + s * drive.lean * 0.1) * open;
    wingOuter.rotation.y += -s * 0.22 * drive.amp * Math.sin(drive.phase - 1.4) * open;
    wingOuter.rotation.z += -s * (0.25 * up + 0.15 * inside) * open;
    wingOuter.rotation.x = (Math.sin(t * 11 + s) * 0.05 * (0.3 + drive.speed) - 0.12 * up) * open;
    for (let i = 0; i < bones.length; i++) {
      bones[i].rotation.z = rest[i] - i * 0.06 * (down - fold);
      bones[i].rotation.y = Math.sin(t * 9 - i * 0.8) * 0.06 * (0.3 + drive.speed) * open;
    }
  } else if (rig === "jointed") {
    // Servos: the stroke snaps and holds at both ends instead of swinging through
    const stroke = Math.sin(drive.phase) + 0.22 * Math.sin(drive.phase * 2);
    const snapped = Math.tanh(2.4 * Math.sin(drive.phase)) / Math.tanh(2.4);
    wing.rotation.y += -s * drive.amp * (snapped - stroke) * open;
    wing.rotation.x = 0;
    // A faint motor buzz while the joints are moving
    wing.rotation.z += Math.sin(t * 90) * 0.006 * Math.abs(rising) * flap;
    // The outer plate stays in step (no lag) and retracts in one quick step on the upstroke
    wingOuter.rotation.y = -s * (0.05 + drive.amp * 0.25 * snapped) * open + wingOuter.rotation.y * fold;
    wingOuter.rotation.z += -s * 0.32 * smoothstep(0.35, 0.65, up) * open;
    wingOuter.rotation.x = 0;
    // Plates fan out in steps, like a clockwork fan
    const steps = Math.round(clamp(0.6 * down + 0.2 - 1.2 * fold - 0.3 * up, -1, 1) * 3) / 3;
    for (let i = 0; i < bones.length; i++) {
      const bone = bones[i];
      bone.rotation.z += (rest[i] - i * 0.14 * steps - bone.rotation.z) * (1 - Math.exp(-drive.dt * 22));
      bone.rotation.x = 0;
      bone.rotation.y = 0;
    }
  } else {
    // One piece: no twist, no bend; the outer part (if any) stays where it was built
    wing.rotation.x = Math.sin(t * 7.3) * 0.04 * drive.speed * open;
    wingOuter.rotation.set(0, 0, 0);
  }
}

/** How much faster a wing beats than the classic pair (little wings flutter) */
export function rigRate(rig: WingRig, size: number): number {
  if (rig === "rigid") return size < 0.7 ? 2.4 : 0.85;
  if (rig === "jointed") return 0.9;
  return 1;
}

/** How far a wing beats against the classic pair */
export function rigAmplitude(rig: WingRig, size: number): number {
  if (rig === "rigid") return size < 0.7 ? 1.25 : 0.65;
  if (rig === "jointed") return 0.85;
  if (rig === "sail") return 0.9;
  return 1;
}
