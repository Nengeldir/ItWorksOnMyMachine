import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import type { StructureSpec } from "../biomes/types";
import { type Paint, limb, part, reseed, v } from "../flora/meshes";
import type { StructureId } from "./kinds";

// Structure meshes built from primitives like the plants (flora/meshes.ts):
// 1 m tall, in true proportions, the door facing +z, the plinth reaching below
// the ground so uneven sites don't show a gap. Every vertex carries a color, a
// sway weight (banners), a glow weight (windows, lanterns, gold: dim by day,
// lit at night) and a spin weight (1 on parts turning about the z axis: sails).

interface Colors {
  stone: THREE.Color;
  stone2: THREE.Color;
  roof: THREE.Color;
  wood: THREE.Color;
  cloth: THREE.Color;
  trim: THREE.Color;
  light: THREE.Color;
}

/** How bright lit windows are: above 1, so they bloom at night */
const LIT = 2.3;

function piece(source: THREE.BufferGeometry, paint: Paint, spin = 0): THREE.BufferGeometry {
  const geometry = part(source, { sway: [0, 0], ...paint });
  geometry.setAttribute("spin", new THREE.BufferAttribute(new Float32Array(geometry.getAttribute("position").count).fill(spin), 1));
  return geometry;
}

/** A box on a round wall: `radius` out from the axis at height `y`, facing outwards at angle `a` (0: +z) */
function onWall(w: number, h: number, d: number, radius: number, y: number, a: number): THREE.BufferGeometry {
  return new THREE.BoxGeometry(w, h, d).translate(0, y, radius).rotateY(a);
}

function watchtower(c: Colors): THREE.BufferGeometry[] {
  const stone: Paint = { color: c.stone, color2: c.stone2, share2: 0.22, shade: [0.7, 1.08] };
  const lit: Paint = { color: c.light, shade: [1, 1], glow: LIT };
  const parts = [
    piece(new THREE.CylinderGeometry(0.2, 0.22, 0.26, 10).translate(0, -0.1, 0), stone),
    piece(new THREE.CylinderGeometry(0.135, 0.17, 0.66, 10).translate(0, 0.36, 0), stone),
    // The gallery flares out under the lantern room
    piece(new THREE.CylinderGeometry(0.19, 0.15, 0.05, 10).translate(0, 0.705, 0), stone),
    piece(new THREE.CylinderGeometry(0.11, 0.12, 0.13, 8).translate(0, 0.795, 0), stone),
    piece(new THREE.ConeGeometry(0.19, 0.15, 8).translate(0, 0.925, 0), { color: c.roof, shade: [0.72, 1.15] }),
    piece(new THREE.IcosahedronGeometry(0.02, 0).translate(0, 1, 0), { color: c.trim, shade: [1, 1], glow: 0.8 }),
    piece(onWall(0.06, 0.1, 0.02, 0.163, 0.08, 0), { color: c.wood, shade: [0.8, 1] }),
  ];
  for (let i = 0; i < 8; i++) parts.push(piece(onWall(0.05, 0.04, 0.03, 0.172, 0.75, (i / 8) * Math.PI * 2), stone));
  // Slit windows winding up the wall, and the lantern room's on every side
  for (let i = 0; i < 4; i++) {
    const y = 0.22 + i * 0.12;
    const wall = 0.17 - 0.035 * ((y - 0.03) / 0.66);
    parts.push(piece(onWall(0.03, 0.06, 0.02, wall - 0.004, y, 0.9 + i * 1.9), lit));
  }
  for (let i = 0; i < 4; i++) parts.push(piece(onWall(0.055, 0.07, 0.02, 0.108, 0.8, (i / 4) * Math.PI * 2 + 0.4), lit));
  // A banner hanging off the gallery, loose at the bottom
  parts.push(piece(onWall(0.07, 0.2, 0.006, 0.2, 0.585, 2.2), { color: c.cloth, shade: [0.85, 1.05], sway: [1, 0.05] }));
  parts.push(piece(onWall(0.07, 0.025, 0.008, 0.2, 0.5, 2.2), { color: c.trim, shade: [1, 1], sway: [1, 0.9], glow: 0.5 }));
  return parts;
}

