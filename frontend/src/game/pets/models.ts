import * as THREE from "three";
import { Builder, leaf, sphere, star } from "../items/models";
import { disposeModel, paintedModel } from "../cosmetics/models";
import { PET_LOOKS } from "../tuning";
import type { PetId } from "./catalog";

const IVORY = "#fff1d8", GOLD = "#f3c869", INK = "#3c344f";
type CompanionId = Exclude<PetId, "none">;
const colorForBrow = (id: CompanionId) => id === "fox" || id === "owl" ? "#9a7168" : INK;

/** A few merged parts per pet: one body, two wings, and up to three tails. */
export class PetModel {
  readonly group = new THREE.Group();
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
      b.add(sphere(0.22, 14, 10), color, 0, [0, 0, 0.03], [0, 0, 0], [owl ? .9 : 0.75, owl ? 1 : 0.85, crane ? 1.7 : 1.4])
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
        for (let i = -1; i <= 1; i++) b.add(leaf(0.17, 0.025), GOLD, 0.35, [i * 0.035, 0.22, -0.13], [0.25, 0, -i * 0.3]);
      }
      this.makeWings(color, id === "phoenix" ? GOLD : IVORY, crane ? 0.6 : owl ? 0.34 : 0.43, owl);
      this.makeTails(id === "phoenix" ? 3 : id === "swallow" ? 2 : 1, id === "phoenix" ? GOLD : color, id === "phoenix" ? 0.7 : id === "swallow" ? 0.48 : 0.27);
    } else {
      const dragon = id === "dragon", kirin = id === "kirin", fox = id === "fox";
      b.add(sphere(0.2, 14, 10), color, 0, [0, 0, 0.05], [0, 0, 0], [0.85, dragon ? 0.75 : 1, dragon ? 1.8 : 1.5])
        .add(sphere(0.13, 14, 10), fox ? IVORY : color, 0, [0, 0.16, -0.23], [0, 0, 0], [.9, 1.1, dragon ? 1.35 : 1.15])
        .add(sphere(0.075, 12, 8), IVORY, 0, [0, 0.11, -0.35], [0, 0, 0], [0.8, 0.65, dragon ? 1.65 : 1.35]);
      this.eyes(b, 0.07, 0.2, -0.36, 0.016);
      for (const s of [-1, 1]) {
        // Tucked paws, clear of the pilot's wings.
        for (const z of [-0.1, 0.21]) b.add(new THREE.CapsuleGeometry(0.037, 0.1, 3, 8), kirin ? "#8e7eae" : color, 0, [s * 0.14, -0.13, z], [0.7, 0, s * 0.3])
          .add(sphere(0.038, 8, 6), kirin ? GOLD : IVORY, kirin ? 0.2 : 0, [s * 0.14, -0.2, z - 0.03]);
        if (dragon) {
          b.add(new THREE.ConeGeometry(0.035, 0.17, 8), IVORY, 0.2, [s * 0.11, 0.34, -0.19], [0.2, 0, -s * 0.3])
            .add(new THREE.CapsuleGeometry(0.008, 0.15, 2, 6), GOLD, 0.2, [s * 0.12, 0.1, -0.38], [0, 0, s * 1.15]);
        } else if (fox || kirin) {
          b.add(new THREE.ConeGeometry(0.069, fox ? 0.2 : 0.14, 10), color, 0, [s * 0.115, 0.32, -0.19], [0.15, 0, -s * 0.25])
            .add(new THREE.ConeGeometry(0.036, fox ? 0.13 : 0.08, 8), fox ? "#e9b1ad" : "#e6d4ed", 0, [s * 0.115, 0.34, -0.225], [0.15, 0, -s * 0.25]);
        }
      }
      if (dragon) {
        for (let i = 0; i < 5; i++) b.add(leaf(0.11, 0.025), IVORY, 0.15, [0, 0.14, -0.1 + i * 0.1], [0.2, 0, 0]);
        this.makeTails(1, color, 0.72);
      } else if (kirin) {
        b.add(new THREE.ConeGeometry(0.04, 0.24, 10), GOLD, 0.4, [0, 0.4, -0.28], [-0.25, 0, 0]);
        for (let i = 0; i < 7; i++) b.add(leaf(.17, .04), IVORY, 0.1, [0, .23 - i * .016, -.14 + i * .05], [1.1, 0, 0]);
        this.makeTails(1, IVORY, 0.46);
      } else if (fox) {
        b.add(sphere(0.025, 8, 6), INK, 0, [0, 0.125, -0.44]);
        this.makeTails(3, IVORY, 0.65);
      } else {
        b.add(new THREE.ConeGeometry(0.06, 0.12, 10), GOLD, 0.25, [0, 0.1, -0.42], [-Math.PI / 2, 0, 0]);
        for (let i = 0; i < 9; i++) { const a = i * Math.PI * 2 / 9; b.add(leaf(.16, .035), "#bf8958", 0, [Math.cos(a) * 0.11, 0.1 + Math.sin(a) * 0.11, -0.11], [.2, 0, a]); }
        this.makeWings("#d7ae72", IVORY, 0.5, false);
        this.makeTails(1, "#bf8958", 0.45);
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
    this.group.add(paintedModel(b));
  }

  private eyes(b: Builder, x: number, y: number, z: number, radius: number) {
    for (const s of [-1, 1]) b.add(sphere(radius, 10, 8), INK, 0, [s * x, y, z], [0, 0, 0], [1, 1.15, 0.6])
      .add(sphere(radius * 0.32, 6, 5), IVORY, 0, [s * x + 0.003, y + 0.004, z - radius * 0.5])
      .add(new THREE.CapsuleGeometry(.006, radius * 1.6, 2, 6), colorForBrow(this.id), 0, [s * x, y + radius * 1.2, z], [0, 0, Math.PI / 2 + s * .22]);
  }
  private makeWings(color: string, tip: string, length: number, round: boolean) {
    for (const s of [-1, 1]) {
      const b = new Builder();
      b.add(sphere(0.075, 10, 8), color, 0, [s * 0.11, 0, 0.06], [0, 0, 0], [2, 0.4, 1]);
      for (let i = 0; i < 7; i++) {
        const angle = s * (1.2 - i * .14), at: [number, number, number] = [s * (.06 + i * .035), 0, .025 * i];
        b.add(leaf(length * (1 - i * .065), round ? .05 : .032).rotateX(Math.PI / 2), i > 3 ? tip : color, i > 3 ? .1 : 0, at, [0, angle, 0]);
        b.add(leaf(length * .48, .022).rotateX(Math.PI / 2), i % 2 ? IVORY : color, 0, [at[0], .013, at[2]], [0, angle, 0]);
      }
      const wing = paintedModel(b); wing.position.set(s * 0.14, 0.045, 0); this.group.add(wing); this.wings.push(wing);
    }
  }
  private makeTails(count: number, color: string, length: number) {
    for (let i = 0; i < count; i++) {
      const s = i - (count - 1) / 2, b = new Builder();
      if (this.id === "fox" || this.id === "dragon") {
        b.add(sphere(0.09, 12, 8), color, 0, [0, 0, length * 0.3], [-0.25, 0, 0], [0.8, 0.8, length * 3.7])
          .add(sphere(0.055, 10, 7), this.id === "fox" ? "#eac29c" : IVORY, 0.25, [0, length * 0.12, length * 0.58], [0, 0, 0], [1, 1, 1.7]);
      } else b.add(leaf(length, 0.035).rotateX(Math.PI / 2), color, this.id === "phoenix" ? 0.3 : 0, [0, 0, 0]);
      const tail = paintedModel(b); tail.position.set(s * 0.065, 0, 0.23); tail.rotation.y = s * 0.45;
      this.group.add(tail); this.tails.push(tail);
    }
  }
  animate(dt: number) {
    if (dt <= 0) return;
    this.time += dt;
    const t = this.time;
    // A quicker downstroke and a floating recovery, with staggered tail follow-through.
    const phase = t * Math.PI * 2 * this.rate * PET_LOOKS.wingbeat;
    const flap = Math.sin(phase) + 0.16 * Math.sin(phase * 2);
    for (let i = 0; i < this.wings.length; i++) this.wings[i].rotation.z = (i ? 1 : -1) * (0.12 + flap * this.amplitude);
    for (let i = 0; i < this.tails.length; i++) {
      this.tails[i].rotation.y = (i - (this.tails.length - 1) / 2) * 0.45 + Math.sin(t * 2.6 - i * 0.55) * 0.16 * PET_LOOKS.tailSway;
      this.tails[i].rotation.x = -0.15 + Math.sin(t * 2 - i * 0.4) * 0.13 * PET_LOOKS.tailSway;
    }
  }
  dispose() { disposeModel(this.group); }
}
