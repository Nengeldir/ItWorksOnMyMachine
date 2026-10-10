import * as THREE from "three";
import { Builder, GOLD, GOLD_DEEP, blend, cyl, lathe, leaf, sphere, star } from "./builder";
import { RELIC_BUILDERS, type RelicId } from "./relics";
import { outlineMaterial, toonMaterial } from "../toon";

// Items the pilot can carry: a giant firework worn on the back like a
// jetpack, candies, a golden feather, helmets and fruits. Models only (what
// they do comes later). Each is built from primitives at runtime, painted per
// vertex and drawn with the pilot's toon material and ink outline, so it sits
// in the same Genshin / Sky look. Units match the avatar's body (about 1.1
// tall before the avatar's own scale); `y` is up, `-z` the front.

export type ItemId =
  | RelicId
  | "firework"
  | "candyWrapped"
  | "lollipop"
  | "starCandy"
  | "goldenFeather"
  | "aviatorCap"
  | "wingedHelm"
  | "apple"
  | "peach"
  | "grapes"
  | "cherries"
  | "starfruit";

/** Where an item goes on the pilot (boots go on both feet) */
export type ItemSlot = "back" | "head" | "hand" | "feet";

export interface ItemInfo {
  id: ItemId;
  name: string;
  kind: "gadget" | "candy" | "feather" | "helmet" | "fruit" | "relic";
  slot: ItemSlot;
}

export const ITEMS: ItemInfo[] = [
  { id: "firework", name: "Comet Tail Firework", kind: "gadget", slot: "back" },
  { id: "candyWrapped", name: "Berry candy", kind: "candy", slot: "hand" },
  { id: "lollipop", name: "Swirl lollipop", kind: "candy", slot: "hand" },
  { id: "starCandy", name: "Star candy", kind: "candy", slot: "hand" },
  { id: "goldenFeather", name: "Golden feather", kind: "feather", slot: "hand" },
  { id: "aviatorCap", name: "Aviator cap", kind: "helmet", slot: "head" },
  { id: "wingedHelm", name: "Winged helm", kind: "helmet", slot: "head" },
  { id: "apple", name: "Apple", kind: "fruit", slot: "hand" },
  { id: "peach", name: "Peach", kind: "fruit", slot: "hand" },
  { id: "grapes", name: "Grapes", kind: "fruit", slot: "hand" },
  { id: "cherries", name: "Cherries", kind: "fruit", slot: "hand" },
  { id: "starfruit", name: "Starfruit", kind: "fruit", slot: "hand" },
  { id: "spiritLantern", name: "Spirit Lantern", kind: "relic", slot: "hand" },
  { id: "echoConch", name: "Echoing Conch", kind: "relic", slot: "hand" },
  { id: "phoenixFeather", name: "Feather of the Great Phoenix", kind: "relic", slot: "hand" },
  { id: "silkRibbon", name: "Cloud-Spun Silk Ribbon", kind: "relic", slot: "hand" },
  { id: "vortexGeode", name: "Vortex Geode", kind: "relic", slot: "hand" },
  { id: "aeroBoots", name: "Aero-Boots of the Adepti", kind: "relic", slot: "feet" },
  { id: "stormKite", name: "Stormcaller's Kite", kind: "relic", slot: "hand" },
  { id: "glacialPrism", name: "Glacial Prism", kind: "relic", slot: "hand" },
  { id: "sunNectar", name: "Sun-Kissed Nectar", kind: "relic", slot: "hand" },
  { id: "windTether", name: "Tether of the Wind Spirit", kind: "relic", slot: "hand" },
  { id: "mothCape", name: "Illusory Moth Cape", kind: "relic", slot: "hand" },
  { id: "resonantChimes", name: "Resonant Chimes", kind: "relic", slot: "hand" },
  // The design list's items (run/items.ts has what they do)
  { id: "anemoCatcher", name: "Anemo Catcher", kind: "relic", slot: "hand" },
  { id: "starflakeShield", name: "Starflake Shield", kind: "relic", slot: "hand" },
  { id: "gliderWax", name: "Luminescent Glider Wax", kind: "relic", slot: "hand" },
];

export const itemInfo = (id: ItemId): ItemInfo => ITEMS.find((i) => i.id === id)!;

export { Builder, cyl, lathe, leaf, sphere, star } from "./builder";

// --- the models --------------------------------------------------------------------

