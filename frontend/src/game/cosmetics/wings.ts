import * as THREE from "three";
import { Builder, blend, cyl, leaf, sphere } from "../items/builder";
import type { FeatherBone } from "../wingRig";
import { paintedModel, disposeModel, skinnedModel } from "./models";
import { wingSpec, type WingId, type WingRig } from "./catalog";

// The wardrobe's wings. Each pair is built for the right side (+x out along
// the span, +y towards the head, +z the back) in two parts that hang on the
// pilot's two wing joints: the inner part on the shoulder, the outer on the
// wrist, 0.54 out (scaled with the wing's size). The left wing is the same
// model mirrored. Feathered wings put each primary on a bone of its own, so
// the avatar can spread, twist and bend them (wingRig.ts); one-piece wings
// (rigid) put everything on the inner part. Looks only.

const GOLD = "#f3c869";

/** Where a wing's tip or trailing corner is: on which part, on which of its bones (-1: none), and where */
export interface WingAnchor {
  part: "inner" | "outer";
  bone: number;
  position: [number, number, number];
}

export interface WingModel {
  inner: THREE.Group;
  outer: THREE.Group;
  /** The outer part's primaries or plates, as bones (empty: none) */
  bones: THREE.Bone[];
  rest: number[];
  tip: WingAnchor;
  trail: WingAnchor;
  rig: WingRig;
  size: number;
  dispose(): void;
}

/** Flat tiny star facets need no bevel subdivisions. */
function star(outer: number, inner: number, depth: number) {
  const shape = new THREE.Shape();
  for (let i = 0; i < 10; i++) {
    const angle = Math.PI / 2 + i * Math.PI / 5, radius = i % 2 ? inner : outer;
    if (i === 0) shape.moveTo(Math.cos(angle) * radius, Math.sin(angle) * radius);
    else shape.lineTo(Math.cos(angle) * radius, Math.sin(angle) * radius);
  }
  shape.closePath();
  return new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: false });
}

/** A sculpted blade in the same XY plane as the pilot's original feathers. */
function blade(length: number, width: number, shape: string) {
  const s = new THREE.Shape();
  s.moveTo(0, -width * .45);
  if (shape === "crystal" || shape === "blade") {
    s.lineTo(length * .55, -width * .55); s.lineTo(length, 0);
    s.lineTo(length * .7, width * .5); s.lineTo(length * .18, width * .3);
  } else {
    s.bezierCurveTo(length * .25, -width, length * .75, -width * .6, length, 0);
    if (shape === "flame") s.bezierCurveTo(length * .8, -width * .3, length * .58, width, length * .45, width * .25);
    else if (shape === "fin") {
      s.quadraticCurveTo(length * .7, width * .85, length * .55, width * .35);
      s.quadraticCurveTo(length * .35, width * .8, length * .2, width * .4);
    } else s.quadraticCurveTo(length * .5, width * .8, 0, width * .45);
  }
  s.closePath();
  return new THREE.ExtrudeGeometry(s, { depth: .018, bevelEnabled: false, curveSegments: 7 });
}

/** A flat outline in the wing's plane, `depth` thick (smooth: a spline through the points) */
function flat(points: [number, number][], depth = 0.02, smooth = false) {
  const shape = new THREE.Shape();
  if (smooth) {
    shape.moveTo(...points[0]);
    shape.splineThru(points.slice(1).map(([x, y]) => new THREE.Vector2(x, y)));
  } else {
    points.forEach(([x, y], i) => (i ? shape.lineTo(x, y) : shape.moveTo(x, y)));
  }
  shape.closePath();
  return new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: false, curveSegments: 10 }).translate(0, 0, -depth / 2);
}

/** A flat disc facing the back (+z), for eyespots and gems */
const disc = (radius: number, depth = 0.012) => cyl(radius, radius, depth, 18).rotateX(Math.PI / 2);

