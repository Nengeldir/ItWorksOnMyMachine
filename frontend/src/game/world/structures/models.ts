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
  snow: THREE.Color | null;
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

/** A four-sided block, tapering: `r0` and `r1` are half its width at the bottom and top */
function block(r0: number, r1: number, y0: number, y1: number): THREE.BufferGeometry {
  return new THREE.CylinderGeometry(r1 * Math.SQRT2, r0 * Math.SQRT2, y1 - y0, 4, 1).rotateY(Math.PI / 4).translate(0, (y0 + y1) / 2, 0);
}

/** A four-sided roof with its eaves `r` out from the middle */
function hipRoof(r: number, y0: number, y1: number): THREE.BufferGeometry {
  return new THREE.ConeGeometry(r * Math.SQRT2, y1 - y0, 4, 1).rotateY(Math.PI / 4).translate(0, (y0 + y1) / 2, 0);
}

/** A box on the `k`th face of a block (0: the front, +z), `out` from the middle, `off` along the face */
function onFace(w: number, h: number, d: number, off: number, y: number, out: number, k: number): THREE.BufferGeometry {
  return new THREE.BoxGeometry(w, h, d).translate(off, y, out).rotateY((k * Math.PI) / 2);
}

/** Roofs take the snow, where there is any */
function roofing(c: Colors): Paint {
  return c.snow ? { color: c.roof, color2: c.snow, share2: 0.72, shade: [0.85, 1.1] } : { color: c.roof, shade: [0.72, 1.15] };
}

function monastery(c: Colors): THREE.BufferGeometry[] {
  const wall: Paint = { color: c.stone, shade: [0.82, 1.06] };
  const lit: Paint = { color: c.light, shade: [1, 1], glow: LIT };
  const gold: Paint = { color: c.trim, shade: [1, 1], glow: 0.7 };
  const parts = [
    // A battered terrace of dark stone, the white hall on it, a tower above
    piece(block(0.4, 0.36, -0.3, 0.1), { color: c.stone2, shade: [0.7, 1.05] }),
    piece(block(0.3, 0.26, 0.1, 0.5), wall),
    piece(block(0.27, 0.27, 0.5, 0.58), { color: c.cloth, shade: [0.85, 1.05] }),
    piece(hipRoof(0.36, 0.58, 0.67), roofing(c)),
    piece(block(0.15, 0.13, 0.62, 0.82), wall),
    piece(block(0.14, 0.14, 0.8, 0.85), { color: c.cloth, shade: [0.85, 1.05] }),
    piece(hipRoof(0.2, 0.85, 0.94), roofing(c)),
    piece(new THREE.ConeGeometry(0.022, 0.07, 6).translate(0, 0.965, 0), gold),
    piece(new THREE.IcosahedronGeometry(0.02, 0).translate(0, 0.935, 0), gold),
    piece(onFace(0.09, 0.14, 0.02, 0, 0.17, 0.292, 0), { color: c.wood, shade: [0.8, 1] }),
    piece(onFace(0.12, 0.02, 0.03, 0, 0.25, 0.29, 0), gold),
  ];
  for (let k = 0; k < 4; k++) {
    // Two rows of windows on every side of the hall, one on the tower
    for (let row = 0; row < 2; row++) {
      const y = 0.33 + row * 0.1;
      const out = 0.3 - 0.04 * ((y - 0.1) / 0.4) - 0.006;
      for (let i = -1; i <= 1; i++) parts.push(piece(onFace(0.04, 0.05, 0.02, i * 0.13, y, out, k), lit));
    }
    parts.push(piece(onFace(0.05, 0.06, 0.02, 0, 0.72, 0.134, k), lit));
    // Gold on the corners of the eaves
    const a = (k * Math.PI) / 2 + Math.PI / 4;
    parts.push(piece(new THREE.IcosahedronGeometry(0.02, 0).translate(Math.sin(a) * 0.5, 0.59, Math.cos(a) * 0.5), gold));
  }
  // Banners down the front, either side of the door
  for (const side of [-1, 1]) parts.push(piece(onFace(0.05, 0.2, 0.006, side * 0.2, 0.2, 0.305, 0), { color: c.cloth, shade: [0.9, 1.1], sway: [1, 0.05] }));
  return parts;
}

