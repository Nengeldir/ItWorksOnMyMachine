import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import type { FloraSpecies } from "../biomes/types";
import type { SpeciesId } from "./species";

// Low-poly plant meshes built from primitives, one per species, 1 m tall with
// a radius of about 1 m (instances scale them). Every vertex carries a color
// (shaded darker towards the bottom of each part, for volume), a sway weight
// (0 on the trunk's foot, 1 on the leaves; the shader moves it with the wind)
// and a glow weight (self-lit caps and crystals).

export interface Paint {
  color: THREE.Color;
  color2?: THREE.Color; // some faces take this one instead
  share2?: number; // share of faces painted color2
  shade?: [number, number]; // brightness at the bottom and top of the part
  sway?: [number, number]; // sway weight at the bottom and top of the part
  glow?: number;
  glow2?: number; // glow of the color2 faces (a mushroom's spots)
}

let seed = 1;
/** A small seeded random for shaping meshes (looks only) */
function random(): number {
  seed = (seed + 0x6d2b79f5) | 0;
  let t = seed;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
/** Restarts the shaping random, so a mesh comes out the same every time */
export function reseed(value: number) {
  seed = value;
}
const rr = (a: number, b: number) => a + (b - a) * random();

export function part(source: THREE.BufferGeometry, paint: Paint): THREE.BufferGeometry {
  const geometry = source.index ? source.toNonIndexed() : source;
  if (geometry !== source) source.dispose();
  geometry.deleteAttribute("uv");
  geometry.deleteAttribute("normal");
  const position = geometry.getAttribute("position");
  geometry.computeBoundingBox();
  const { min, max } = geometry.boundingBox!;
  const span = Math.max(1e-4, max.y - min.y);
  const count = position.count;
  const colors = new Float32Array(count * 3);
  const sway = new Float32Array(count);
  const glow = new Float32Array(count);
  const [s0, s1] = paint.shade ?? [0.72, 1.08];
  const [w0, w1] = paint.sway ?? [1, 1];
  const c = new THREE.Color();
  for (let face = 0; face < count / 3; face++) {
    const second = paint.color2 && random() < (paint.share2 ?? 0.5);
    for (let k = 0; k < 3; k++) {
      const i = face * 3 + k;
      const t = (position.getY(i) - min.y) / span;
      c.copy(second ? paint.color2! : paint.color).multiplyScalar(s0 + (s1 - s0) * t);
      c.toArray(colors, i * 3);
      sway[i] = w0 + (w1 - w0) * t;
      glow[i] = second ? (paint.glow2 ?? paint.glow ?? 0) : (paint.glow ?? 0);
    }
  }
  geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  geometry.setAttribute("sway", new THREE.BufferAttribute(sway, 1));
  geometry.setAttribute("glow", new THREE.BufferAttribute(glow, 1));
  return geometry;
}

/** A lumpy blob of leaves */
function blob(radius: number, squash = 0.8, detail = 0): THREE.BufferGeometry {
  const g = new THREE.IcosahedronGeometry(radius, detail);
  const p = g.getAttribute("position");
  for (let i = 0; i < p.count; i++) {
    const k = 1 + (random() - 0.5) * 0.22;
    p.setXYZ(i, p.getX(i) * k, p.getY(i) * k * squash, p.getZ(i) * k);
  }
  return g;
}

/** A cylinder between two points */
export function limb(a: THREE.Vector3, b: THREE.Vector3, r0: number, r1: number, sides = 5): THREE.BufferGeometry {
  const dir = new THREE.Vector3().subVectors(b, a);
  const length = dir.length();
  const g = new THREE.CylinderGeometry(r1, r0, length, sides, 1);
  g.translate(0, length / 2, 0);
  g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize()));
  g.translate(a.x, a.y, a.z);
  return g;
}

export const v = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);

interface Colors {
  foliage: THREE.Color;
  foliage2: THREE.Color;
  trunk: THREE.Color;
}