/** A rod from `a` to `b` in the wing's plane */
function rod(builder: Builder, a: [number, number], b: [number, number], radius: number, color: string, glow = 0, z = 0) {
  const length = Math.hypot(b[0] - a[0], b[1] - a[1]);
  const angle = Math.atan2(b[1] - a[1], b[0] - a[0]);
  builder.add(cyl(radius, radius * 0.8, length, 7).rotateZ(-Math.PI / 2), color, glow, [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, z], [0, 0, angle]);
}

/** A cog: a ring with teeth, facing the back */
function gear(builder: Builder, at: [number, number, number], radius: number, color: string, glow = 0.15) {
  builder.add(new THREE.TorusGeometry(radius, radius * 0.22, 5, 16), color, glow, at);
  for (let i = 0; i < 8; i++) {
    const a = i * Math.PI / 4;
    builder.add(new THREE.BoxGeometry(radius * 0.32, radius * 0.38, radius * 0.3), color, glow,
      [at[0] + Math.cos(a) * radius * 1.18, at[1] + Math.sin(a) * radius * 1.18, at[2]], [0, 0, a]);
  }
  builder.add(sphere(radius * 0.32, 8, 6), GOLD, 0.4, at);
}

interface Built {
  inner: Builder;
  outer: Builder | null;
  feathers: FeatherBone[];
  tip: WingAnchor;
  trail: WingAnchor;
}

/** The original wardrobe shapes: fans of sculpted blades (feather wings put each primary on a bone) */
function classicShapes(id: WingId): Built {
  const spec = wingSpec(id), inner = new Builder(), outer = new Builder();
  const shape = spec.shape as string;
  const count = shape === "stars" ? 6 : shape === "sail" ? 3 : 7;
  const boned = spec.rig === "feather";
  const rainbow = ["#bd8bc9", "#8d9fdf", "#73cbd5", "#8bd0b0", "#efc681", "#e49fb7", "#b48dd3"];
  const feathers: FeatherBone[] = [];
  let tip: WingAnchor = { part: "outer", bone: -1, position: [0.9, 0.12, 0.02] };
  let trail: WingAnchor = { part: "outer", bone: -1, position: [0.5, -0.6, 0.02] };
  for (const [builder, base, n] of [[inner, .65, 4], [outer, 1, count]] as const) {
    const isOuter = builder === outer;
    for (let i = 0; i < n; i++) {
      const angle = isOuter ? .14 - i * (1.1 / Math.max(1, n - 1)) : -.75 - i * .22;
      const length = base * (1 - i * .055), x = isOuter ? .05 + i * .026 : .08 + i * .1;
      const y = -i * .026, color = id === "prism" ? rainbow[i % rainbow.length] : i % 2 ? spec.accent : spec.color;
      const width = shape === "sail" ? .29 : shape === "fin" ? .22 : .13;
      if (isOuter && boned) {
        feathers.push({ position: [x, y, i * .006], angle });
        builder.bone(feathers.length);
      }
      if (shape === "stars") {
        for (let j = 0; j < 4; j++) {
          const f = .12 + j * .23;
          builder.add(star(j % 2 ? .048 : .072, .022, .015), j % 2 ? spec.accent : color, .3,
            [x + Math.cos(angle) * length * f, y + Math.sin(angle) * length * f, .012 + i * .006], [0, 0, j * .5]);
        }
      } else builder.add(blade(length, width, shape), color, 0, [x, y, i * .006], [0, 0, angle]);
      // Each feather carries its own fine gilded spine and jewel tip.
      builder.add(new THREE.BoxGeometry(length * .72, .009, .012), GOLD, .2,
        [x + Math.cos(angle) * length * .36, y + Math.sin(angle) * length * .36, .028 + i * .006], [0, 0, angle]);
      if (isOuter) {
        const tx = x + Math.cos(angle) * length * .78, ty = y + Math.sin(angle) * length * .78;
        builder.add(shape === "stars" ? star(.052, .023, .014) : new THREE.OctahedronGeometry(.034, 0), spec.accent, .45, [tx, ty, .04 + i * .006]);
        const end: [number, number, number] = boned ? [length, 0, .02] : [x + Math.cos(angle) * length, y + Math.sin(angle) * length, .02];
        if (i === 0) tip = { part: "outer", bone: boned ? feathers.length - 1 : -1, position: end };
        if (i === n - 1) trail = { part: "outer", bone: boned ? feathers.length - 1 : -1, position: end };
      }
    }
    builder.bone(0);
    // Layered coverts soften the mechanical root and make the fan read as crafted plumage.
    for (let i = 0; i < 4; i++) builder.add(blade(.25, .075, "feather"), spec.accent, 0, [.07 + i * .075, -.02, .055], [0, 0, -.9]);
  }
  if (id === "gale" || id === "tide") {
    outer.add(new THREE.TorusGeometry(.17, .009, 5, 20, Math.PI * 1.65), GOLD, .25, [.4, -.15, .07], [0, 0, -.3]);
    for (let i = 0; i < 5; i++) outer.add(new THREE.SphereGeometry(.023, 8, 6), "#fff2d8", .2, [.22 + i * .08, -.27 - Math.sin(i) * .05, .055]);
  }
  if (id === "frost" || id === "storm") {
    for (let i = 0; i < 3; i++) outer.add(new THREE.BoxGeometry(.23, .012, .015), spec.accent, .25, [.4, -.2, .065], [0, 0, i * Math.PI / 3]);
  }
  return { inner, outer, feathers, tip, trail };
}

