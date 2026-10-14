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
  { id: "crystalUpdraft", name: "Crystallized Updraft", kind: "relic", slot: "hand" },
  { id: "duskHourglass", name: "Dusk-Weaver's Hourglass", kind: "relic", slot: "hand" },
  { id: "electroPrism", name: "Electro-Charged Prism", kind: "relic", slot: "hand" },
  { id: "dragonTear", name: "Tear of the Dragon", kind: "relic", slot: "hand" },
  // The design list's items (run/items.ts has what they do)
  { id: "anemoCatcher", name: "Anemo Catcher", kind: "relic", slot: "hand" },
  { id: "starflakeShield", name: "Starflake Shield", kind: "relic", slot: "hand" },
  { id: "gliderWax", name: "Luminescent Glider Wax", kind: "relic", slot: "hand" },
  { id: "windGourd", name: "Wind-Drinking Gourd", kind: "relic", slot: "hand" },
  { id: "foresightCharm", name: "Jade Foresight Talisman", kind: "relic", slot: "hand" },
  { id: "oilUmbrella", name: "Oil-Paper Umbrella", kind: "relic", slot: "hand" },
  { id: "koiCharm", name: "Golden Koi Charm", kind: "relic", slot: "hand" },
  { id: "paperCrane", name: "Paper Crane Guide", kind: "relic", slot: "hand" },
  { id: "firecrackers", name: "String of Firecrackers", kind: "relic", slot: "hand" },
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

/** Shared detail for the food keepsakes: a two-tone leaf with a pale midrib, a curved stem, a gold-thread tie */
function veinedLeaf(b: Builder, length: number, width: number, at: [number, number, number], rot: [number, number, number], light = "#8fd36e", dark = "#4e9a46") {
  b.add(leaf(length, width, 0.006, 8), (p, out) => blend(dark, light, Math.abs(p.x) / width * 1.4 + p.y / length * 0.3, out), 0, at, rot);
  b.add(cyl(0.0025, 0.0035, length * 0.85, 4), "#e8f5c8", 0.05, [at[0], at[1], at[2]], rot, [1, 1, 1]);
}
function curvedStem(b: Builder, at: [number, number, number], length: number, bend: number, color = "#7a5434") {
  for (let i = 0; i < 4; i++) {
    const t = i / 4;
    b.add(cyl(0.0045, 0.0055, length / 4 + 0.002, 6), color, 0, [at[0] + Math.sin(t * bend) * length * 0.3, at[1] + t * length + length / 8, at[2]], [0, 0, -bend * (t + 0.12)]);
  }
}
/** A loop of gold thread with a tiny tag: every keepsake carries the collector's tie */
function goldTie(b: Builder, at: [number, number, number], radius = 0.016) {
  b.add(new THREE.TorusGeometry(radius, 0.003, 5, 14), GOLD, 0.45, at, [Math.PI / 2, 0, 0]);
  b.add(new THREE.OctahedronGeometry(radius * 0.55, 0), "#fff1c4", 0.6, [at[0] + radius * 1.2, at[1] - radius * 1.4, at[2]]);
}

/** A wrapped berry candy: a glossy oval of berry glass in a twisted, gold-edged paper */
function candyWrapped(): THREE.BufferGeometry {
  const b = new Builder();
  b.add(sphere(0.058, 24, 16), (p, out) => {
    // Berry glass with a pale swirl and a bright glossy patch where the light catches
    const swirl = Math.sin(Math.atan2(p.y, p.z) * 3 + p.x * 34);
    blend("#c23a64", "#ff8db1", swirl * 0.3 + 0.35 + p.y * 6, out);
    if (p.y > 0.025 && p.z < -0.01 && p.x < 0.01) out.lerp(new THREE.Color("#fff3f7"), 0.6);
  }, 0.2, [0, 0, 0], [0, 0, 0], [1.3, 0.95, 0.95]);
  for (const s of [1, -1]) {
    // Twisted wrapper ends: a pinched neck and a pleated fan of paper with a gold edge
    b.add(cyl(0.012, 0.016, 0.022, 10), "#ffd2e1", 0.05, [s * 0.08, 0, 0], [0, 0, Math.PI / 2]);
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * Math.PI * 2;
      b.add(leaf(0.06, 0.022, 0.004, 5), (p, out) => blend("#fff4f8", "#f3c869", p.y / 0.06 * 1.3 - 0.4, out), 0.1,
        [s * 0.094, Math.cos(a) * 0.006, Math.sin(a) * 0.006], [a, 0, -s * Math.PI / 2 + s * 0.35]);
    }
  }
  goldTie(b, [0.0, 0.058, 0]);
  return b.build();
}

