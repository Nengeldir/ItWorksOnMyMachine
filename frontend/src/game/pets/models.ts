import * as THREE from "three";
import { Builder, leaf as fullLeaf, sphere, star } from "../items/models";
import { disposeModel, paintedModel } from "../cosmetics/models";
import { PET_LOOKS } from "../tuning";
import type { PetId } from "./catalog";

const IVORY = "#fff1d8", GOLD = "#f3c869", INK = "#3c344f";
type CompanionId = Exclude<PetId, "none">;
type Vec = [number, number, number];
const colorForBrow = (id: CompanionId) => id === "fox" || id === "owl" ? "#9a7168" : INK;

/** Pets carry many small feathers: four segments per edge keep their outline and halve the vertices */
const leaf = (length: number, width: number) => fullLeaf(length, width, 0.008, 4);
const fromColor = new THREE.Color(), toColor = new THREE.Color();
/** Paints a primitive from `a` at its base to `b` at `length` along y (feathers, plumes) */
const grad = (a: string, b: string, length: number, from = 0.35) => (p: THREE.Vector3, out: THREE.Color) => {
  const k = THREE.MathUtils.smoothstep(p.y / length, from, 1);
  out.copy(fromColor.set(a)).lerp(toColor.set(b), k);
};
/** A feather along +z (leaf geometry laid back), for tails and wings */
const quill = (length: number, width: number) => leaf(length, width).rotateX(Math.PI / 2);

/** Each companion's own trail of light, shed from its tail as it flies (looks only) */
export const PET_SPARKS: Record<CompanionId, { color: string; kind: number; size: number; life: number; gravity: number; rate: number; intensity: number }> = {
  swallow: { color: "#a9e3ff", kind: 3, size: 0.16, life: 0.7, gravity: 0, rate: 10, intensity: 0.7 }, // wind wisps
  owl: { color: "#e6ecff", kind: 4, size: 0.09, life: 1.6, gravity: -0.15, rate: 7, intensity: 1.1 }, // moonlit motes
  crane: { color: "#9fe6cf", kind: 2, size: 0.1, life: 1.4, gravity: 0.35, rate: 6, intensity: 0.9 }, // jade petals
  phoenix: { color: "#ffb469", kind: 0, size: 0.08, life: 0.9, gravity: -0.8, rate: 16, intensity: 1.3 }, // rising embers
  dragon: { color: "#f2fbff", kind: 3, size: 0.2, life: 0.9, gravity: -0.1, rate: 9, intensity: 0.6 }, // cloud breath
  kirin: { color: "#d9c8ff", kind: 1, size: 0.11, life: 1.1, gravity: 0, rate: 9, intensity: 1.2 }, // star twinkles
  fox: { color: "#ffc27a", kind: 4, size: 0.1, life: 1.3, gravity: -0.3, rate: 9, intensity: 1.2 }, // foxfire
  griffin: { color: "#ffe08a", kind: 2, size: 0.09, life: 0.8, gravity: 0.1, rate: 10, intensity: 1.1 }, // sun flecks
};

/** A few merged parts per pet: one body, two wings, and up to three tails. */
export class PetModel {
  readonly group = new THREE.Group();
  /** Everything but the root: rocks and bobs with the gait, so the root stays where the companion puts it */
  private readonly rig = new THREE.Group();
  private readonly legs: THREE.Group[] = [];
  private runs = false;
  private readonly wings: THREE.Group[] = [];
  private readonly tails: THREE.Group[] = [];
  private time = 0;
  private readonly rate: number;
  private readonly amplitude: number;