/** The giant firework: a striped rocket as long as the pilot, nozzle down, worn on the back with two straps */
function firework(): THREE.BufferGeometry {
  const b = new Builder();
  const bodyH = 0.72;
  // Paper body with a red and cream spiral, gold bands at both ends
  b.add(cyl(0.1, 0.1, bodyH, 24, 16), (p, out) => {
    const y = p.y + bodyH / 2;
    if (y < 0.04 || (y > 0.66 && y < 0.7)) out.set(GOLD);
    else {
      const a = Math.atan2(p.z, p.x);
      out.set(Math.sin(a * 2 + y * 22) > 0.15 ? "#e8483f" : "#fff2dc");
    }
  }, 0, [0, bodyH / 2, 0]);
  // Nose cone in deep blue with gold rings, a glowing star at the tip
  b.add(lathe([[0.001, 0.3], [0.03, 0.26], [0.07, 0.17], [0.1, 0.06], [0.108, 0.0], [0.001, 0.0]], 24), (p, out) => out.set(p.y > 0.06 && p.y < 0.09 ? GOLD : p.y > 0.2 ? "#5b7ce8" : "#3a4fb8"), 0, [0, bodyH, 0]);
  b.add(star(0.06, 0.026, 0.02), GOLD, 1, [0, bodyH + 0.34, 0]);
  // Nozzle, flared, in dark brass
  b.add(lathe([[0.07, 0.0], [0.065, -0.03], [0.08, -0.08], [0.095, -0.11], [0.085, -0.11], [0.055, -0.03], [0.001, -0.03]], 20), (p, out) => blend("#6b4a3a", GOLD_DEEP, -p.y * 9, out), 0, [0, 0.0, 0]);
  // Four fins
  const fin = new THREE.Shape();
  fin.moveTo(0, 0);
  fin.lineTo(0.12, -0.06);
  fin.lineTo(0.12, 0.02);
  fin.quadraticCurveTo(0.05, 0.12, 0, 0.22);
  fin.lineTo(0, 0);
  for (let i = 0; i < 4; i++) {
    const a = (i * Math.PI) / 2 + Math.PI / 4;
    b.add(new THREE.ExtrudeGeometry(fin, { depth: 0.016, bevelEnabled: false }).translate(0, 0, -0.008), (p, out) => out.set(p.x > 0.085 ? GOLD : "#e8483f"), 0, [Math.cos(a) * 0.09, 0.02, -Math.sin(a) * 0.09], [0, a, 0]);
  }
  // Leather straps with gold buckles, and a curled fuse with a glowing tip
  for (const y of [0.22, 0.52]) {
    b.add(new THREE.TorusGeometry(0.106, 0.014, 6, 28), "#7a4b33", 0, [0, y, 0], [Math.PI / 2, 0, 0]);
    b.add(new THREE.BoxGeometry(0.04, 0.035, 0.02), GOLD, 0.4, [0, y, -0.115]);
  }
  b.add(new THREE.TorusGeometry(0.035, 0.006, 5, 14, Math.PI * 1.4), "#4a3a35", 0, [0.11, 0.1, 0], [0, Math.PI / 2, 0]);
  b.add(sphere(0.012, 8, 6), "#ffd27a", 1, [0.12, 0.13, 0.03]);
  return b.build();
}

function candyWrapped(): THREE.BufferGeometry {
  const b = new Builder();
  b.add(sphere(0.06, 18, 12), (p, out) => out.set(Math.sin(Math.atan2(p.y, p.z) * 4 + p.x * 40) > 0.3 ? "#fff4f8" : "#ff6f9f"), 0.15, [0, 0, 0], [0, 0, 0], [1.35, 1, 1]);
  for (const s of [1, -1]) {
    // Twisted wrapper ends, fanned out
    b.add(new THREE.ConeGeometry(0.045, 0.07, 8, 1, true), (p, out) => blend("#ffc1d8", "#ffffff", p.y * 8 + 0.5, out), 0.1, [s * 0.1, 0, 0], [0, 0, s * (Math.PI / 2)]);
    b.add(cyl(0.012, 0.012, 0.02, 8), "#ffb0cc", 0, [s * 0.075, 0, 0], [0, 0, Math.PI / 2]);
  }
  return b.build();
}