function bellPavilion(c: Colors): THREE.BufferGeometry[] {
  const parts = [
    piece(block(0.46, 0.4, -0.42, 0.06), { color: c.stone, color2: c.stone2, share2: 0.3, shade: [0.72, 1.08] }),
    piece(hipRoof(0.5, 0.62, 0.88), roofing(c)),
    piece(new THREE.ConeGeometry(0.035, 0.12, 6).translate(0, 0.93, 0), { color: c.trim, shade: [1, 1], glow: 0.7 }),
    // The bell, with a light inside
    piece(new THREE.CylinderGeometry(0.09, 0.15, 0.22, 8).translate(0, 0.42, 0), { color: c.trim, shade: [0.85, 1.1], glow: 0.5, sway: [0.5, 0.05] }),
    piece(new THREE.IcosahedronGeometry(0.07, 0).translate(0, 0.32, 0), { color: c.light, shade: [1, 1], glow: LIT, sway: [0.6, 0.6] }),
    piece(limb(v(0, 0.53, 0), v(0, 0.64, 0), 0.012, 0.012, 4), { color: c.wood }),
  ];
  for (let i = 0; i < 4; i++) {
    const x = i % 2 ? 0.3 : -0.3;
    const z = i < 2 ? 0.3 : -0.3;
    parts.push(piece(new THREE.BoxGeometry(0.06, 0.58, 0.06).translate(x, 0.34, z), { color: c.wood, shade: [0.8, 1.05] }));
  }
  return parts;
}

function stoneHut(c: Colors): THREE.BufferGeometry[] {
  const lit: Paint = { color: c.light, shade: [1, 1], glow: LIT };
  return [
    piece(new THREE.CylinderGeometry(0.5, 0.57, 0.97, 9).translate(0, 0.015, 0), { color: c.stone, color2: c.stone2, share2: 0.35, shade: [0.72, 1.08] }),
    piece(new THREE.ConeGeometry(0.66, 0.5, 9).translate(0, 0.73, 0), roofing(c)),
    piece(onWall(0.2, 0.3, 0.04, 0.5, 0.16, 0), { color: c.wood, shade: [0.8, 1] }),
    piece(onWall(0.14, 0.14, 0.04, 0.5, 0.3, 1.5), lit),
    piece(onWall(0.14, 0.14, 0.04, 0.5, 0.3, -1.7), lit),
    // A chimney through the roof
    piece(new THREE.BoxGeometry(0.12, 0.3, 0.12).translate(-0.25, 0.78, -0.1), { color: c.stone2, shade: [0.8, 1.05] }),
  ];
}

const FLAGS = ["#3f74d6", "#f6f4ec", "#d6463c", "#3f9f5c", "#f2c53d"];

function prayerPole(c: Colors): THREE.BufferGeometry[] {
  const parts = [
    piece(limb(v(0, -0.3, 0), v(0, 1, 0), 0.02, 0.012, 5), { color: c.wood, shade: [0.8, 1.05] }),
    // A cairn at its foot
    piece(new THREE.CylinderGeometry(0.11, 0.2, 0.36, 6).translate(0, -0.14, 0), { color: c.stone, color2: c.stone2, share2: 0.4, shade: [0.75, 1.08] }),
    piece(new THREE.CylinderGeometry(0.06, 0.09, 0.07, 6).translate(0, 0.075, 0), { color: c.stone2, shade: [0.8, 1.08] }),
    piece(new THREE.IcosahedronGeometry(0.022, 0).translate(0, 1, 0), { color: c.trim, shade: [1, 1], glow: 0.7 }),
  ];
  // Strings of flags from the top down to pegs all around
  const top = v(0, 0.97, 0);
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2 + 0.3;
    const peg = v(Math.sin(a) * 0.62, 0.03, Math.cos(a) * 0.62);
    parts.push(piece(limb(top, peg, 0.004, 0.004, 3), { color: c.wood, sway: [0.05, 0.5] }));
    for (let k = 1; k <= 9; k++) {
      const t = k / 10;
      // (the string sags a little under its flags)
      const at = top.clone().lerp(peg, t);
      const flag = new THREE.BoxGeometry(0.075, 0.065, 0.004).translate(0, -0.04, 0).rotateY(a + Math.PI / 2).translate(at.x, at.y, at.z);
      parts.push(piece(flag, { color: new THREE.Color(FLAGS[(k + i) % FLAGS.length]), shade: [0.9, 1.05], sway: [1, 0.4] }));
    }
  }
  return parts;
}