function pine(c: Colors, tiers = 4, width = 1, snow?: THREE.Color): THREE.BufferGeometry[] {
  const parts = [part(new THREE.CylinderGeometry(0.06, 0.1, 0.3, 5).translate(0, 0.15, 0), { color: c.trunk, sway: [0, 0.1] })];
  for (let i = 0; i < tiers; i++) {
    const t = i / tiers;
    const r = width * (1 - t * 0.78);
    const h = 0.5 - t * 0.18;
    const y = 0.2 + t * 0.66;
    const cone = new THREE.ConeGeometry(r, h, 7, 1).rotateY(random() * 6.28).translate(0, y + h / 2, 0);
    const foliage = i % 2 ? c.foliage2 : c.foliage;
    const p = part(cone, { color: foliage, shade: [0.62, 1.12], sway: [0.25 + t * 0.6, 0.45 + t * 0.55] });
    if (snow) {
      // Snow on the upper side of each tier
      const position = p.getAttribute("position");
      const color = p.getAttribute("color") as THREE.BufferAttribute;
      for (let k = 0; k < position.count; k += 3) {
        const top = Math.max(position.getY(k), position.getY(k + 1), position.getY(k + 2));
        if (top > y + h * 0.55 && random() < 0.85) for (let j = 0; j < 3; j++) color.setXYZ(k + j, snow.r, snow.g, snow.b);
      }
    }
    parts.push(p);
  }
  return parts;
}

function oak(c: Colors, trunkTop = 0.5, spread = 1): THREE.BufferGeometry[] {
  const parts = [
    part(limb(v(0, 0, 0), v(0.02, trunkTop, 0), 0.11, 0.07, 6), { color: c.trunk, sway: [0, 0.25] }),
    part(limb(v(0.02, trunkTop * 0.75, 0), v(0.32 * spread, trunkTop + 0.18, 0.08), 0.045, 0.025), { color: c.trunk, sway: [0.2, 0.5] }),
    part(limb(v(0, trunkTop * 0.8, 0), v(-0.28 * spread, trunkTop + 0.2, -0.12), 0.045, 0.025), { color: c.trunk, sway: [0.2, 0.5] }),
  ];
  const blobs = 7;
  for (let i = 0; i < blobs; i++) {
    const a = (i / blobs) * Math.PI * 2 + random() * 0.6;
    const ring = i === 0 ? 0 : rr(0.35, 0.6) * spread;
    const r = i === 0 ? 0.45 : rr(0.3, 0.42);
    const y = i === 0 ? trunkTop + 0.32 : trunkTop + rr(0.08, 0.3);
    const g = blob(r, 0.75).translate(Math.cos(a) * ring, y, Math.sin(a) * ring);
    parts.push(part(g, { color: i % 3 ? c.foliage : c.foliage2, shade: [0.6, 1.15], sway: [0.7, 1] }));
  }
  return parts;
}

function birch(c: Colors): THREE.BufferGeometry[] {
  const trunk = part(limb(v(0, 0, 0), v(0.03, 0.72, 0.01), 0.07, 0.04, 6), { color: c.trunk, color2: c.trunk.clone().multiplyScalar(0.25), share2: 0.18, shade: [0.9, 1.05], sway: [0, 0.4] });
  const parts = [trunk];
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + random();
    const g = blob(rr(0.26, 0.34), 1.25).translate(Math.cos(a) * rr(0.08, 0.3), rr(0.62, 0.86), Math.sin(a) * rr(0.08, 0.3));
    parts.push(part(g, { color: i % 2 ? c.foliage : c.foliage2, shade: [0.65, 1.15], sway: [0.7, 1] }));
  }
  return parts;
}

function bush(c: Colors): THREE.BufferGeometry[] {
  const parts: THREE.BufferGeometry[] = [];
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + random();
    const g = blob(rr(0.45, 0.6), 0.75).translate(Math.cos(a) * rr(0.15, 0.4), rr(0.3, 0.55), Math.sin(a) * rr(0.15, 0.4));
    parts.push(part(g, { color: i % 2 ? c.foliage : c.foliage2, shade: [0.6, 1.1], sway: [0.3, 1] }));
  }
  return parts;
}

