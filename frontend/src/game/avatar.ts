import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { outlineMaterial, toonMaterial } from "./toon";
import { ATMOSPHERE } from "./world/atmosphere";
import { ANIM, FX, COSMETIC_FX } from "./tuning";
import { clamp, smoothstep } from "./math";
import { DISSOLVE_AT, type DeathKind, WING_POINTS } from "./death";
import type { ItemSlot } from "./items/models";
import { capeSpec, type CapeId, type WingId } from "./cosmetics/catalog";
import { buildWing } from "./cosmetics/wings";
import type { Appearance } from "./cosmetics/storage";
import { buildHat, buildShoe, disposeModel } from "./cosmetics/models";

// The pilot: a small cel-shaded flyer with Genshin / Sky proportions (a big
// head, slim limbs), a Sky-style cape, a scarf, and a pair of feathered
// glider wings on the back. Everything is built from primitives at runtime.
//
// The body is modelled standing (up +y, facing -z, right +x) and then laid
// prone, so the head points along the flight direction (-z) and the back faces
// up. The caller places `group` at the flight model's position and rotation;
// everything the animation adds (rolls, bobbing, flaps) happens inside it.

const SCALE = 1.55;
const TAU = Math.PI * 2;

// --- colors ----------------------------------------------------------------------

interface Tones {
  skin: THREE.Color;
  blush: THREE.Color;
  hair: THREE.Color;
  hairShine: THREE.Color;
  cloth: THREE.Color;
  clothLight: THREE.Color;
  clothDark: THREE.Color;
  trim: THREE.Color;
  dark: THREE.Color;
  white: THREE.Color;
  eye: THREE.Color;
  tip: THREE.Color;
}

type ToneName = keyof Tones;
/** A flat tone, or a function of the vertex position (in the part's space) and its index */
type Paint = ToneName | ((p: THREE.Vector3, tones: Tones, out: THREE.Color, index: number) => void);

function tonesFor(color: string): Tones {
  const cloth = new THREE.Color(color);
  const white = new THREE.Color("#fbf6ec");
  const hsl = { h: 0, s: 0, l: 0 };
  cloth.getHSL(hsl);
  return {
    skin: new THREE.Color("#ffe1cf"),
    blush: new THREE.Color("#ffa9a4"),
    hair: new THREE.Color("#3d2c4f").lerp(cloth, 0.12),
    hairShine: new THREE.Color("#7a5d8f").lerp(cloth, 0.2),
    cloth,
    clothLight: cloth.clone().lerp(white, 0.55),
    clothDark: new THREE.Color().setHSL(hsl.h, Math.min(1, hsl.s * 0.9), hsl.l * 0.5),
    trim: new THREE.Color("#f3c869"),
    dark: new THREE.Color("#3a3245"),
    white,
    eye: new THREE.Color("#2b2140"),
    tip: new THREE.Color().setHSL((hsl.h + 0.08) % 1, 0.75, 0.72),
  };
}

// --- geometry helpers --------------------------------------------------------------

const euler = new THREE.Euler();
const m4 = new THREE.Matrix4();
const q = new THREE.Quaternion();
const v3 = new THREE.Vector3();
const s3 = new THREE.Vector3();

type Vec = [number, number, number];

function place(geometry: THREE.BufferGeometry, at: Vec = [0, 0, 0], rot: Vec = [0, 0, 0], scale: Vec = [1, 1, 1]) {
  m4.compose(v3.set(...at), q.setFromEuler(euler.set(...rot)), s3.set(...scale));
  return geometry.applyMatrix4(m4);
}

/** Collects primitives into one mesh with per-vertex colors, so each body part is one draw call */
class PartBuilder {
  private readonly items: { geometry: THREE.BufferGeometry; paint: Paint }[] = [];

  add(geometry: THREE.BufferGeometry, paint: Paint, at?: Vec, rot?: Vec, scale?: Vec): this {
    place(geometry, at, rot, scale);
    const flat = geometry.index ? geometry.toNonIndexed() : geometry;
    if (flat !== geometry) geometry.dispose();
    for (const name of Object.keys(flat.attributes)) {
      if (name !== "position" && name !== "normal") flat.deleteAttribute(name);
    }
    this.items.push({ geometry: flat, paint });
    return this;
  }

  build(): Painted {
    const geometry = mergeGeometries(this.items.map((i) => i.geometry))!;
    const ranges: PaintRange[] = [];
    let start = 0;
    for (const item of this.items) {
      const count = item.geometry.getAttribute("position").count;
      ranges.push({ start, count, paint: item.paint });
      start += count;
      item.geometry.dispose();
    }
    geometry.setAttribute("color", new THREE.Float32BufferAttribute(new Float32Array(start * 3), 3));
    geometry.setAttribute("glow", new THREE.Float32BufferAttribute(new Float32Array(start), 1));
    geometry.computeBoundingSphere();
    return { geometry, ranges };
  }
}

interface PaintRange {
  start: number;
  count: number;
  paint: Paint;
}

interface Painted {
  geometry: THREE.BufferGeometry;
  ranges: PaintRange[];
}

const paintColor = new THREE.Color();
const paintPoint = new THREE.Vector3();

/** How close two colors are, 1 = the same */
function likeness(a: THREE.Color, b: THREE.Color): number {
  const d = Math.hypot(a.r - b.r, a.g - b.g, a.b - b.b);
  return 1 - smoothstep(0.03, 0.22, d);
}

/** Writes vertex colors, and a glow for the gold trims and the wingtips (they light up at night) */
function applyPaint({ geometry, ranges }: Painted, tones: Tones) {
  const position = geometry.getAttribute("position");
  const color = geometry.getAttribute("color") as THREE.BufferAttribute;
  const glow = geometry.getAttribute("glow") as THREE.BufferAttribute;
  for (const { start, count, paint } of ranges) {
    for (let i = start; i < start + count; i++) {
      if (typeof paint === "string") paintColor.copy(tones[paint]);
      else paint(paintPoint.fromBufferAttribute(position, i), tones, paintColor, i - start);
      color.setXYZ(i, paintColor.r, paintColor.g, paintColor.b);
      glow.setX(i, Math.max(likeness(paintColor, tones.trim), likeness(paintColor, tones.tip) * 0.8));
    }
  }
  color.needsUpdate = true;
  glow.needsUpdate = true;
}

/** A leaf-shaped feather with a little thickness, lying along +x */
function feather(length: number, width: number): THREE.BufferGeometry {
  const shape = new THREE.Shape();
  shape.moveTo(0, -width * 0.5);
  shape.quadraticCurveTo(length * 0.55, -width * 0.75, length, 0);
  shape.quadraticCurveTo(length * 0.55, width * 0.75, 0, width * 0.5);
  shape.closePath();
  const geometry = new THREE.ExtrudeGeometry(shape, { depth: 0.014, bevelEnabled: false, curveSegments: 5 });
  geometry.translate(0, 0, -0.007);
  return geometry;
}

const sphere = (r: number, w = 14, h = 10) => new THREE.SphereGeometry(r, w, h);
const capsule = (r: number, length: number) => new THREE.CapsuleGeometry(r, length, 4, 10, 1);
const cyl = (top: number, bottom: number, h: number, n = 10) => new THREE.CylinderGeometry(top, bottom, h, n, 1);
const lathe = (profile: [number, number][], n = 14) =>
  new THREE.LatheGeometry(
    profile.map(([r, y]) => new THREE.Vector2(r, y)),
    n,
  );

// --- cloth -------------------------------------------------------------------------

type ClothShape = (u: number, v: number, out: THREE.Vector3) => void;

/** Height on a triangle projected into cloth's (x, y) plane. */
function clothHeight(triangle: THREE.Triangle, x: number, y: number, inside = false): number {
  const { a, b, c } = triangle;
  const determinant = (b.y - c.y) * (a.x - c.x) + (c.x - b.x) * (a.y - c.y);
  if (Math.abs(determinant) < 1e-10) return -Infinity;
  const u = ((b.y - c.y) * (x - c.x) + (c.x - b.x) * (y - c.y)) / determinant;
  const v = ((c.y - a.y) * (x - c.x) + (a.x - c.x) * (y - c.y)) / determinant;
  if (inside && (u < -1e-7 || v < -1e-7 || u + v > 1 + 1e-7)) return -Infinity;
  return u * a.z + v * b.z + (1 - u - v) * c.z;
}

/** A grid of vertices moved procedurally every frame: the cape and the scarf tails */
class Cloth {
  readonly mesh: THREE.Mesh;
  readonly painted: Painted;
  private readonly cols: number;
  private readonly rows: number;
  private readonly point = new THREE.Vector3();
  private readonly clearance: Float32Array;
  private bounds: Float32Array | null = null;
  private readonly ribbonTriangle = new THREE.Triangle();
  private readonly surfaceTriangle = new THREE.Triangle();
  private readonly ribbonCorners = [this.ribbonTriangle.a, this.ribbonTriangle.b, this.ribbonTriangle.c];
  private readonly surfaceCorners = [this.surfaceTriangle.a, this.surfaceTriangle.b, this.surfaceTriangle.c];