/** Sparrow wings: one small rounded piece, coverts over a fan of round primaries with a cream bar */
function sparrow(): Built {
  const b = new Builder();
  const brown = "#9a6b4a", tan = "#c9a27e", dark = "#6e4a35", cream = "#fff1dc";
  b.add(new THREE.CapsuleGeometry(0.03, 0.5, 4, 8).rotateZ(Math.PI / 2), brown, 0, [0.27, 0.02, 0]);
  for (let i = 0; i < 6; i++) {
    const angle = 0.25 - i * 0.24, length = 0.58 - i * 0.05, x = 0.42 + i * 0.05, y = -i * 0.02;
    b.add(blade(length, 0.2, "feather"), (p, out) => {
      const k = p.x / length;
      if (k > 0.25 && k < 0.36) out.set(cream);
      else blend(tan, dark, (k - 0.3) * 1.6, out);
    }, 0, [x, y, i * 0.005], [0, 0, angle]);
  }
  for (let i = 0; i < 6; i++) b.add(blade(0.32, 0.16, "feather"), i % 2 ? tan : brown, 0, [0.05 + i * 0.075, 0, 0.03], [0, 0, -0.75 - i * 0.08]);
  for (let i = 0; i < 4; i++) b.add(sphere(0.022, 6, 5), cream, 0, [0.15 + i * 0.1, -0.06, 0.05], [0, 0, 0], [1.4, 1, 0.4]);
  return { inner: b, outer: null, feathers: [], tip: { part: "inner", bone: -1, position: [0.42 + Math.cos(0.25) * 0.58, Math.sin(0.25) * 0.58, 0.02] },
    trail: { part: "inner", bone: -1, position: [0.67 + Math.cos(-0.95) * 0.33, -0.1 + Math.sin(-0.95) * 0.33, 0.02] } };
}

