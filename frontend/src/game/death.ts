import * as THREE from "three";
import { clamp } from "./math";

// What a crash looks like: the pilot stays on screen and falls the way the
// hit sent them, before dissolving into light and respawning. Looks only: the
// crash itself (where, when, the respawn delay) is decided by Game.step, and
// nothing here feeds back into the flight model, scoring or the clock.
//
//  - headfirst: straight into a wall. The pilot bounces off and tumbles head
//    over heels down the face.
//  - slide: a glancing hit on ground below. The pilot rolls down the slope,
//    kicking up dust, until friction stops them.
//  - wing: one wing clips rock. The pilot loses balance and spins down like a
//    sycamore seed.
//  - fall: lost below the islands, a slow tumble into the clouds.

export type DeathKind = "headfirst" | "slide" | "wing" | "fall";

type Field = (x: number, y: number, z: number) => number;
/**
 * The signed distance from a point to the nearest surface within about
 * `radius` (anything at least `radius` when there is none), writing the way
 * out of it to `normal`
 */
export type Contact = (p: THREE.Vector3, radius: number, normal: THREE.Vector3) => number;

const GRAVITY = 20;
/**
 * The body's contact balls in its own frame (x right, y up the back, -z
 * towards the head; origin at the hips) with their radii: head and chest,
 * hips, feet. The wings add points from the live pose (`wing`).
 */
const BODY: readonly (readonly [number, number, number, number])[] = [
  [0, 0.05, -0.62, 0.42],
  [0, 0, 0.05, 0.36],
  [0, -0.05, 0.85, 0.14],
];
const WING_RADIUS = 0.1;
/** Contact points along each wing: Avatar.wingPoints fills them */
export const WING_POINTS = 5;
/** Moment of inertia per unit mass (m²): how readily a hit at the wingtip spins the body */
const INERTIA = 0.3;
/** Longest physics step; frames are cut into these so fast spins don't tunnel into rock */
const MAX_STEP = 1 / 120;
/** Rounds of pushing the contact points out per step, until all are clear */
const PASSES = 4;
/** Seconds after which the body starts dissolving into light (Game respawns at RESPAWN_DELAY) */
export const DISSOLVE_AT = 1.1;

const tmp = new THREE.Vector3();
const tangent = new THREE.Vector3();
const spin = new THREE.Quaternion();
const axis = new THREE.Vector3();
const arm = new THREE.Vector3();
const point = new THREE.Vector3();
const pointVelocity = new THREE.Vector3();
const across = new THREE.Vector3();
const local = new THREE.Vector3();
const normalOut = new THREE.Vector3();
const WORLD_UP = new THREE.Vector3(0, 1, 0);

/** The surface normal of a distance field at a point (the direction away from the nearest surface) */
export function fieldNormal(field: Field, p: THREE.Vector3, out: THREE.Vector3, e = 0.5): THREE.Vector3 {
  out.set(
    field(p.x + e, p.y, p.z) - field(p.x - e, p.y, p.z),
    field(p.x, p.y + e, p.z) - field(p.x, p.y - e, p.z),
    field(p.x, p.y, p.z + e) - field(p.x, p.y, p.z - e),
  );
  if (out.lengthSq() < 1e-10) return out.copy(WORLD_UP);
  return out.normalize();
}

/**
 * Which way a crash should play out, from the flight direction, the pilot's
 * right, the surface normal and the part of the hitbox that hit
 */
export function classifyCrash(
  direction: THREE.Vector3,
  right: THREE.Vector3,
  normal: THREE.Vector3,
  lost: boolean,
  part: "body" | "left" | "right" | null = "body",
): DeathKind {
  if (lost) return "fall";
  // A wing touched first: thrown off balance into a spin
  if (part === "left" || part === "right") return "wing";
  const impact = -direction.dot(normal); // 1 = straight into the surface
  if (impact > 0.62) return "headfirst";
  // The surface off to one side, more than below: a wing took the hit
  if (Math.abs(right.dot(normal)) > 0.5 && normal.y < 0.55) return "wing";
  if (normal.y > 0.25) return "slide";
  return Math.abs(right.dot(normal)) > 0.3 ? "wing" : "headfirst";
}