  constructor(cols: number, rows: number, paint: (u: number, v: number, tones: Tones, out: THREE.Color) => void, material: THREE.Material) {
    this.cols = cols;
    this.rows = rows;
    this.clearance = new Float32Array((cols + 1) * (rows + 1));
    const geometry = new THREE.PlaneGeometry(1, 1, cols, rows);
    geometry.deleteAttribute("uv");
    // Keep (u, v) per vertex so the paint can use them
    const uv = new Float32Array((cols + 1) * (rows + 1) * 3);
    for (let r = 0; r <= rows; r++) {
      for (let c = 0; c <= cols; c++) uv.set([(c / cols) * 2 - 1, r / rows, 0], (r * (cols + 1) + c) * 3);
    }
    const uvAttribute = new THREE.BufferAttribute(uv, 3);
    geometry.setAttribute("color", new THREE.Float32BufferAttribute(new Float32Array(uv.length), 3));
    geometry.setAttribute("glow", new THREE.Float32BufferAttribute(new Float32Array(uv.length / 3), 1));
    (geometry.getAttribute("position") as THREE.BufferAttribute).setUsage(THREE.DynamicDrawUsage);
    this.painted = {
      geometry,
      ranges: [
        {
          start: 0,
          count: uv.length / 3,
          // The positions move, so paint from each vertex's (u, v)
          paint: (_p, tones, out, i) => paint(uvAttribute.getX(i), uvAttribute.getY(i), tones, out),
        },
      ],
    };
    this.mesh = new THREE.Mesh(geometry, material);
    this.mesh.frustumCulled = false;
  }

  update(shape: ClothShape) {
    const position = this.mesh.geometry.getAttribute("position") as THREE.BufferAttribute;
    for (let r = 0; r <= this.rows; r++) {
      for (let c = 0; c <= this.cols; c++) {
        shape((c / this.cols) * 2 - 1, r / this.rows, this.point);
        this.point.toArray(position.array, (r * (this.cols + 1) + c) * 3);
      }
    }
    position.needsUpdate = true;
    this.mesh.geometry.computeVertexNormals();
  }

  /** Each triangle's bounds projected into (x, y): min x, max x, min y, max y */
  private projectedBounds(): Float32Array {
    const p = this.mesh.geometry.getAttribute("position").array as Float32Array;
    const index = this.mesh.geometry.index!.array;
    const bounds = (this.bounds ??= new Float32Array((index.length / 3) * 4));
    for (let j = 0, o = 0; j < index.length; j += 3, o += 4) {
      const d = index[j] * 3, e = index[j + 1] * 3, f = index[j + 2] * 3;
      bounds[o] = Math.min(p[d], p[e], p[f]);
      bounds[o + 1] = Math.max(p[d], p[e], p[f]);
      bounds[o + 2] = Math.min(p[d + 1], p[e + 1], p[f + 1]);
      bounds[o + 3] = Math.max(p[d + 1], p[e + 1], p[f + 1]);
    }
    return bounds;
  }

  /** Lift ribbons above another cloth mesh, including crossings between vertices. */
  keepAbove(surface: Cloth, gap: number) {
    const position = this.mesh.geometry.getAttribute("position") as THREE.BufferAttribute;
    // Straight from the buffers: this runs for every pair of triangles, every frame
    const p = position.array as Float32Array;
    const sp = surface.mesh.geometry.getAttribute("position").array as Float32Array;
    const index = this.mesh.geometry.index!.array;
    const surfaceIndex = surface.mesh.geometry.index!.array;
    const surfaceBounds = surface.projectedBounds();
    this.clearance.fill(0);
    for (let i = 0; i < index.length; i += 3) {
      for (let k = 0; k < 3; k++) this.ribbonCorners[k].fromArray(p, index[i + k] * 3);
      const [a, b, c] = this.ribbonCorners;
      const minX = Math.min(a.x, b.x, c.x), maxX = Math.max(a.x, b.x, c.x);
      const minY = Math.min(a.y, b.y, c.y), maxY = Math.max(a.y, b.y, c.y);
      let lift = 0;
      for (let j = 0, o = 0; j < surfaceIndex.length; j += 3, o += 4) {
        if (surfaceBounds[o + 1] < minX || surfaceBounds[o] > maxX || surfaceBounds[o + 3] < minY || surfaceBounds[o + 2] > maxY) continue;
        for (let k = 0; k < 3; k++) this.surfaceCorners[k].fromArray(sp, surfaceIndex[j + k] * 3);

        // The height difference is linear on each triangle. Its maximum lies
        // at a vertex of their projected intersection: an enclosed corner or
        // an edge crossing. Checking both covers the whole ribbon triangle.
        for (const p of this.ribbonCorners) {
          lift = Math.max(lift, clothHeight(this.surfaceTriangle, p.x, p.y, true) + gap - p.z);
        }
        for (const p of this.surfaceCorners) {
          const height = clothHeight(this.ribbonTriangle, p.x, p.y, true);
          if (height !== -Infinity) lift = Math.max(lift, p.z + gap - height);
        }
        for (let k = 0; k < 3; k++) {
          const p = this.ribbonCorners[k], q = this.ribbonCorners[(k + 1) % 3];
          const rx = q.x - p.x, ry = q.y - p.y;
          for (let l = 0; l < 3; l++) {
            const s = this.surfaceCorners[l], t = this.surfaceCorners[(l + 1) % 3];
            const sx = t.x - s.x, sy = t.y - s.y;
            const determinant = rx * sy - ry * sx;
            if (Math.abs(determinant) < 1e-10) continue;
            const dx = s.x - p.x, dy = s.y - p.y;
            const along = (dx * sy - dy * sx) / determinant;
            const across = (dx * ry - dy * rx) / determinant;
            if (along < 0 || along > 1 || across < 0 || across > 1) continue;
            const x = p.x + along * rx, y = p.y + along * ry;
            lift = Math.max(lift, clothHeight(this.surfaceTriangle, x, y) + gap - clothHeight(this.ribbonTriangle, x, y));
          }
        }
      }
      // Accumulate first: all three corners must move by at least this lift,
      // and neighboring triangles share the larger correction without seams.
      for (let k = 0; k < 3; k++) {
        const vertex = index[i + k];
        this.clearance[vertex] = Math.max(this.clearance[vertex], lift);
      }
    }
    for (let i = 0; i < position.count; i++) p[i * 3 + 2] += this.clearance[i];
    position.needsUpdate = true;
    this.mesh.geometry.computeVertexNormals();
  }

  /** The middle of the hem, in the cloth's space */
  tip(shape: ClothShape, out: THREE.Vector3): THREE.Vector3 {
    shape(0, 1, out);
    return out;
  }
}

// --- the avatar --------------------------------------------------------------------

export interface AvatarOptions {
  ghost?: boolean;
}

interface Side {
  innerMesh: THREE.Mesh;
  outerMesh: THREE.Mesh;
  boot: THREE.Mesh;
  shoulder: THREE.Object3D;
  elbow: THREE.Object3D;
  hip: THREE.Object3D;
  knee: THREE.Object3D;
  wing: THREE.Object3D;
  wingOuter: THREE.Object3D;
  tip: THREE.Object3D;
  /** The tip of the last (innermost) primary, the wing's trailing corner */
  trail: THREE.Object3D;
}

const localOmega = new THREE.Vector3();
const dq = new THREE.Quaternion();
const prevInverse = new THREE.Quaternion();
const forwardTmp = new THREE.Vector3();
const elbowTmp = new THREE.Vector3();

function springStep(value: number, velocity: number, target: number, stiffness: number, damping: number, dt: number) {
  const c = 2 * damping * Math.sqrt(stiffness);
  const a = stiffness * (target - value) - c * velocity;
  const v = velocity + a * dt;
  return [value + v * dt, v];
}

const smoother = (t: number) => t * t * t * (t * (t * 6 - 15) + 10);

export class Avatar {
  /** Place this at the flight model's position and rotation */
  readonly group = new THREE.Group();
  /** Fires on each downstroke of the wings, with how hard it was (0..1) */
  onDownstroke?: (strength: number) => void;

  private readonly rig = new THREE.Group();
  private readonly body = new THREE.Group();
  private readonly pelvis = new THREE.Object3D();
  private readonly chest = new THREE.Object3D();
  private readonly head = new THREE.Object3D();
  private readonly pony: THREE.Object3D[] = [];
  /** The two hair-and-eyes styles under the head; one is shown */
  private readonly styles: THREE.Object3D[] = [];
  private style: 1 | 2 = 1;
  private readonly left: Side;
  private readonly right: Side;
  private readonly cape: Cloth;
  private capeId: CapeId = "classic";
  private hat: THREE.Group | null = null;
  private shoes: THREE.Group[] = [];
  private appearance: Appearance = { cape: "classic", hat: "none", shoes: "classic", wings: "classic", pet: "none" };
  private wingModels: ReturnType<typeof buildWing>[] = [];
  get wingStyle(): WingId { return this.appearance.wings; }
  private readonly scarf: Cloth[];
  // Conservative bounds of the animated legs, reused for cloth self-collision.
  private readonly clothObstacles: { mesh: THREE.Mesh; local: THREE.Box3; bounds: THREE.Box3 }[] = [];
  private readonly clothInverse = new THREE.Matrix4();
  private readonly clothMatrix = new THREE.Matrix4();
  private readonly painted: Painted[] = [];
  private readonly outlines: THREE.Mesh[] = [];
  private readonly materials: THREE.Material[] = [];
  private readonly aura: THREE.Sprite;
  private tones: Tones;
  private readonly ghost: boolean;