function lighthouse(c: Colors, lamp: number): THREE.BufferGeometry[] {
  const lit: Paint = { color: c.light, shade: [1, 1], glow: LIT };
  const parts = [
    // A rock of a plinth, the tower in bands of white and red, the lamp room, a cap
    piece(new THREE.CylinderGeometry(0.19, 0.24, 0.4, 8).translate(0, -0.12, 0), { color: c.stone2, shade: [0.7, 1.05] }),
    piece(new THREE.CylinderGeometry(0.075, 0.08, 0.1, 8).translate(0, lamp, 0), { color: c.light, shade: [1, 1], glow: 1.5 }),
    piece(new THREE.CylinderGeometry(0.115, 0.095, 0.025, 10).translate(0, lamp - 0.06, 0), { color: c.stone2, shade: [0.8, 1.05] }),
    piece(new THREE.ConeGeometry(0.11, 0.1, 8).translate(0, lamp + 0.1, 0), { color: c.roof, shade: [0.72, 1.15] }),
    piece(new THREE.IcosahedronGeometry(0.018, 0).translate(0, lamp + 0.155, 0), { color: c.trim, shade: [1, 1], glow: 0.8 }),
    piece(onWall(0.05, 0.085, 0.02, 0.128, 0.125, 0), { color: c.wood, shade: [0.8, 1] }),
  ];
  for (let i = 0; i < 5; i++) {
    const y0 = 0.08 + i * 0.144;
    const r = (y: number) => 0.13 - 0.045 * ((y - 0.08) / 0.72);
    parts.push(piece(new THREE.CylinderGeometry(r(y0 + 0.144), r(y0), 0.144, 10).translate(0, y0 + 0.072, 0), { color: i % 2 ? c.cloth : c.stone, shade: [0.92, 1.05] }));
    if (i > 0 && i < 4) parts.push(piece(onWall(0.025, 0.04, 0.02, r(y0 + 0.07) - 0.004, y0 + 0.07, 1 + i * 1.7), lit));
  }
  // The beam: two bars of light turning with the lamp
  for (const side of [-1, 1]) parts.push(piece(new THREE.BoxGeometry(0.42, 0.018, 0.018).translate(side * 0.28, lamp, 0), { color: c.light, shade: [1, 1], glow: 1.1 }, 1));
  return parts;
}

function stiltHut(c: Colors): THREE.BufferGeometry[] {
  const lit: Paint = { color: c.light, shade: [1, 1], glow: LIT };
  const wood: Paint = { color: c.wood, shade: [0.8, 1.05] };
  const parts = [
    piece(new THREE.BoxGeometry(0.78, 0.04, 0.78).translate(0, 0.46, 0), wood),
    piece(block(0.27, 0.27, 0.48, 0.72), { color: c.stone, color2: c.stone2, share2: 0.3, shade: [0.8, 1.06] }),
    // Thatch, steep and wide
    piece(hipRoof(0.46, 0.68, 1), { color: c.roof, color2: c.roof.clone().multiplyScalar(0.82), share2: 0.4, shade: [0.72, 1.15] }),
    piece(onFace(0.12, 0.17, 0.02, -0.08, 0.565, 0.272, 0), wood),
    piece(onFace(0.1, 0.09, 0.02, 0.13, 0.61, 0.272, 0), lit),
    piece(onFace(0.1, 0.09, 0.02, 0, 0.61, 0.272, 1), lit),
    piece(onFace(0.1, 0.09, 0.02, 0, 0.61, 0.272, 3), lit),
    // A lantern hanging off the corner of the deck
    piece(new THREE.BoxGeometry(0.05, 0.06, 0.05).translate(0.36, 0.55, 0.36), { color: c.light, shade: [1, 1], glow: LIT * 0.7 }),
    piece(limb(v(0.36, 0.46, 0.36), v(0.36, 0.66, 0.36), 0.008, 0.008, 4), wood),
  ];
  for (let i = 0; i < 4; i++) parts.push(piece(limb(v(i % 2 ? 0.32 : -0.32, -0.32, i < 2 ? 0.32 : -0.32), v(i % 2 ? 0.3 : -0.3, 0.46, i < 2 ? 0.3 : -0.3), 0.025, 0.02, 5), wood));
  return parts;
}

function ruinColumn(c: Colors): THREE.BufferGeometry[] {
  const stone: Paint = { color: c.stone, color2: c.stone2, share2: 0.35, shade: [0.72, 1.08] };
  const parts = [piece(new THREE.BoxGeometry(0.62, 0.4, 0.3).translate(0, -0.12, 0), stone)];
  // Three columns of a lost colonnade: one whole with its capital, two broken
  const tops = [1, 0.62, 0.34];
  tops.forEach((top, i) => {
    const x = (i - 1) * 0.21;
    parts.push(piece(new THREE.CylinderGeometry(0.052, 0.062, top - 0.06, 8).translate(x, (top + 0.06) / 2, 0), stone));
    if (i === 0) parts.push(piece(new THREE.BoxGeometry(0.16, 0.05, 0.16).translate(x, top - 0.025, 0), stone));
    else parts.push(piece(new THREE.CylinderGeometry(0.03, 0.052, 0.06, 5).translate(x + 0.01, top + 0.02, 0.01), { color: c.stone2, shade: [0.8, 1.05] }));
  });
  // A fallen drum in front
  parts.push(piece(new THREE.CylinderGeometry(0.055, 0.055, 0.16, 8).rotateZ(Math.PI / 2).rotateY(0.5).translate(0.12, 0.09, 0.22), stone));
  return parts;
}