function lollipop(): THREE.BufferGeometry {
  const b = new Builder();
  const colors = ["#ff6f9f", "#fff4f8", "#ffd45c", "#fff4f8", "#7fd6ff", "#fff4f8"];
  b.add(cyl(0.09, 0.09, 0.03, 32, 1), (p, out) => {
    const r = Math.hypot(p.x, p.z);
    const a = Math.atan2(p.z, p.x);
    const band = Math.floor(((a / (Math.PI * 2) + 1) * 6 + r * 50) % 6);
    out.set(r > 0.085 ? "#ffffff" : colors[band]);
  }, 0.15, [0, 0.2, 0], [Math.PI / 2, 0, 0]);
  b.add(cyl(0.008, 0.008, 0.22, 8), "#fffaf0", 0, [0, 0.07, 0]);
  b.add(new THREE.TorusGeometry(0.02, 0.006, 5, 12), "#ff6f9f", 0, [0, 0.12, 0], [Math.PI / 2, 0, 0]);
  return b.build();
}

function starCandy(): THREE.BufferGeometry {
  const b = new Builder();
  b.add(star(0.08, 0.04, 0.035), (p, out) => blend("#fff3a8", "#ffbf3c", Math.hypot(p.x, p.y) * 12, out), 0.6);
  // A little face, as on Genshin's sweets
  b.add(sphere(0.007, 6, 5), "#5a3a2a", 0, [0.018, 0.008, -0.034]);
  b.add(sphere(0.007, 6, 5), "#5a3a2a", 0, [-0.018, 0.008, -0.034]);
  b.add(sphere(0.008, 6, 5), "#ff8fa8", 0, [0.032, -0.008, -0.03], [0, 0, 0], [1.3, 0.7, 0.5]);
  b.add(sphere(0.008, 6, 5), "#ff8fa8", 0, [-0.032, -0.008, -0.03], [0, 0, 0], [1.3, 0.7, 0.5]);
  return b.build();
}

/** A golden feather like Sky's winged light: it glows by itself */
function goldenFeather(): THREE.BufferGeometry {
  const b = new Builder();
  b.add(leaf(0.34, 0.075, 0.01), (p, out) => blend("#fff1c2", GOLD, Math.abs(p.x) * 14 + (1 - p.y * 3) * 0.3, out), 0.9, [0, 0.0, 0]);
  b.add(cyl(0.005, 0.008, 0.4, 6), GOLD_DEEP, 0.5, [0, 0.17, 0.006]);
  // Small notches of barbs near the base
  b.add(leaf(0.07, 0.03, 0.008), "#fff6da", 0.9, [0.02, 0.03, 0], [0, 0, -0.9]);
  b.add(leaf(0.07, 0.03, 0.008), "#fff6da", 0.9, [-0.02, 0.03, 0], [0, 0, 0.9]);
  return b.build();
}

/** A leather aviator cap with ear flaps and goggles up on the forehead (fits the pilot's head: radius 0.17) */
function aviatorCap(): THREE.BufferGeometry {
  const b = new Builder();
  b.add(new THREE.SphereGeometry(0.19, 22, 12, 0, Math.PI * 2, 0, Math.PI * 0.55), (p, out) => out.set(Math.abs(p.x) < 0.012 ? "#5e3c2b" : "#9a6444"), 0, [0, 0, 0.005]);
  for (const s of [1, -1]) {
    b.add(new THREE.CapsuleGeometry(0.045, 0.07, 4, 10), "#9a6444", 0, [s * 0.165, -0.06, 0.01], [0, 0, s * 0.15], [0.55, 1, 1]);
    b.add(sphere(0.03, 10, 8), "#f6e7cf", 0, [s * 0.172, -0.1, 0.01], [0, 0, 0], [0.5, 1, 1]);
    // Goggles: brass rims and teal glass that catches the light
    b.add(new THREE.TorusGeometry(0.045, 0.012, 6, 16), GOLD_DEEP, 0.2, [s * 0.055, 0.07, -0.16], [0.5, 0, 0]);
    b.add(sphere(0.042, 12, 8), "#7fe0e6", 0.5, [s * 0.055, 0.07, -0.16], [0.5, 0, 0], [1, 1, 0.4]);
  }
  b.add(cyl(0.012, 0.012, 0.04, 6), "#5e3c2b", 0, [0, 0.07, -0.165], [0, 0, Math.PI / 2]);
  b.add(new THREE.TorusGeometry(0.18, 0.012, 5, 30, Math.PI), "#3c2a24", 0, [0, 0.08, 0.02], [-0.25, 0, 0]);
  return b.build();
}

