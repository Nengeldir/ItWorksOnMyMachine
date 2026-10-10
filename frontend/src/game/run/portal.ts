import * as THREE from "three";
import { clamp } from "../math";
import { Kind, type Particles, fx, fxTime } from "../particles";

// Portals end every level of a run: a ring of light around a flat disk that
// looks like a window onto deep night, with a beam rising from it so you can
// find it from anywhere. Flying in blurs the screen into sparkles, and you
// come out of the blur inside the wormhole (below), where the next biome is
// built while you choose an upgrade.

const veilVertex = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = position.xy;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const veilFragment = /* glsl */ `
  uniform vec3 color;
  uniform float time;
  uniform float open;
  uniform float radius;
  varying vec2 vUv;
  float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  void main() {
    vec2 p = vUv / radius;
    float r = length(p);
    // Offset so the angle is defined even at the very center (a NaN would blacken the bloom)
    float a = atan(p.y, p.x + 1e-5);
    // A flat disk that looks like a window onto deep night: stars swirling into the middle
    float spin = a + time * 0.25 + 1.6 / (r + 0.25);
    vec2 q = vec2(cos(spin), sin(spin)) * r * 9.0;
    vec2 cell = floor(q);
    vec2 f = fract(q) - 0.5;
    float h = hash(cell);
    float star = step(0.7, h) * exp(-dot(f, f) * 60.0) * (0.6 + 0.4 * sin(time * 3.0 + h * 40.0));
    vec3 night = mix(vec3(0.01, 0.012, 0.04), color * 0.18, smoothstep(0.1, 0.9, r)) + vec3(0.9, 0.95, 1.0) * star * 1.4;
    // A bright swirling rim and a soft light at the heart
    float swirl = 0.5 + 0.5 * sin(a * 3.0 + r * 11.0 - time * 3.2);
    float rim = smoothstep(0.62, 0.97, r) * (0.55 + 0.45 * swirl);
    float heart = exp(-r * r * 30.0);
    vec3 c = night + color * rim * 0.85 + mix(color, vec3(1.0), 0.6) * heart * 0.5;
    float edge = smoothstep(1.0, 0.95, r);
    gl_FragColor = vec4(c, clamp(edge * open * (0.92 + 0.08 * rim), 0.0, 1.0));
    #include <colorspace_fragment>
  }
`;

const beamVertex = /* glsl */ `
  varying float vHeight;
  varying float vFacing;
  void main() {
    vHeight = position.y;
    vec4 world = modelMatrix * vec4(position, 1.0);
    vec3 n = normalize(mat3(modelMatrix) * normal);
    vec3 toCamera = normalize(cameraPosition - world.xyz);
    vFacing = abs(dot(n, toCamera));
    gl_Position = projectionMatrix * viewMatrix * world;
  }
`;

const beamFragment = /* glsl */ `
  uniform vec3 color;
  uniform float time;
  uniform float open;
  uniform float height;
  varying float vHeight;
  varying float vFacing;
  void main() {
    float h = clamp(vHeight / height, 0.0, 1.0);
    float fade = (1.0 - h) * (1.0 - h);
    float flow = 0.75 + 0.25 * sin(vHeight * 0.05 - time * 3.0);
    float soft = pow(clamp(vFacing, 0.0, 1.0), 1.5);
    // Kept under the bloom threshold: a beam to steer by, not a glare
    gl_FragColor = vec4(color * soft * fade * flow * open * 0.5, 1.0);
    #include <colorspace_fragment>
  }
`;

export class Portal {
  readonly group = new THREE.Group();
  readonly position: THREE.Vector3;
  readonly normal: THREE.Vector3;
  readonly radius: number;
  open: boolean;
  private openness: number;
  private readonly color: THREE.Color;
  private readonly ring: THREE.Mesh;
  private readonly ringMaterial: THREE.MeshBasicMaterial;
  private readonly veil: THREE.Mesh<THREE.CircleGeometry, THREE.ShaderMaterial>;
  private readonly beam: THREE.Mesh<THREE.CylinderGeometry, THREE.ShaderMaterial>;
  private moteDebt = 0;