  readonly id: CompanionId;
  constructor(id: CompanionId) {
    this.id = id;
    this.group.name = id;
    const bird = id === "swallow" || id === "owl" || id === "crane" || id === "phoenix";
    const color = id === "swallow" ? "#64a7cb" : id === "owl" ? "#d5c5b2" : id === "crane" ? IVORY : id === "phoenix" ? "#e99366" : id === "dragon" ? "#8bc9b8" : id === "kirin" ? "#b3a4d3" : id === "fox" ? IVORY : "#d7ae72";
    this.rate = id === "swallow" ? 4 : id === "owl" ? 1.5 : id === "crane" ? 1.1 : bird ? 1.8 : 1.4;
    this.amplitude = id === "crane" ? 0.42 : 0.65;
    const b = new Builder();
    if (bird) {
      const owl = id === "owl", crane = id === "crane";
      b.add(sphere(0.22, 12, 9), color, 0, [0, 0, 0.03], [0, 0, 0], [owl ? .9 : 0.75, owl ? 1 : 0.85, crane ? 1.7 : 1.4])
        .add(sphere(owl ? 0.145 : 0.115, 14, 10), crane ? IVORY : color, 0, [0, crane ? 0.19 : 0.14, crane ? -0.27 : -0.17])
        .add(sphere(0.13, 12, 8), IVORY, 0, [0, -0.025, -0.05], [0, 0, 0], [0.95, 0.8, 1]);
      const headZ = crane ? -0.27 : -0.17, eyeY = crane ? 0.22 : 0.17;
      if (owl) {
        for (const s of [-1, 1]) {
          b.add(sphere(0.054, 12, 8), IVORY, 0, [s * 0.065, eyeY, headZ - 0.1], [0, 0, 0], [1, 1.12, 0.4])
            .add(sphere(0.025, 10, 8), GOLD, 0.12, [s * 0.065, eyeY, headZ - 0.13], [0, 0, 0], [1, 1, 0.5])
            .add(leaf(.12, .025), color, 0, [s * 0.11, .24, -.13], [.15, 0, -s * .35]);
        }
      }
      this.eyes(b, owl ? 0.065 : 0.065, eyeY, headZ - (owl ? 0.14 : 0.105), owl ? 0.016 : 0.014);
      b.add(new THREE.ConeGeometry(crane ? 0.026 : 0.035, crane ? 0.22 : 0.09, 8), crane ? INK : GOLD, 0.1, [0, eyeY - 0.04, headZ - (crane ? 0.2 : 0.14)], [-Math.PI / 2, 0, 0]);
      if (crane) {
        b.add(sphere(0.06, 10, 7), "#d86d75", 0, [0, 0.3, -0.27], [0, 0, 0], [1, 0.5, 1])
          .add(new THREE.CapsuleGeometry(0.045, 0.17, 3, 8), IVORY, 0, [0, 0.11, -0.18], [-0.4, 0, 0]);
      }
      if (id === "phoenix") {
        // A tall swept crest of flame feathers and flicked cheek plumes
        for (let i = -2; i <= 2; i++) b.add(leaf(0.3 - Math.abs(i) * 0.04, 0.04), grad("#ff9a62", "#ffe39a", 0.3), 0.35, [i * 0.03, 0.2, -0.13], [0.7, 0, -i * 0.28]);
        for (const s of [-1, 1]) b.add(leaf(0.14, 0.03), grad("#e99366", GOLD, 0.14), 0.2, [s * 0.09, 0.13, -0.12], [1.3, 0, -s * 1.1]);
      } else if (id === "swallow") {
        // A rose ribbon scarf, its two ends streaming back
        b.add(new THREE.TorusGeometry(0.1, 0.022, 6, 16), "#f2a7b8", 0.05, [0, 0.07, -0.13], [0.9, 0, 0]);
        for (const s of [-1, 1]) b.add(leaf(0.24, 0.045), grad("#f2a7b8", "#ffe1e8", 0.24), 0.1, [s * 0.05, 0.06, -0.06], [1.75, s * 0.25, 0]);
      } else if (owl) {
        // A crescent moon on the breast, faintly lit
        b.add(new THREE.TorusGeometry(0.06, 0.016, 6, 18, Math.PI * 1.3), "#fff2b8", 0.6, [0, -0.01, -0.21], [0.25, 0, 2.1]);
      } else if (crane) {
        // A string of jade beads under the throat
        for (let i = -2; i <= 2; i++) b.add(sphere(0.022, 8, 6), "#7fd4b4", 0.3, [i * 0.035, 0.045 - Math.abs(i) * 0.012, -0.19 + Math.abs(i) * 0.012]);
      }
      this.makeWings(color, id === "phoenix" ? GOLD : crane ? INK : owl ? "#b9a48e" : "#2f5f86", crane ? 0.74 : owl ? 0.44 : 0.54, owl, id === "phoenix" ? 0.35 : 0);
      this.makeTails(id === "phoenix" ? 3 : id === "swallow" ? 2 : 1, id === "phoenix" ? GOLD : color, id === "phoenix" ? 0.95 : id === "swallow" ? 0.68 : crane ? 0.42 : 0.34);
    } else {
      const dragon = id === "dragon", kirin = id === "kirin", fox = id === "fox";
      this.runs = id !== "griffin";
      b.add(sphere(0.2, 12, 9), color, 0, [0, 0, 0.05], [0, 0, 0], [0.85, dragon ? 0.75 : 1, dragon ? 1.8 : 1.5])
        .add(sphere(0.13, 12, 9), fox ? IVORY : color, 0, [0, 0.16, -0.23], [0, 0, 0], [.9, 1.1, dragon ? 1.35 : 1.15])
        .add(sphere(0.075, 12, 8), IVORY, 0, [0, 0.11, -0.35], [0, 0, 0], [0.8, 0.65, dragon ? 1.65 : 1.35]);
      this.eyes(b, 0.07, 0.2, -0.36, 0.016);
      // Wingless pets run on the air: front and hind legs swing as two pairs (a bounding gallop)
      if (this.runs) this.makeLegs(kirin ? "#8e7eae" : color, kirin ? GOLD : IVORY, kirin ? 0.2 : 0, kirin);
      for (const s of [-1, 1]) {
        if (dragon) {
          b.add(new THREE.ConeGeometry(0.035, 0.17, 8), IVORY, 0.2, [s * 0.11, 0.34, -0.19], [0.2, 0, -s * 0.3])
            .add(new THREE.CapsuleGeometry(0.008, 0.15, 2, 6), GOLD, 0.2, [s * 0.12, 0.1, -0.38], [0, 0, s * 1.15]);
        } else if (fox || kirin) {
          b.add(new THREE.ConeGeometry(0.069, fox ? 0.2 : 0.14, 10), color, 0, [s * 0.115, 0.32, -0.19], [0.15, 0, -s * 0.25])
            .add(new THREE.ConeGeometry(0.036, fox ? 0.13 : 0.08, 8), fox ? "#e9b1ad" : "#e6d4ed", 0, [s * 0.115, 0.34, -0.225], [0.15, 0, -s * 0.25]);
        }
      }
      if (dragon) {
        // A flowing ivory mane along the spine and a glowing pearl held under the chin
        for (let i = 0; i < 6; i++) b.add(leaf(0.16 - i * 0.012, 0.04), grad(IVORY, "#cdeee4", 0.16), 0.15, [0, 0.14, -0.12 + i * 0.09], [0.55, 0, 0]);
        b.add(sphere(0.055, 12, 9), "#eef8ff", 0.7, [0, -0.02, -0.4])
          .add(new THREE.TorusGeometry(0.068, 0.008, 5, 18), GOLD, 0.3, [0, -0.02, -0.4], [0.3, 0, 0]);
        this.makeTails(1, color, 0.8);
      } else if (kirin) {
        b.add(new THREE.ConeGeometry(0.04, 0.24, 10), GOLD, 0.4, [0, 0.4, -0.28], [-0.25, 0, 0]);
        for (let i = 0; i < 7; i++) b.add(leaf(.22, .05), grad(IVORY, "#e6d4ed", .22), 0.1, [0, .23 - i * .016, -.14 + i * .05], [1.1, 0, 0]);
        this.makeTails(1, IVORY, 0.55);
      } else if (fox) {
        b.add(sphere(0.025, 8, 6), INK, 0, [0, 0.125, -0.44]);
        // A paper lantern on the harness, lit from inside
        b.add(sphere(0.045, 9, 7), "#ff9a5c", 0.75, [0, -0.11, -0.22], [0, 0, 0], [1, 1.25, 1])
          .add(new THREE.CylinderGeometry(0.02, 0.026, 0.018, 10), GOLD, 0.2, [0, -0.05, -0.22])
          .add(new THREE.CylinderGeometry(0.026, 0.02, 0.018, 10), GOLD, 0.2, [0, -0.168, -0.22]);
        this.makeTails(3, IVORY, 0.72);
      } else {
        // Tucked paws, clear of the pilot's wings: the griffin flies on its wings
        for (const s of [-1, 1]) for (const z of [-0.1, 0.21]) b.add(new THREE.CapsuleGeometry(0.037, 0.1, 3, 8), color, 0, [s * 0.14, -0.13, z], [0.7, 0, s * 0.3])
          .add(sphere(0.038, 8, 6), IVORY, 0, [s * 0.14, -0.2, z - 0.03]);
        b.add(new THREE.ConeGeometry(0.06, 0.12, 10), GOLD, 0.25, [0, 0.1, -0.42], [-Math.PI / 2, 0, 0]);
        for (let i = 0; i < 9; i++) { const a = i * Math.PI * 2 / 9; b.add(leaf(.2, .045), grad("#bf8958", "#e8b36a", .2), 0, [Math.cos(a) * 0.11, 0.1 + Math.sin(a) * 0.11, -0.11], [.2, 0, a - Math.PI / 2]); }
        // A sun disc behind the mane, rayed in gold
        b.add(new THREE.TorusGeometry(0.2, 0.012, 4, 24), GOLD, 0.45, [0, 0.12, -0.06]);
        for (let i = 0; i < 8; i++) { const a = i * Math.PI / 4; b.add(new THREE.ConeGeometry(0.018, 0.07, 6), GOLD, 0.45, [Math.cos(a) * 0.24, 0.12 + Math.sin(a) * 0.24, -0.06], [0, 0, a - Math.PI / 2]); }
        this.makeWings("#d7ae72", IVORY, 0.62, false, 0);
        this.makeTails(1, "#bf8958", 0.5);
      }
    }
    // A tiny collar: warm gilding, no large additive bloom surfaces.
    b.add(new THREE.TorusGeometry(0.105, 0.012, 6, 16), GOLD, 0.3, [0, 0.08, -0.15], [0.7, 0, 0]);
    // Layered breast plumage / mane, a fitted Sky-like harness and a small elemental jewel.
    // Smaller eyes and heads keep companions in the pilot's anime proportions.
    for (let row = 0; row < 3; row++) for (const s of [-1, 1]) {
      b.add(leaf(.12 + row * .018, .033), row % 2 ? IVORY : color, 0,
        [s * (.06 + row * .025), -.08 - row * .018, -.12 + row * .065], [1.2, 0, s * .4]);
      b.add(new THREE.CapsuleGeometry(.009, .22, 2, 6), GOLD, .2, [s * .155, .045, .06], [Math.PI / 2, 0, s * .12]);
    }
    b.add(star(.047, .024, .016), GOLD, .35, [0, .09, -.24], [-.4, 0, 0])
      .add(new THREE.OctahedronGeometry(.025, 0), id === "phoenix" ? "#ffe7a9" : "#9edbd8", .4, [0, .095, -.258]);
    if (id === "dragon" || id === "kirin") {
      for (let i = 0; i < 7; i++) for (const s of [-1, 1]) b.add(leaf(.09, .023), i % 2 ? IVORY : GOLD, .1,
        [s * .13, .05, -.08 + i * .055], [Math.PI / 2, s * .4, 0]);
    }
    this.rig.add(paintedModel(b));
    this.group.add(this.rig);
  }

