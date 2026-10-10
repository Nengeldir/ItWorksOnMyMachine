import * as THREE from "three";
import { Builder } from "../items/models";
import { paintedModel, disposeModel } from "./models";
import { wingSpec, type WingId } from "./catalog";

const GOLD = "#f3c869";

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

/** Two merged, outlined pieces per side, attached to the existing flapping joints. */
export function buildWing(id: WingId, hand: number) {
  const side = 1;
  const spec = wingSpec(id), inner = new Builder(), outer = new Builder();
  const count = spec.shape === "stars" ? 6 : spec.shape === "sail" ? 3 : 7;
  const rainbow = ["#bd8bc9", "#8d9fdf", "#73cbd5", "#8bd0b0", "#efc681", "#e49fb7", "#b48dd3"];
  for (const [builder, base, n] of [[inner, .65, 4], [outer, 1, count]] as const) {
    for (let i = 0; i < n; i++) {
      const a = builder === inner ? -.75 - i * .22 : .14 - i * (1.1 / Math.max(1, n - 1));
      const angle = side > 0 ? a : Math.PI - a;
      const length = base * (1 - i * .055), x = (builder === inner ? .08 + i * .1 : .05 + i * .026) * side;
      const y = -i * .026, color = id === "prism" ? rainbow[i % rainbow.length] : i % 2 ? spec.accent : spec.color;
      const width = spec.shape === "sail" ? .29 : spec.shape === "fin" ? .22 : .13;
      if (spec.shape === "stars") {
        for (let j = 0; j < 4; j++) {
          const f = .12 + j * .23;
          builder.add(star(j % 2 ? .048 : .072, .022, .015), j % 2 ? spec.accent : color, .3,
            [x + Math.cos(angle) * length * f, y + Math.sin(angle) * length * f, .012 + i * .006], [0, 0, j * .5]);
        }
      } else builder.add(blade(length, width, spec.shape), color, 0, [x, y, i * .006], [0, 0, angle]);
      // Each feather carries its own fine gilded spine and jewel tip.
      builder.add(new THREE.BoxGeometry(length * .72, .009, .012), GOLD, .2,
        [x + Math.cos(angle) * length * .36, y + Math.sin(angle) * length * .36, .028 + i * .006], [0, 0, angle]);
      if (builder === outer) {
        const tx = x + Math.cos(angle) * length * .78, ty = y + Math.sin(angle) * length * .78;
        builder.add(spec.shape === "stars" ? star(.052, .023, .014) : new THREE.OctahedronGeometry(.034, 0), spec.accent, .45, [tx, ty, .04 + i * .006]);
      }
    }
    // Layered coverts soften the mechanical root and make the fan read as crafted plumage.
    for (let i = 0; i < 4; i++) builder.add(blade(.25, .075, "feather"), spec.accent, 0,
      [side * (.07 + i * .075), -.02, .055], [0, 0, side > 0 ? -.9 : Math.PI + .9]);
  }
  if (id === "gale" || id === "tide") {
    outer.add(new THREE.TorusGeometry(.17, .009, 5, 20, Math.PI * 1.65), GOLD, .25, [side * .4, -.15, .07], [0, 0, side * -.3]);
    for (let i = 0; i < 5; i++) outer.add(new THREE.SphereGeometry(.023, 8, 6), "#fff2d8", .2, [side * (.22 + i * .08), -.27 - Math.sin(i) * .05, .055]);
  }
  if (id === "frost" || id === "storm") {
    for (let i = 0; i < 3; i++) outer.add(new THREE.BoxGeometry(.23, .012, .015), spec.accent, .25, [side * .4, -.2, .065], [0, 0, i * Math.PI / 3]);
  }
  const inside = paintedModel(inner), outside = paintedModel(outer);
  inside.scale.x = outside.scale.x = hand;
  inside.name = `${id}-inner`; outside.name = `${id}-outer`;
  return { inner: inside, outer: outside, dispose: () => { disposeModel(inside); disposeModel(outside); } };
}

/** Small paired wing token, also used by the test viewer. */
export function wingToken(id: WingId) {
  const group = new THREE.Group();
  for (const side of [-1, 1]) {
    const model = buildWing(id, side); model.outer.position.x = .54 * side;
    group.add(model.inner, model.outer);
  }
  return group;
}