  // Animation state
  private readonly lastQuaternion = new THREE.Quaternion();
  private hasLast = false;
  private pitchRate = 0;
  private yawRate = 0;
  private rollRate = 0;
  private lean = 0;
  private leanVelocity = 0;
  private effort = 0.3;
  private flapPhase = 0;
  private lastFlap = 0;
  private barrel = { t: -1, dir: 1 };
  private speed = 30;
  boost = 0;
  brake = 0;
  private boostOn = false;

  setSpeedControls(boost: number, brake: number) {
    if (boost > 0.1 && !this.boostOn) { this.flapPhase = 0; this.beat(); }
    this.boostOn = boost > 0.1;
    this.boost = boost;
    this.brake = brake;
  }

  resetMotion() {
    this.hasLast = false;
    this.pitchRate = this.yawRate = this.rollRate = 0;
    this.lean = this.leanVelocity = 0;
    this.barrel.t = -1;
    this.barrelProgress = -1;
    this.boost = this.brake = 0;
    this.boostOn = false;
  }
  private climb = 0;
  private time = 0;
  private clothTime = 0;
  private detailed = true;
  /** 0..1 while a barrel roll is under way */
  barrelProgress = -1;
  /** Where carried items go: on the back (the firework), on the head (helmets), in the right hand */
  readonly slots: Record<ItemSlot, THREE.Object3D>;
  /** The right and left shin, for boots */
  readonly feet: [THREE.Object3D, THREE.Object3D];
  /**
   * Blends the right arm towards a pose, for item animations (items/equip.ts):
   * `amount` 0..1, shoulder angles in radians (z raises the arm towards the
   * head, x swings it to the back), `elbow` bends the forearm
   */
  readonly armPose = { amount: 0, x: 0, y: 0, z: 0, elbow: 0 };
  /**
   * Whole-body poses for a run's abilities (game/abilities/), each 0..1 and
   * eased by whoever sets them: `tuck` dives like a falling star (Plunging
   * Attack), `hover` hangs upright with the wings fluttering (Hover-Stall),
   * `cast` throws both arms forward and flares the wings (Gale Force), `surf`
   * crouches low with a hand trailing through the clouds (Cloud-Surfing),
   * `climb` reaches for the sky on hard wingbeats (Zenith Climber), `sing`
   * throws the head back and the arms open (Resonance), `flare` rears up
   * with cape and wings thrown forward (Aero-Braking), `falcon` tucks the
   * wings back like a stooping falcon, `butterfly` spreads cape and wings
   * wide on slow, deep beats (the gliding stances), `stand` stands upright on the ground with wings
   * folded down the back and arms at the sides (the inventory's figurine and pilot pages; never in flight)
   */
  readonly stance = { tuck: 0, hover: 0, cast: 0, surf: 0, climb: 0, sing: 0, flare: 0, falcon: 0, butterfly: 0, stand: 0 };
  /** How far each wing (left, right) is folded in during a crash, to keep it out of rock it is wedged against (0..1) */
  private readonly folded = [0, 0];
  /** A crash playing out: the body flails, then goes limp (Game moves `group`) */
  private death: { kind: DeathKind; t: number; side: number } | null = null;