  private eyes(b: Builder, x: number, y: number, z: number, radius: number) {
    for (const s of [-1, 1]) b.add(sphere(radius, 8, 6), INK, 0, [s * x, y, z], [0, 0, 0], [1, 1.15, 0.6])
      .add(sphere(radius * 0.32, 6, 5), IVORY, 0, [s * x + 0.003, y + 0.004, z - radius * 0.5])
      .add(new THREE.CapsuleGeometry(.006, radius * 1.6, 2, 6), colorForBrow(this.id), 0, [s * x, y + radius * 1.2, z], [0, 0, Math.PI / 2 + s * .22]);
  }
  /** Two leg pairs hung from shoulder and hip pivots: a slim leg and a paw (or a hoof on a cloud) */
  private makeLegs(color: string, paw: string, pawGlow: number, hooves: boolean) {
    for (const z of [-0.1, 0.21]) {
      const b = new Builder();
      for (const s of [-1, 1]) {
        b.add(new THREE.CapsuleGeometry(0.037, 0.14, 3, 8), color, 0, [s * 0.145, -0.1, 0], [0, 0, s * 0.08])
          .add(sphere(0.038, 8, 6), paw, pawGlow, [s * 0.15, -0.21, -0.01], [0, 0, 0], [1, 0.8, 1.2]);
        // Little clouds under its hooves: it walks on the sky
        if (hooves) for (let k = 0; k < 3; k++) b.add(sphere(0.035 - k * 0.006, 8, 6), "#f6f2ff", 0.15, [s * (0.13 + k * 0.035), -0.25, (k - 1) * 0.03]);
      }
      const pair = paintedModel(b); pair.position.set(0, -0.06, z); this.rig.add(pair); this.legs.push(pair);
    }
  }
  /** Broad, layered wings: long primaries fading into `tip`, a row of coverts, a rounded shoulder */
  private makeWings(color: string, tip: string, length: number, round: boolean, tipGlow: number) {
    for (const s of [-1, 1]) {
      const b = new Builder();
      b.add(sphere(0.085, 12, 8), color, 0, [s * 0.12, 0, 0.05], [0, 0, 0], [2.2, 0.45, 1.25]);
      for (let i = 0; i < 8; i++) {
        const angle = s * (1.3 - i * .15), at: Vec = [s * (.05 + i * .034), 0, .03 * i];
        const long = length * (1.08 - i * .06);
        b.add(quill(long, round ? .085 : .065), grad(color, tip, long, 0.45), i < 4 ? tipGlow : 0, at, [0, angle, 0]);
        b.add(quill(long * .55, round ? .06 : .045), i % 2 ? IVORY : color, 0, [at[0], .014, at[2]], [0, angle, 0]);
      }
      // Coverts: a short scalloped row over the base of the flight feathers
      for (let i = 0; i < 5; i++) b.add(quill(length * .3, .05), i % 2 ? color : IVORY, 0, [s * (.08 + i * .045), .026, .02 + i * .024], [0, s * (1.15 - i * .15), 0]);
      const wing = paintedModel(b); wing.position.set(s * 0.14, 0.045, 0); this.rig.add(wing); this.wings.push(wing);
    }
  }
  /** Tails with a real silhouette: fans of feathers, plumes with eyes, fluffy brushes, a dragon's spined whip */
  private makeTails(count: number, color: string, length: number) {
    const id = this.id;
    this.sparkFrom.set(0, 0.02, 0.23 + length * 0.85);
    for (let i = 0; i < count; i++) {
      const s = i - (count - 1) / 2, b = new Builder();
      if (id === "fox") {
        // A plump brush: swelling, then tapering into a flame-lit tip, with tufts of fur
        const radii = [0.05, 0.08, 0.1, 0.105, 0.095, 0.075, 0.05];
        radii.forEach((r, k) => {
          const z = (k / (radii.length - 1)) * length, y = Math.sin(k * 0.45) * 0.08;
          b.add(sphere(r, 9, 6), k >= 5 ? "#ffd9a8" : color, k === 6 ? 0.55 : k === 5 ? 0.2 : 0, [0, y, z], [0, 0, 0], [0.95, 0.95, 1.3]);
          if (k > 1 && k < 5) for (const side of [-1, 1]) b.add(leaf(r * 1.2, r * 0.7), color, 0, [side * r * 0.8, y, z], [Math.PI / 2 + 0.4, 0, side * 1.2]);
        });
      } else if (id === "dragon") {
        // A whip of shrinking scales with ivory spines, ending in a golden fin
        for (let k = 0; k < 10; k++) {
          const t = k / 9, z = t * length, y = Math.sin(t * Math.PI * 1.4) * 0.07, r = 0.075 * (1 - t * 0.6);
          b.add(sphere(r, 8, 6), k % 2 ? color : "#7cb8a7", 0, [0, y, z], [0, 0, 0], [1, 0.9, 1 + t * 1.6]);
          if (k < 9 && k % 2 === 0) b.add(new THREE.ConeGeometry(r * 0.45, r * 1.4, 6), IVORY, 0.15, [0, y + r * 0.9, z], [-0.5, 0, 0]);
        }
        for (let k = -1; k <= 1; k++) b.add(quill(0.2, 0.06), grad(GOLD, "#fff1c4", 0.2), 0.3, [0, Math.sin(Math.PI * 1.4) * 0.07, length], [k * 0.5, k * 0.5, 0]);
      } else if (id === "griffin") {
        // A lion's tail: a slim curve ending in a full tuft
        for (let k = 0; k < 7; k++) { const t = k / 6; b.add(sphere(0.036 * (1 - t * 0.3), 6, 4), "#d7ae72", 0, [0, Math.sin(t * 2) * 0.1, t * length], [0, 0, 0], [1, 1, 2.4]); }
        const end: Vec = [0, Math.sin(2) * 0.1, length];
        b.add(sphere(0.06, 9, 7), color, 0, end, [0, 0, 0], [1, 1, 1.4]);
        for (let k = 0; k < 6; k++) { const a = k * Math.PI / 3; b.add(quill(0.12, 0.04), color, 0, end, [Math.sin(a) * 0.5, Math.cos(a) * 0.5, 0]); }
      } else if (id === "kirin") {
        // A cloud tail: a fan of pale streamers with puffs along it
        for (let k = -2; k <= 2; k++) b.add(quill(length * (1 - Math.abs(k) * 0.12), 0.06), grad(IVORY, "#d9c8ff", length), 0.1, [0, 0, 0], [0.15 - Math.abs(k) * 0.05, k * 0.22, 0]);
        for (let k = 0; k < 4; k++) b.add(sphere(0.065 - k * 0.008, 9, 7), "#f6f2ff", 0.15, [Math.sin(k * 2.1) * 0.03, 0.005, length * (0.45 + k * 0.15)], [0, 0, 0], [1.2, 0.8, 1.3]);
      } else if (id === "swallow") {
        // One prong of the forked tail: a long streamer with two shorter feathers at its root
        b.add(quill(length, 0.05), grad(color, "#1f4f7a", length, 0.25), 0, [0, 0, 0])
          .add(quill(length * 0.45, 0.06), color, 0, [0, 0.008, 0], [0, -s * 0.35, 0])
          .add(quill(length * 0.35, 0.05), IVORY, 0, [0, 0.014, 0], [0, s * 0.2, 0])
          .add(star(0.03, 0.014, 0.01), "#bfeaff", 0.5, [0, 0, length * 0.98], [Math.PI / 2, 0, 0]);
      } else if (id === "phoenix") {
        // A long flame plume, coral into gold, with an eye of light near its end and trailing filaments
        b.add(quill(length, 0.075), grad("#e99366", "#ffd36e", length, 0.1), 0.3, [0, 0, 0]);
        for (const side of [-1, 1]) b.add(quill(length * 0.7, 0.03), grad("#ffb27a", "#fff0b8", length * 0.7), 0.35, [side * 0.02, 0, 0.05], [0, side * 0.18, 0]);
        b.add(sphere(0.055, 12, 8), "#ffe9a8", 0.55, [0, 0.01, length * 0.8], [0, 0, 0], [1, 0.4, 1.2])
          .add(sphere(0.028, 10, 7), "#d4564a", 0.45, [0, 0.025, length * 0.8], [0, 0, 0], [1, 0.4, 1.2]);
      } else {
        // Owl and crane: a fan of broad feathers (the crane's drooping, ink-tipped)
        const crane = id === "crane", n = 7;
        for (let k = 0; k < n; k++) {
          const rel = k / (n - 1) - 0.5, long = length * (1 - Math.abs(rel) * (crane ? 0.2 : 0.45));
          b.add(quill(long, crane ? 0.05 : 0.07), crane ? grad(IVORY, INK, long, 0.5) : grad(color, "#8f7a66", long, 0.6), 0,
            [rel * 0.05, k % 2 ? 0.008 : 0, 0], [crane ? 0.35 : 0, rel * (crane ? 0.9 : 1.6), 0]);
        }
      }
      const tail = paintedModel(b); tail.position.set(s * 0.065, 0, 0.23); tail.rotation.y = s * 0.45;
      this.rig.add(tail); this.tails.push(tail);
    }
  }