function palm(c: Colors): THREE.BufferGeometry[] {
  const parts: THREE.BufferGeometry[] = [];
  // A trunk bending towards +x in rings
  const segments = 7;
  let prev = v(0, 0, 0);
  for (let i = 1; i <= segments; i++) {
    const t = i / segments;
    const next = v(0.28 * t * t, 0.92 * t, 0);
    parts.push(part(limb(prev, next, 0.05 - t * 0.012, 0.045 - t * 0.012, 6), { color: i % 2 ? c.trunk : c.trunk.clone().multiplyScalar(0.8), sway: [t * 0.3, t * 0.35] }));
    prev = next;
  }
  const crown = prev;
  // Fronds: folded strips drooping out of the crown
  const fronds = 8;
  for (let i = 0; i < fronds; i++) {
    const a = (i / fronds) * Math.PI * 2 + random() * 0.4;
    const dir = v(Math.cos(a), 0, Math.sin(a));
    const side = v(-dir.z, 0, dir.x);
    const length = rr(0.5, 0.62);
    const positions: number[] = [];
    const steps = 4;
    const at = (s: number) => crown.clone().addScaledVector(dir, length * s).add(v(0, 0.12 * s - 0.42 * s * s, 0));
    for (let s = 0; s < steps; s++) {
      const p0 = at(s / steps);
      const p1 = at((s + 1) / steps);
      const w0 = 0.13 * Math.sin(Math.PI * Math.min(0.95, s / steps + 0.08));
      const w1 = 0.13 * Math.sin(Math.PI * Math.min(0.95, (s + 1) / steps + 0.08));
      const fold = 0.035;
      for (const k of [-1, 1]) {
        const e0 = p0.clone().addScaledVector(side, k * w0).add(v(0, -fold, 0));
        const e1 = p1.clone().addScaledVector(side, k * w1).add(v(0, -fold, 0));
        positions.push(...p0.toArray(), ...e0.toArray(), ...p1.toArray(), ...p1.toArray(), ...e0.toArray(), ...e1.toArray());
        // And the back side, so fronds read from below
        positions.push(...p0.toArray(), ...p1.toArray(), ...e0.toArray(), ...p1.toArray(), ...e1.toArray(), ...e0.toArray());
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
    parts.push(part(g, { color: i % 2 ? c.foliage : c.foliage2, shade: [0.75, 1.1], sway: [0.6, 1] }));
  }
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2;
    parts.push(part(new THREE.IcosahedronGeometry(0.04, 0).translate(crown.x + Math.cos(a) * 0.05, crown.y - 0.05, Math.sin(a) * 0.05), { color: c.trunk.clone().multiplyScalar(0.6), sway: [0.4, 0.4] }));
  }
  return parts;
}

function jungle(c: Colors): THREE.BufferGeometry[] {
  const parts = [part(limb(v(0, 0, 0), v(0, 0.72, 0), 0.08, 0.05, 6), { color: c.trunk, sway: [0, 0.2] })];
  // Buttress roots
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + 0.4;
    parts.push(part(limb(v(Math.cos(a) * 0.2, 0, Math.sin(a) * 0.2), v(0, 0.22, 0), 0.03, 0.05, 4), { color: c.trunk, sway: [0, 0] }));
  }
  // A wide, flat crown: an umbrella of blobs
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2 + random() * 0.4;
    const ring = i === 0 ? 0 : rr(0.42, 0.68);
    const g = blob(i === 0 ? 0.42 : rr(0.3, 0.38), 0.55).translate(Math.cos(a) * ring, rr(0.76, 0.9), Math.sin(a) * ring);
    parts.push(part(g, { color: i % 2 ? c.foliage : c.foliage2, shade: [0.55, 1.12], sway: [0.6, 1] }));
  }
  return parts;
}

function mushroom(c: Colors): THREE.BufferGeometry[] {
  const parts = [part(limb(v(0, 0, 0), v(0.03, 0.62, 0), 0.13, 0.09, 8), { color: c.trunk, shade: [0.8, 1.05], sway: [0, 0.3] })];
  // The cap: a dome with glowing spots, glowing gills underneath
  const cap = new THREE.SphereGeometry(0.5, 12, 5, 0, Math.PI * 2, 0, Math.PI / 2).scale(1, 0.5, 1).translate(0.03, 0.58, 0);
  parts.push(part(cap, { color: c.foliage, color2: c.foliage2, share2: 0.16, shade: [0.75, 1.15], sway: [0.3, 0.4], glow: 0.2, glow2: 1 }));
  const gills = new THREE.CircleGeometry(0.48, 12).rotateX(Math.PI / 2).translate(0.03, 0.585, 0);
  parts.push(part(gills, { color: c.foliage2, shade: [1, 1], sway: [0.3, 0.3], glow: 0.85 }));
  return parts;
}