  constructor(color: string, options: AvatarOptions = {}) {
    this.ghost = !!options.ghost;
    this.tones = tonesFor(color);
    const ghost = this.ghost;
    const skinMat = this.material(toonMaterial({ ghost }));
    const clothMat = this.material(toonMaterial({ ghost, side: THREE.DoubleSide, rim: 0.3 }));
    const wingMat = this.material(toonMaterial({ ghost, side: THREE.DoubleSide, rim: 0.3, rimColor: "#ffffff" }));
    const ink = ghost ? null : this.material(outlineMaterial(0.012));

    this.group.add(this.rig);
    this.rig.add(this.body);
    this.rig.scale.setScalar(SCALE);
    // Lay the standing body prone: head forward (-z), back up (+y), centered on the hips
    this.body.rotation.x = -Math.PI / 2;
    const skeleton = new THREE.Group();
    skeleton.position.y = -0.74;
    this.body.add(skeleton);

    const part = (joint: THREE.Object3D, builder: PartBuilder, material = skinMat, outline = true) => {
      const painted = builder.build();
      this.painted.push(painted);
      const mesh = new THREE.Mesh(painted.geometry, material);
      joint.add(mesh);
      if (ink && outline) {
        const outline = new THREE.Mesh(painted.geometry, ink);
        mesh.add(outline);
        this.outlines.push(outline);
      }
      return mesh;
    };
    const clothObstacle = (mesh: THREE.Mesh) => {
      mesh.geometry.computeBoundingBox();
      this.clothObstacles.push({ mesh, local: mesh.geometry.boundingBox!.clone(), bounds: new THREE.Box3() });
      return mesh;
    };

    // Pelvis: a flared tunic hem, belt and buckle
    this.pelvis.position.set(0, 0.74, 0);
    skeleton.add(this.pelvis);
    part(
      this.pelvis,
      new PartBuilder()
        .add(
          lathe([
            [0.001, 0.07],
            [0.095, 0.07],
            [0.112, -0.02],
            [0.135, -0.1],
            [0.138, -0.12],
            [0.001, -0.12],
          ]),
          (p, t, out) => out.copy(p.y < -0.085 ? t.trim : t.clothDark),
          [0, 0, 0],
          [0, 0, 0],
          [1, 1, 0.8],
        )
        .add(cyl(0.1, 0.1, 0.035, 14), "dark", [0, 0.06, 0], [0, 0, 0], [1, 1, 0.8])
        .add(new THREE.OctahedronGeometry(0.026, 0), "trim", [0, 0.06, -0.082]),
    );

    // Chest: torso, collar, neck, a little sash
    this.chest.position.set(0, 0.06, 0);
    this.pelvis.add(this.chest);
    part(
      this.chest,
      new PartBuilder()
        .add(
          lathe([
            [0.001, -0.02],
            [0.094, -0.02],
            [0.084, 0.06],
            [0.1, 0.15],
            [0.112, 0.21],
            [0.078, 0.26],
            [0.03, 0.285],
            [0.001, 0.285],
          ]),
          (p, t, out) => {
            // A white shirt panel down the front, cloth everywhere else
            out.copy(p.z < -0.04 && Math.abs(p.x) < 0.045 + p.y * 0.12 ? t.white : t.cloth);
          },
          [0, 0, 0],
          [0, 0, 0],
          [1, 1, 0.78],
        )
        .add(new THREE.TorusGeometry(0.05, 0.02, 6, 16), "trim", [0, 0.27, 0], [Math.PI / 2, 0, 0], [1, 1, 0.9])
        .add(cyl(0.034, 0.038, 0.07, 10), "skin", [0, 0.3, 0])
        .add(sphere(0.055, 10, 8), "clothLight", [0.1, 0.22, 0], [0, 0, 0], [1, 0.85, 0.85])
        .add(sphere(0.055, 10, 8), "clothLight", [-0.1, 0.22, 0], [0, 0, 0], [1, 0.85, 0.85]),
    );

    // Head: big and round, a soft jaw and cheeks under it, and the face drawn on in layers
    this.head.position.set(0, 0.32, 0);
    this.chest.add(this.head);
    const hair: Paint = (p, t, out) => out.copy(p.y > 0.12 && p.z < 0.02 ? t.hairShine : t.hair);
    const iris: Paint = (_p, t, out) => out.copy(t.eye).lerp(t.cloth, 0.5);
    const lip: Paint = (_p, t, out) => out.copy(t.blush).lerp(t.eye, 0.35);
    const nose: Paint = (_p, t, out) => out.copy(t.skin).lerp(t.blush, 0.3);
    part(this.head, new PartBuilder()
      .add(sphere(0.165, 20, 14), "skin", [0, 0.15, 0], [0, 0, 0], [1, 0.97, 0.98])
      // Cheeks and a small rounded chin give the face its front, so it takes light like a sculpted shape
      .add(sphere(0.13, 18, 12), "skin", [0, 0.09, -0.04], [0, 0, 0], [1.04, 0.84, 0.95])
      .add(sphere(0.045, 10, 8), "skin", [0.075, 0.085, -0.115], [0, 0, 0], [1, 0.85, 0.7])
      .add(sphere(0.045, 10, 8), "skin", [-0.075, 0.085, -0.115], [0, 0, 0], [1, 0.85, 0.7]));
    // Small features without ink, which would swallow them
    part(this.head, new PartBuilder()
      .add(sphere(0.013, 8, 6), nose, [0, 0.102, -0.166], [0, 0, 0], [0.85, 0.8, 1.25])
      .add(new THREE.TorusGeometry(0.017, 0.004, 4, 10, Math.PI * 0.75), lip, [0, 0.066, -0.158], [0.35, 0, Math.PI * 1.125])
      .add(sphere(0.02, 8, 6), "blush", [0.08, 0.09, -0.143], [0, 0.5, 0], [1.2, 0.6, 0.3])
      .add(sphere(0.02, 8, 6), "blush", [-0.08, 0.09, -0.143], [0, -0.5, 0], [1.2, 0.6, 0.3]), skinMat, false);

    // Two styles, swapped by `setStyle`: 1 has the ponytail, bangs and big lashed eyes; 2 short tousled hair and straighter brows
    for (const style of [1, 2] as const) {
      const look = new THREE.Object3D();
      look.visible = style === 1;
      this.head.add(look);
      this.styles.push(look);
      const one = style === 1;
      const hairBuilder = new PartBuilder()
        .add(new THREE.SphereGeometry(0.178, 20, 12, 0, TAU, 0, Math.PI * 0.58), hair, [0, 0.165, 0.008], [0.35, 0, 0]);
      if (one) {
        hairBuilder
          .add(sphere(0.12, 12, 8), hair, [0, 0.17, 0.07], [0, 0, 0], [1.3, 1.25, 1.1])
          // Side locks and bangs hang down (cones point up, so flip them)
          .add(new THREE.ConeGeometry(0.045, 0.17, 8), hair, [0.14, 0.06, -0.035], [Math.PI + 0.1, 0, -0.12])
          .add(new THREE.ConeGeometry(0.045, 0.17, 8), hair, [-0.14, 0.06, -0.035], [Math.PI + 0.1, 0, 0.12])
          .add(new THREE.ConeGeometry(0.038, 0.12, 7), hair, [0.065, 0.205, -0.125], [Math.PI + 0.45, 0, 0.3])
          .add(new THREE.ConeGeometry(0.04, 0.13, 7), hair, [-0.01, 0.21, -0.135], [Math.PI + 0.4, 0, -0.05])
          .add(new THREE.ConeGeometry(0.034, 0.11, 7), hair, [-0.085, 0.2, -0.12], [Math.PI + 0.45, 0, -0.35])
          .add(new THREE.ConeGeometry(0.018, 0.14, 6), hair, [0.02, 0.36, -0.01], [-0.7, 0, 0.2])
          // A tiny hair clip
          .add(new THREE.OctahedronGeometry(0.03, 0), "trim", [0.15, 0.22, -0.04], [0, 0, 0.6], [1, 1.4, 0.6]);
      } else {
        hairBuilder
          .add(sphere(0.115, 12, 8), hair, [0, 0.16, 0.06], [0, 0, 0], [1.32, 1.18, 1.08])
          // Short side burns and a tousled fringe swept to one side
          .add(new THREE.ConeGeometry(0.038, 0.1, 7), hair, [0.145, 0.1, -0.03], [Math.PI + 0.1, 0, -0.1])
          .add(new THREE.ConeGeometry(0.038, 0.1, 7), hair, [-0.145, 0.1, -0.03], [Math.PI + 0.1, 0, 0.1])
          .add(new THREE.ConeGeometry(0.042, 0.11, 7), hair, [0.075, 0.225, -0.12], [Math.PI + 0.75, 0, 0.55])
          .add(new THREE.ConeGeometry(0.044, 0.12, 7), hair, [0.005, 0.235, -0.13], [Math.PI + 0.7, 0, 0.35])
          .add(new THREE.ConeGeometry(0.04, 0.1, 7), hair, [-0.075, 0.225, -0.12], [Math.PI + 0.75, 0, 0.1])
          // Spikes on the crown and the nape, swept back by the wind
          .add(new THREE.ConeGeometry(0.04, 0.12, 7), hair, [0.03, 0.33, 0.02], [-0.9, 0, -0.25])
          .add(new THREE.ConeGeometry(0.04, 0.12, 7), hair, [-0.05, 0.31, 0.06], [-1.2, 0, 0.3])
          .add(new THREE.ConeGeometry(0.045, 0.11, 7), hair, [0.05, 0.12, 0.15], [-2.4, 0, -0.2])
          .add(new THREE.ConeGeometry(0.045, 0.11, 7), hair, [-0.05, 0.12, 0.15], [-2.4, 0, 0.2]);
      }
      part(look, hairBuilder);
      // Eyes: a dark almond, a lit iris in its lower half, two highlights, a lash line and a brow
      const eyes = new PartBuilder();
      for (const s of [1, -1]) {
        const x = 0.058 * s, y = one ? 0.13 : 0.128, turn = 0.38 * s;
        eyes
          .add(sphere(one ? 0.027 : 0.025, 12, 8), "eye", [x, y, -0.149], [0, turn, 0], one ? [0.85, 1.25, 0.5] : [0.92, 1.02, 0.5])
          .add(sphere(0.018, 10, 8), iris, [x, y - 0.012, -0.158], [0, turn, 0], [0.85, 0.85, 0.35])
          .add(sphere(0.008, 6, 5), "white", [x + 0.007 * s, y + 0.013, -0.166])
          .add(sphere(0.004, 5, 4), "white", [x - 0.008 * s, y - 0.016, -0.166])
          .add(capsule(0.0045, one ? 0.05 : 0.044), "eye", [x, y + (one ? 0.031 : 0.025), -0.156], [0, turn, Math.PI / 2 - 0.14 * s])
          .add(capsule(one ? 0.0035 : 0.006, one ? 0.034 : 0.04), "hair", [x + 0.004 * s, y + (one ? 0.06 : 0.05), -0.155], [0, turn, Math.PI / 2 + (one ? 0.2 : 0.05) * s]);
        // Style 1's lashes flick up at the outer corner
        if (one) eyes.add(new THREE.ConeGeometry(0.006, 0.022, 5), "eye", [x + 0.026 * s, y + 0.03, -0.148], [0, turn, -1.1 * s]);
      }
      part(look, eyes, skinMat, false);
    }

    // A ponytail in two links that swing (style 1)
    let parent: THREE.Object3D = this.styles[0];
    const ponyAt: Vec[] = [
      [0, 0.24, 0.13],
      [0, -0.13, 0],
    ];
    for (let i = 0; i < 2; i++) {
      const joint = new THREE.Object3D();
      joint.position.set(...ponyAt[i]);
      parent.add(joint);
      const builder = new PartBuilder();
      if (i === 0) builder.add(new THREE.TorusGeometry(0.03, 0.012, 6, 12), "trim", [0, 0, 0], [Math.PI / 2, 0, 0]);
      builder.add(sphere(0.06 - i * 0.012, 10, 8), "hair", [0, -0.07, 0], [0, 0, 0], [1, 1.6, 0.9]);
      part(joint, builder);
      this.pony.push(joint);
      parent = joint;
    }

    // Arms, legs and wings, mirrored
    const makeSide = (s: 1 | -1): Side => {
      const shoulder = new THREE.Object3D();
      shoulder.position.set(0.125 * s, 0.215, 0);
      this.chest.add(shoulder);
      part(
        shoulder,
        new PartBuilder()
          .add(sphere(0.05, 10, 8), "clothLight", [0, -0.02, 0])
          .add(capsule(0.036, 0.13), "clothLight", [0, -0.1, 0])
          .add(new THREE.TorusGeometry(0.037, 0.01, 5, 12), "trim", [0, -0.17, 0], [Math.PI / 2, 0, 0]),
      );
      const elbow = new THREE.Object3D();
      elbow.position.set(0, -0.19, 0);
      shoulder.add(elbow);
      part(
        elbow,
        new PartBuilder()
          .add(capsule(0.03, 0.13), "skin", [0, -0.08, 0])
          .add(cyl(0.036, 0.033, 0.05, 10), "white", [0, -0.12, 0])
          .add(sphere(0.036, 10, 8), "skin", [0, -0.19, 0], [0, 0, 0], [0.75, 1.15, 0.45]),
      );

      const hip = new THREE.Object3D();
      hip.position.set(0.062 * s, -0.04, 0);
      this.pelvis.add(hip);
      clothObstacle(part(hip, new PartBuilder().add(capsule(0.05, 0.2), "white", [0, -0.14, 0])));
      const knee = new THREE.Object3D();
      knee.position.set(0, -0.29, 0);
      hip.add(knee);
      const boot = clothObstacle(part(
        knee,
        new PartBuilder()
          .add(capsule(0.042, 0.18), "dark", [0, -0.13, 0])
          .add(new THREE.TorusGeometry(0.046, 0.013, 6, 12), "trim", [0, -0.03, 0], [Math.PI / 2, 0, 0])
          // Pointed toes, like a dancer's
          .add(capsule(0.034, 0.08), "dark", [0, -0.3, -0.012], [0.25, 0, 0]),
      ));

      // Wings: an inner arm-wing and an outer hand-wing, each a fan of feathers
      const wing = new THREE.Object3D();
      wing.position.set(0.05 * s, 0.17, 0.12);
      wing.rotation.order = "YZX";
      this.chest.add(wing);
      const featherPaint: Paint = (p, t, out) => {
        const d = p.length();
        out.copy(t.cloth).lerp(t.clothLight, smoothstep(0.05, 0.6, d)).lerp(t.white, smoothstep(0.5, 0.9, d) * 0.6);
      };
      const inner = new PartBuilder().add(capsule(0.022, 0.5), "trim", [0.27 * s, 0.03, 0], [0, 0, Math.PI / 2 - 0.12 * s]);
      for (let i = 0; i < 4; i++) {
        const angle = -0.9 - i * 0.22; // fanning back towards the feet
        inner.add(feather(0.5 + i * 0.05, 0.13), featherPaint, [(0.08 + i * 0.13) * s, 0.02 + i * 0.012, 0.004 * i], [
          0,
          0,
          s > 0 ? angle : Math.PI - angle,
        ]);
      }
      const innerMesh = part(wing, inner, wingMat);
      const wingOuter = new THREE.Object3D();
      wingOuter.position.set(0.54 * s, 0.07, 0);
      wingOuter.rotation.order = "YZX";
      wing.add(wingOuter);
      const tipPaint: Paint = (p, t, out) => {
        const d = p.length();
        out.copy(t.clothLight).lerp(t.white, smoothstep(0.05, 0.4, d) * 0.5).lerp(t.tip, smoothstep(0.45, 0.95, d));
      };
      const outer = new PartBuilder().add(capsule(0.018, 0.3), "trim", [0.15 * s, -0.02, 0], [0, 0, Math.PI / 2 + 0.25 * s]);
      const primaries = 5;
      for (let i = 0; i < primaries; i++) {
        const angle = 0.12 - i * 0.3;
        const length = 0.98 - i * 0.1;
        outer.add(feather(length, 0.15), tipPaint, [(0.05 + i * 0.045) * s, -0.02 * i, 0.004 * i], [
          0,
          0,
          s > 0 ? angle : Math.PI - angle,
        ]);
      }
      const outerMesh = part(wingOuter, outer, wingMat);
      const tip = new THREE.Object3D();
      tip.position.set((0.05 + 0.98 * Math.cos(0.12)) * s, 0.98 * Math.sin(0.12), 0);
      wingOuter.add(tip);
      const last = 0.12 - (primaries - 1) * 0.3;
      const lastLength = 0.98 - (primaries - 1) * 0.1;
      const trail = new THREE.Object3D();
      trail.position.set((0.05 + (primaries - 1) * 0.045 + lastLength * Math.cos(last)) * s, -0.02 * (primaries - 1) + lastLength * Math.sin(last), 0);
      wingOuter.add(trail);

      return { shoulder, elbow, hip, knee, wing, wingOuter, tip, trail, boot, innerMesh, outerMesh };
    };
    this.right = makeSide(1);
    this.left = makeSide(-1);

    // Item slots: between the shoulder blades over the cape, the middle of the head, the right palm
    const back = new THREE.Object3D();
    back.position.set(0, -0.12, 0.25);
    this.chest.add(back);
    const crown = new THREE.Object3D();
    crown.position.set(0, 0.15, 0);
    this.head.add(crown);
    const hand = new THREE.Object3D();
    hand.position.set(0, -0.215, -0.02);
    this.right.elbow.add(hand);
    // Boots go on both shins (items/equip.ts mirrors the left one)
    const foot = (side: Side) => {
      const anchor = new THREE.Object3D();
      anchor.position.set(0, -0.2, -0.005);
      side.knee.add(anchor);
      return anchor;
    };
    this.feet = [foot(this.right), foot(this.left)];
    this.slots = { back, head: crown, hand, feet: this.feet[0] };

    // The cape: wide, long and rippling, with a golden hem and an emblem
    this.cape = new Cloth(
      18,
      24,
      (u, v, t, out) => {
        const spec = capeSpec(this.capeId), pattern = spec.pattern;
        const diamond = Math.abs(u) * 1.25 + Math.abs(v - 0.42) * 3.2 < 0.42;
        const sun = Math.hypot(u * 0.7, (v - 0.4) * 2) < 0.19 || (v > 0.22 && v < 0.58 && Math.abs(Math.sin(Math.atan2(v - 0.4, u * 0.35) * 8)) < 0.17 && Math.hypot(u * 0.7, (v - 0.4) * 2) < 0.3);
        const leaf = Math.abs(u) < 0.05 || Math.abs(Math.abs(u) - (v * 3 % 1) * 0.8) < 0.06;
        const stars = (Math.abs(u - 0.42) + Math.abs(v - 0.3) * 4 < 0.18) || (Math.abs(u + 0.35) + Math.abs(v - 0.58) * 4 < 0.18) || diamond;
        const feathers = Math.abs((u * 3 + v * 4) % 1) < 0.12;
        const emblem = pattern === "sun" ? sun : pattern === "leaf" ? leaf : pattern === "stars" ? stars : pattern === "feathers" ? feathers : diamond;
        const hem = v > 0.95 || (v > 0.86 && v < 0.89) || (pattern === "border" && Math.abs(u) > 0.84);
        const embroidery = pattern !== "diamond" && Math.abs(Math.abs(u) - (.73 + .06 * Math.sin(v * 24))) < .045;
        const panel = pattern === "stars" ? .28 * Math.sin(u * 5 + v * 9) : pattern === "feathers" ? .22 * Math.cos(u * 12 - v * 8) : .08 * Math.cos(u * 9);
        out.copy(hem || emblem || embroidery ? t.trim : t.cloth).lerp(t.clothLight, hem || emblem || embroidery ? 0 : Math.max(0, panel))
          .lerp(t.clothDark, hem || emblem || embroidery ? 0 : smoothstep(0.2, 1, v) * 0.35);
      },
      clothMat,
    );
    this.painted.push(this.cape.painted);
    this.chest.add(this.cape.mesh);

    // Two scarf tails that stream over the cape
    this.scarf = [0, 1].map(() => {
      const tail = new Cloth(
        1,
        12,
        (u, v, t, out) => out.copy(v > 0.86 ? t.trim : t.white).lerp(t.clothLight, (u + 1) * 0.15),
        clothMat,
      );
      this.painted.push(tail.painted);
      this.chest.add(tail.mesh);
      return tail;
    });

    // A soft glow around the body, like a Sky child's light
    this.aura = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: glowTexture(),
        color: this.tones.clothLight,
        blending: THREE.AdditiveBlending,
        transparent: true,
        depthWrite: false,
        opacity: 0.25,
      }),
    );
    this.materials.push(this.aura.material);
    this.aura.scale.setScalar(1.8);
    this.rig.add(this.aura);

    this.repaint();
    this.applyPose(0);
  }

  private material<T extends THREE.Material>(material: T): T {
    this.materials.push(material);
    return material;
  }

  private repaint() {
    for (const painted of this.painted) {
      if (painted === this.cape.painted && this.capeId !== "classic") {
        const spec = capeSpec(this.capeId), capeTones = tonesFor(spec.color!);
        capeTones.trim.set(spec.trim);
        applyPaint(painted, capeTones);
      } else applyPaint(painted, this.tones);
    }
    (this.aura.material as THREE.SpriteMaterial).color.copy(this.tones.clothLight);
  }

  setColor(color: string) {
    this.tones = tonesFor(color);
    this.repaint();
  }

  /** Cosmetic meshes live on the animated joints; the flight hitbox never reads them. */
  /** Style 1 or 2 (hair and eyes); looks only */
  setStyle(style: 1 | 2) {
    if (style === this.style) return;
    this.style = style;
    this.styles.forEach((look, i) => (look.visible = i + 1 === style));
  }

  setAppearance(appearance: Appearance) {
    if (this.ghost) return;
    if (appearance.wings !== this.appearance.wings) {
      this.wingModels.forEach(model => model.dispose()); this.wingModels = [];
      for (const [side, sign] of [[this.left, -1], [this.right, 1]] as const) {
        side.innerMesh.visible = side.outerMesh.visible = appearance.wings === "classic";
        if (appearance.wings !== "classic") {
          const model = buildWing(appearance.wings, sign);
          side.wing.add(model.inner); side.wingOuter.add(model.outer); this.wingModels.push(model);
        }
      }
    }
    if (appearance.hat !== this.appearance.hat) {
      if (this.hat) disposeModel(this.hat);
      this.hat = appearance.hat === "none" ? null : buildHat(appearance.hat);
      if (this.hat) this.slots.head.add(this.hat);
    }
    if (appearance.shoes !== this.appearance.shoes) {
      this.shoes.forEach(disposeModel);
      this.shoes = [];
      for (const [side, sign] of [[this.left, -1], [this.right, 1]] as const) {
        side.boot.visible = appearance.shoes === "classic";
        if (appearance.shoes !== "classic") {
          const shoe = buildShoe(appearance.shoes, sign);
          side.knee.add(shoe); this.shoes.push(shoe);
        }
      }
    }
    this.capeId = appearance.cape;
    this.appearance = { ...appearance };
    this.repaint();
    this.applyPose(0);
  }

  /** A carried helmet takes priority over the wardrobe hat. */
  showCosmeticHat(visible: boolean) { if (this.hat) this.hat.visible = visible; }

  /** Wingtip positions in world space (call after update) */
  wingtips(left: THREE.Vector3, right: THREE.Vector3) {
    this.left.tip.getWorldPosition(left);
    this.right.tip.getWorldPosition(right);
  }

  /**
   * Points along both wings in the pilot's own frame (the group's), left wing
   * then right, five each: the wrist, the leading edge, the tip, the trailing
   * corner and the middle of the outer edge. The crash tumble keeps them out
   * of the rock (call after update)
   */
  wingPoints(out: THREE.Vector3[]) {
    this.sidePoints(this.left, out, 0);
    this.sidePoints(this.right, out, WING_POINTS);
  }

  private sidePoints(side: Side, out: THREE.Vector3[], k: number) {
    const g = this.group;
    const elbow = g.worldToLocal(side.wingOuter.getWorldPosition(elbowTmp));
    const tip = g.worldToLocal(side.tip.getWorldPosition(out[k + 2]));
    const trail = g.worldToLocal(side.trail.getWorldPosition(out[k + 3]));
    out[k].copy(elbow);
    out[k + 1].lerpVectors(elbow, tip, 0.5);
    out[k + 4].lerpVectors(tip, trail, 0.5);
  }

  /** The middle of the cape's hem in world space (call after update) */
  capeTip(out: THREE.Vector3): THREE.Vector3 {
    this.cape.tip(this.capeShape, out);
    return this.cape.mesh.localToWorld(out);
  }

  /** The direction the wings span, in world space: trails use it as their width */
  span(out: THREE.Vector3): THREE.Vector3 {
    return out.setFromMatrixColumn(this.rig.matrixWorld, 1).normalize();
  }

  /** A wingbeat on demand (a run's flap ability): the wings at full effort for a moment */
  beat() {
    this.effort = 1;
  }

  /** The roll is visual; flight physics supplies its timing and displacement. */
  setDodge(phase: number) {
    this.barrel.t = phase === 0 ? -1 : Math.min(1, Math.abs(phase));
    this.barrel.dir = phase < 0 ? -1 : 1;
    this.barrelProgress = this.barrel.t;
  }

  /**
   * Animates the pilot. Call after placing `group` for this frame. `distance`
   * is how far the camera is, so far-away pilots skip the fine details.
   */
  update(dt: number, speed: number, proximity: number, distance = 0) {
    if (dt <= 0) return;
    this.time += dt;
    this.speed = speed;
    if (this.death) {
      this.death.t += dt;
      this.applyDeathPose(dt);
      return;
    }

    // Turn rates in the pilot's own frame, from how the rotation changed since last frame
    if (this.hasLast) {
      dq.multiplyQuaternions(prevInverse.copy(this.lastQuaternion).invert(), this.group.quaternion);
      if (dq.w < 0) dq.set(-dq.x, -dq.y, -dq.z, -dq.w);
      const angle = 2 * Math.acos(clamp(dq.w, -1, 1));
      const s = Math.sqrt(Math.max(1e-9, 1 - dq.w * dq.w));
      localOmega.set(dq.x / s, dq.y / s, dq.z / s).multiplyScalar(angle / dt);
      if (angle < 1e-6) localOmega.set(0, 0, 0);
      const k = 1 - Math.exp(-dt * 10);
      this.pitchRate += (clamp(localOmega.x, -6, 6) - this.pitchRate) * k;
      this.yawRate += (clamp(-localOmega.y, -6, 6) - this.yawRate) * k;
      this.rollRate += (clamp(-localOmega.z, -8, 8) - this.rollRate) * k;
    }
    this.lastQuaternion.copy(this.group.quaternion);
    this.hasLast = true;
    forwardTmp.set(0, 0, -1).applyQuaternion(this.group.quaternion);
    this.climb += (forwardTmp.y - this.climb) * (1 - Math.exp(-dt * 4));

    // Bank lead: the body rolls a little ahead of the turn and settles with a spring
    const target = clamp(this.rollRate * ANIM.bankLead + this.yawRate * 0.35, -1.1, 1.1);
    [this.lean, this.leanVelocity] = springStep(this.lean, this.leanVelocity, target, ANIM.bankSpring, ANIM.bankDamping, dt);

    // Effort decides how hard the wings flap: climbing, turning, rolling or slow
    const slow = clamp((32 - speed) / 18, 0, 1);
    const diving = smoothstep(-0.15, -0.6, this.climb);
    let effort =
      0.18 + clamp(this.climb, 0, 1) * 0.9 + Math.abs(this.yawRate) * 0.35 + Math.abs(this.rollRate) * 0.08 + slow * 0.7;
    effort = clamp(effort * (1 - diving * 0.75), 0, 1);
    const st = this.stance;
    effort = Math.max(effort * (1 - st.tuck * 0.9) * (1 - st.falcon * 0.8), st.hover, st.cast * 0.8, st.climb * 0.95, st.flare * 0.7, st.butterfly * 0.75);
    this.effort += (effort - this.effort) * (1 - Math.exp(-dt * 3));
    const before = Math.sin(this.flapPhase);
    this.flapPhase += TAU * (ANIM.flapRate + ANIM.flapBoost * this.effort) * dt * (this.barrel.t >= 0 ? 1.6 : 1) * (1 + st.hover * 0.9) * (1 - st.butterfly * 0.45) * (1 + st.climb * 0.35);
    const after = Math.sin(this.flapPhase);
    if (before > 0 && after <= 0 && this.time - this.lastFlap > 0.15) {
      this.lastFlap = this.time;
      this.onDownstroke?.(this.effort);
    }

    const far = distance > 110;
    if (far !== !this.detailed) {
      this.detailed = !far;
      this.outlines.forEach((o) => (o.visible = this.detailed));
    }
    this.applyPose(dt, proximity);
  }

  private capeShape: ClothShape = () => {};

  private applyPose(dt: number, proximity = 0) {
    const t = this.time;
    const A = ANIM;
    const speedK = smoothstep(25, 95, this.speed);
    const turn = clamp(this.yawRate, -1.5, 1.5);

    // Rig: physics-timed barrel roll, gentle bobbing, squash and stretch
    let roll = 0; // steering bank is already in group; never visually exceed its limit
    if (this.barrel.t >= 0) {
      const p = smoother(clamp(this.barrel.t, 0, 1));
      const angle = p * TAU * this.barrel.dir;
      roll -= angle;
    }
    const calm = 1 - speedK * 0.65;
    const bob = Math.sin(t * TAU * A.bobRate) * A.bobAmount * calm;
    const flapLift = Math.sin(this.flapPhase + Math.PI / 2) * 0.05 * this.effort;
    this.rig.position.set(Math.sin(t * TAU * A.bobRate * 0.5) * A.bobAmount * 0.4 * calm, bob + flapLift, 0);
    const st = this.stance;
    // Hovering, the body swings upright under the wings; surfing, it sits back a little
    // Flaring, the body rears up into the wind; in the butterfly stance it floats, rocking gently
    this.rig.rotation.set(
      Math.cos(t * TAU * A.bobRate) * 0.04 * calm - this.pitchRate * 0.05 + st.hover * 0.95 + st.surf * 0.18 - st.tuck * 0.1 + st.flare * 0.85 + st.butterfly * 0.12,
      0,
      roll + Math.sin(t * 1.3) * 0.12 * st.surf + Math.sin(t * 0.9) * 0.08 * st.butterfly,
    );
    const stretch = 1 + clamp((this.speed - 55) / 60, 0, 1) * 0.06 + st.falcon * 0.05;
    this.rig.scale.set(SCALE / Math.sqrt(stretch), SCALE / Math.sqrt(stretch), SCALE * stretch);

    // Body: a superhero arch, more when climbing; the head looks ahead and into turns
    this.chest.rotation.set(this.brake * 0.18 - this.boost * 0.08 + 0.1 + clamp(this.climb, 0, 1) * 0.12 + this.pitchRate * 0.05 + st.cast * 0.3 + st.surf * 0.25 - st.tuck * 0.12 + st.climb * 0.15 + st.sing * 0.3 + st.flare * 0.2 - st.falcon * 0.1, -turn * 0.08 * A.limbSwing, 0);
    // Singing, the head is thrown back (with a little sway to the song)
    this.head.rotation.set(0.85 - this.pitchRate * 0.08 - st.hover * 0.55 - st.surf * 0.15 - st.sing * 0.6 - st.climb * 0.2 + st.falcon * 0.1, -turn * 0.35 * A.headLook, turn * 0.25 * A.headLook + Math.sin(t * 7) * 0.12 * st.sing);
    this.pelvis.rotation.set(0, turn * 0.06 * A.limbSwing, -this.lean * 0.15);

    // Wings
    const amp = (A.flapAngle * this.effort + A.glideFlutter * (1 - this.effort)) * (1 - this.brake * 0.85) * (1 - this.boost * 0.5) * (1 - st.tuck * 0.85) * (1 - st.surf * 0.6) * (1 + st.hover * 0.25) * (1 - st.falcon * 0.85) * (1 + st.butterfly * 0.7 + st.climb * 0.3);
    const stroke = Math.sin(this.flapPhase) + 0.22 * Math.sin(this.flapPhase * 2);
    const strokeOuter = Math.sin(this.flapPhase - 0.7) + 0.22 * Math.sin(this.flapPhase * 2 - 1.4);
    const barrelTuck = this.barrel.t >= 0 ? Math.sin(Math.PI * this.barrel.t) : 0;
    const sweep = A.sweepAtSpeed * speedK + barrelTuck * 0.45 - slow01(this.speed) * 0.1 + this.boost * A.boostSweep - this.brake * A.brakeSweep
      + st.tuck * 0.95 - st.hover * 0.3 - st.cast * 0.35 - st.flare * 0.95 + st.falcon * 1.15 - st.butterfly * 0.45 - st.sing * 0.2;
    // Positive lift raises the wing (towards the back)
    const lift = (s: 1 | -1) => 0.12 + amp * stroke + turn * 0.12 * s * A.limbSwing + st.cast * 0.35 - st.tuck * 0.15 + st.climb * 0.25 + st.sing * 0.4 + st.flare * 0.3 - st.falcon * 0.12 + st.butterfly * 0.18;
    for (const [side, s] of [
      [this.right, 1],
      [this.left, -1],
    ] as [Side, 1 | -1][]) {
      side.wing.rotation.set(-0.15 * Math.cos(this.flapPhase) * amp, -lift(s) * s, (-0.18 - sweep) * s);
      side.wingOuter.rotation.set(0, -(amp * 0.8 * strokeOuter + 0.05) * s, (-0.1 - sweep * 0.7) * s);

      // Arms reach out like a Sky glide and follow the wings a little
      const glide = 1.3 - speedK * 0.35 - barrelTuck * 0.5 + this.brake * 0.25 - this.boost * 0.15;
      // Tucked, the arms reach past the head like a diver's; casting, they thrust ahead; the
      // surfer's left hand trails low, through the cloud
      // Climbing, they reach for the sky; flaring, they brace forward; singing, they open wide; the
      // falcon holds them back along its sides, the butterfly spreads them with its wings
      const reach = Math.max(st.tuck, st.cast, st.climb * 0.6, st.flare * 0.45);
      const trailing = s < 0 ? st.surf : st.surf * 0.4;
      const spread = (glide + (2.75 - glide) * reach + st.hover * 0.25 - trailing * 0.55 + st.sing * 0.2 + st.butterfly * 0.25) * (1 - st.falcon * 0.8);
      const armLift = (0.25 + stroke * amp * 0.35 + turn * 0.25 * s * A.limbSwing) * (1 - reach) - trailing * 0.7 + st.sing * 0.45 + st.butterfly * 0.2 - st.falcon * 0.5;
      side.shoulder.rotation.set(0, -armLift * s, spread * s);
      side.elbow.rotation.set(0, 0, (0.25 + st.cast * 0.1 - st.tuck * 0.2) * s);

      // Legs together, knees soft, toes pointed; they swing like a rudder in turns
      const kick = Math.sin(t * 2.4 + (s > 0 ? 0 : 1.6)) * 0.06 * calm;
      // Hovering, the legs dangle; surfing, they swing under the body, knees bent as if on a board
      // Flaring, the legs swing forward under the body like a bird landing
      side.hip.rotation.set(0.06 + kick + st.hover * 0.35 * (s > 0 ? 1 : 0.7) + st.surf * 0.75 + st.flare * 0.7, 0, 0.05 * s - turn * 0.12 * A.limbSwing + st.surf * 0.12 * s + st.butterfly * 0.1 * s);
      side.knee.rotation.set((-this.brake * 0.3 - 0.32 - clamp(this.climb, 0, 1) * 0.35 - kick * 1.4 - barrelTuck * 0.4) * (1 - st.tuck * 0.85) * (1 - st.falcon * 0.8) - st.hover * 0.45 - st.surf * 0.9 - st.flare * 0.5, 0, 0);
    }

    // Item animations take over the right arm
    const arm = this.armPose;
    if (arm.amount > 0) {
      const k = clamp(arm.amount, 0, 1);
      const sh = this.right.shoulder.rotation;
      sh.set(sh.x + (arm.x - sh.x) * k, sh.y + (arm.y - sh.y) * k, sh.z + (arm.z - sh.z) * k);
      const el = this.right.elbow.rotation;
      el.z += (arm.elbow - el.z) * k;
    }

    // Ponytail trails the head and swings
    const sway = Math.sin(t * 5 * A.clothSpeed + 0.5) * 0.12 * A.clothWave;
    this.pony[0].rotation.set(-1.25 + this.pitchRate * 0.1 + sway * 0.5, 0, -turn * 0.4 + sway);
    this.pony[1].rotation.set(0.25 + sway * 0.4, 0, sway * 1.2);

    // Standing (the figurine): every joint eases into an upright, relaxed pose
    if (st.stand > 0) this.standPose(st.stand, t);

    // Aura breathes with the flaps and burns brighter when skimming
    const auraMat = this.aura.material as THREE.SpriteMaterial;
    auraMat.opacity = (0.14 + 0.08 * Math.max(0, stroke) * this.effort + proximity * 0.25) * FX.aura * (1 + ATMOSPHERE.night.value * 1.5);
    this.aura.visible = auraMat.opacity > 0.01;

    if (!this.detailed && dt > 0) return;
    this.clothTime += dt * (4.5 + this.speed * 0.11) * A.clothSpeed * (1 - st.stand * 0.7);
    this.updateCloth(
      A.clothWave * (0.075 + slow01(this.speed) * 0.05) * (1 + st.flare * 1.5 + st.butterfly * 0.6) * (1 - st.falcon * 0.6) * (1 - st.stand * 0.75),
      -this.lean * 0.3 - turn * 0.15,
      this.pitchRate * 0.12 - this.climb * 0.12 + st.flare * 0.75 - st.falcon * 0.2 + st.stand * 0.1,
      1 + st.butterfly * 1.6 + st.flare * 0.4 - st.falcon * 0.3 - st.stand * 0.35,
    );
  }

  /** Blends the pose towards standing on the ground, by `k` (0..1); a slow breath keeps it alive */
  private standPose(k: number, t: number) {
    const breath = Math.sin(t * 1.6);
    const to = (o: THREE.Object3D, x: number, y: number, z: number) =>
      o.rotation.set(o.rotation.x + (x - o.rotation.x) * k, o.rotation.y + (y - o.rotation.y) * k, o.rotation.z + (z - o.rotation.z) * k);
    // Upright: the rig turns the prone flying body up on its feet, without the flight's bob
    this.rig.rotation.x += (Math.PI / 2 - this.rig.rotation.x) * k;
    this.rig.rotation.z *= 1 - k;
    this.rig.position.multiplyScalar(1 - k);
    this.rig.scale.setScalar(SCALE);
    to(this.chest, 0.02 + breath * 0.012, 0, 0);
    to(this.head, 0.06 + breath * 0.01, Math.sin(t * 0.5) * 0.12, 0);
    this.pelvis.rotation.set(this.pelvis.rotation.x * (1 - k), this.pelvis.rotation.y * (1 - k), this.pelvis.rotation.z * (1 - k));
    for (const [side, s] of [[this.right, 1], [this.left, -1]] as [Side, 1 | -1][]) {
      // Wings folded behind the back like a resting bird's, the outer half curving down; they lift with each breath
      to(side.wing, 0, -(1.22 + breath * 0.03) * s, -0.42 * s);
      to(side.wingOuter, 0, -0.38 * s, -0.3 * s);
      // Arms at the sides, elbows soft; legs straight, a little apart
      to(side.shoulder, 0, -0.08 * s, (0.16 + breath * 0.01) * s);
      to(side.elbow, 0, 0, 0.18 * s);
      to(side.hip, 0, 0, 0.04 * s);
      to(side.knee, -0.04, 0, 0);
    }
    // The ponytail hangs down instead of streaming back
    to(this.pony[0], -0.25 + Math.sin(t * 1.1) * 0.05, 0, Math.sin(t * 0.8) * 0.06);
    to(this.pony[1], 0.1, 0, 0);
  }

  /** Moves the cape and scarf: `wave` ripple size, `leanX` sideways swing, `pitch` lift of the hem, `spread` how wide it fans */
  private updateCloth(wave: number, leanX: number, pitch: number, spread = 1) {
    const A = ANIM;
    const ct = this.clothTime;
    // Cloth is in chest space, whereas the legs follow the pelvis. Resolve
    // their current pose before shaping it, including knees bent by climbing,
    // braking, abilities or a crash. Never alter the limbs or flight hitbox.
    this.body.updateWorldMatrix(true, true);
    this.clothInverse.copy(this.chest.matrixWorld).invert();
    for (const obstacle of this.clothObstacles) {
      this.clothMatrix.multiplyMatrices(this.clothInverse, obstacle.mesh.matrixWorld);
      obstacle.bounds.copy(obstacle.local).applyMatrix4(this.clothMatrix);
    }
    // Standing, the cape drapes down the back instead of streaming out to its full length
    const drape = 1 - this.stance.stand * 0.38;
    this.capeShape = (u, v, out) => {
      const spec = capeSpec(this.capeId);
      const width = (0.11 + 0.2 * Math.pow(v, 0.8) * spread) * spec.width;
      const scallop = (spec.pattern === "leaf" ? .075 * Math.cos(u * Math.PI * 3) : spec.pattern === "feathers" ? .085 * Math.cos(u * Math.PI * 5) : spec.pattern === "sun" ? .18 * (1 - Math.abs(u)) : spec.pattern === "stars" ? .08 * Math.cos(u * Math.PI * 2) : spec.pattern === "border" ? -.065 * (1 - u * u) : 0) * COSMETIC_FX.capeDetail;
      const w =
        wave * Math.pow(v, 1.3) * Math.sin(TAU * 1.3 * v - ct + u * 0.7) +
        wave * 0.35 * v * Math.sin(TAU * 2.4 * v - ct * 1.7 + u * 2.1);
      out.set(
        u * width + leanX * v * v + Math.sin(ct * 0.6 + v * 3) * 0.03 * v * v * A.clothWave,
        0.245 - v * 1.18 * spec.length * drape + scallop * Math.pow(v, 6),
        0.085 + 0.06 * v + 0.12 * v * v + 0.05 * (1 - u * u) * v + w - pitch * v * v,
      );
      this.clearCloth(out);
    };
    this.cape.update(this.capeShape);
    this.scarf.forEach((cloth, i) => {
      const tail = i === 0 ? -1 : 1;
      const length = i === 0 ? 0.78 : 0.66;
      cloth.update((u, v, out) => {
        const phase = TAU * 1.8 * v - ct * 1.35 + tail * 1.3;
        out.set(
          tail * (0.035 + 0.1 * v) + u * 0.03 + leanX * v * 1.2 + Math.sin(phase * 0.7) * 0.05 * v * A.clothWave,
          0.27 - v * length,
          0.13 + 0.08 * v + 0.16 * v * v + wave * 1.4 * v * Math.sin(phase) - pitch * v,
        );
        this.clearCloth(out);
      });
      cloth.keepAbove(this.cape, 0.02);
    });
  }

  /** Keep cloth behind the legs (+z in chest space), with a soft drape around them. */
  private clearCloth(out: THREE.Vector3) {
    for (const { bounds } of this.clothObstacles) {
      // Cover half a cloth grid cell beyond the bounds so triangles between
      // samples also clear the boots. The z gap includes their ink outlines.
      const dx = Math.max(bounds.min.x - out.x, out.x - bounds.max.x, 0);
      const dy = Math.max(bounds.min.y - out.y, out.y - bounds.max.y, 0);
      const drape = 1 - smoothstep(0.06, 0.12, Math.max(dx, dy));
      out.z += Math.max(0, bounds.max.z + 0.025 - out.z) * drape;
    }
  }

  /** Starts the crash animation of this kind; `side` is the wing that hit (1 right, -1 left) */
  die(kind: DeathKind, side: 1 | -1) {
    this.death = { kind, t: 0, side };
    this.barrel.t = -1;
    this.barrelProgress = -1;
  }

  /**
   * During a crash: fold the wings in where they are stuck in the rock by
   * `left` and `right` metres (DeathFall.wedged), so the wing that can't get
   * free crumples against the rock instead of going through it; unfolds
   * slowly once free
   */
  foldWings(left: number, right: number, dt: number) {
    for (let i = 0; i < 2; i++) {
      const depth = i === 0 ? left : right;
      // The wing reaches about 2.4 m: fold it in by the share it is stuck
      if (depth > 0.01) this.folded[i] = Math.min(0.8, this.folded[i] + (depth / 2.4) * 1.2);
      else this.folded[i] = Math.max(0, this.folded[i] - dt * 0.8);
    }
    this.left.wing.scale.setScalar(1 - this.folded[0]);
    this.right.wing.scale.setScalar(1 - this.folded[1]);
  }

  /** Back to flying (on respawn) */
  revive() {
    this.death = null;
    this.folded[0] = this.folded[1] = 0;
    this.left.wing.scale.setScalar(1);
    this.right.wing.scale.setScalar(1);
    this.hasLast = false;
    this.lean = this.leanVelocity = 0;
    this.pitchRate = this.yawRate = this.rollRate = 0;
  }

  get dying(): boolean {
    return this.death !== null;
  }

  /**
   * The crash pose: limbs windmill in panic, then flop as the pilot goes limp;
   * the wings crumple back (or stay spread when spinning); a headfirst hit
   * squashes the body for a moment. At the end the pilot shrinks into light.
   */
  private applyDeathPose(dt: number) {
    const d = this.death!;
    const t = d.t;
    const A = ANIM;
    const panic = Math.exp(-t * 1.5);
    const wave = (rate: number, phase: number) => Math.sin(t * rate + phase);
    const spinning = d.kind === "wing";
    const curl = d.kind === "headfirst" ? 0.7 : d.kind === "slide" ? 0.5 : d.kind === "fall" ? 0.3 : -0.1;

    // Squash on impact, then shrink away into light at the end
    const hit = d.kind === "headfirst" ? Math.sin(Math.PI * clamp(t / 0.22, 0, 1)) * 0.28 : d.kind === "slide" ? Math.sin(Math.PI * clamp(t / 0.18, 0, 1)) * 0.14 : 0;
    const vanish = 1 - smoothstep(DISSOLVE_AT, DISSOLVE_AT + 0.22, t);
    const size = SCALE * Math.max(0.001, vanish);
    this.rig.position.set(0, 0, 0);
    this.rig.rotation.set(0, 0, 0);
    this.rig.scale.set(size * (1 + hit * 0.5), size * (1 - hit), size * (1 + hit * 0.5));

    this.chest.rotation.set(0.1 + curl * 0.45 + wave(9, 0) * 0.18 * panic, wave(7, 1) * 0.25 * panic, wave(5, 2) * 0.18 * panic);
    this.head.rotation.set(0.55 + wave(11, 0.5) * 0.4 * panic + (1 - panic) * 0.35, wave(8, 2) * 0.45 * panic, wave(6, 1) * 0.3);
    this.pelvis.rotation.set(curl * 0.35, 0, wave(6, 0) * 0.12 * panic);

    for (const [side, s] of [
      [this.right, 1],
      [this.left, -1],
    ] as [Side, 1 | -1][]) {
      // Arms windmill, or stretch out while spinning; legs kick, then fold
      const reach = spinning ? 1.5 : 1.15;
      side.shoulder.rotation.set(wave(13 + s, s) * 1.3 * panic, wave(10, s * 2) * 0.6 * panic, (reach + wave(12, s) * 0.6 * panic) * s);
      side.elbow.rotation.set(0, 0, (0.55 + 0.45 * wave(9, s)) * s);
      side.hip.rotation.set(-curl * 0.8 + wave(11, s * 1.7) * 0.55 * panic, 0, 0.15 * s);
      side.knee.rotation.set(-0.6 - curl * 0.8 - Math.abs(wave(10, s)) * 0.45 * panic, 0, 0);

      // Wings crumple back and flutter; when spinning they stay out, the one that hit bent
      const broken = spinning && s === d.side;
      const fold = spinning ? (broken ? 0.9 : 0.15) : 0.85 + 0.35 * (1 - panic);
      side.wing.rotation.set(wave(17, s) * 0.3 * panic, -(0.15 + wave(15, s * 3) * 0.6 * panic) * s, (-0.18 - fold) * s);
      side.wingOuter.rotation.set(0, -(0.45 + wave(19, s) * 0.5 * panic + (broken ? 0.8 : 0)) * s, (-0.1 - fold * 0.9) * s);
    }

    const flop = wave(7, 0.5);
    this.pony[0].rotation.set(-1.25 + flop * 0.6, 0, wave(9, 1) * 0.6);
    this.pony[1].rotation.set(0.25 + flop * 0.4, 0, wave(11, 2) * 0.8);

    const auraMat = this.aura.material as THREE.SpriteMaterial;
    auraMat.opacity = 0.12 * FX.aura * vanish * (1 + ATMOSPHERE.night.value * 1.5);
    this.aura.visible = auraMat.opacity > 0.01;

    if (!this.detailed) return;
    // Cloth whips around hard
    this.clothTime += dt * 14 * A.clothSpeed;
    this.updateCloth(A.clothWave * 0.16, wave(3, 0) * 0.35, -0.3 + wave(4, 1) * 0.3);
  }

  /** Run-only spirit cape: translucent toon body and ink; normal opacity is restored on exit. */
  spectral(amount: number) {
    if(this.ghost)return;
    for(const material of this.materials){
      if(material===this.aura.material)continue;
      const transparent=amount>0;
      if(material.transparent!==transparent){material.transparent=transparent;material.needsUpdate=true;}
      material.opacity=1-amount*0.65;
      material.depthWrite=!transparent;
    }
  }

  /** A ghost's opacity, 0..1 (Wind-Shear Dash's afterimages fade out); solid pilots ignore it */
  fade(opacity: number) {
    if (!this.ghost) return;
    for (const material of this.materials) if (material !== this.aura.material) material.opacity = opacity;
    (this.aura.material as THREE.SpriteMaterial).opacity = opacity * 0.3;
  }

  /** Hides the pilot (e.g. after a crash) */
  set visible(visible: boolean) {
    this.group.visible = visible;
  }

  get visible(): boolean {
    return this.group.visible;
  }

  dispose() {
    this.wingModels.forEach(model => model.dispose());
    if (this.hat) disposeModel(this.hat);
    this.shoes.forEach(disposeModel);
    this.painted.forEach((p) => p.geometry.dispose());
    this.materials.forEach((m) => m.dispose());
  }
}