/** A cardboard glider: one cut-out piece with painted feathers, tape at the root and a string loop */
function cardboard(): Built {
  const b = new Builder();
  const card = "#b98a55", red = "#c9473f", white = "#efe6d4";
  const outline: [number, number][] = [[0, 0.08], [0.6, 0.2], [1.25, 0.24], [1.45, 0.12], [1.3, 0.02], [1.32, -0.12], [1.15, -0.16], [1.1, -0.3],
    [0.92, -0.32], [0.85, -0.46], [0.66, -0.46], [0.58, -0.58], [0.4, -0.55], [0.3, -0.62], [0.12, -0.5], [0, -0.3]];
  b.add(flat(outline, 0.03), (p, out) => {
    // Painted feather bands in poster paint, the bare card showing round the edge
    const band = ((Math.floor((p.x * 1.2 - p.y * 0.6) * 4) % 3) + 3) % 3;
    out.set(p.y > 0.12 || p.x < 0.12 ? card : band === 0 ? red : band === 1 ? white : card);
  });
  // A crayon sun, tape across the root and a string loop to wear it by
  b.add(star(0.09, 0.045, 0.01), "#ffd04a", 0.1, [0.75, -0.12, 0.02]);
  for (const y of [0.02, -0.25]) b.add(new THREE.BoxGeometry(0.22, 0.07, 0.034), "#efe8d6", 0, [0.08, y, 0.004], [0, 0, 0.15]);
  b.add(new THREE.TorusGeometry(0.06, 0.006, 5, 14), "#f4f0e6", 0, [0.03, -0.1, 0.03], [0, Math.PI / 2, 0]);
  return { inner: b, outer: null, feathers: [], tip: { part: "inner", bone: -1, position: [1.45, 0.12, 0.02] }, trail: { part: "inner", bone: -1, position: [0.6, -0.56, 0.02] } };
}

/** Origami crane wings: two crisp folded facets each, a red edge band */
function origami(): Built {
  const inner = new Builder(), outer = new Builder();
  const paper = "#fbf3ea", shade = "#eadfcf", red = "#e8546b";
  // Each half is two flat facets meeting at a crease, tilted against each other
  inner.add(flat([[0, 0.06], [0.56, 0.08], [0.5, -0.1]], 0.012), paper, 0, [0, 0, 0.01], [0.12, 0, 0])
    .add(flat([[0, 0.06], [0.5, -0.1], [0.18, -0.42]], 0.012), shade, 0, [0, 0, -0.005], [-0.12, 0, 0])
    .add(flat([[0.5, -0.1], [0.56, 0.08], [0.52, -0.02]], 0.014), red, 0.05, [0, 0, 0.012]);
  outer.add(flat([[0, 0.02], [1.05, 0.28], [0.95, 0.12]], 0.012), paper, 0, [0, 0, 0.01], [0.1, 0, 0])
    .add(flat([[0, 0.02], [0.95, 0.12], [0.3, -0.38], [0, -0.16]], 0.012), shade, 0, [0, 0, -0.004], [-0.1, 0, 0])
    .add(flat([[0.95, 0.12], [1.05, 0.28], [0.82, 0.13]], 0.015), red, 0.05, [0, 0, 0.012])
    .add(flat([[0.3, -0.38], [0.42, -0.3], [0.2, -0.3]], 0.015), red, 0.05, [0, 0, 0.012]);
  return { inner, outer, feathers: [], tip: { part: "outer", bone: -1, position: [1.05, 0.28, 0.02] }, trail: { part: "outer", bone: -1, position: [0.3, -0.38, 0.02] } };
}