  /** Where the tail's light trail starts, in the model's own frame */
  readonly sparkFrom = new THREE.Vector3(0, 0.02, 0.5);
  animate(dt: number) {
    if (dt <= 0) return;
    this.time += dt;
    const t = this.time;
    // A quicker downstroke and a floating recovery, with staggered tail follow-through.
    const phase = t * Math.PI * 2 * this.rate * PET_LOOKS.wingbeat;
    const flap = Math.sin(phase) + 0.16 * Math.sin(phase * 2);
    for (let i = 0; i < this.wings.length; i++) this.wings[i].rotation.z = (i ? 1 : -1) * (0.12 + flap * this.amplitude);
    if (this.runs) {
      // A bounding gallop on thin air: the front pair reaches forward as the hind pair kicks back, then they gather;
      // the body rocks and lifts with each bound
      const stride = t * Math.PI * 2 * PET_LOOKS.gallop, reach = 0.75 * PET_LOOKS.stride;
      this.legs[0].rotation.x = -Math.sin(stride) * reach - 0.2;
      this.legs[1].rotation.x = Math.sin(stride + 0.9) * reach + 0.15;
      this.rig.rotation.x = Math.sin(stride + 0.45) * 0.09 * PET_LOOKS.stride;
      this.rig.position.y = Math.abs(Math.cos(stride + 0.45)) * 0.035 * PET_LOOKS.stride;
    }
    for (let i = 0; i < this.tails.length; i++) {
      this.tails[i].rotation.y = (i - (this.tails.length - 1) / 2) * 0.45 + Math.sin(t * 2.6 - i * 0.55) * 0.16 * PET_LOOKS.tailSway;
      this.tails[i].rotation.x = -0.15 + Math.sin(t * 2 - i * 0.4) * 0.13 * PET_LOOKS.tailSway;
    }
  }
  dispose() { disposeModel(this.group); }
}
