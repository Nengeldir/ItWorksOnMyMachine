import * as THREE from "three";
import { Builder, buildItem, cyl, leaf, sphere, star } from "../items/models";
import { GOLD_DEEP, blend } from "../items/builder";
import { outlineMaterial, toonMaterial } from "../toon";
import { type FeatherBone, skinnedMesh } from "../wingRig";
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

/** A painted model whose parts tagged with `builder.bone(i)` follow `feathers[i - 1]` (articulated wings) */
export function skinnedModel(builder: Builder, feathers: readonly FeatherBone[]) {
  const group = new THREE.Group();
  const skinned = skinnedMesh(builder.build(), toon, ink, feathers);
  group.add(skinned.mesh);
  return { group, bones: skinned.bones, rest: skinned.rest };
}
export function disposeModel(group: THREE.Group) {
  const geometries = new Set<THREE.BufferGeometry>(), skeletons = new Set<THREE.Skeleton>();
  group.traverse(o => {
    if (o instanceof THREE.Mesh) geometries.add(o.geometry);
    if (o instanceof THREE.SkinnedMesh) skeletons.add(o.skeleton);
  });
  geometries.forEach(g => g.dispose());
  skeletons.forEach(s => s.dispose());
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
  } else if (id === "strawHat") {
    // A wide woven brim and crown (alternating straw bands), a rose ribbon and wildflowers
    const weave = (p: THREE.Vector3, out: THREE.Color) => out.set(Math.sin(Math.atan2(p.z, p.x) * 28 + Math.hypot(p.x, p.z) * 60) > 0 ? "#e8c98a" : "#d8b26c");
    b.add(cyl(0.36, 0.37, 0.018, 36), weave, 0, [0, 0.13, 0.01], [0.08, 0, 0])
      .add(cyl(0.16, 0.185, 0.13, 28), weave, 0, [0, 0.21, 0.01], [0.08, 0, 0])
      .add(new THREE.SphereGeometry(0.16, 20, 8, 0, Math.PI * 2, 0, Math.PI / 2), weave, 0, [0, 0.27, 0.016], [0.08, 0, 0], [1, 0.45, 1])
      .add(new THREE.TorusGeometry(0.183, 0.022, 6, 28), "#e88aa0", 0.05, [0, 0.165, 0.008], [Math.PI / 2 + 0.08, 0, 0]);
    for (const s of [-1, 1]) b.add(leaf(0.1, 0.035), "#e88aa0", 0, [0.17, 0.15, 0.13 + s * 0.03], [1.2, 0, -0.6 + s * 0.3]);
    for (let i = 0; i < 3; i++) {
      const at: [number, number, number] = [-0.17 + i * 0.02, 0.2 + i * 0.025, -0.06 + i * 0.05];
      b.add(star(0.03, 0.014, 0.01, 5), i === 1 ? "#a7c7ff" : "#fff6dc", 0.15, at, [0, -1.2, 0]).add(sphere(0.012, 6, 5), GOLD, 0.3, at);
    }
  } else if (id === "catEars") {
    // A headband arching over the head, two fluffy ears with pink insides, a little silver bell
    b.add(new THREE.TorusGeometry(0.178, 0.013, 6, 24, Math.PI), "#e9d7ea", 0, [0, 0.13, 0.02], [0, 0, 0]);
    for (const s of [-1, 1]) {
      b.add(new THREE.ConeGeometry(0.075, 0.15, 4), "#f2e6f0", 0, [s * 0.12, 0.31, 0.02], [0, Math.PI / 4, -s * 0.35], [1, 1, 0.55])
        .add(new THREE.ConeGeometry(0.045, 0.1, 4), "#f5b9cf", 0.05, [s * 0.118, 0.3, -0.006], [0, Math.PI / 4, -s * 0.35], [1, 1, 0.4])
        .add(sphere(0.03, 8, 6), "#ffffff", 0, [s * 0.1, 0.25, 0.03]);
    }
    b.add(sphere(0.026, 10, 8), "#dfe6ef", 0.35, [0.17, 0.1, -0.04]).add(new THREE.TorusGeometry(0.026, 0.005, 5, 12), GOLD, 0.3, [0.17, 0.1, -0.04], [Math.PI / 2, 0, 0]);
  } else if (id === "flowerCrown") {
    b.add(new THREE.TorusGeometry(0.172, 0.014, 6, 26), "#7fae6a", 0, [0, 0.2, 0.01], [Math.PI / 2 + 0.12, 0, 0]);
    const colors = ["#fff8ec", "#9cc4ff", "#ffd36e", "#f6b2c8"];
    for (let i = 0; i < 10; i++) {
      const a = (i / 10) * Math.PI * 2, x = Math.sin(a) * 0.172, z = Math.cos(a) * 0.172, y = 0.2 + Math.cos(a) * 0.02;
      for (let k = 0; k < 5; k++) {
        const p = (k / 5) * Math.PI * 2;
        b.add(sphere(0.018, 6, 5), colors[i % 4], 0.05, [x + Math.cos(p) * 0.02, y + 0.012, z + Math.sin(p) * 0.02], [0, 0, 0], [1, 0.5, 1]);
      }
      b.add(sphere(0.012, 6, 5), GOLD, 0.25, [x, y + 0.02, z]);
      if (i % 2) b.add(leaf(0.07, 0.025), "#8fc27a", 0, [x, y - 0.005, z], [Math.PI / 2, a, 0]);
    }
  } else if (id === "jadePin") {
    // A bun at the back, a jade pin through it, a gold filigree flower and two swinging tassels
    b.add(sphere(0.085, 14, 10), "#3d2c4f", 0, [0.03, 0.27, 0.14], [0, 0, 0], [1, 0.85, 0.9])
      .add(cyl(0.012, 0.009, 0.36, 8), "#66b59c", 0.15, [0.03, 0.29, 0.15], [0, 0, 1.15])
      .add(new THREE.TorusGeometry(0.05, 0.007, 5, 16), GOLD, 0.35, [0.18, 0.36, 0.15], [0, 0.3, 0]);
    for (let k = 0; k < 5; k++) {
      const a = (k / 5) * Math.PI * 2;
      b.add(leaf(0.05, 0.022), k % 2 ? GOLD : "#8fd3bb", 0.25, [0.18, 0.36, 0.15], [0, 0.3, a]);
    }
    for (const s of [0, 1]) {
      const x = 0.15 + s * 0.05;
      b.add(cyl(0.004, 0.004, 0.15, 5), "#c9404b", 0, [x, 0.27, 0.17])
        .add(sphere(0.016, 8, 6), "#66b59c", 0.25, [x, 0.19, 0.17])
        .add(new THREE.ConeGeometry(0.018, 0.07, 8), "#c9404b", 0, [x, 0.14, 0.17], [Math.PI, 0, 0]);
    }
  } else if (id === "featherBand") {
    b.add(new THREE.TorusGeometry(0.172, 0.013, 6, 28), GOLD, 0.35, [0, 0.17, 0.01], [Math.PI / 2 + 0.1, 0, 0])
      .add(new THREE.OctahedronGeometry(0.03, 0), "#8fc4e8", 0.6, [0, 0.19, -0.172], [0, 0, 0], [0.8, 1.2, 0.5]);
    for (let i = 0; i < 3; i++) {
      b.add(leaf(0.26 - i * 0.04, 0.055), (p, out) => out.set(p.y > 0.15 - i * 0.03 ? "#e9f6ff" : "#8fc4e8"), 0.1, [0.15, 0.2 + i * 0.015, 0.06 + i * 0.03], [-0.5 - i * 0.25, 0, -0.35 - i * 0.12]);
    }
  } else if (id === "foxMask") {
    // A festival kitsune mask, pushed to the side of the head: white face, red markings, a gold bell on its cord
    const at: [number, number, number] = [0.16, 0.2, 0.02];
    b.add(sphere(0.12, 18, 12), "#fff4e8", 0, at, [0, 1.2, 0.1], [0.9, 1, 0.42])
      .add(new THREE.ConeGeometry(0.05, 0.11, 8), "#fff4e8", 0, [0.2, 0.17, -0.06], [0, 1.2, -Math.PI / 2 + 0.2], [1, 1, 0.6]);
    for (const s of [-1, 1]) {
      b.add(new THREE.ConeGeometry(0.04, 0.1, 4), "#fff4e8", 0, [0.16, 0.31, 0.02 + s * 0.06], [s * 0.3, 1.2, 0])
        .add(new THREE.ConeGeometry(0.022, 0.06, 4), "#d8424f", 0.1, [0.17, 0.3, 0.02 + s * 0.06], [s * 0.3, 1.2, 0])
        .add(leaf(0.06, 0.016), "#d8424f", 0.1, [0.2, 0.23, 0.02 + s * 0.045], [0, 1.2, s * 0.9 + Math.PI / 2])
        .add(sphere(0.012, 6, 5), "#2b2140", 0, [0.21, 0.215, 0.02 + s * 0.04]);
    }
    b.add(new THREE.TorusGeometry(0.175, 0.006, 5, 28), "#c9404b", 0, [0, 0.18, 0.01], [Math.PI / 2 + 0.15, 0, 0])
      .add(sphere(0.02, 8, 6), GOLD, 0.4, [0.21, 0.08, 0.06]);
  } else if (id === "halo") {
    // A ring of morning light floating above the head, threaded with tiny stars
    b.add(new THREE.TorusGeometry(0.17, 0.016, 8, 40), "#ffe39a", 1, [0, 0.42, 0.04], [Math.PI / 2 + 0.25, 0, 0])
      .add(new THREE.TorusGeometry(0.2, 0.004, 5, 40), "#fff6d6", 1, [0, 0.42, 0.04], [Math.PI / 2 + 0.25, 0, 0]);
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      b.add(star(0.022, 0.009, 0.006, 4), "#ffffff", 1, [Math.cos(a) * 0.17, 0.42 + Math.sin(a) * 0.04, 0.04 + Math.sin(a) * 0.165], [0, a, 0]);
    }
  } else if (id === "crown") {
    // Golden spires floating in a ring over the head, each tipped with a star, a sapphire at the front
    for (let i = 0; i < 7; i++) {
      const a = (i / 7) * Math.PI * 2, x = Math.sin(a) * 0.15, z = Math.cos(a) * 0.15, tall = i % 2 ? 0.11 : 0.16;
      b.add(new THREE.ConeGeometry(0.03, tall, 6), (p, out) => blend(GOLD_DEEP, "#fff1b8", p.y / tall + 0.5, out), 0.35, [x, 0.36 + tall / 2, z])
        .add(star(0.025, 0.011, 0.008, 5), "#fff6d6", 0.9, [x, 0.38 + tall + 0.02, z], [0, a, 0]);
    }
    b.add(new THREE.TorusGeometry(0.155, 0.012, 6, 30), GOLD, 0.5, [0, 0.35, 0.01], [Math.PI / 2, 0, 0])
      .add(new THREE.OctahedronGeometry(0.04, 0), "#6fa8ff", 0.8, [0, 0.4, -0.16], [0, 0, 0], [0.8, 1.2, 0.5]);
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
  const color = id === "cloud" ? IVORY : id === "petal" ? "#d586a6" : id === "frost" ? "#99c5dc" : id === "geta" ? "#f6efe4" : id === "windrunner" ? "#5fb8a8" : id === "starstep" ? "#4a4a8c" : "#dc8062";
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
  } else if (id === "geta") {
    // White tabi socks on lacquered wooden sandals: a platform on two teeth, a red thong
    b.add(new THREE.BoxGeometry(0.1, 0.022, 0.17), "#b5764a", 0, [0, -0.36, -0.03], [0.25, 0, 0])
      .add(new THREE.BoxGeometry(0.09, 0.04, 0.02), "#8f5634", 0, [0, -0.39, -0.08], [0.25, 0, 0])
      .add(new THREE.BoxGeometry(0.09, 0.04, 0.02), "#8f5634", 0, [0, -0.36, 0.03], [0.25, 0, 0])
      .add(new THREE.TorusGeometry(0.03, 0.007, 5, 12, Math.PI), "#d8424f", 0.05, [0, -0.33, -0.06], [0.25, 0, 0]);
  } else if (id === "windrunner") {
    // Ribbons wound round the shin and streaming off the heel, silver buckles
    for (let i = 0; i < 3; i++) b.add(new THREE.TorusGeometry(0.047, 0.008, 5, 14), "#e9fbf6", 0.1, [0, -0.06 - i * 0.06, 0], [Math.PI / 2 + (i % 2 ? 0.25 : -0.25), 0, 0]);
    for (const k of [0, 1]) b.add(leaf(0.2 - k * 0.05, 0.03), "#bff1e6", 0.15, [side * 0.02, -0.1 - k * 0.05, 0.05], [Math.PI / 2 + 0.4, 0, side * 0.3 * (k ? 1 : -1)]);
    b.add(new THREE.BoxGeometry(0.03, 0.025, 0.012), "#dfe6ef", 0.3, [0, -0.2, -0.045]);
  } else if (id === "starstep") {
    // Midnight slippers, a glowing star on each toe and a ring of tiny ones round the cuff
    b.add(star(0.04, 0.018, 0.012, 5), "#ffe39a", 0.9, [0, -0.32, -0.06], [0.6, 0, 0]);
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      b.add(star(0.012, 0.005, 0.006, 4), "#fff6d6", 0.8, [Math.sin(a) * 0.05, -0.03, Math.cos(a) * 0.05], [0, a, 0]);
    }
  } else {
    b.add(leaf(0.16, 0.026), GOLD, 0.35, [side * 0.04, -0.2, 0], [0, Math.PI / 2, -side * 0.3])
      .add(sphere(0.04, 10, 7), GOLD, 0.3, [0, -0.32, -0.026], [0, 0, 0], [0.95, 0.85, 0.8]);
  }
  const group = paintedModel(b); group.name = id; return group;
}