function shrineGate(c: Colors): THREE.BufferGeometry[] {
  const post: Paint = { color: c.cloth, shade: [0.82, 1.06] };
  const parts = [
    // Two lintels across the posts, the upper one wider with gold ends
    piece(new THREE.BoxGeometry(0.98, 0.06, 0.08).translate(0, 0.94, 0), { color: c.roof, shade: [0.9, 1.1] }),
    piece(new THREE.BoxGeometry(0.84, 0.045, 0.06).translate(0, 0.78, 0), post),
    piece(new THREE.BoxGeometry(0.06, 0.12, 0.05).translate(0, 0.86, 0), post),
  ];
  for (const side of [-1, 1]) {
    parts.push(piece(limb(v(side * 0.36, -0.32, 0), v(side * 0.35, 0.92, 0), 0.045, 0.036, 8), post));
    parts.push(piece(new THREE.CylinderGeometry(0.07, 0.085, 0.4, 6).translate(side * 0.36, -0.12, 0), { color: c.stone, color2: c.stone2, share2: 0.3, shade: [0.72, 1.08] }));
    parts.push(piece(new THREE.BoxGeometry(0.05, 0.07, 0.09).translate(side * 0.5, 0.94, 0), { color: c.trim, shade: [1, 1], glow: 0.7 }));
    // A lantern hanging under the lintel, swinging
    parts.push(piece(limb(v(side * 0.2, 0.76, 0), v(side * 0.2, 0.66, 0), 0.005, 0.005, 3), { color: c.wood, sway: [0.5, 0.05] }));
    parts.push(piece(new THREE.BoxGeometry(0.055, 0.075, 0.055).translate(side * 0.2, 0.62, 0), { color: c.light, shade: [1, 1], glow: LIT, sway: [0.8, 0.5] }));
  }
  return parts;
}

function spiritStatue(c: Colors): THREE.BufferGeometry[] {
  const stone: Paint = { color: c.stone, color2: c.stone2, share2: 0.45, shade: [0.72, 1.08] };
  const lit: Paint = { color: c.light, shade: [1, 1], glow: LIT };
  const parts = [
    // A sitting fox spirit on a plinth: round body, head with tall ears, eyes and a mark that glow
    piece(block(0.3, 0.26, -0.32, 0.14), stone),
    piece(new THREE.IcosahedronGeometry(0.25, 1).scale(1, 1.15, 0.95).translate(0, 0.4, -0.02), stone),
    piece(new THREE.IcosahedronGeometry(0.17, 1).translate(0, 0.74, 0.04), stone),
    piece(new THREE.ConeGeometry(0.06, 0.1, 5).rotateX(Math.PI / 2).translate(0, 0.71, 0.21), stone),
    piece(new THREE.IcosahedronGeometry(0.035, 0).translate(0, 0.47, 0.22), lit),
    piece(new THREE.BoxGeometry(0.16, 0.02, 0.02).translate(0, 0.22, 0.25), { color: c.trim, shade: [1, 1], glow: 0.7 }),
  ];
  for (const side of [-1, 1]) {
    parts.push(piece(new THREE.ConeGeometry(0.06, 0.2, 4).translate(side * 0.1, 0.96, 0.02), stone));
    parts.push(piece(new THREE.IcosahedronGeometry(0.024, 0).translate(side * 0.07, 0.77, 0.19), lit));
    parts.push(piece(new THREE.CylinderGeometry(0.05, 0.06, 0.26, 5).translate(side * 0.13, 0.27, 0.17), stone));
  }
  return parts;
}