/**
 * A small rigid-body tumble for the pilot after a crash (visual only): balls
 * for the head, hips and feet and points along both wings push off the rock
 * with impulses, so a wingtip catching a slope spins the body and nothing
 * sinks into the ground
 */
export class DeathFall {
  kind: DeathKind = "fall";
  time = 0;
  /** Which way the wing spin turns, and which side the pilot rolls to */
  side: 1 | -1 = 1;
  /** On the ground this frame (rolling), for dust */
  grounded = false;
  /** Speed of the body, for the pose's flailing */
  speed = 0;
  readonly position = new THREE.Vector3();
  readonly velocity = new THREE.Vector3();
  readonly quaternion = new THREE.Quaternion();
  readonly normal = new THREE.Vector3(0, 1, 0);
  /** Wing contact points in the body's frame, left wing then right (Avatar.wingPoints) */
  readonly wing = Array.from({ length: WING_POINTS * 2 }, () => new THREE.Vector3());
  /**
   * How far each wing (left, right) is still in the rock after this frame's
   * pushing: wedged under an overhang or in a crevice, where moving the body
   * can't free it. The pose folds that wing in (Avatar.foldWing)
   */
  readonly wedged = [0, 0];
  /** Angular velocity in world space (axis × rad/s) */
  private readonly omega = new THREE.Vector3();
  private friction = 0;
  private bounce = 0;

  start(
    kind: DeathKind,
    position: THREE.Vector3,
    velocity: THREE.Vector3,
    quaternion: THREE.Quaternion,
    right: THREE.Vector3,
    up: THREE.Vector3,
    normal: THREE.Vector3,
    side?: 1 | -1,
  ) {
    this.kind = kind;
    this.time = 0;
    this.grounded = false;
    this.position.copy(position);
    this.quaternion.copy(quaternion);
    this.normal.copy(normal);
    const speed = velocity.length();
    this.side = side ?? (right.dot(normal) < 0 ? 1 : -1);

    if (kind === "headfirst") {
      // Bounce back off the wall and flip head over heels
      tmp.copy(velocity).addScaledVector(normal, -velocity.dot(normal)); // the part along the wall
      this.velocity.copy(tmp).multiplyScalar(0.15).addScaledVector(normal, 3 + speed * 0.06).addScaledVector(WORLD_UP, 4);
      this.omega.copy(right).multiplyScalar(-(7 + speed * 0.05));
      this.omega.addScaledVector(up, (Math.random() - 0.5) * 2);
      this.friction = 0.6;
      this.bounce = 0.35;
    } else if (kind === "slide") {
      // Keep sliding along the slope, rolling sideways down it
      tangent.copy(velocity).addScaledVector(normal, -velocity.dot(normal));
      this.velocity.copy(tangent).multiplyScalar(0.5).addScaledVector(normal, 1.5);
      axis.crossVectors(normal, tangent);
      if (axis.lengthSq() < 1e-6) axis.copy(right);
      this.omega.copy(axis.normalize()).multiplyScalar(clamp(tangent.length() * 0.5 / 0.4, 4, 11));
      this.friction = 0.9;
      this.bounce = 0.15;
    } else if (kind === "wing") {
      // Thrown off balance: a flat spin around the body's up axis, falling
      this.velocity.copy(velocity).multiplyScalar(0.35).addScaledVector(normal, 4).addScaledVector(WORLD_UP, 2);
      this.omega.copy(up).multiplyScalar(11 * this.side).addScaledVector(right, -1.5);
      this.friction = 0.4;
      this.bounce = 0.15;
    } else {
      this.velocity.copy(velocity).multiplyScalar(0.6);
      this.omega.copy(right).multiplyScalar(-2.2).addScaledVector(up, 1.2);
      this.friction = 0;
      this.bounce = 0;
    }
  }

