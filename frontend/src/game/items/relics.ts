import * as THREE from "three";
import { Builder, GOLD, GOLD_DEEP, blend, cyl, lathe, leaf, sphere, star } from "./builder";

// Models of the design list's items (CLAUDE.md, "Items and abilities"), in
// the same painted-primitive style as models.ts: toon-shaded, inked, gold
// trims, glowing where they hold magic. Units match the pilot's hand (an item
// is a hand's length or two); `y` is up, `-z` the front. The giant firework
// (the Comet Tail Firework) is in models.ts.

export type RelicId = "anemoCatcher" | "starflakeShield" | "gliderWax" | "spiritLantern" | "echoConch" | "phoenixFeather" | "silkRibbon" | "vortexGeode" | "aeroBoots";

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

/** The Starflake Shield: a six-pointed crystal of ice, a smaller star turned inside it, a bright heart */
function starflakeShield(): THREE.BufferGeometry {
  const b = new Builder();
  b.add(star(0.12, 0.045, 0.026, 6), (p, out) => blend("#eafcff", "#7fd3ff", Math.hypot(p.x, p.y) * 9, out), 0.6);
  b.add(star(0.075, 0.03, 0.04, 6), (p, out) => blend("#ffffff", "#bfeaff", Math.hypot(p.x, p.y) * 12, out), 0.9, [0, 0, 0], [0, 0, Math.PI / 6]);
  b.add(new THREE.OctahedronGeometry(0.03, 0), "#ffffff", 1, [0, 0, 0], [0, 0, 0], [1, 1, 1.6]);
  // Little frost buds between the points
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    b.add(new THREE.OctahedronGeometry(0.014, 0), "#d8f6ff", 0.8, [Math.cos(a) * 0.07, Math.sin(a) * 0.07, 0]);
  }
  return b.build();
}

/** Luminescent Glider Wax: a little round tin of glowing golden wax, its lid tipped open, a feather to spread it */
function gliderWax(): THREE.BufferGeometry {
  const b = new Builder();
  // The tin: brass with an engraved band of waves
  b.add(cyl(0.075, 0.07, 0.05, 28, 3), (p, out) => {
    const a = Math.atan2(p.z, p.x);
    const band = Math.abs(p.y) < 0.012 && Math.sin(a * 12 + p.y * 200) > 0;
    out.set(band ? "#fff0b8" : p.y < -0.02 ? GOLD_DEEP : GOLD);
  }, 0.15);
  b.add(new THREE.TorusGeometry(0.075, 0.006, 6, 30), GOLD_DEEP, 0.1, [0, 0.025, 0], [Math.PI / 2, 0, 0]);
  // The wax inside, glowing like honey in sunlight, with a swirl where it was scooped
  b.add(cyl(0.068, 0.068, 0.008, 28), (p, out) => {
    const r = Math.hypot(p.x, p.z);
    const swirl = Math.sin(Math.atan2(p.z, p.x) * 2 + r * 90);
    blend("#fff6c9", "#ffcf5a", r * 12 + swirl * 0.25, out);
  }, 1, [0, 0.022, 0]);
  // The lid, tipped up against the back, with a sun on it
  b.add(cyl(0.078, 0.078, 0.012, 28), GOLD, 0.15, [0, 0.06, 0.07], [1.25, 0, 0]);
  b.add(star(0.03, 0.014, 0.008, 8), "#fff3c4", 0.8, [0, 0.07, 0.065], [1.25 - Math.PI / 2, 0, 0]);
  // A small white feather, its tip dipped gold
  b.add(leaf(0.15, 0.03, 0.006), (p, out) => blend("#ffffff", "#ffd36e", (p.y - 0.09) * 18, out), 0.5, [0.03, 0.03, -0.02], [0.4, 0.3, -0.5]);
  b.add(sphere(0.006, 6, 5), GOLD_DEEP, 0.2, [0.03, 0.03, -0.02]);
  return b.build();
}