function forgeTemple(c: Colors): THREE.BufferGeometry[] {
  const stone: Paint = { color: c.stone, color2: c.stone2, share2: 0.3, shade: [0.7, 1.08] };
  const lava: Paint = { color: c.light, shade: [1, 1], glow: LIT };
  const parts = [
    // Three steps of dark stone
    piece(block(0.44, 0.39, -0.3, 0.2), stone),
    piece(block(0.31, 0.27, 0.2, 0.45), stone),
    piece(block(0.19, 0.16, 0.45, 0.66), stone),
    // The fire on top, in a bowl of gold
    piece(new THREE.CylinderGeometry(0.13, 0.07, 0.07, 8).translate(0, 0.695, 0), { color: c.trim, shade: [0.85, 1.1], glow: 0.5 }),
    piece(new THREE.ConeGeometry(0.1, 0.26, 6).translate(0, 0.86, 0), { ...lava, sway: [0.1, 1] }),
    piece(new THREE.ConeGeometry(0.06, 0.16, 5).translate(0.03, 0.8, 0.02), { color: c.cloth, shade: [1, 1], glow: LIT, sway: [0.1, 1] }),
    // The gate of the forge, glowing from inside
    piece(onFace(0.14, 0.2, 0.03, 0, 0.1, 0.415, 0), lava),
  ];
  for (let k = 0; k < 4; k++) {
    // Lava running down a channel on every side, step by step
    parts.push(piece(onFace(0.05, 0.21, 0.02, 0, 0.555, 0.178, k), lava));
    parts.push(piece(onFace(0.05, 0.25, 0.02, k === 0 ? 0.16 : 0, 0.325, 0.292, k), lava));
    if (k > 0) parts.push(piece(onFace(0.05, 0.5, 0.02, 0, -0.05, 0.418, k), lava));
    // Obelisks on the corners of the first step
    const a = (k * Math.PI) / 2 + Math.PI / 4;
    parts.push(piece(new THREE.ConeGeometry(0.035, 0.22, 4).translate(Math.sin(a) * 0.47, 0.31, Math.cos(a) * 0.47), { color: c.roof, shade: [0.75, 1.15] }));
  }
  return parts;
}

function obelisk(c: Colors): THREE.BufferGeometry[] {
  const parts = [
    piece(block(0.14, 0.12, -0.32, 0.05), { color: c.stone2, shade: [0.72, 1.05] }),
    piece(block(0.085, 0.05, 0.05, 0.88), { color: c.stone, color2: c.roof, share2: 0.3, shade: [0.75, 1.15] }),
    piece(hipRoof(0.05, 0.88, 1), { color: c.roof, shade: [0.85, 1.2] }),
  ];
  // Runes down every face
  for (let k = 0; k < 4; k++) {
    for (let i = 0; i < 4; i++) {
      const y = 0.22 + i * 0.16 + (k % 2) * 0.05;
      const out = 0.085 - 0.035 * ((y - 0.05) / 0.83) - 0.004;
      parts.push(piece(onFace(i % 2 ? 0.05 : 0.025, i % 2 ? 0.02 : 0.06, 0.012, 0, y, out, k), { color: c.light, shade: [1, 1], glow: LIT }));
    }
  }
  return parts;
}

function brazier(c: Colors): THREE.BufferGeometry[] {
  return [
    piece(new THREE.CylinderGeometry(0.2, 0.26, 0.42, 6).translate(0, -0.12, 0), { color: c.stone, color2: c.stone2, share2: 0.35, shade: [0.72, 1.08] }),
    piece(new THREE.CylinderGeometry(0.07, 0.11, 0.36, 6).translate(0, 0.26, 0), { color: c.stone, shade: [0.75, 1.08] }),
    piece(new THREE.CylinderGeometry(0.26, 0.1, 0.16, 8).translate(0, 0.5, 0), { color: c.trim, shade: [0.8, 1.1], glow: 0.4 }),
    // The fire: two tongues, flickering in the wind
    piece(new THREE.ConeGeometry(0.19, 0.42, 6).translate(0, 0.78, 0), { color: c.light, shade: [1, 1], glow: LIT, sway: [0.1, 1] }),
    piece(new THREE.ConeGeometry(0.11, 0.26, 5).translate(0.06, 0.7, 0.04), { color: c.cloth, shade: [1, 1], glow: LIT, sway: [0.1, 1] }),
  ];
}