/** Swallowtail silk: a hindwing with a long tail and a painted forewing lobe, black borders, eyespots */
function butterfly(): Built {
  const inner = new Builder(), outer = new Builder();
  const orange = "#f2a65a", border = "#2b2340", indigo = "#3c3f74", cream = "#fff4dc";
  const hind: [number, number][] = [[0, 0.02], [0.58, 0.06], [0.6, -0.2], [0.42, -0.42], [0.36, -0.86], [0.27, -0.5], [0.08, -0.36]];
  inner.add(flat(hind, 0.012, true), border, 0, [0, 0, -0.004]);
  inner.add(flat(hind.map(([x, y]) => [x * 0.9 + 0.02, y * 0.88 - 0.01] as [number, number]), 0.012, true), orange, 0, [0, 0, 0.006]);
  inner.add(disc(0.05), indigo, 0.2, [0.4, -0.3, 0.014]).add(disc(0.022), cream, 0.35, [0.4, -0.3, 0.02]);
  const fore: [number, number][] = [[-0.06, 0.05], [0.35, 0.3], [0.72, 0.42], [0.78, 0.18], [0.55, -0.06], [0.05, -0.08]];
  outer.add(flat(fore, 0.012, true), border, 0, [0, 0, -0.004]);
  outer.add(flat(fore.map(([x, y]) => [x * 0.88 + 0.02, y * 0.82 + 0.01] as [number, number]), 0.012, true), (p, out) => blend(orange, "#ffd27f", p.x * 1.4 - 0.2, out), 0, [0, 0, 0.006]);
  for (const [x, y, r] of [[0.58, 0.28, 0.035], [0.45, 0.2, 0.025], [0.66, 0.1, 0.02]] as const) outer.add(disc(r), cream, 0.3, [x, y, 0.016]);
  outer.add(disc(0.06), indigo, 0.2, [0.3, 0.08, 0.014]).add(disc(0.025), cream, 0.35, [0.3, 0.08, 0.02]);
  return { inner, outer, feathers: [], tip: { part: "outer", bone: -1, position: [0.74, 0.4, 0.02] }, trail: { part: "inner", bone: -1, position: [0.36, -0.86, 0.02] } };
}

/** Maple glider: a great five-lobed leaf on a gold stem, veined in gold */
function maple(): Built {
  const inner = new Builder(), outer = new Builder();
  const paint = (length: number) => (p: THREE.Vector3, out: THREE.Color) => blend("#c9452f", "#ffb347", p.y / length * 1.2, out);
  inner.add(new THREE.CapsuleGeometry(0.018, 0.5, 3, 6).rotateZ(Math.PI / 2), GOLD, 0.2, [0.27, 0.02, 0]);
  // Two broad base lobes from the stem's root, out and back, so the leaf reaches the shoulder
  for (const [x, angle, l] of [[0.04, -0.3, 0.62], [0.08, -0.85, 0.5], [0.3, -1.2, 0.36]] as const) {
    inner.add(leaf(l, 0.22, 0.012, 8), paint(l), 0, [x, 0, 0.004], [0, 0, angle - Math.PI / 2]);
    rod(inner, [x, 0], [x + Math.cos(angle) * l * 0.8, Math.sin(angle) * l * 0.8], 0.007, GOLD, 0.35, 0.014);
  }
  // Five lobes fanning from the wrist, the middle one longest, each with its vein
  const lobes: [number, number][] = [[0.75, 0.62], [0.95, 0.15], [1.05, -0.3], [0.85, -0.78], [0.6, -1.25]];
  for (const [length, angle] of lobes) {
    outer.add(leaf(length, 0.3, 0.014, 10), paint(length), 0, [0, 0, 0.004], [0, 0, angle - Math.PI / 2]);
    rod(outer, [0, 0], [Math.cos(angle) * length * 0.85, Math.sin(angle) * length * 0.85], 0.008, GOLD, 0.35, 0.016);
  }
  return { inner, outer, feathers: [], tip: { part: "outer", bone: -1, position: [Math.cos(0.15) * 0.95, Math.sin(0.15) * 0.95, 0.02] },
    trail: { part: "outer", bone: -1, position: [Math.cos(-1.25) * 0.6, Math.sin(-1.25) * 0.6, 0.02] } };
}