  constructor(position: THREE.Vector3, normal: THREE.Vector3, radius: number, color: string) {
    this.position = position.clone();
    this.normal = normal.clone().normalize();
    this.radius = radius;
    this.open = true;
    this.openness = this.open ? 1 : 0;
    this.color = new THREE.Color(color);

    const facing = new THREE.Group();
    facing.position.copy(position);
    facing.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), this.normal);
    this.group.add(facing);

    this.ringMaterial = new THREE.MeshBasicMaterial({ color: this.color.clone().multiplyScalar(2.2), fog: false });
    this.ring = new THREE.Mesh(new THREE.TorusGeometry(radius, Math.max(0.7, radius * 0.06), 10, 72), this.ringMaterial);
    facing.add(this.ring);
    this.veil = new THREE.Mesh(
      new THREE.CircleGeometry(radius, 64),
      new THREE.ShaderMaterial({
        uniforms: { color: { value: this.color }, time: fxTime, open: { value: this.openness }, radius: { value: radius } },
        vertexShader: veilVertex,
        fragmentShader: veilFragment,
        transparent: true,
        depthWrite: false,
        side: THREE.DoubleSide,
      }),
    );
    this.veil.renderOrder = 6;
    facing.add(this.veil);

    const height = 700;
    const beamGeometry = new THREE.CylinderGeometry(radius * 0.3, radius * 0.5, height, 24, 1, true).translate(0, height / 2, 0);
    this.beam = new THREE.Mesh(
      beamGeometry,
      new THREE.ShaderMaterial({
        uniforms: { color: { value: this.color }, time: fxTime, open: { value: this.openness }, height: { value: height } },
        vertexShader: beamVertex,
        fragmentShader: beamFragment,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide,
      }),
    );
    this.beam.position.copy(position);
    this.beam.renderOrder = 6;
    this.group.add(this.beam);
    this.apply();
  }

  private apply() {
    const o = this.openness;
    this.veil.material.uniforms.open.value = o;
    this.beam.material.uniforms.open.value = 0.25 + 0.75 * o;
    // A closed portal is a dull stone-grey ring
    this.ringMaterial.color.copy(this.color).multiplyScalar(0.35 + 1.9 * o);
  }

  /** Did a step from `a` to `b` pass through the open veil? */
  crossed(a: THREE.Vector3, b: THREE.Vector3, slack = 1): boolean {
    if (!this.open) return false;
    const before = this.normal.x * (a.x - this.position.x) + this.normal.y * (a.y - this.position.y) + this.normal.z * (a.z - this.position.z);
    const after = this.normal.x * (b.x - this.position.x) + this.normal.y * (b.y - this.position.y) + this.normal.z * (b.z - this.position.z);
    if (before >= 0 || after < 0) return false;
    const t = before / (before - after);
    const x = a.x + (b.x - a.x) * t - this.position.x;
    const y = a.y + (b.y - a.y) * t - this.position.y;
    const z = a.z + (b.z - a.z) * t - this.position.z;
    return Math.hypot(x, y, z) <= this.radius + slack;
  }

  update(dt: number, particles: Particles, camera: THREE.Vector3) {
    const target = this.open ? 1 : 0;
    if (this.openness !== target) {
      this.openness = clamp(this.openness + Math.sign(target - this.openness) * dt * 0.8, 0, 1);
      this.apply();
    }
    this.ring.rotation.z += dt * 0.4;
    // Light drifting around the rim, when you're near enough to see it
    if (this.openness <= 0 || this.position.distanceToSquared(camera) > 500 * 500) return;
    this.moteDebt += 40 * this.openness * particles.budget * dt;
    for (; this.moteDebt >= 1; this.moteDebt--) {
      const a = Math.random() * Math.PI * 2;
      at.set(Math.cos(a) * this.radius, Math.sin(a) * this.radius, 0).applyQuaternion(this.ring.parent!.quaternion).add(this.position);
      vel.set(-Math.sin(a), Math.cos(a), 0).applyQuaternion(this.ring.parent!.quaternion).multiplyScalar(4).addScaledVector(this.normal, Math.random() * 2 - 1);
      particles.emit(at, vel, fx(1 + Math.random(), 0.6 + Math.random() * 0.6, this.color, Kind.Star, -0.3, 0.8, 2.6));
    }
  }

  dispose() {
    this.ring.geometry.dispose();
    this.ringMaterial.dispose();
    this.veil.geometry.dispose();
    this.veil.material.dispose();
    this.beam.geometry.dispose();
    this.beam.material.dispose();
    this.group.removeFromParent();
  }
}