function observatory(c: Colors): THREE.BufferGeometry[] {
  const stone: Paint = { color: c.stone, color2: c.stone2, share2: 0.25, shade: [0.72, 1.08] };
  const lit: Paint = { color: c.light, shade: [1, 1], glow: LIT };
  const parts = [
    piece(new THREE.CylinderGeometry(0.24, 0.27, 0.42, 10).translate(0, -0.1, 0), { color: c.stone2, shade: [0.7, 1.05] }),
    piece(new THREE.CylinderGeometry(0.17, 0.2, 0.5, 10).translate(0, 0.36, 0), stone),
    piece(new THREE.CylinderGeometry(0.21, 0.17, 0.03, 10).translate(0, 0.615, 0), { color: c.trim, shade: [0.9, 1.1], glow: 0.5 }),
    // A dome of crystal, lit from inside
    piece(new THREE.SphereGeometry(0.18, 10, 5, 0, Math.PI * 2, 0, Math.PI / 2).translate(0, 0.63, 0), { color: c.light, color2: c.cloth, share2: 0.35, shade: [1, 1], glow: 0.9, glow2: 1.6 }),
    piece(new THREE.IcosahedronGeometry(0.022, 0).translate(0, 0.83, 0), { color: c.trim, shade: [1, 1], glow: 0.9 }),
    piece(onWall(0.06, 0.1, 0.02, 0.193, 0.16, 0), { color: c.wood, shade: [0.8, 1] }),
    // Two rings of gold turning around the dome
    piece(new THREE.TorusGeometry(0.3, 0.011, 4, 20).rotateX(Math.PI / 2 - 0.5).translate(0, 0.72, 0), { color: c.trim, shade: [1, 1], glow: 0.9 }, 1),
    piece(new THREE.TorusGeometry(0.25, 0.009, 4, 18).rotateX(Math.PI / 2 + 0.7).rotateY(1).translate(0, 0.72, 0), { color: c.trim, shade: [1, 1], glow: 0.9 }, 1),
    piece(new THREE.IcosahedronGeometry(0.025, 0).translate(0.3, 0.72, 0), lit, 1),
  ];
  for (let i = 0; i < 5; i++) parts.push(piece(onWall(0.03, 0.06, 0.02, 0.2 - 0.03 * ((0.2 + i * 0.07 - 0.11) / 0.5) - 0.004, 0.22 + i * 0.07, 0.8 + i * 1.25), lit));
  return parts;
}

function pylon(c: Colors): THREE.BufferGeometry[] {
  const crystal: Paint = { color: c.light, color2: c.cloth, share2: 0.4, shade: [0.8, 1.15], glow: 0.55, glow2: 0.95 };
  const parts = [
    piece(block(0.16, 0.13, -0.32, 0.08), { color: c.stone, color2: c.stone2, share2: 0.3, shade: [0.72, 1.08] }),
    piece(block(0.1, 0.085, 0.08, 0.2), { color: c.stone2, shade: [0.8, 1.08] }),
    piece(new THREE.CylinderGeometry(0.14, 0.14, 0.012, 8).translate(0, 0.21, 0), { color: c.trim, shade: [1, 1], glow: 0.7 }),
    // The crystal: two pyramids base to base, hanging over its plinth
    piece(new THREE.ConeGeometry(0.1, 0.5, 5).translate(0, 0.74, 0), { ...crystal, sway: [1, 1] }),
    piece(new THREE.ConeGeometry(0.1, 0.22, 5).rotateX(Math.PI).translate(0, 0.38, 0), { ...crystal, sway: [1, 1] }),
  ];
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2 + 0.5;
    parts.push(piece(new THREE.OctahedronGeometry(0.03, 0).scale(1, 1.8, 1).translate(Math.sin(a) * 0.2, 0.5 + i * 0.12, Math.cos(a) * 0.2), { ...crystal, sway: [2, 2] }));
  }
  return parts;
}

function starAltar(c: Colors): THREE.BufferGeometry[] {
  const stone: Paint = { color: c.stone, color2: c.stone2, share2: 0.3, shade: [0.72, 1.08] };
  const parts = [
    piece(new THREE.CylinderGeometry(0.58, 0.68, 0.62, 10).translate(0, -0.21, 0), stone),
    piece(new THREE.CylinderGeometry(0.4, 0.44, 0.08, 10).translate(0, 0.14, 0), stone),
    piece(new THREE.CylinderGeometry(0.3, 0.3, 0.012, 10).translate(0, 0.186, 0), { color: c.light, shade: [1, 1], glow: 0.5 }),
    // A fallen star, floating over it
    piece(new THREE.OctahedronGeometry(0.16, 0).scale(1, 1.3, 1).translate(0, 0.72, 0), { color: c.light, shade: [0.85, 1.1], glow: 0.9, sway: [1, 1] }),
    piece(new THREE.OctahedronGeometry(0.1, 0).scale(1.9, 0.5, 1.9).rotateY(0.6).translate(0, 0.72, 0), { color: c.cloth, shade: [0.9, 1.1], glow: 1.2, sway: [1, 1] }),
  ];
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    parts.push(piece(new THREE.ConeGeometry(0.05, 0.22, 4).translate(Math.sin(a) * 0.5, 0.2, Math.cos(a) * 0.5), { color: c.stone2, shade: [0.8, 1.1] }));
  }
  return parts;
}