/** Clockwork aviator: a brass arm with gears, canvas panels, and four ribs that fan out in steps */
function clockwork(): Built {
  const inner = new Builder(), outer = new Builder();
  const brass = "#c9965a", canvas = "#efe3c4", teal = "#7fd0d6";
  rod(inner, [0, 0.02], [0.56, 0.06], 0.026, brass, 0.1);
  gear(inner, [0.06, 0.02, 0.03], 0.06, brass);
  gear(inner, [0.5, 0.05, 0.03], 0.045, brass);
  inner.add(flat([[0.02, -0.02], [0.54, 0.02], [0.5, -0.3], [0.08, -0.36]], 0.01), (p, out) => blend(canvas, "#d9c7a0", -p.y * 2, out), 0, [0, 0, -0.01]);
  for (let i = 0; i < 4; i++) inner.add(sphere(0.012, 6, 5), GOLD, 0.3, [0.1 + i * 0.13, -0.33 + i * 0.01, 0.01]);
  rod(outer, [0, 0], [0.22, 0.04], 0.022, brass, 0.1);
  gear(outer, [0.03, 0.01, 0.04], 0.05, brass);
  const feathers: FeatherBone[] = [];
  for (let i = 0; i < 4; i++) {
    const angle = 0.18 - i * 0.38, length = 0.9 - i * 0.09;
    feathers.push({ position: [0.12, 0, 0.01 * i], angle });
    outer.bone(i + 1);
    // The rib along +x from its root (placed by angle), with a canvas panel trailing it and a teal lens at its end
    outer.add(cyl(0.014, 0.01, length, 6).rotateZ(-Math.PI / 2), brass, 0.12, [0.12 + Math.cos(angle) * length / 2, Math.sin(angle) * length / 2, 0.01 * i], [0, 0, angle]);
    outer.add(flat([[0, 0], [length, 0], [length * 0.85, -0.2], [0.05, -0.16]], 0.008), (p, out) => blend(canvas, teal, p.x / length * 0.35, out), 0,
      [0.12, 0, -0.008 + 0.01 * i], [0, 0, angle]);
    outer.add(sphere(0.026, 8, 6), teal, 0.8, [0.12 + Math.cos(angle) * length, Math.sin(angle) * length, 0.01 * i + 0.01]);
  }
  outer.bone(0);
  return { inner, outer, feathers, tip: { part: "outer", bone: 0, position: [0.9, 0, 0.02] }, trail: { part: "outer", bone: 3, position: [0.63, 0, 0.02] } };
}

/** Ruin guard vanes: a carved stone-and-bronze plate round an amber core, three vanes that fan in steps */
function ruin(): Built {
  const inner = new Builder(), outer = new Builder();
  const stone = "#7b8c86", dark = "#56645f", bronze = "#b58b4c", amber = "#ffad4a";
  inner.add(flat([[0, 0.06], [0.56, 0.1], [0.52, -0.16], [0.3, -0.3], [0.04, -0.26]], 0.05), (p, out) => blend(stone, dark, -p.y * 2.5, out), 0);
  inner.add(sphere(0.055, 12, 9), amber, 1, [0.26, -0.08, 0.03], [0, 0, 0], [1, 1, 0.6]);
  inner.add(new THREE.TorusGeometry(0.075, 0.012, 5, 18), bronze, 0.2, [0.26, -0.08, 0.03]);
  rod(inner, [0.04, 0.05], [0.55, 0.09], 0.012, bronze, 0.15, 0.03);
  rod(inner, [0.33, -0.08], [0.52, -0.14], 0.006, amber, 0.9, 0.03);
  rod(inner, [0.19, -0.08], [0.06, -0.2], 0.006, amber, 0.9, 0.03);
  const feathers: FeatherBone[] = [];
  const vanes: [number, number][] = [[0.88, 0.12], [0.78, -0.36], [0.62, -0.84]];
  vanes.forEach(([length, angle], i) => {
    feathers.push({ position: [0.04, -0.02 * i, 0.015 * i], angle });
    outer.bone(i + 1);
    outer.add(blade(length, 0.2, "blade"), (p, out) => blend(stone, dark, Math.abs(p.y) * 6, out), 0, [0.04, -0.02 * i, 0.015 * i], [0, 0, angle]);
    outer.add(new THREE.BoxGeometry(length * 0.7, 0.012, 0.02), amber, 0.95, [0.04 + Math.cos(angle) * length * 0.42, -0.02 * i + Math.sin(angle) * length * 0.42, 0.02 + 0.015 * i], [0, 0, angle]);
    outer.add(new THREE.OctahedronGeometry(0.03, 0), bronze, 0.3, [0.04 + Math.cos(angle) * length * 0.95, -0.02 * i + Math.sin(angle) * length * 0.95, 0.02 + 0.015 * i]);
  });
  outer.bone(0);
  outer.add(sphere(0.045, 10, 8), bronze, 0.2, [0.02, 0, 0.02]);
  return { inner, outer, feathers, tip: { part: "outer", bone: 0, position: [0.88, 0, 0.02] }, trail: { part: "outer", bone: 2, position: [0.62, 0, 0.02] } };
}

