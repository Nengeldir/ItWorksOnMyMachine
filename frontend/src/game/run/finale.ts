import * as THREE from "three";
import { clamp } from "../math";
import { Kind, type Particles, fx, fxTime } from "../particles";

// The last portal of a run leads nowhere: through it the pilot floats alone
// in empty space under the Milky Way. A cutscene plays: the camera leaves
// the chase view and slowly pans down beneath the pilot, looking up past
// them at the galaxy arching overhead, holds there, pans back, and the view
// fades into white light. Looks only: the run is already scored.

/** The cutscene's timeline, in seconds from the portal */
const BLUR_IN = 0.5; // the screen blurs; under it, the land gives way to space
const CLEAR = 1.5; // the blur has cleared
const PAN_DOWN = 7.0; // beneath the pilot
const HOLD = 10.0; // looking up at the Milky Way
const PAN_BACK = 13.5; // back behind the pilot
export const FINALE_WHITE = 13.5; // the white light begins
const END = 16.0;

const ease = (t: number) => {
  const x = clamp(t, 0, 1);
  return x * x * (3 - 2 * x);
};

const skyVertex = /* glsl */ `
  varying vec3 vDir;
  void main() {
    vDir = position;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const skyFragment = /* glsl */ `
  uniform float time;
  uniform vec3 bandNormal;
  uniform vec3 coreDir;
  varying vec3 vDir;

  float hash3(vec3 p) { return fract(sin(dot(p, vec3(127.1, 311.7, 74.7))) * 43758.5453); }
  float noise(vec3 p) {
    vec3 i = floor(p);
    vec3 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(
      mix(mix(hash3(i), hash3(i + vec3(1, 0, 0)), f.x), mix(hash3(i + vec3(0, 1, 0)), hash3(i + vec3(1, 1, 0)), f.x), f.y),
      mix(mix(hash3(i + vec3(0, 0, 1)), hash3(i + vec3(1, 0, 1)), f.x), mix(hash3(i + vec3(0, 1, 1)), hash3(i + vec3(1, 1, 1)), f.x), f.y),
      f.z);
  }
  float fbm(vec3 p) {
    float v = 0.0;
    float a = 0.5;
    for (int i = 0; i < 5; i++) {
      v += a * noise(p);
      p *= 2.07;
      a *= 0.5;
    }
    return v;
  }

  /** Stars in 3D cells around the sky sphere, one or two pixels across wherever they are */
  float stars(vec3 d, float scale, float density) {
    vec3 p = d * scale;
    vec3 cell = floor(p);
    float h = hash3(cell);
    vec3 c = cell + 0.5 + (vec3(hash3(cell + 1.7), hash3(cell + 4.3), hash3(cell + 8.1)) - 0.5) * 0.7;
    vec3 diff = p - c;
    diff -= d * dot(diff, d);
    float px = max(length(dFdx(p)), length(dFdy(p)));
    float r = length(diff) / max(1e-4, px * (0.8 + 1.3 * h));
    float resolved = 1.0 - smoothstep(0.3, 0.7, px);
    float twinkle = 0.65 + 0.35 * sin(time * (0.5 + h * 2.0) + h * 60.0);
    return step(1.0 - density, h) * exp(-r * r) * twinkle * (0.35 + h) * resolved;
  }

  void main() {
    vec3 d = normalize(vDir);
    // Galactic coordinates: latitude from the band's plane, longitude from the core
    float b = clamp(dot(d, bandNormal), -1.0, 1.0);
    float lat = asin(b);
    vec3 inPlane = d - bandNormal * b;
    float l = atan(dot(inPlane, cross(bandNormal, coreDir)), dot(inPlane, coreDir) + 1e-5);

    float n = fbm(d * 3.0);
    float n2 = fbm(d * 7.0 + 3.1);
    float width = 0.15 + 0.07 * n;
    // Squared by hand: lat is signed, and pow() of a negative base is undefined in GLSL (NaN on Direct3D)
    float across = lat / width;
    float band = exp(-across * across);
    float core = exp(-(l * l) / 0.3 - (lat * lat) / 0.025);
    // Dark dust lanes winding along the middle of the band
    float lane = (lat - 0.03 * sin(l * 2.5)) / 0.055;
    float dust = smoothstep(0.42, 0.72, fbm(d * 9.0 + 1.3)) * exp(-lane * lane);

    vec3 col = vec3(0.003, 0.004, 0.014) + vec3(0.012, 0.016, 0.045) * (1.0 - abs(b));
    col += vec3(0.5, 0.6, 0.95) * band * (0.15 + 0.6 * n2) * 0.32;
    col += vec3(1.0, 0.8, 0.58) * core * (0.45 + 0.2 * n);
    col += vec3(0.9, 0.42, 0.75) * band * pow(clamp(n, 0.0, 1.0), 3.0) * 0.3;
    col += vec3(0.35, 0.5, 1.0) * band * pow(clamp(n2, 0.0, 1.0), 4.0) * 0.25;
    col *= 1.0 - dust * 0.85;

    // Stars everywhere, far more of them in the band
    float dense = 0.008 + 0.05 * band + 0.08 * core;
    float s = 1.6 * stars(d, 110.0, 0.018) + stars(d, 240.0, dense) + 0.7 * stars(d, 480.0, dense * 1.3);
    col += mix(vec3(0.75, 0.85, 1.0), vec3(1.0, 0.9, 0.75), n2) * s * 1.1;
    gl_FragColor = vec4(col, 1.0);
    #include <colorspace_fragment>
  }