  update(dt: number, field: Contact) {
    if (dt <= 0) return;
    this.time += dt;
    this.grounded = false;
    this.wedged[0] = this.wedged[1] = 0;
    const steps = Math.ceil(dt / MAX_STEP);
    for (let i = 0; i < steps; i++) this.step(dt / steps, field);
    this.speed = this.velocity.length();
  }

  private step(dt: number, field: Contact) {
    const v = this.velocity;
    v.y -= GRAVITY * dt;
    // Air drag: a wing-spinning body falls slower, like a seed
    v.multiplyScalar(1 - (this.kind === "wing" ? 1.4 : 0.5) * dt);
    // The spin keeps going (a wing spin longest), tilting over as the pilot falls
    this.omega.multiplyScalar(1 - (this.kind === "wing" ? 0.15 : 0.35) * dt);
    this.position.addScaledVector(v, dt);
    const rate = this.omega.length();
    if (rate > 1e-4) {
      spin.setFromAxisAngle(axis.copy(this.omega).divideScalar(rate), rate * dt);
      this.quaternion.premultiply(spin).normalize();
    }

    // Lost below the islands: nothing to hit
    if (this.kind === "fall") return;
    // Pushing one point out can push another back in (wedged in a crevice, both wings on rock):
    // go round again until every point is clear, a few times at most
    let pushed = false;
    for (let pass = 0; pass < PASSES; pass++) {
      pushed = false;
      for (const [x, y, z, r] of BODY) pushed = this.contact(field, local.set(x, y, z), r) || pushed;
      for (const p of this.wing) pushed = this.contact(field, p, WING_RADIUS) || pushed;
      if (!pushed) break;
    }
    // Still not clear: how deep is each wing stuck?
    if (pushed) {
      for (let i = 0; i < this.wing.length; i++) {
        point.copy(this.wing[i]).applyQuaternion(this.quaternion).add(this.position);
        const depth = WING_RADIUS - field(point, WING_RADIUS, normalOut);
        const side = i < WING_POINTS ? 0 : 1;
        if (depth > this.wedged[side]) this.wedged[side] = depth;
      }
    }
  }

  /** One contact point (in the body's frame) against the rock: push out, bounce and rub along the surface */
  /** Returns whether the point had to be pushed out (more than a centimetre) */
  private contact(field: Contact, at: THREE.Vector3, radius: number): boolean {
    arm.copy(at).applyQuaternion(this.quaternion);
    point.copy(this.position).add(arm);
    const d = field(point, radius, normalOut);
    if (d >= radius) return false;
    const n = this.normal.copy(normalOut);
    this.position.addScaledVector(n, radius - d);
    this.grounded = true;
    const pushed = radius - d > 0.01;
    // The point's own velocity: the body's plus its spin
    pointVelocity.crossVectors(this.omega, arm).add(this.velocity);
    const into = pointVelocity.dot(n);
    if (into >= 0) return pushed;
    across.crossVectors(arm, n);
    const push = (-(1 + this.bounce) * into) / (1 + across.lengthSq() / INERTIA);
    this.velocity.addScaledVector(n, push);
    this.omega.addScaledVector(across, push / INERTIA);
    // Friction: rolling without slipping when it grips, sliding when it doesn't
    tangent.copy(pointVelocity).addScaledVector(n, -into);
    const slip = tangent.length();
    if (slip < 1e-4) return pushed;
    tangent.divideScalar(slip);
    across.crossVectors(arm, tangent);
    const rub = Math.min(slip / (1 + across.lengthSq() / INERTIA), this.friction * push);
    this.velocity.addScaledVector(tangent, -rub);
    this.omega.addScaledVector(across, -rub / INERTIA);
    return pushed;
  }
}