/** Cloud wyrm wings: ivory arm and finger bones, jade membranes with scalloped trailing edges */
function wyrm(): Built {
  const inner = new Builder(), outer = new Builder();
  const jade = "#5fae96", deep = "#3f7f6c", bone = "#f4f0dc";
  inner.add(new THREE.CapsuleGeometry(0.03, 0.5, 4, 8).rotateZ(Math.PI / 2), bone, 0, [0.27, 0.03, 0.01]);
  inner.add(flat([[0, 0.03], [0.56, 0.05], [0.5, -0.14], [0.35, -0.22], [0.22, -0.34], [0.02, -0.26]], 0.012, true), (p, out) => blend(deep, jade, p.x * 1.6, out), 0, [0, 0, -0.008]);
  inner.add(new THREE.ConeGeometry(0.025, 0.09, 6), bone, 0.1, [0.56, 0.11, 0.01]);
  const fingers: [number, number][] = [[0.95, 0.35], [0.9, -0.2], [0.72, -0.72]];
  const ends = fingers.map(([l, a]) => [Math.cos(a) * l, Math.sin(a) * l] as [number, number]);
  for (let i = 0; i < fingers.length; i++) {
    rod(outer, [0, 0], ends[i], 0.018, bone, 0.05, 0.012);
    outer.add(new THREE.ConeGeometry(0.018, 0.07, 6), bone, 0.1, [ends[i][0], ends[i][1], 0.012], [0, 0, Math.atan2(ends[i][1], ends[i][0]) - Math.PI / 2]);
  }
  // Membranes between the fingers, each trailing edge scalloped inwards
  const span = [[0, 0] as [number, number], ...ends, [0.12, -0.42] as [number, number]];
  for (let i = 1; i < span.length - 1; i++) {
    const a = span[i], c = span[i + 1];
    const mid: [number, number] = [(a[0] + c[0]) * 0.36, (a[1] + c[1]) * 0.36];
    outer.add(flat([[0, 0], a, mid, c], 0.01, false), (p, out) => blend(deep, jade, Math.hypot(p.x, p.y) * 1.3, out), 0, [0, 0, -0.006]);
  }
  return { inner, outer, feathers: [], tip: { part: "outer", bone: -1, position: [ends[0][0], ends[0][1], 0.02] }, trail: { part: "outer", bone: -1, position: [ends[2][0], ends[2][1], 0.02] } };
}