/** A white-and-gold winged helm with a glowing gem, Genshin-knight style */
function wingedHelm(): THREE.BufferGeometry {
  const b = new Builder();
  b.add(new THREE.SphereGeometry(0.19, 22, 12, 0, Math.PI * 2, 0, Math.PI * 0.5), (p, out) => out.set(Math.abs(p.x) < 0.02 ? GOLD : "#f4f1ff"), 0, [0, 0, 0]);
  b.add(new THREE.TorusGeometry(0.19, 0.016, 6, 32), GOLD, 0.4, [0, 0.0, 0], [Math.PI / 2, 0, 0]);
  b.add(new THREE.OctahedronGeometry(0.035, 0), "#6fe3ff", 1, [0, 0.06, -0.19], [0, 0, 0], [0.8, 1.2, 0.5]);
  for (const s of [1, -1]) {
    // Little wings, three feathers each, sweeping back
    for (let i = 0; i < 3; i++) {
      b.add(leaf(0.16 - i * 0.03, 0.035), (p, out) => blend("#ffffff", "#bfe9ff", p.y * 6, out), 0.2, [s * 0.19, 0.06 - i * 0.025, 0.04 + i * 0.02], [0, s * -0.35, s * (-0.9 - i * 0.35)]);
    }
  }
  return b.build();
}

function apple(): THREE.BufferGeometry {
  const b = new Builder();
  b.add(lathe([[0.001, -0.06], [0.035, -0.065], [0.065, -0.035], [0.072, 0.01], [0.06, 0.05], [0.025, 0.06], [0.001, 0.045]], 20), (p, out) => blend("#e33b3b", "#ffd25a", (p.x + 0.07) * 4 - 0.4, out), 0.05);
  b.add(cyl(0.005, 0.006, 0.05, 6), "#6b4a2a", 0, [0.004, 0.07, 0], [0, 0, -0.2]);
  b.add(leaf(0.06, 0.025), "#5fbf4a", 0, [0.012, 0.075, 0], [0.4, 0, -1.1]);
  return b.build();
}

function peach(): THREE.BufferGeometry {
  const b = new Builder();
  b.add(sphere(0.065, 18, 14), (p, out) => {
    blend("#ffcf9a", "#ff7f8a", (p.y + 0.05) * 9 + p.x * 3, out);
    // The crease down one side
    if (Math.abs(p.x) < 0.006 && p.z < 0) out.multiplyScalar(0.8);
  }, 0.05, [0, 0, 0], [0, 0, 0], [1, 1.05, 0.97]);
  b.add(leaf(0.07, 0.03), "#6fcf5a", 0, [0, 0.06, 0.01], [0.5, 0.6, -0.8]);
  b.add(leaf(0.06, 0.026), "#5fbf4a", 0, [0, 0.06, 0.01], [-0.3, -0.5, 0.9]);
  return b.build();
}

function grapes(): THREE.BufferGeometry {
  const b = new Builder();
  const rows = [4, 4, 3, 2, 1];
  rows.forEach((n, row) => {
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + row * 0.6;
      const r = n > 1 ? 0.03 + n * 0.006 : 0;
      b.add(sphere(0.026, 10, 8), (p, out) => blend("#9b5fd9", "#d4b0ff", p.y * 20 + 0.2, out), 0.1, [Math.cos(a) * r, -row * 0.035, Math.sin(a) * r]);
    }
  });
  b.add(cyl(0.005, 0.006, 0.06, 6), "#6b4a2a", 0, [0, 0.05, 0], [0, 0, 0.3]);
  b.add(leaf(0.08, 0.04), "#6fcf5a", 0, [0.01, 0.06, 0], [0.3, 0, -1.2]);
  return b.build();
}

function cherries(): THREE.BufferGeometry {
  const b = new Builder();
  for (const s of [1, -1]) {
    b.add(sphere(0.034, 14, 10), (p, out) => blend("#d81f3f", "#ff7a8a", p.y * 14 + p.x * 6 * s, out), 0.1, [s * 0.04, 0, 0]);
    b.add(cyl(0.004, 0.004, 0.11, 6), "#5e8a3a", 0, [s * 0.022, 0.06, 0], [0, 0, s * 0.42]);
  }
  b.add(leaf(0.06, 0.025), "#6fcf5a", 0, [0, 0.11, 0], [0.4, 0, -1.3]);
  return b.build();
}