function slow01(speed: number) {
  return clamp((35 - speed) / 20, 0, 1);
}

let glow: THREE.Texture | null = null;

/** A soft round glow, shared by the aura and other sprites */
export function glowTexture(): THREE.Texture {
  if (!glow) {
    const size = 64;
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = size;
    const ctx = canvas.getContext("2d")!;
    const gradient = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
    gradient.addColorStop(0, "rgba(255,255,255,1)");
    gradient.addColorStop(0.25, "rgba(255,255,255,0.55)");
    gradient.addColorStop(0.6, "rgba(255,255,255,0.12)");
    gradient.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, size, size);
    glow = new THREE.CanvasTexture(canvas);
    glow.colorSpace = THREE.SRGBColorSpace;
  }
  return glow;
}

/** A name tag that keeps the same size on screen */
export function createLabel(text: string, color: string): THREE.Sprite {
  const canvas = document.createElement("canvas");
  canvas.width = 256;
  canvas.height = 64;
  const ctx = canvas.getContext("2d")!;
  ctx.font = "600 30px system-ui, sans-serif";
  const width = Math.min(240, ctx.measureText(text).width + 28);
  ctx.fillStyle = "rgba(10, 12, 20, 0.6)";
  ctx.beginPath();
  ctx.roundRect((256 - width) / 2, 8, width, 48, 24);
  ctx.fill();
  ctx.fillStyle = color;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(text, 128, 33, 220);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const sprite = new THREE.Sprite(
    new THREE.SpriteMaterial({ map: texture, sizeAttenuation: false, fog: false, depthWrite: false }),
  );
  sprite.scale.set(0.16, 0.04, 1);
  sprite.renderOrder = 10;
  return sprite;
}

export function disposeLabel(label: THREE.Sprite) {
  label.material.map?.dispose();
  label.material.dispose();
}