const at = new THREE.Vector3();
const vel = new THREE.Vector3();

// --- the wormhole -----------------------------------------------------------------------
//
// Inside a portal: no land, no sky, only a vast, dark, peaceful tube of night.
// A shell around the camera maps every view direction onto an endless tube
// along the direction of travel (depth = log((1 + cos θ) / (1 - cos θ))), so
// the starfield stretches into streaks and swirls into the far end like
// Interstellar's wormhole, nebula bands bend around it, and the way out
// glows far ahead inside a lensed ring of light. Spirits (soft motes) float
// everywhere, drifting past. It is drawn first and writes no depth, so the
// pilot stays visible in front of it; Game hides the world meanwhile.

const shellVertex = /* glsl */ `
  varying vec3 vDir;
  void main() {
    vDir = position;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const shellFragment = /* glsl */ `
  uniform vec3 from;
  uniform vec3 to;
  uniform float blend;
  uniform float time;
  varying vec3 vDir;

  float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
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
    for (int i = 0; i < 4; i++) {
      v += a * noise(p);
      p *= 2.03;
      a *= 0.5;
    }
    return v;
  }

  /**
   * Stars in one layer of cells around the tube, a pixel or two across wherever
   * they are (sized by the cells' size on screen), stretched into streaks
   * along the travel towards the far end
   */
  float stars(float around, float along, float cells, float rows, float density, float stretch) {
    vec2 uv = vec2(around * cells, along * rows);
    // Cell units per pixel; huge across the seam where the angle wraps, so no star there
    vec2 w = vec2(fwidth(uv.x), fwidth(uv.y));
    float px = max(w.x, w.y);
    vec2 cell = floor(uv);
    cell.x = mod(cell.x, cells);
    vec2 f = fract(uv) - 0.5;
    float h = hash(cell);
    vec2 offset = vec2(hash(cell + 7.13), hash(cell + 3.71)) - 0.5;
    vec2 q = (f - offset * 0.6) / max(vec2(1e-4), w * (1.1 + 1.4 * h));
    q.y /= stretch;
    float twinkle = 0.55 + 0.45 * sin(time * (0.7 + h * 2.3) + h * 50.0);
    // Cells smaller than a few pixels would only shimmer: fade the layer out there
    float resolved = 1.0 - smoothstep(0.12, 0.3, px);
    return step(1.0 - density, h) * exp(-dot(q, q)) * twinkle * (0.5 + h) * resolved;
  }

  void main() {
    vec3 d = normalize(vDir);
    float c = clamp(d.z, -0.9999, 0.9999);
    float theta = acos(c);
    float phi = atan(d.y, d.x + 1e-5);
    // Looking down an endless tube: depth runs to infinity at the far end
    float depth = log((1.0 + c) / (1.0 - c));
    float flow = depth - time * 0.22;
    // The tube twists: everything swirls slowly towards the way out
    float twist = phi + depth * 0.32 + time * 0.025;
    float around = fract(twist / 6.28318530718);

    vec3 tint = mix(from, to, blend);
    vec3 col = vec3(0.008, 0.01, 0.028);

    // Nebula bands bent around the tube, faint and deep
    vec3 np = vec3(cos(twist) * 1.4, sin(twist) * 1.4, flow * 0.35);
    float n = fbm(np);
    float n2 = fbm(np * 2.1 + vec3(5.2, 1.3, time * 0.02));
    float bands = 0.5 + 0.5 * sin(depth * 2.6 - time * 0.3 + n * 4.0);
    col += tint * 0.1 * pow(clamp(n, 0.0, 1.0), 2.4) * (0.4 + bands);
    col += vec3(0.16, 0.2, 0.55) * 0.14 * pow(clamp(n2, 0.0, 1.0), 3.0);
    col += vec3(0.5, 0.25, 0.6) * 0.06 * pow(clamp(1.0 - n, 0.0, 1.0), 4.0) * bands;

    // Stars: three layers, stretched into streaks towards the far end
    float stretch = 1.0 + 2.5 * smoothstep(1.2, 0.25, theta);
    float s = stars(around, flow, 60.0, 5.0, 0.11, stretch)
            + 0.6 * stars(fract(around + 0.37), flow * 1.7 + 4.0, 120.0, 9.0, 0.07, stretch)
            + 0.4 * stars(fract(around + 0.71), flow * 3.1 + 9.0, 220.0, 16.0, 0.05, stretch);
    // Too dense to resolve right at the far end: fade them into its glow
    s *= smoothstep(0.04, 0.25, theta);
    vec3 starColor = mix(vec3(0.75, 0.85, 1.0), vec3(1.0, 0.88, 0.72), hash(vec2(floor(around * 60.0), floor(flow * 5.0))));
    col += starColor * s * 1.5;

    // The way out: a soft light far ahead, inside a thin lensed ring
    float glow = exp(-theta * theta * 40.0);
    float ring = exp(-pow((theta - 0.17) * 34.0, 2.0)) * (0.7 + 0.3 * sin(phi * 3.0 + time * 0.6));
    col += mix(to, vec3(1.0), 0.35) * glow * 1.6 + mix(to, vec3(1.0), 0.6) * ring * 0.55;
    // Behind you, the dark you came from
    col *= 0.55 + 0.45 * smoothstep(-0.9, 0.2, c);
    gl_FragColor = vec4(col, 1.0);
    #include <colorspace_fragment>
  }