function ethMainBuilding(c: Colors): THREE.BufferGeometry[] {
  const stone: Paint = { color: c.stone, shade: [0.84, 1.06] };
  const base: Paint = { color: c.stone2, shade: [0.75, 1.02] };
  const roof: Paint = { color: c.roof, color2: c.roof.clone().multiplyScalar(0.86), share2: 0.3, shade: [0.8, 1.12] };
  const lit: Paint = { color: c.light, shade: [1, 1], glow: 1.5 };
  const box = (w: number, h: number, d: number, x: number, y: number, z: number) => new THREE.BoxGeometry(w, h, d).translate(x, y, z);
  const parts = [
    // A terrace, the long hall on a rusticated ground floor, a cornice and a low roof
    piece(box(2.3, 0.37, 0.92, 0, -0.135, 0), base),
    piece(box(2.2, 0.14, 0.78, 0, 0.12, 0), base),
    piece(box(2.16, 0.28, 0.74, 0, 0.33, 0), stone),
    piece(box(2.2, 0.02, 0.8, 0, 0.48, 0), { color: c.stone, shade: [1.05, 1.1] }),
    piece(box(2.1, 0.05, 0.66, 0, 0.515, 0), roof),
    // The rotunda swelling out of the front, its drum and the ribbed dome
    piece(new THREE.CylinderGeometry(0.33, 0.33, 0.55, 16).translate(0, 0.325, 0.2), stone),
    piece(new THREE.CylinderGeometry(0.36, 0.36, 0.025, 16).translate(0, 0.5, 0.2), { color: c.stone, shade: [1.05, 1.1] }),
    piece(new THREE.CylinderGeometry(0.27, 0.29, 0.14, 16).translate(0, 0.66, 0.12), stone),
    piece(new THREE.SphereGeometry(0.27, 16, 6, 0, Math.PI * 2, 0, Math.PI / 2).scale(1, 0.82, 1).translate(0, 0.73, 0.12), roof),
    piece(new THREE.CylinderGeometry(0.035, 0.045, 0.05, 8).translate(0, 0.965, 0.12), stone),
    piece(new THREE.IcosahedronGeometry(0.02, 0).translate(0, 1, 0.12), { color: c.trim, shade: [1, 1], glow: 0.8 }),
    // The doors under the columns
    piece(box(0.1, 0.12, 0.02, 0, 0.11, 0.535), { color: c.wood, shade: [0.8, 1] }),
  ];
  // Columns round the rotunda, with tall windows between them
  for (let i = -4; i <= 4; i++) {
    const a = (i / 4) * 1.25;
    parts.push(piece(new THREE.CylinderGeometry(0.014, 0.016, 0.3, 6).translate(Math.sin(a) * 0.35, 0.34, 0.2 + Math.cos(a) * 0.35), { color: c.stone, shade: [0.95, 1.1] }));
    if (i < 4) {
      const b = ((i + 0.5) / 4) * 1.25;
      parts.push(piece(new THREE.BoxGeometry(0.045, 0.16, 0.02).translate(0, 0.35, 0.325).rotateY(b).translate(0, 0, 0.2), lit));
    }
  }
  for (let i = 0; i < 10; i++) parts.push(piece(new THREE.BoxGeometry(0.035, 0.07, 0.02).translate(0, 0.66, 0.272).rotateY((i / 10) * Math.PI * 2).translate(0, 0, 0.12), lit));
  for (const side of [-1, 1]) {
    // Pavilions closing the wings, a little taller and further out
    parts.push(piece(box(0.34, 0.47, 0.84, side * 0.95, 0.285, 0), stone));
    parts.push(piece(box(0.37, 0.02, 0.87, side * 0.95, 0.53, 0), { color: c.stone, shade: [1.05, 1.1] }));
    parts.push(piece(box(0.3, 0.045, 0.74, side * 0.95, 0.56, 0), roof));
    // Two storeys of windows down both long sides
    for (const face of [-1, 1]) {
      for (let row = 0; row < 2; row++) {
        for (let i = 0; i < 6; i++) parts.push(piece(box(0.035, row ? 0.075 : 0.06, 0.02, side * (0.39 + i * 0.066), 0.29 + row * 0.11, face * 0.372), lit));
        for (let i = 0; i < 3; i++) parts.push(piece(box(0.04, row ? 0.075 : 0.06, 0.02, side * (0.86 + i * 0.09), 0.29 + row * 0.11, face * 0.422), lit));
      }
    }
    // Banners in the university's blue either side of the doors
    parts.push(piece(box(0.035, 0.16, 0.006, side * 0.42, 0.36, 0.378), { color: c.cloth, shade: [0.9, 1.1], sway: [1, 0.05] }));
  }
  return parts;
}

