import * as THREE from "three";
import { Builder, GOLD, blend, cyl, lathe, leaf, star } from "./builder";

// Models of the design list's items (CLAUDE.md, "Items and abilities"), in
// the same painted-primitive style as models.ts: toon-shaded, inked, gold
// trims, glowing where they hold magic. Units match the pilot's hand (an item
// is a hand's length or two); `y` is up, `-z` the front. The giant firework
// (the Comet Tail Firework) is in models.ts.

export type RelicId = "anemoCatcher";

const ANEMO = "#5fe6c6";
const ANEMO_LIGHT = "#c8fff1";

/** The Anemo Catcher: a round glass bottle with a swirl of wind inside, a cork and a ribbon */
function anemoCatcher(): THREE.BufferGeometry {
  const b = new Builder();
  // The bottle: pale glass, the wind inside showing through as swirling teal bands
  b.add(
    lathe([[0.001, 0], [0.06, 0.004], [0.085, 0.035], [0.092, 0.085], [0.078, 0.135], [0.042, 0.168], [0.03, 0.19], [0.03, 0.225], [0.036, 0.232], [0.001, 0.232]], 28),
    (p, out) => {
      const a = Math.atan2(p.z, p.x);
      const swirl = Math.sin(a * 2 + p.y * 46);
      if (p.y > 0.17) out.set("#e8fffb");
      else if (swirl > 0.55) blend(ANEMO, ANEMO_LIGHT, (swirl - 0.55) * 1.6, out);
      else blend("#dffcf6", "#ffffff", Math.max(0, -p.x * 9), out);
    },
    0.45,
  );
  // A gold ring round the neck, the cork, and a string tied under it
  b.add(new THREE.TorusGeometry(0.033, 0.008, 6, 18), GOLD, 0.3, [0, 0.19, 0], [Math.PI / 2, 0, 0]);
  b.add(cyl(0.03, 0.026, 0.05, 12), (p, out) => blend("#a8744f", "#d6a777", p.y * 14 + 0.4, out), 0, [0, 0.25, 0]);
  b.add(new THREE.TorusGeometry(0.036, 0.005, 5, 16), "#f7f1e0", 0, [0, 0.205, 0], [Math.PI / 2, 0, 0]);
  // A teal bow at the neck, and the wind's emblem on the front (a four-pointed star)
  for (const s of [1, -1]) b.add(leaf(0.06, 0.03, 0.006), ANEMO, 0.3, [s * 0.02, 0.2, -0.03], [0.4, 0, s * -1.6]);
  b.add(leaf(0.07, 0.016, 0.006), ANEMO, 0.3, [0.005, 0.2, -0.033], [0.2, 0, 2.9]);
  b.add(star(0.034, 0.012, 0.01, 4), ANEMO_LIGHT, 1, [0, 0.085, -0.093], [0, 0, Math.PI / 4]);
  return b.build();
}

export const RELIC_BUILDERS: Record<RelicId, () => THREE.BufferGeometry> = {
  anemoCatcher,
};