/** Seraph of dawn: three tiers of white-and-gold feathers, gilded arcs, primaries that glow at the tips */
function seraph(): Built {
  const inner = new Builder(), outer = new Builder();
  const white = "#fff6e6", gold = "#ffcf6a";
  const featherPaint = (length: number, glowTo: string) => (p: THREE.Vector3, out: THREE.Color) => blend(white, glowTo, Math.pow(Math.max(0, p.x / length), 2.2) * 1.1, out);
  // Secondaries and tertials, then a row of coverts over them, and gilded filigree arcs
  for (let i = 0; i < 6; i++) inner.add(blade(0.62 + i * 0.04, 0.15, "feather"), featherPaint(0.7, "#ffe2a8"), 0, [0.06 + i * 0.09, 0.01 - i * 0.008, 0.004 * i], [0, 0, -0.85 - i * 0.18]);
  for (let i = 0; i < 6; i++) inner.add(blade(0.3, 0.1, "feather"), i % 2 ? white : "#ffeccc", 0.05, [0.05 + i * 0.085, 0.02, 0.04], [0, 0, -0.65 - i * 0.12]);
  inner.add(new THREE.TorusGeometry(0.22, 0.009, 5, 22, Math.PI * 1.2), GOLD, 0.45, [0.28, -0.08, 0.06], [0, 0, -0.6]);
  const feathers: FeatherBone[] = [];
  const n = 7;
  for (let i = 0; i < n; i++) {
    const angle = 0.2 - i * 0.2, length = 1.18 - i * 0.075, x = 0.05 + i * 0.03, y = -i * 0.024;
    feathers.push({ position: [x, y, i * 0.006], angle });
    outer.bone(i + 1);
    outer.add(blade(length, 0.15, "feather"), featherPaint(length, gold), i < 3 ? 0.25 : 0.12, [x, y, i * 0.006], [0, 0, angle]);
    outer.add(new THREE.BoxGeometry(length * 0.75, 0.008, 0.012), GOLD, 0.3, [x + Math.cos(angle) * length * 0.37, y + Math.sin(angle) * length * 0.37, 0.028 + i * 0.006], [0, 0, angle]);
  }
  outer.bone(0);
  for (let i = 0; i < 5; i++) outer.add(blade(0.34, 0.11, "feather"), i % 2 ? "#ffeccc" : white, 0.05, [0.05 + i * 0.07, -0.01, 0.06], [0, 0, -0.4 - i * 0.18]);
  outer.add(sphere(0.04, 10, 8), gold, 0.8, [0.03, 0.02, 0.07]);
  return { inner, outer, feathers, tip: { part: "outer", bone: 0, position: [1.18, 0, 0.02] }, trail: { part: "outer", bone: n - 1, position: [1.18 - (n - 1) * 0.075, 0, 0.02] } };
}

function shapesFor(id: WingId): Built {
  const shape = wingSpec(id).shape as string;
  if (shape === "round") return sparrow();
  if (shape === "card") return cardboard();
  if (shape === "origami") return origami();
  if (shape === "butterfly") return butterfly();
  if (shape === "leaf") return maple();
  if (shape === "clockwork") return clockwork();
  if (shape === "ruin") return ruin();
  if (shape === "wyrm") return wyrm();
  if (shape === "seraph") return seraph();
  return classicShapes(id);
}

/** One side's wing (`hand` 1 right, -1 left: mirrored), its two parts for the pilot's two wing joints */
export function buildWing(id: WingId, hand: number): WingModel {
  const spec = wingSpec(id), built = shapesFor(id);
  const inside = paintedModel(built.inner);
  let outside: THREE.Group, bones: THREE.Bone[] = [], rest: number[] = [];
  if (!built.outer) outside = new THREE.Group();
  else if (built.feathers.length) {
    const skinned = skinnedModel(built.outer, built.feathers);
    outside = skinned.group; bones = skinned.bones; rest = skinned.rest;
  } else outside = paintedModel(built.outer);
  inside.scale.set(hand * spec.size, spec.size, spec.size);
  outside.scale.set(hand * spec.size, spec.size, spec.size);
  inside.name = `${id}-inner`; outside.name = `${id}-outer`;
  return {
    inner: inside, outer: outside, bones, rest, tip: built.tip, trail: built.trail, rig: spec.rig, size: spec.size,
    dispose: () => { disposeModel(inside); disposeModel(outside); },
  };
}

/** Small paired wing token, also used by the test viewer. */
export function wingToken(id: WingId) {
  const group = new THREE.Group();
  for (const side of [-1, 1]) {
    const model = buildWing(id, side);
    model.outer.position.x = .54 * side * model.size;
    group.add(model.inner, model.outer);
  }
  return group;
}
