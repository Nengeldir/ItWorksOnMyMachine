import * as THREE from "three";
import { Builder, buildItem, cyl, leaf, sphere, star } from "../items/models";
import { outlineMaterial, toonMaterial } from "../toon";
import type { HatId, ShoeId } from "./catalog";

const GOLD = "#f3c869", IVORY = "#fff4df";
// Each accessory owns its geometry; materials live for the lifetime of this module.
const toon = toonMaterial({ side: THREE.DoubleSide, rim: 0.35 });
const ink = outlineMaterial(0.006);
export function paintedModel(builder: Builder): THREE.Group {
  const group = new THREE.Group(), geometry = builder.build();
  const mesh = new THREE.Mesh(geometry, toon);
  mesh.add(new THREE.Mesh(geometry, ink));
  group.add(mesh);
  return group;
}
export function disposeModel(group: THREE.Group) {
  const geometries = new Set<THREE.BufferGeometry>();
  group.traverse(o => { if (o instanceof THREE.Mesh) geometries.add(o.geometry); });
  geometries.forEach(g => g.dispose());
  group.removeFromParent();
}

/** Centered on Avatar.slots.head, in the standing body's frame. */
export function buildHat(id: Exclude<HatId, "none">): THREE.Group {
  if (id === "aviatorCap" || id === "wingedHelm") {
    const group = buildItem(id);
    group.position.set(0, 0.02, 0.01);
    group.rotation.x = 0.25;
    return group;
  }
  const b = new Builder();
  if (id === "starwitch") {
    b.add(cyl(0.28, 0.27, 0.022, 24), "#766098", 0, [0, 0.18, 0], [0, 0, 0], [1, 1, 0.85])
      .add(new THREE.ConeGeometry(0.18, 0.4, 16), "#9181bb", 0, [0.03, 0.39, 0.02], [0.05, 0, -0.18])
      .add(new THREE.TorusGeometry(0.169, 0.017, 6, 20), GOLD, 0.5, [0, 0.22, 0], [Math.PI / 2, 0, 0])
      .add(new THREE.TorusGeometry(0.044, 0.012, 6, 16, Math.PI * 1.5), GOLD, 0.5, [0, 0.27, -0.156], [0, 0, -0.7]);
    for (const s of [-1, 1]) b.add(star(0.025, 0.011, 0.008), IVORY, 0.3, [s * 0.09, 0.32, -0.125]);
  } else if (id === "lotus") {
    b.add(new THREE.TorusGeometry(0.17, 0.014, 6, 20), GOLD, 0.4, [0, 0.18, 0], [Math.PI / 2, 0, 0]);
    for (let i = 0; i < 8; i++) {
      const a = i * Math.PI / 4;
      b.add(leaf(0.16, 0.045), i % 2 ? "#f7c8da" : "#e9a0bd", 0, [Math.sin(a) * 0.14, 0.18, Math.cos(a) * 0.14], [Math.cos(a) * 0.4, a, -Math.sin(a) * 0.4]);
    }
    b.add(sphere(0.038, 10, 8), IVORY, 0.55, [0, 0.24, -0.17]);
  } else if (id === "antlers") {
    b.add(new THREE.TorusGeometry(0.169, 0.012, 6, 20), "#638b6d", 0, [0, 0.18, 0], [Math.PI / 2, 0, 0]);
    for (const s of [-1, 1]) {
      b.add(cyl(0.009, 0.022, 0.24, 7), GOLD, 0.3, [s * 0.16, 0.28, 0.01], [0, 0, -s * 0.3])
        .add(cyl(0.005, 0.013, 0.1, 6), GOLD, 0.3, [s * 0.19, 0.34, -0.03], [-0.6, 0, s * 0.6])
        .add(leaf(0.11, 0.032), "#a9d6a2", 0, [s * 0.18, 0.23, -0.05], [0, 0, -s * 0.9]);
    }
  } else {
    b.add(sphere(0.19, 20, 10), "#5ba6ac", 0, [0.015, 0.19, 0.01], [0, 0, -0.15], [1.15, 0.5, 1.05])
      .add(new THREE.TorusGeometry(0.167, 0.012, 6, 20), GOLD, 0.3, [0, 0.15, 0], [Math.PI / 2, 0, 0])
      .add(leaf(0.22, 0.036), IVORY, 0.15, [0.15, 0.2, -0.065], [0, 0, -0.45])
      .add(star(0.03, 0.013, 0.012), GOLD, 0.45, [0.15, 0.21, -0.1]);
  }
  const group = paintedModel(b); group.name = id; return group;
}

/** Boots replace the original boot mesh, at the animated knee, so feet never double up. */
export function buildShoe(id: Exclude<ShoeId, "classic">, side: number): THREE.Group {
  const color = id === "cloud" ? IVORY : id === "petal" ? "#d586a6" : id === "frost" ? "#99c5dc" : "#dc8062";
  const b = new Builder()
    .add(new THREE.CapsuleGeometry(0.044, 0.18, 4, 10), color, 0, [0, -0.13, 0])
    .add(new THREE.CapsuleGeometry(0.038, 0.08, 4, 10), color, 0, [0, -0.3, -0.012], [0.25, 0, 0])
    .add(new THREE.TorusGeometry(0.047, 0.012, 6, 12), GOLD, 0.35, [0, -0.03, 0], [Math.PI / 2, 0, 0]);
  if (id === "cloud") {
    for (let i = 0; i < 3; i++) b.add(leaf(0.09 + i * 0.02, 0.018), IVORY, 0.15, [side * 0.045, -0.06 - i * 0.022, 0], [0, Math.PI / 2, side * -0.8]);
  } else if (id === "petal") {
    for (let i = 0; i < 5; i++) {
      const a = i * Math.PI * 2 / 5;
      b.add(leaf(0.085, 0.022), "#f8c8d9", 0, [Math.sin(a) * 0.04, -0.06, Math.cos(a) * 0.04], [0, a, 0]);
    }
  } else if (id === "frost") {
    for (let i = 0; i < 8; i++) { const a = i * Math.PI / 4; b.add(sphere(0.018, 6, 5), IVORY, 0, [Math.sin(a) * 0.044, -0.03, Math.cos(a) * 0.044]); }
    b.add(new THREE.OctahedronGeometry(0.025), "#c1eeef", 0.45, [0, -0.12, -0.043]);
  } else {
    b.add(leaf(0.16, 0.026), GOLD, 0.35, [side * 0.04, -0.2, 0], [0, Math.PI / 2, -side * 0.3])
      .add(sphere(0.04, 10, 7), GOLD, 0.3, [0, -0.32, -0.026], [0, 0, 0], [0.95, 0.85, 0.8]);
  }
  const group = paintedModel(b); group.name = id; return group;
}