`;

const spiritVertex = /* glsl */ `
  attribute vec4 seed;
  uniform float time;
  uniform float pixelScale;
  varying vec3 vColor;
  varying float vAlpha;
  varying float vStar;
  void main() {
    // Each spirit floats on its own slow path through the tube, drifting past you
    float span = 150.0;
    float z = mod(seed.z * span - time * (1.5 + seed.w * 3.5), span) - 25.0;
    float angle = seed.y * 6.28318 + time * 0.06 * (seed.w - 0.5) + sin(time * 0.3 + seed.x * 9.0) * 0.15;
    float r = 2.5 + pow(seed.x, 0.7) * 45.0;
    vec3 p = vec3(cos(angle) * r, sin(angle) * r, z);
    p += vec3(sin(time * 0.7 + seed.z * 31.0), cos(time * 0.5 + seed.y * 17.0), 0.0) * (0.4 + seed.w);
    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    gl_Position = projectionMatrix * mv;
    float size = 0.12 + seed.w * seed.w * 0.55;
    gl_PointSize = clamp(size * pixelScale / max(0.5, -mv.z), 1.0, 48.0);
    // Soft colors: moonlight, pale gold, a little rose
    vec3 moon = vec3(0.7, 0.88, 1.0);
    vec3 gold = vec3(1.0, 0.86, 0.55);
    vec3 rose = vec3(1.0, 0.68, 0.85);
    vColor = seed.y < 0.55 ? moon : seed.y < 0.85 ? gold : rose;
    float twinkle = 0.45 + 0.55 * (0.5 + 0.5 * sin(time * (0.8 + seed.x * 2.0) + seed.z * 40.0));
    float near = smoothstep(1.5, 6.0, -mv.z);
    float far = 1.0 - smoothstep(90.0, 125.0, z);
    vAlpha = twinkle * near * far;
    vStar = step(0.8, fract(seed.x * 13.7));
  }
`;

const spiritFragment = /* glsl */ `
  uniform float opacity;
  varying vec3 vColor;
  varying float vAlpha;
  varying float vStar;
  void main() {
    vec2 uv = gl_PointCoord * 2.0 - 1.0;
    float r2 = dot(uv, uv);
    float a = exp(-r2 * 6.0) + exp(-r2 * 40.0) * 0.8;
    // Some spirits twinkle with four little rays
    vec2 q = abs(uv);
    a += vStar * (exp(-q.x * 22.0) * exp(-q.y * 3.0) + exp(-q.y * 22.0) * exp(-q.x * 3.0)) * 0.7;
    if (a < 0.01) discard;
    gl_FragColor = vec4(vColor * a * vAlpha * opacity * 1.6, 1.0);
    #include <colorspace_fragment>
  }