/** A swirl lollipop: a thick disc of spiral sugar glass, a paper stick and a satin bow */
function lollipop(): THREE.BufferGeometry {
  const b = new Builder();
  const colors = ["#e35a87", "#fff4f8", "#f2b84a", "#fff4f8", "#5ab8e6", "#fff4f8"];
  b.add(cyl(0.09, 0.09, 0.034, 40, 2), (p, out) => {
    const r = Math.hypot(p.x, p.z);
    const a = Math.atan2(p.z, p.x);
    const band = Math.floor(((a / (Math.PI * 2) + 1) * 6 + r * 50) % 6);
    out.set(r > 0.084 ? "#fff8ef" : colors[band]);
    // A soft highlight on the upper face
    if (p.y > 0.015 && p.x < -0.02 && p.z < -0.02) out.lerp(new THREE.Color("#ffffff"), 0.45);
  }, 0.18, [0, 0.2, 0], [Math.PI / 2, 0, 0]);
  b.add(new THREE.TorusGeometry(0.09, 0.006, 6, 40), "#fff8ef", 0.25, [0, 0.2, 0]);
  b.add(cyl(0.0075, 0.0075, 0.22, 10), (p, out) => blend("#fffaf0", "#efe2c8", Math.abs(p.y) * 6, out), 0, [0, 0.07, 0]);
  // A satin bow tied under the disc
  for (const s of [1, -1]) b.add(leaf(0.05, 0.022, 0.005, 6), "#e35a87", 0.05, [s * 0.012, 0.115, 0.004], [0, 0, -s * 1.9]);
  for (const s of [1, -1]) b.add(leaf(0.06, 0.012, 0.004, 5), "#c94a73", 0, [s * 0.006, 0.112, 0.006], [0, 0, Math.PI - s * 0.35]);
  b.add(sphere(0.008, 8, 6), GOLD, 0.4, [0, 0.115, 0.008]);
  return b.build();
}

/** Star candy (konpeito-like): a faceted star of sugar crystal, a smaller one turned inside it, gold flecks */
function starCandy(): THREE.BufferGeometry {
  const b = new Builder();
  b.add(star(0.08, 0.04, 0.035), (p, out) => blend("#fff7c2", "#f0b03a", Math.hypot(p.x, p.y) * 12, out), 0.55);
  b.add(star(0.05, 0.025, 0.046), (p, out) => blend("#ffffff", "#ffe08a", Math.hypot(p.x, p.y) * 14, out), 0.75, [0, 0, 0], [0, 0, Math.PI / 5]);
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    b.add(new THREE.OctahedronGeometry(0.006, 0), GOLD, 0.8, [Math.cos(a) * 0.035, Math.sin(a) * 0.035, -0.025]);
  }
  goldTie(b, [0, 0.085, 0], 0.012);
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

/** An apple, sun-kissed red over gold, a glossy shoulder, a curved stem and a veined leaf */
function apple(): THREE.BufferGeometry {
  const b = new Builder();
  b.add(lathe([[0.001, -0.058], [0.022, -0.063], [0.05, -0.05], [0.068, -0.02], [0.073, 0.012], [0.068, 0.038], [0.05, 0.056], [0.028, 0.06], [0.012, 0.05], [0.001, 0.044]], 32), (p, out) => {
    // Red blushing over gold, with faint streaks and a highlight where the light falls
    const streak = Math.sin(Math.atan2(p.z, p.x) * 14) * 0.08;
    blend("#ffcf5a", "#c8323a", 0.8 + p.x * 3 + p.y * 2 + streak, out);
    if (p.y > 0.02 && p.x < -0.02 && p.z < -0.02) out.lerp(new THREE.Color("#fff1dc"), 0.35);
  }, 0.05);
  curvedStem(b, [0.002, 0.045, 0], 0.045, 0.6);
  veinedLeaf(b, 0.07, 0.03, [0.012, 0.075, 0], [0.3, 0, -1.15]);
  goldTie(b, [0.004, 0.058, 0], 0.012);
  return b.build();
}

/** A peach: velvet blush, a soft crease, two leaves */
function peach(): THREE.BufferGeometry {
  const b = new Builder();
  b.add(sphere(0.066, 28, 20), (p, out) => {
    blend("#ffd9a8", "#f0707e", (p.y + 0.05) * 8 + p.x * 3, out);
    // The crease down one side, and a pale bloom of fuzz on the top
    if (Math.abs(p.x) < 0.007 && p.z < 0) out.multiplyScalar(0.84);
    if (p.y > 0.045) out.lerp(new THREE.Color("#ffe8d6"), 0.25);
  }, 0.06, [0, 0, 0], [0, 0, 0], [1, 1.05, 0.97]);
  curvedStem(b, [0, 0.058, 0.004], 0.02, 0.4);
  veinedLeaf(b, 0.075, 0.03, [0, 0.068, 0.01], [0.5, 0.6, -0.8]);
  veinedLeaf(b, 0.062, 0.026, [0, 0.066, 0.01], [-0.3, -0.5, 0.9], "#9ade72", "#5aa84c");
  goldTie(b, [0, 0.07, 0.004], 0.011);
  return b.build();
}