function crystal(c: Colors): THREE.BufferGeometry[] {
  const parts: THREE.BufferGeometry[] = [];
  for (let i = 0; i < 6; i++) {
    const h = i === 0 ? 1 : rr(0.45, 0.8);
    const r = i === 0 ? 0.22 : rr(0.12, 0.18);
    const g = new THREE.ConeGeometry(r, h * 0.3, 5).translate(0, h - h * 0.15, 0);
    const body = new THREE.CylinderGeometry(r, r * 0.8, h * 0.7, 5).translate(0, h * 0.35, 0);
    const merged = mergeGeometries([g.toNonIndexed(), body.toNonIndexed()])!;
    g.dispose();
    body.dispose();
    const a = (i / 6) * Math.PI * 2;
    const tilt = i === 0 ? 0 : rr(0.25, 0.6);
    merged.rotateZ(tilt).rotateY(a).translate(i === 0 ? 0 : Math.cos(a) * 0.2, 0, i === 0 ? 0 : -Math.sin(a) * 0.2);
    parts.push(part(merged, { color: i % 2 ? c.foliage : c.foliage2, shade: [0.7, 1.25], sway: [0, 0], glow: 0.55 }));
  }
  return parts;
}

function deadTree(c: Colors): THREE.BufferGeometry[] {
  const parts = [part(limb(v(0, 0, 0), v(0.06, 1, 0.02), 0.1, 0.03, 5), { color: c.trunk, shade: [0.8, 1.05], sway: [0, 0.3] })];
  for (let i = 0; i < 5; i++) {
    const y = rr(0.35, 0.8);
    const a = random() * 6.28;
    const tip = v(Math.cos(a) * rr(0.35, 0.6), y + rr(0.15, 0.3), Math.sin(a) * rr(0.35, 0.6));
    parts.push(part(limb(v(0.03, y, 0), tip, 0.035, 0.012, 4), { color: c.trunk, sway: [0.3, 0.7] }));
  }
  return parts;
}

function basalt(c: Colors): THREE.BufferGeometry[] {
  const parts: THREE.BufferGeometry[] = [];
  const spots = [
    [0, 0],
    [0.42, 0.1],
    [-0.4, 0.16],
    [0.15, 0.42],
    [-0.2, -0.4],
    [0.35, -0.35],
    [-0.5, -0.2],
  ];
  spots.forEach(([x, z], i) => {
    const h = i === 0 ? 1 : rr(0.35, 0.9);
    const g = new THREE.CylinderGeometry(0.22, 0.24, h, 6).translate(x, h / 2, z);
    parts.push(part(g, { color: i % 2 ? c.foliage : c.foliage2, shade: [0.65, 1.2], sway: [0, 0] }));
  });
  return parts;
}

function boulder(c: Colors): THREE.BufferGeometry[] {
  const g = blob(0.8, 0.62, 1).translate(0, 0.38, 0);
  return [part(g, { color: c.foliage, color2: c.foliage2, share2: 0.35, shade: [0.65, 1.1], sway: [0, 0] })];
}

function redwood(c: Colors): THREE.BufferGeometry[] {
  const parts = [part(limb(v(0, 0, 0), v(0, 0.75, 0), 0.32, 0.18, 7), { color: c.trunk, shade: [0.7, 1.05], sway: [0, 0.1] })];
  for (let i = 0; i < 5; i++) {
    const t = i / 5;
    const g = new THREE.ConeGeometry(0.9 - t * 0.55, 0.3, 7).translate(0, 0.5 + t * 0.42, 0);
    parts.push(part(g, { color: i % 2 ? c.foliage : c.foliage2, shade: [0.6, 1.1], sway: [0.3, 0.5] }));
  }
  return parts;
}

/** Builds a species' mesh in a biome's colors */
export function speciesGeometry(spec: FloraSpecies, snow: THREE.Color): THREE.BufferGeometry {
  reseed(spec.id.length * 7919 + 17);
  const foliage = new THREE.Color(spec.foliage);
  const colors: Colors = {
    foliage,
    foliage2: new THREE.Color(spec.foliage2 ?? foliage.clone().multiplyScalar(0.82).getHex()),
    trunk: new THREE.Color(spec.trunk ?? "#5a4330"),
  };
  const builders: Record<SpeciesId, () => THREE.BufferGeometry[]> = {
    pine: () => pine(colors, 4, 1),
    fir: () => pine(colors, 6, 0.95),
    snowFir: () => pine(colors, 6, 0.95, snow),
    oak: () => oak(colors),
    birch: () => birch(colors),
    bush: () => bush(colors),
    palm: () => palm(colors),
    jungle: () => jungle(colors),
    mushroom: () => mushroom(colors),
    crystal: () => crystal(colors),
    deadTree: () => deadTree(colors),
    basalt: () => basalt(colors),
    boulder: () => boulder(colors),
    redwood: () => redwood(colors),
  };
  const parts = builders[spec.id]();
  const merged = mergeGeometries(parts)!;
  parts.forEach((p) => p.dispose());
  merged.computeVertexNormals();
  merged.computeBoundingSphere();
  return merged;
}