function einsteinBust(c: Colors): THREE.BufferGeometry[] {
  const stone: Paint = { color: c.stone, color2: c.stone2, share2: 0.25, shade: [0.75, 1.06] };
  const bronze: Paint = { color: c.roof, shade: [0.78, 1.12] };
  const hair: Paint = { color: c.cloth, shade: [0.85, 1.08] };
  const head = 0.79;
  const parts = [
    // A pedestal with a gold plaque
    piece(block(0.23, 0.2, -0.32, 0.4), stone),
    piece(block(0.24, 0.24, 0.4, 0.44), stone),
    piece(onFace(0.2, 0.1, 0.012, 0, 0.2, 0.212, 0), { color: c.trim, shade: [1, 1], glow: 0.5 }),
    // Shoulders in a rumpled jumper, neck, head
    piece(block(0.2, 0.16, 0.44, 0.52), bronze),
    piece(new THREE.IcosahedronGeometry(0.2, 1).scale(1.25, 0.5, 0.8).translate(0, 0.56, 0), bronze),
    piece(new THREE.CylinderGeometry(0.055, 0.07, 0.1, 7).translate(0, 0.66, 0), bronze),
    piece(new THREE.IcosahedronGeometry(0.115, 1).scale(0.95, 1.12, 1).translate(0, head, 0.01), bronze),
    piece(new THREE.ConeGeometry(0.028, 0.06, 4).rotateX(Math.PI / 2).translate(0, head - 0.01, 0.135), bronze),
    // The moustache, and eyebrows as wild as the hair
    piece(new THREE.IcosahedronGeometry(0.035, 0).scale(1.9, 0.6, 0.8).translate(0, head - 0.055, 0.115), hair),
    piece(new THREE.BoxGeometry(0.045, 0.014, 0.02).rotateZ(-0.2).translate(0.045, head + 0.048, 0.108), hair),
    piece(new THREE.BoxGeometry(0.045, 0.014, 0.02).rotateZ(0.2).translate(-0.045, head + 0.048, 0.108), hair),
    piece(new THREE.IcosahedronGeometry(0.014, 0).translate(0.043, head + 0.02, 0.105), { color: c.wood, shade: [0.5, 0.6] }),
    piece(new THREE.IcosahedronGeometry(0.014, 0).translate(-0.043, head + 0.02, 0.105), { color: c.wood, shade: [0.5, 0.6] }),
  ];
  // The hair: tufts standing out every way, thickest at the sides and back
  const tufts: [number, number, number, number][] = [
    [0.13, 0.06, -0.01, 0.07], [-0.13, 0.06, -0.01, 0.07], [0.15, -0.02, -0.04, 0.06], [-0.15, -0.02, -0.04, 0.06],
    [0.08, 0.13, -0.02, 0.065], [-0.08, 0.13, -0.02, 0.065], [0, 0.15, -0.03, 0.065], [0, 0.1, -0.11, 0.075],
    [0.09, 0.02, -0.11, 0.065], [-0.09, 0.02, -0.11, 0.065], [0.05, 0.14, 0.05, 0.045], [-0.05, 0.14, 0.05, 0.045],
  ];
  for (const [x, y, z, r] of tufts) parts.push(piece(new THREE.IcosahedronGeometry(r, 0).scale(1, 1, 1).translate(x * 1.05, head + y, z), hair));
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
    snow: spec.colors.snow ? new THREE.Color(spec.colors.snow) : null,
  };
  const builders: Record<StructureId, () => THREE.BufferGeometry[]> = {
    watchtower: () => watchtower(colors),
    stoneLantern: () => stoneLantern(colors),
    windmill: () => windmill(colors, spinY),
    monastery: () => monastery(colors),
    bellPavilion: () => bellPavilion(colors),
    stoneHut: () => stoneHut(colors),
    prayerPole: () => prayerPole(colors),
    lighthouse: () => lighthouse(colors, spinY),
    stiltHut: () => stiltHut(colors),
    ruinColumn: () => ruinColumn(colors),
    shrineGate: () => shrineGate(colors),
    spiritStatue: () => spiritStatue(colors),
    forgeTemple: () => forgeTemple(colors),
    obelisk: () => obelisk(colors),
    brazier: () => brazier(colors),
    observatory: () => observatory(colors),
    pylon: () => pylon(colors),
    starAltar: () => starAltar(colors),
    ethMainBuilding: () => ethMainBuilding(colors),
    einsteinBust: () => einsteinBust(colors),
  };
  const parts = builders[spec.id]();
  const merged = mergeGeometries(parts)!;
  parts.forEach((p) => p.dispose());
  merged.computeVertexNormals();
  merged.computeBoundingSphere();
  return merged;
}
