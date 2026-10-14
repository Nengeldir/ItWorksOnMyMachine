import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";

// Building items from painted primitives: each primitive is painted per vertex
// (a color and a `glow` the toon material reads) before it is placed, and
// everything is merged into one geometry.

export type Vec = [number, number, number];
export type Paint = string | ((p: THREE.Vector3, out: THREE.Color) => void);

const euler = new THREE.Euler();
const m4 = new THREE.Matrix4();
const q = new THREE.Quaternion();
const v3 = new THREE.Vector3();
const s3 = new THREE.Vector3();
const point = new THREE.Vector3();
const paintColor = new THREE.Color();

/**
 * Collects painted primitives into one geometry with `color` and `glow` (what toonMaterial reads).
 * Parts added after `bone(n)` are skinned to bone `n` (articulated wings bend each feather on its own
 * bone); a geometry with any bone tagged gets `skinIndex` and `skinWeight`
 */
export class Builder {
  private readonly parts: THREE.BufferGeometry[] = [];
  private readonly bones: number[] = [];
  private current = 0;
  private skinned = false;

  /** Parts added from now on follow bone `index` (0: the root) */
  bone(index: number): this {
    this.current = index;
    if (index > 0) this.skinned = true;
    return this;
  }

  add(geometry: THREE.BufferGeometry, paint: Paint, glow = 0, at: Vec = [0, 0, 0], rot: Vec = [0, 0, 0], scale: Vec = [1, 1, 1]): this {
    // Paint in the primitive's own space, before it is placed
    const flat = geometry.index ? geometry.toNonIndexed() : geometry;
    if (flat !== geometry) geometry.dispose();
    for (const name of Object.keys(flat.attributes)) if (name !== "position" && name !== "normal") flat.deleteAttribute(name);
    const position = flat.getAttribute("position");
    const colors = new Float32Array(position.count * 3);
    const glows = new Float32Array(position.count).fill(glow);
    for (let i = 0; i < position.count; i++) {
      if (typeof paint === "string") paintColor.set(paint);
      else paint(point.fromBufferAttribute(position, i), paintColor);
      paintColor.toArray(colors, i * 3);
    }
    flat.setAttribute("color", new THREE.BufferAttribute(colors, 3));
    flat.setAttribute("glow", new THREE.BufferAttribute(glows, 1));
    m4.compose(v3.set(...at), q.setFromEuler(euler.set(...rot)), s3.set(...scale));
    flat.applyMatrix4(m4);
    this.parts.push(flat);
    this.bones.push(this.current);
    return this;
  }

  build(): THREE.BufferGeometry {
    const geometry = mergeGeometries(this.parts)!;
    if (this.skinned) {
      const count = geometry.getAttribute("position").count;
      const index = new Uint16Array(count * 4), weight = new Float32Array(count * 4);
      let at = 0;
      this.parts.forEach((part, i) => {
        const n = part.getAttribute("position").count;
        for (let v = at; v < at + n; v++) { index[v * 4] = this.bones[i]; weight[v * 4] = 1; }
        at += n;
      });
      geometry.setAttribute("skinIndex", new THREE.Uint16BufferAttribute(index, 4));
      geometry.setAttribute("skinWeight", new THREE.Float32BufferAttribute(weight, 4));
    }
    this.parts.forEach((p) => p.dispose());
    geometry.computeBoundingSphere();
    return geometry;
  }
}

export const sphere = (r: number, w = 16, h = 12) => new THREE.SphereGeometry(r, w, h);
export const cyl = (top: number, bottom: number, h: number, n = 14, rows = 1) => new THREE.CylinderGeometry(top, bottom, h, n, rows);
export const lathe = (profile: [number, number][], n = 18) =>
  new THREE.LatheGeometry(
    profile.map(([r, y]) => new THREE.Vector2(r, y)),
    n,
  );

/** A five-pointed star, extruded and bevelled, in the xy plane */
export function star(outer: number, inner: number, depth: number, points = 5): THREE.BufferGeometry {
  const shape = new THREE.Shape();
  for (let i = 0; i <= points * 2; i++) {
    const a = Math.PI / 2 + (i * Math.PI) / points;
    const r = i % 2 ? inner : outer;
    if (i === 0) shape.moveTo(Math.cos(a) * r, Math.sin(a) * r);
    else shape.lineTo(Math.cos(a) * r, Math.sin(a) * r);
  }
  const bevel = Math.min(depth * 0.45, inner * 0.3);
  return new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: true, bevelSize: bevel, bevelThickness: bevel, bevelSegments: 2 }).translate(0, 0, -depth / 2);
}

/** A leaf or feather shape along +y, with a little thickness */
export function leaf(length: number, width: number, depth = 0.008, segments = 6): THREE.BufferGeometry {
  const shape = new THREE.Shape();
  shape.moveTo(0, 0);
  shape.quadraticCurveTo(width, length * 0.4, 0, length);
  shape.quadraticCurveTo(-width, length * 0.4, 0, 0);
  return new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: false, curveSegments: segments }).translate(0, 0, -depth / 2);
}

const tmpColor = new THREE.Color();
export const blend = (a: string, b: string, k: number, out: THREE.Color) => {
  out.set(a);
  tmpColor.set(b);
  out.lerp(tmpColor, Math.min(1, Math.max(0, k)));
};

export const GOLD = "#f3c869";
export const GOLD_DEEP = "#d9963a";