/** A bunch of grapes: frosted violet berries with a bloom, a curling vine tendril, a leaf */
function grapes(): THREE.BufferGeometry {
  const b = new Builder();
  const rows = [5, 4, 4, 3, 2, 1];
  rows.forEach((n, row) => {
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + row * 0.6;
      const r = n > 1 ? 0.026 + n * 0.006 : 0;
      b.add(sphere(0.024, 14, 10), (p, out) => {
        blend("#5b2f8f", "#b48ae6", p.y * 18 + 0.35 - p.x * 6, out);
        // The dusty bloom of a fresh grape, and a glint
        if (p.y > 0.012 && p.x < -0.006) out.lerp(new THREE.Color("#eee6ff"), 0.45);
      }, 0.08, [Math.cos(a) * r, -row * 0.032, Math.sin(a) * r]);
    }
  });
  curvedStem(b, [0, 0.02, 0], 0.045, 0.5, "#6b5032");
  b.add(new THREE.TorusGeometry(0.018, 0.0025, 5, 14, Math.PI * 1.5), "#8fbf5a", 0, [0.025, 0.06, 0], [0, 0, 0.5]);
  veinedLeaf(b, 0.085, 0.045, [0.01, 0.055, 0], [0.3, 0, -1.25]);
  goldTie(b, [-0.006, 0.05, 0], 0.012);
  return b.build();
}

/** A pair of cherries: deep glossy red, stems joined at a tiny knot, a leaf */
function cherries(): THREE.BufferGeometry {
  const b = new Builder();
  for (const s of [1, -1]) {
    b.add(sphere(0.034, 20, 14), (p, out) => {
      blend("#8e0f2a", "#e8455a", p.y * 12 + p.x * 4 * s + 0.4, out);
      if (p.y > 0.012 && p.x * s < 0 && p.z < 0) out.lerp(new THREE.Color("#ffe5ea"), 0.55);
    }, 0.1, [s * 0.04, 0, 0], [0, 0, 0], [1, 0.95, 1]);
    for (let i = 0; i < 5; i++) {
      const t = i / 5;
      b.add(cyl(0.0035, 0.0035, 0.025, 5), "#6f8f3a", 0, [s * (0.04 - t * 0.04 + Math.sin(t * 2) * 0.006), 0.035 + t * 0.085, 0], [0, 0, s * (0.35 + t * 0.2)]);
    }
  }
  b.add(sphere(0.007, 8, 6), "#6b5032", 0, [0, 0.122, 0]);
  veinedLeaf(b, 0.065, 0.026, [0, 0.12, 0], [0.4, 0, -1.3]);
  goldTie(b, [0, 0.11, 0], 0.01);
  return b.build();
}

/** A starfruit: five waxy ridges, green-gold, slightly translucent at the edges */
function starfruit(): THREE.BufferGeometry {
  const b = new Builder();
  const body = lathe([[0.001, -0.09], [0.022, -0.082], [0.04, -0.06], [0.052, -0.025], [0.056, 0], [0.052, 0.025], [0.04, 0.06], [0.022, 0.082], [0.001, 0.09]], 60);
  const position = body.getAttribute("position") as THREE.BufferAttribute;
  for (let i = 0; i < position.count; i++) {
    const x = position.getX(i);
    const z = position.getZ(i);
    const a = Math.atan2(z, x);
    const ridge = 0.6 + 0.4 * Math.pow(Math.abs(Math.cos((a * 5) / 2)), 2.4);
    position.setXYZ(i, x * ridge, position.getY(i), z * ridge);
  }
  body.computeVertexNormals();
  b.add(body, (p, out) => {
    const r = Math.hypot(p.x, p.z);
    blend("#b9d65a", "#ffd23a", r * 16 - 0.1, out);
    if (r > 0.046) out.lerp(new THREE.Color("#fff6c2"), 0.4);
  }, 0.25, [0, 0, 0], [0, 0, Math.PI / 2 - 0.3]);
  curvedStem(b, [-0.092, 0.028, 0], 0.025, 1.3);
  goldTie(b, [-0.085, 0.04, 0], 0.011);
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