`;

const tmp = new THREE.Vector3();
const offset = new THREE.Vector3();
const look = new THREE.Vector3();
const at = new THREE.Vector3();
const vel = new THREE.Vector3();
const MOTE = new THREE.Color("#cfe0ff");
const GOLD = new THREE.Color("#ffe3a8");
const UP = new THREE.Vector3(0, 1, 0);

/** Spherical camera pose around the pilot: azimuth, elevation, radius, and how high above the pilot it looks */
interface Pose {
  azimuth: number;
  elevation: number;
  radius: number;
  lookUp: number;
}

export interface FinaleFrame {
  /** Screen blur and sparkles, 0..1 */
  veil: number;
  /** In space: the land and its sky are hidden */
  space: boolean;
  /** The white light, 0..1 */
  white: number;
  done: boolean;
}

/** The finale: space, the Milky Way and the camera's slow pan, then white light */
export class Finale {
  readonly group = new THREE.Group();
  time = 0;
  private readonly sky: THREE.Mesh<THREE.SphereGeometry, THREE.ShaderMaterial>;
  private readonly pilot = new THREE.Vector3();
  private readonly startLook = new THREE.Vector3();
  private chase: Pose | null = null;
  private below: Pose | null = null;
  private moteDebt = 0;

  constructor() {
    // The galaxy arches overhead, its core near the zenith, the band tilted a little
    const bandNormal = new THREE.Vector3(1, 0.12, 0.38).normalize();
    const coreDir = UP.clone().addScaledVector(bandNormal, -UP.dot(bandNormal)).normalize().applyAxisAngle(bandNormal, 0.35);
    this.sky = new THREE.Mesh(
      new THREE.SphereGeometry(60, 64, 40),
      new THREE.ShaderMaterial({
        uniforms: { time: fxTime, bandNormal: { value: bandNormal }, coreDir: { value: coreDir } },
        vertexShader: skyVertex,
        fragmentShader: skyFragment,
        side: THREE.BackSide,
        depthTest: false,
        depthWrite: false,
        fog: false,
      }),
    );
    this.sky.renderOrder = -1000;
    this.sky.frustumCulled = false;
    // Starlight from all around, and the galaxy's core lights the pilot from above
    const key = new THREE.DirectionalLight("#ffe6c8", 1.5);
    key.position.copy(coreDir);
    this.group.add(this.sky, new THREE.HemisphereLight("#8ea6ff", "#1c1638", 1.0), key, key.target);
    this.group.visible = false;
  }

  /** Skips to the white light */
  skip() {
    if (this.time < FINALE_WHITE) this.time = FINALE_WHITE;
  }

  /** Advances the cutscene and, once in space, places the camera. `pilot`: where the pilot floats */
  update(dt: number, camera: THREE.PerspectiveCamera, pilot: THREE.Vector3, particles: Particles): FinaleFrame {
    this.time += dt;
    const t = this.time;
    const veil = t < BLUR_IN ? ease(t / BLUR_IN) : t < CLEAR ? 1 - ease((t - BLUR_IN - 0.1) / (CLEAR - BLUR_IN - 0.1)) : 0;
    const space = t >= BLUR_IN;
    const white = ease((t - FINALE_WHITE) / (END - FINALE_WHITE - 0.4));
    this.group.visible = space;
    if (!space) return { veil, space, white, done: false };

    if (!this.chase) {
      // Where the chase camera was when the land went: the pan starts and ends there
      this.pilot.copy(pilot);
      offset.subVectors(camera.position, pilot);
      const radius = Math.max(4, offset.length());
      this.chase = { azimuth: Math.atan2(offset.x, offset.z), elevation: Math.asin(clamp(offset.y / radius, -1, 1)), radius, lookUp: 1.2 };
      camera.getWorldDirection(tmp);
      this.startLook.copy(camera.position).addScaledVector(tmp, 20);
      // Beneath the pilot and off to one side, looking up past them at the sky
      this.below = { azimuth: this.chase.azimuth + 1.1, elevation: -0.95, radius: 11, lookUp: 7 };
    }
    const chase = this.chase;
    const below = this.below!;
    let k: number;
    if (t < CLEAR) k = 0;
    else if (t < PAN_DOWN) k = ease((t - CLEAR) / (PAN_DOWN - CLEAR));
    else if (t < HOLD) k = 1;
    else k = 1 - ease((t - HOLD) / (PAN_BACK - HOLD));
    // A slow drift while holding, so the view keeps breathing
    const drift = t >= PAN_DOWN ? Math.sin(((Math.min(t, PAN_BACK) - PAN_DOWN) / (PAN_BACK - PAN_DOWN)) * Math.PI) * 0.25 : 0;
    const azimuth = chase.azimuth + (below.azimuth - chase.azimuth) * k + drift;
    const elevation = chase.elevation + (below.elevation - chase.elevation) * k;
    const radius = chase.radius + (below.radius - chase.radius) * k;
    camera.position.set(
      Math.sin(azimuth) * Math.cos(elevation) * radius,
      Math.sin(elevation) * radius,
      Math.cos(azimuth) * Math.cos(elevation) * radius,
    ).add(this.pilot);
    // From where the chase camera looked, to above the pilot, and back
    look.copy(this.pilot).addScaledVector(UP, chase.lookUp + (below.lookUp - chase.lookUp) * k);
    const fromStart = t < PAN_DOWN ? 1 - ease((t - CLEAR) / 2.5) : t > HOLD ? ease((t - PAN_BACK + 2.5) / 2.5) : 0;
    look.lerp(this.startLook, clamp(fromStart, 0, 1));
    camera.up.copy(UP);
    camera.lookAt(look);
    this.group.position.copy(camera.position);

    // A few motes of light drift around the pilot in the void
    this.moteDebt += 10 * particles.budget * dt;
    for (; this.moteDebt >= 1; this.moteDebt--) {
      at.set(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).multiplyScalar(24).add(this.pilot);
      vel.set(Math.random() - 0.5, Math.random() * 0.4, Math.random() - 0.5).multiplyScalar(0.6);
      particles.emit(at, vel, fx(3 + Math.random() * 2, 0.08 + Math.random() * 0.14, Math.random() < 0.7 ? MOTE : GOLD, Kind.Glow, -0.05, 0.2, 2.2));
    }
    return { veil, space, white, done: t >= END };
  }

  dispose() {
    this.sky.geometry.dispose();
    this.sky.material.dispose();
    this.group.removeFromParent();
  }
}