function stoneLantern(c: Colors): THREE.BufferGeometry[] {
  const stone: Paint = { color: c.stone, color2: c.stone2, share2: 0.3, shade: [0.72, 1.08] };
  const parts = [
    piece(new THREE.CylinderGeometry(0.2, 0.23, 0.3, 6).translate(0, -0.08, 0), stone),
    piece(new THREE.CylinderGeometry(0.06, 0.08, 0.44, 6).translate(0, 0.28, 0), stone),
    piece(new THREE.CylinderGeometry(0.2, 0.13, 0.07, 6).translate(0, 0.53, 0), stone),
    // The light, behind four corner posts
    piece(new THREE.BoxGeometry(0.19, 0.19, 0.19).translate(0, 0.66, 0), { color: c.light, shade: [1, 1], glow: LIT * 0.7 }),
    piece(new THREE.ConeGeometry(0.29, 0.19, 6).translate(0, 0.85, 0), { color: c.roof, shade: [0.72, 1.15] }),
    piece(new THREE.IcosahedronGeometry(0.04, 0).translate(0, 0.96, 0), { color: c.trim, shade: [1, 1], glow: 0.8 }),
  ];
  for (let i = 0; i < 4; i++) {
    const x = i % 2 ? 0.1 : -0.1;
    const z = i < 2 ? 0.1 : -0.1;
    parts.push(piece(new THREE.BoxGeometry(0.04, 0.2, 0.04).translate(x, 0.66, z), stone));
  }
  return parts;
}

function windmill(c: Colors, hub: number): THREE.BufferGeometry[] {
  const stone: Paint = { color: c.stone, color2: c.stone2, share2: 0.22, shade: [0.7, 1.08] };
  const lit: Paint = { color: c.light, shade: [1, 1], glow: LIT };
  const wood: Paint = { color: c.wood, shade: [0.8, 1.05] };
  const parts = [
    piece(new THREE.CylinderGeometry(0.22, 0.24, 0.26, 10).translate(0, -0.1, 0), stone),
    piece(new THREE.CylinderGeometry(0.13, 0.2, 0.73, 10).translate(0, 0.395, 0), stone),
    // A round cap, turned into the wind
    piece(new THREE.SphereGeometry(0.15, 10, 4, 0, Math.PI * 2, 0, Math.PI / 2).scale(1, 1.45, 1).translate(0, 0.76, 0), { color: c.roof, shade: [0.72, 1.15] }),
    piece(new THREE.IcosahedronGeometry(0.02, 0).translate(0, 0.99, 0), { color: c.trim, shade: [1, 1], glow: 0.8 }),
    piece(onWall(0.07, 0.11, 0.02, 0.192, 0.085, 0.6), wood),
    piece(limb(v(0, hub, 0.08), v(0, hub, 0.22), 0.022, 0.018, 6), wood),
    piece(new THREE.IcosahedronGeometry(0.032, 0).translate(0, hub, 0.22), { color: c.trim, shade: [1, 1], glow: 0.6 }, 1),
  ];
  for (let i = 0; i < 3; i++) {
    const y = 0.26 + i * 0.17;
    const wall = 0.2 - 0.07 * ((y - 0.03) / 0.73);
    parts.push(piece(onWall(0.035, 0.06, 0.02, wall - 0.004, y, 2.4 + i * 2.1), lit));
  }
  // Four sails: a spar and a sheet of cloth on its trailing side
  for (let i = 0; i < 4; i++) {
    const turn = Math.PI / 4 + (i * Math.PI) / 2;
    const spar = new THREE.BoxGeometry(0.014, 0.42, 0.014).translate(0, 0.21, 0).rotateZ(turn).translate(0, hub, 0.21);
    const sheet = new THREE.BoxGeometry(0.085, 0.3, 0.006).translate(0.05, 0.26, 0).rotateZ(turn).translate(0, hub, 0.21);
    parts.push(piece(spar, wood, 1), piece(sheet, { color: c.cloth, shade: [0.92, 1.05] }, 1));
  }
  return parts;
}

/** Builds a structure's mesh in a biome's colors */
export function structureGeometry(spec: StructureSpec, spinY: number): THREE.BufferGeometry {
  reseed(spec.id.length * 104729 + 31);
  const stone = new THREE.Color(spec.colors.stone);
  const colors: Colors = {
    stone,
    stone2: new THREE.Color(spec.colors.stone2 ?? stone.clone().multiplyScalar(0.84).getHex()),
    roof: new THREE.Color(spec.colors.roof),
    wood: new THREE.Color(spec.colors.wood ?? "#6b4a2f"),
    cloth: new THREE.Color(spec.colors.cloth ?? "#f1e6cf"),
    trim: new THREE.Color(spec.colors.trim ?? "#f2c761"),
    light: new THREE.Color(spec.colors.light ?? "#ffd58a"),
  };
  const builders: Record<StructureId, () => THREE.BufferGeometry[]> = {
    watchtower: () => watchtower(colors),
    stoneLantern: () => stoneLantern(colors),
    windmill: () => windmill(colors, spinY),
  };
  const parts = builders[spec.id]();
  const merged = mergeGeometries(parts)!;
  parts.forEach((p) => p.dispose());
  merged.computeVertexNormals();
  merged.computeBoundingSphere();
  return merged;
}