function spiritLantern(): THREE.BufferGeometry {
  const b = new Builder();
  b.add(cyl(0.09,0.065,0.18,8), "#ffe6ad", 0.8, [0,0.1,0]);
  for(const y of [0.01,0.19]) b.add(cyl(0.105,0.105,0.025,8), GOLD,0.2,[0,y,0]);
  for(let i=0;i<8;i++){const a=i*Math.PI/4;b.add(cyl(0.005,0.005,0.18,5),GOLD_DEEP,0,[Math.cos(a)*0.09,0.1,Math.sin(a)*0.09]);}
  b.add(new THREE.TorusGeometry(0.05,0.007,5,16),GOLD,0.1,[0,0.25,0]);
  b.add(leaf(0.1,0.018,0.006),"#d47b63",0,[0,0,0],[0,0,Math.PI]);
  return b.build();
}

function echoConch(): THREE.BufferGeometry {
 const b=new Builder();
 for(let i=0;i<14;i++){const a=i*0.6;const r=0.018+i*0.005;b.add(sphere(0.011+i*0.002,10,8),i%2 ? "#fff4de":"#efb8a7",0.2,[Math.cos(a)*r,0.04+Math.sin(a)*r,i*0.004]);}
 b.add(new THREE.TorusGeometry(0.039,0.014,7,20),"#f7d3ba",0.2,[0.08,0.03,0.06],[0,0.6,0],[1,1.5,1]);
 b.add(star(0.012,0.005,0.006,4),GOLD,0.8,[0.06,0.08,0.03]);return b.build();
}

function phoenixFeather(): THREE.BufferGeometry {
 const b=new Builder();
 b.add(cyl(0.004,0.003,0.24,6),GOLD,0.4,[0,0.1,0],[0,0,-0.15]);
 for(let i=0;i<7;i++)for(const side of [-1,1])b.add(leaf(0.09-i*0.006,0.024,0.006),i>4 ? "#fff3ac" : side<0 ? "#ff945e":"#ffcf69",0.7,[0,0.01+i*0.028,0],[0,side*0.2,side*-0.9]);
 b.add(star(0.026,0.009,0.01,4),"#fff3c5",1,[0.03,0.2,0]);return b.build();
}

function silkRibbon(): THREE.BufferGeometry {
 const b=new Builder();
 for(const side of [-1,1])b.add(new THREE.TorusGeometry(0.046,0.012,6,20),side<0 ? "#b9a3ef":"#d6c5fa",0.2,[side*0.04,0.04,0],[0.2,0,side*0.3],[1,0.7,1]);
 b.add(sphere(0.024,10,8),GOLD,0.3,[0,0.04,0]);
 for(const side of [-1,1])b.add(leaf(0.17,0.026,0.008),"#b9a3ef",0.2,[side*0.012,0.025,0],[0.2,0,Math.PI+side*0.25]);return b.build();
}

function vortexGeode(): THREE.BufferGeometry {
 const b=new Builder();b.add(new THREE.DodecahedronGeometry(0.09,0),"#6b607e",0);
 b.add(new THREE.IcosahedronGeometry(0.063,0),"#b9a3ef",0.8,[0,0,-0.045]);
 for(let i=0;i<8;i++){const a=i*Math.PI/4;b.add(new THREE.OctahedronGeometry(0.025,0),i%2 ? "#e3d5ff":"#8ecff5",0.9,[Math.cos(a)*0.06,Math.sin(a)*0.06,-0.07],[0,0,a],[1,1.4,1]);}return b.build();
}

function aeroBoots(): THREE.BufferGeometry {
 const b=new Builder();b.add(cyl(0.055,0.05,0.16,10),"#fff0d4",0,[0,0.07,0]);
 b.add(sphere(0.06,12,8),"#718eb8",0,[0,-0.025,-0.035],[0,0,0],[0.9,0.6,1.5]);
 b.add(cyl(0.061,0.061,0.023,10),GOLD,0.2,[0,0.15,0]);
 for(const side of [-1,1])for(let i=0;i<3;i++)b.add(leaf(0.08-i*0.016,0.02,0.006),"#f7faff",0.3,[side*0.05,0.08+i*0.012,0.02],[0,side*0.4,side*-1.1]);return b.build();
}

export const RELIC_BUILDERS: Record<RelicId, () => THREE.BufferGeometry> = {
  aeroBoots,
  vortexGeode,
  silkRibbon,
  phoenixFeather,
  echoConch,
  spiritLantern,
  anemoCatcher,
  starflakeShield,
  gliderWax,
};