/** An oval fruit with five ridges: a star in cross-section, tapering at both ends */
function starfruit(): THREE.BufferGeometry {
  const b = new Builder();
  const body = lathe([[0.001, -0.09], [0.03, -0.075], [0.05, -0.04], [0.055, 0], [0.05, 0.04], [0.03, 0.075], [0.001, 0.09]], 40);
  const position = body.getAttribute("position") as THREE.BufferAttribute;
  for (let i = 0; i < position.count; i++) {
    const x = position.getX(i);
    const z = position.getZ(i);
    const a = Math.atan2(z, x);
    const ridge = 0.62 + 0.38 * Math.pow(Math.abs(Math.cos((a * 5) / 2)), 3);
    position.setXYZ(i, x * ridge, position.getY(i), z * ridge);
  }
  body.computeVertexNormals();
  b.add(body, (p, out) => blend("#cfe86a", "#ffcf3a", Math.hypot(p.x, p.z) * 18 - 0.2, out), 0.25, [0, 0, 0], [0, 0, Math.PI / 2 - 0.3]);
  b.add(cyl(0.005, 0.006, 0.03, 6), "#6b4a2a", 0, [-0.09, 0.03, 0], [0, 0, 1.3]);
  return b.build();
}

const BUILDERS: Record<ItemId, () => THREE.BufferGeometry> = {
  ...RELIC_BUILDERS,
  firework,
  candyWrapped,
  lollipop,
  starCandy,
  goldenFeather,
  aviatorCap,
  wingedHelm,
  apple,
  peach,
  grapes,
  cherries,
  starfruit,
};

let toon: THREE.MeshToonMaterial | null = null;
let ink: THREE.MeshBasicMaterial | null = null;

/** Materials shared by every item (never disposed: items come and go, the look stays) */
function materials() {
  if (!toon) {
    toon = toonMaterial({ side: THREE.DoubleSide, rim: 0.4 });
    ink = outlineMaterial(0.008);
  }
  return { toon: toon!, ink: ink! };
}

/** One item, ready to place: a toon mesh with its ink outline. Dispose with `disposeItem` */
export function buildItem(id: ItemId): THREE.Group {
  const { toon, ink } = materials();
  const geometry = BUILDERS[id]();
  const group = new THREE.Group();
  group.name = id;
  const mesh = new THREE.Mesh(geometry, toon);
  mesh.add(new THREE.Mesh(geometry, ink));
  group.add(mesh);
  return group;
}

export function disposeItem(group: THREE.Group) {
  // Materials are shared by every item and stay; geometries are each item's own
  group.traverse((o) => {
    if (o instanceof THREE.Mesh) o.geometry.dispose();
  });
  group.removeFromParent();
}

// --- the firework's flame ------------------------------------------------------------

let flameMaterial: THREE.ShaderMaterial | null = null;

const flameVertex = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const flameFragment = /* glsl */ `
  uniform float time;
  varying vec2 vUv;
  void main() {
    // The cone's v is 0 at its base (the nozzle) and 1 at the tip: along = 1 at the nozzle
    float along = clamp(1.0 - vUv.y, 0.0, 1.0);
    float flicker = 0.75 + 0.25 * sin(time * 40.0 + vUv.x * 25.0) * sin(time * 23.0);
    float core = pow(along, 2.0);
    vec3 c = mix(vec3(1.0, 0.45, 0.6), vec3(1.0, 0.85, 0.4), along) * (1.2 + 1.6 * core) + vec3(1.0) * core * 1.2;
    float a = smoothstep(0.0, 0.6, along) * flicker;
    gl_FragColor = vec4(c * a, 1.0);
    #include <colorspace_fragment>
  }
`;

/** A flickering flame for the firework's nozzle (additive, blooms). Scale `.scale.y` for thrust */
export function fireworkFlame(time: { value: number }): THREE.Mesh {
  if (!flameMaterial) {
    flameMaterial = new THREE.ShaderMaterial({
      uniforms: { time },
      vertexShader: flameVertex,
      fragmentShader: flameFragment,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
    });
  }
  // A cone pointing down from the nozzle: y from 0 to -1
  const mesh = new THREE.Mesh(new THREE.ConeGeometry(0.075, 1, 14, 1, true).rotateX(Math.PI).translate(0, -0.5, 0), flameMaterial);
  mesh.position.y = -0.1;
  mesh.renderOrder = 7;
  mesh.frustumCulled = false;
  return mesh;
}