`;

const SPIRITS = 1100;

/** The inside of a portal: a dark tube of stars and spirits around the camera */
export class Wormhole {
  readonly group = new THREE.Group();
  private readonly shell: THREE.Mesh<THREE.SphereGeometry, THREE.ShaderMaterial>;
  private readonly spirits: THREE.Points<THREE.BufferGeometry, THREE.ShaderMaterial>;
  private readonly exitLight: THREE.DirectionalLight;

  constructor() {
    this.shell = new THREE.Mesh(
      new THREE.SphereGeometry(60, 64, 40),
      new THREE.ShaderMaterial({
        uniforms: { from: { value: new THREE.Color() }, to: { value: new THREE.Color() }, blend: { value: 0 }, time: fxTime },
        vertexShader: shellVertex,
        fragmentShader: shellFragment,
        side: THREE.BackSide,
        depthTest: false,
        depthWrite: false,
        fog: false,
      }),
    );
    // Drawn before anything else, writing no depth: the pilot draws over it
    this.shell.renderOrder = -1000;
    this.shell.frustumCulled = false;

    const seeds = new Float32Array(SPIRITS * 4);
    for (let i = 0; i < seeds.length; i++) seeds[i] = Math.random();
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(new Float32Array(SPIRITS * 3), 3));
    geometry.setAttribute("seed", new THREE.BufferAttribute(seeds, 4));
    this.spirits = new THREE.Points(
      geometry,
      new THREE.ShaderMaterial({
        uniforms: { time: fxTime, pixelScale: { value: 800 }, opacity: { value: 1 } },
        vertexShader: spiritVertex,
        fragmentShader: spiritFragment,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        fog: false,
      }),
    );
    this.spirits.renderOrder = 8;
    this.spirits.frustumCulled = false;
    // The level's lights are hidden with it: moonlight from all around, and the way out lights the pilot from ahead
    const exitLight = new THREE.DirectionalLight("#eaf2ff", 1.6);
    exitLight.position.set(0, 0.6, 1);
    this.exitLight = exitLight;
    this.group.add(this.shell, this.spirits, new THREE.HemisphereLight("#9fb2ff", "#3a2a60", 1.1), exitLight, exitLight.target);
    this.group.visible = false;
  }

  /** Sets the colors: from this biome's light, towards the next one's */
  colors(from: THREE.ColorRepresentation, to: THREE.ColorRepresentation) {
    this.shell.material.uniforms.from.value.set(from);
    this.shell.material.uniforms.to.value.set(to);
    this.exitLight.color.set(to).lerp(WHITE, 0.6);
  }

  /**
   * Puts the wormhole around the camera, its far end straight ahead along
   * `forward`. `inside` false hides it; `blend` moves the colors towards the next biome
   */
  place(camera: THREE.Camera, forward: THREE.Vector3, inside: boolean, blend: number, pixelHeight: number) {
    this.group.visible = inside;
    if (!inside) return;
    this.group.position.copy(camera.position);
    this.group.quaternion.setFromUnitVectors(Z, forward);
    this.shell.material.uniforms.blend.value = blend;
    const fov = (camera as THREE.PerspectiveCamera).fov ?? 70;
    this.spirits.material.uniforms.pixelScale.value = pixelHeight / (2 * Math.tan(THREE.MathUtils.degToRad(fov) / 2));
  }

  dispose() {
    this.shell.geometry.dispose();
    this.shell.material.dispose();
    this.spirits.geometry.dispose();
    this.spirits.material.dispose();
    this.group.removeFromParent();
  }
}

/** Sparkles thrown across the view as you pass through a portal */
export function screenSparkle(particles: Particles, camera: THREE.Camera, forward: THREE.Vector3, color: THREE.Color) {
  const count = Math.round(110 * particles.budget);
  for (let k = 0; k < count; k++) {
    // In a cone in front of the camera, close enough to fill the screen
    at.set(Math.random() * 2 - 1, Math.random() * 2 - 1, Math.random() * 2 - 1).normalize().multiplyScalar(2 + Math.random() * 3);
    at.addScaledVector(forward, 3 + Math.random() * 5).add(camera.position);
    vel.subVectors(at, camera.position).normalize().multiplyScalar(1 + Math.random() * 3);
    particles.emit(at, vel, k % 3 ? fx(0.8 + Math.random() * 0.8, 0.1 + Math.random() * 0.15, WHITE, Kind.Star, 0, 1.5, 2.8) : fx(0.9 + Math.random() * 0.6, 0.15 + Math.random() * 0.2, color, Kind.Glow, 0, 1.2, 2.4));
  }
}

const WHITE = new THREE.Color("#ffffff");
const Z = new THREE.Vector3(0, 0, 1);
