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

const GRAVITY = 20;
const BODY_RADIUS = 0.55; // metres the body keeps off the surface
/** Seconds after which the body starts dissolving into light (Game respawns at RESPAWN_DELAY) */
export const DISSOLVE_AT = 1.1;

const tmp = new THREE.Vector3();
const tangent = new THREE.Vector3();
const spin = new THREE.Quaternion();
const axis = new THREE.Vector3();
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

/** Which way a crash should play out, from the flight direction, the pilot's right and the surface normal */
export function classifyCrash(direction: THREE.Vector3, right: THREE.Vector3, normal: THREE.Vector3, lost: boolean): DeathKind {
  if (lost) return "fall";
  const impact = -direction.dot(normal); // 1 = straight into the surface
  if (impact > 0.62) return "headfirst";
  // The surface off to one side, more than below: a wing took the hit
  if (Math.abs(right.dot(normal)) > 0.5 && normal.y < 0.55) return "wing";
  if (normal.y > 0.25) return "slide";
  return Math.abs(right.dot(normal)) > 0.3 ? "wing" : "headfirst";
}

/** A small rigid-body tumble for the pilot after a crash (visual only) */
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
  /** Angular velocity in world space (axis × rad/s) */
  private readonly omega = new THREE.Vector3();
  private friction = 0;

  start(
    kind: DeathKind,
    position: THREE.Vector3,
    velocity: THREE.Vector3,
    quaternion: THREE.Quaternion,
    right: THREE.Vector3,
    up: THREE.Vector3,
    normal: THREE.Vector3,
  ) {
    this.kind = kind;
    this.time = 0;
    this.grounded = false;
    this.position.copy(position);
    this.quaternion.copy(quaternion);
    this.normal.copy(normal);
    const speed = velocity.length();
    this.side = right.dot(normal) < 0 ? 1 : -1;

    if (kind === "headfirst") {
      // Bounce back off the wall and flip head over heels
      tmp.copy(velocity).addScaledVector(normal, -velocity.dot(normal)); // the part along the wall
      this.velocity.copy(tmp).multiplyScalar(0.15).addScaledVector(normal, 3 + speed * 0.06).addScaledVector(WORLD_UP, 4);
      this.omega.copy(right).multiplyScalar(-(7 + speed * 0.05));
      this.omega.addScaledVector(up, (Math.random() - 0.5) * 2);
      this.friction = 0.6;
    } else if (kind === "slide") {
      // Keep sliding along the slope, rolling sideways down it
      tangent.copy(velocity).addScaledVector(normal, -velocity.dot(normal));
      this.velocity.copy(tangent).multiplyScalar(0.5).addScaledVector(normal, 1.5);
      axis.crossVectors(normal, tangent);
      if (axis.lengthSq() < 1e-6) axis.copy(right);
      this.omega.copy(axis.normalize()).multiplyScalar(clamp(tangent.length() * 0.5 / BODY_RADIUS, 4, 11));
      this.friction = 0.9;
    } else if (kind === "wing") {
      // Thrown off balance: a flat spin around the body's up axis, falling
      this.velocity.copy(velocity).multiplyScalar(0.35).addScaledVector(normal, 4).addScaledVector(WORLD_UP, 2);
      this.omega.copy(up).multiplyScalar(11 * this.side).addScaledVector(right, -1.5);
      this.friction = 0.4;
    } else {
      this.velocity.copy(velocity).multiplyScalar(0.6);
      this.omega.copy(right).multiplyScalar(-2.2).addScaledVector(up, 1.2);
      this.friction = 0;
    }
  }

  update(dt: number, field: Field) {
    if (dt <= 0) return;
    this.time += dt;
    const v = this.velocity;
    v.y -= GRAVITY * dt;
    // Air drag: a wing-spinning body falls slower, like a seed
    v.multiplyScalar(1 - (this.kind === "wing" ? 1.4 : 0.5) * dt);
    if (this.kind === "wing") {
      // The spin keeps going, tilting over as the pilot falls
      this.omega.multiplyScalar(1 - 0.15 * dt);
    } else {
      this.omega.multiplyScalar(1 - 0.35 * dt);
    }
    this.position.addScaledVector(v, dt);

    // Keep the body out of the rock: push it out along the field's gradient, bounce and roll
    this.grounded = false;
    if (this.kind !== "fall") {
      const d = field(this.position.x, this.position.y, this.position.z);
      if (d < BODY_RADIUS) {
        fieldNormal(field, this.position, this.normal);
        this.position.addScaledVector(this.normal, BODY_RADIUS - d);
        const into = v.dot(this.normal);
        if (into < 0) v.addScaledVector(this.normal, -into * (this.kind === "headfirst" ? 1.35 : 1.15));
        // Friction along the surface, and rolling without slipping
        tangent.copy(v).addScaledVector(this.normal, -v.dot(this.normal));
        v.addScaledVector(tangent, -Math.min(1, this.friction * 3 * dt));
        if (tangent.lengthSq() > 0.25) {
          axis.crossVectors(this.normal, tangent).divideScalar(BODY_RADIUS);
          this.omega.lerp(axis, Math.min(1, 6 * dt));
        }
        this.grounded = true;
      }
    }
    this.speed = v.length();

    const rate = this.omega.length();
    if (rate > 1e-4) {
      spin.setFromAxisAngle(axis.copy(this.omega).divideScalar(rate), rate * dt);
      this.quaternion.premultiply(spin).normalize();
    }
  }
}
