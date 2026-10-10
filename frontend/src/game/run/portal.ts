import * as THREE from "three";
import { clamp } from "../math";
import { Kind, type Particles, fx, fxTime } from "../particles";

// Portals end every level of a run: a ring of light around a swirling veil,
// with a beam rising from it so you can find it from anywhere. Flying in
// starts the tunnel: streaks
// of light rushing past while the next biome is built behind them.

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
  void main() {
    vec2 p = vUv / radius;
    float r = length(p);
    // Offset so the angle is defined even at the very center (a NaN would blacken the bloom)
    float a = atan(p.y, p.x + 1e-5);
    float swirl = 0.5 + 0.5 * sin(a * 3.0 + r * 11.0 - time * 3.2);
    float swirl2 = 0.5 + 0.5 * sin(-a * 5.0 + r * 7.0 - time * 2.1);
    float core = exp(-r * r * 6.0);
    float edge = smoothstep(1.0, 0.82, r);
    vec3 c = color * (0.5 + 0.7 * swirl * swirl2) + vec3(1.0) * core * 0.9;
    float alpha = edge * open * (0.3 + 0.4 * swirl + 0.35 * core);
    gl_FragColor = vec4(c, clamp(alpha, 0.0, 1.0));
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

const tunnelVertex = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const tunnelFragment = /* glsl */ `
  uniform vec3 from;
  uniform vec3 to;
  uniform float blend;
  uniform float time;
  uniform float opacity;
  varying vec2 vUv;
  void main() {
    // Streaks rushing along the tunnel, in bands around it
    float along = vUv.y * 14.0 + time * 9.0;
    float around = vUv.x * 32.0;
    float streak = smoothstep(0.55, 1.0, sin(along + sin(around * 0.7) * 2.0) * 0.5 + 0.5);
    float bands = 0.5 + 0.5 * sin(around + time * 1.5);
    vec3 color = mix(from, to, blend);
    // Mostly below the bloom threshold: only the streaks' cores glow
    vec3 c = color * (0.35 + 0.35 * bands) + mix(color, vec3(1.0), 0.5) * streak * 0.9;
    // The far end glows like a light at the end of the tunnel
    c += color * smoothstep(0.8, 1.0, vUv.y) * 0.8;
    gl_FragColor = vec4(c, opacity);
    #include <colorspace_fragment>
  }
`;

/** The tunnel between biomes: a sleeve of rushing light around the camera */
export class Tunnel {
  readonly mesh: THREE.Mesh<THREE.CylinderGeometry, THREE.ShaderMaterial>;

  constructor() {
    const geometry = new THREE.CylinderGeometry(7, 7, 220, 40, 1, true).rotateX(Math.PI / 2);
    this.mesh = new THREE.Mesh(
      geometry,
      new THREE.ShaderMaterial({
        uniforms: {
          from: { value: new THREE.Color() },
          to: { value: new THREE.Color() },
          blend: { value: 0 },
          time: fxTime,
          opacity: { value: 0 },
        },
        vertexShader: tunnelVertex,
        fragmentShader: tunnelFragment,
        transparent: true,
        depthWrite: false,
        depthTest: false,
        side: THREE.BackSide,
        fog: false,
      }),
    );
    this.mesh.renderOrder = 20;
    this.mesh.frustumCulled = false;
    this.mesh.visible = false;
  }

  /** Sets the colors: from this biome's portal, towards the next one's */
  colors(from: THREE.ColorRepresentation, to: THREE.ColorRepresentation) {
    this.mesh.material.uniforms.from.value.set(from);
    this.mesh.material.uniforms.to.value.set(to);
  }

  /** Places the tunnel around the camera, looking along `forward`; opacity 0 hides it */
  place(camera: THREE.Vector3, forward: THREE.Vector3, opacity: number, blend: number) {
    this.mesh.visible = opacity > 0.001;
    this.mesh.position.copy(camera);
    this.mesh.quaternion.setFromUnitVectors(Z, forward);
    this.mesh.material.uniforms.opacity.value = opacity;
    this.mesh.material.uniforms.blend.value = blend;
  }

  dispose() {
    this.mesh.geometry.dispose();
    this.mesh.material.dispose();
  }
}

const Z = new THREE.Vector3(0, 0, 1);
