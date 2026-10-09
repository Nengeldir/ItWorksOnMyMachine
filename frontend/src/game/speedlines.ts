import * as THREE from "three";
import { FX } from "./tuning";

const COUNT = 90;

const vertexShader = /* glsl */ `
  attribute vec3 shade; // x: 0 head .. 1 tail, y: -1..1 across, z: brightness
  varying vec3 vShade;
  void main() {
    vShade = shade;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const fragmentShader = /* glsl */ `
  uniform vec3 color;
  varying vec3 vShade;
  void main() {
    float along = sin(3.14159 * vShade.x);
    float across = 1.0 - vShade.y * vShade.y;
    gl_FragColor = vec4(color * along * across * vShade.z, 1.0);
  }
`;

interface Streak {
  position: THREE.Vector3;
  age: number;
  life: number;
  length: number;
  brightness: number;
}

const tmp = new THREE.Vector3();
const side = new THREE.Vector3();
const toCamera = new THREE.Vector3();
const tail = new THREE.Vector3();
const basisA = new THREE.Vector3();
const basisB = new THREE.Vector3();

/**
 * Wind streaks, like gliding in Genshin: thin lines that hang in the air ahead
 * of you and rush past as you fly through them. More and longer with speed.
 */
export class SpeedLines {
  readonly mesh: THREE.Mesh<THREE.BufferGeometry, THREE.ShaderMaterial>;
  private readonly streaks: Streak[] = [];
  private readonly positions = new Float32Array(COUNT * 4 * 3);
  private readonly shade = new Float32Array(COUNT * 4 * 3);
  private spawnDebt = 0;

  constructor() {
    const index: number[] = [];
    for (let i = 0; i < COUNT; i++) {
      const a = i * 4;
      index.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
      this.shade.set([0, 1, 0, 0, -1, 0, 1, 1, 0, 1, -1, 0], i * 12);
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(this.positions, 3).setUsage(THREE.DynamicDrawUsage));
    geometry.setAttribute("shade", new THREE.BufferAttribute(this.shade, 3).setUsage(THREE.DynamicDrawUsage));
    geometry.setIndex(index);
    this.mesh = new THREE.Mesh(
      geometry,
      new THREE.ShaderMaterial({
        uniforms: { color: { value: new THREE.Color("#ffffff") } },
        vertexShader,
        fragmentShader,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      }),
    );
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 6;
  }

  setColor(color: THREE.ColorRepresentation) {
    (this.mesh.material.uniforms.color.value as THREE.Color).set(color).lerp(new THREE.Color("#ffffff"), 0.7);
  }

  reset() {
    this.streaks.length = 0;
  }

  update(dt: number, position: THREE.Vector3, velocity: THREE.Vector3, camera: THREE.Camera, budget: number) {
    const speed = velocity.length();
    const strength = THREE.MathUtils.clamp((speed - FX.speedLinesFrom) / 45, 0, 1) * FX.speedLines;
    const dir = tmp.copy(velocity).divideScalar(Math.max(speed, 1e-3));

    // New streaks ahead of the pilot, in a tube around the flight path
    this.spawnDebt += strength * 90 * budget * dt;
    if (Math.abs(dir.y) < 0.95) basisA.crossVectors(dir, THREE.Object3D.DEFAULT_UP).normalize();
    else basisA.set(1, 0, 0);
    basisB.crossVectors(basisA, dir);
    while (this.spawnDebt >= 1 && this.streaks.length < COUNT) {
      this.spawnDebt -= 1;
      const angle = Math.random() * Math.PI * 2;
      const radius = 2.5 + Math.random() * 11;
      const ahead = 12 + Math.random() * 45;
      this.streaks.push({
        position: new THREE.Vector3()
          .copy(position)
          .addScaledVector(dir, ahead)
          .addScaledVector(basisA, Math.cos(angle) * radius)
          .addScaledVector(basisB, Math.sin(angle) * radius),
        age: 0,
        life: 0.35 + Math.random() * 0.4,
        length: speed * (0.05 + Math.random() * 0.06),
        brightness: (0.25 + Math.random() * 0.5) * strength,
      });
    }
    this.spawnDebt = Math.min(this.spawnDebt, 1);

    let n = 0;
    for (let i = this.streaks.length - 1; i >= 0; i--) {
      const s = this.streaks[i];
      s.age += dt;
      if (s.age >= s.life) {
        this.streaks[i] = this.streaks[this.streaks.length - 1];
        this.streaks.pop();
        continue;
      }
      // Each streak is a quad along the flight direction, turned to face the camera
      tail.copy(s.position).addScaledVector(dir, -s.length);
      toCamera.subVectors(camera.position, s.position);
      side.crossVectors(dir, toCamera).normalize().multiplyScalar(0.03 + s.length * 0.004);
      const fade = Math.sin((Math.PI * s.age) / s.life) * s.brightness;
      const k = n * 12;
      this.positions.set(
        [
          s.position.x + side.x, s.position.y + side.y, s.position.z + side.z,
          s.position.x - side.x, s.position.y - side.y, s.position.z - side.z,
          tail.x + side.x, tail.y + side.y, tail.z + side.z,
          tail.x - side.x, tail.y - side.y, tail.z - side.z,
        ],
        k,
      );
      for (let v = 0; v < 4; v++) this.shade[k + v * 3 + 2] = fade;
      n++;
    }
    const geometry = this.mesh.geometry;
    geometry.setDrawRange(0, n * 6);
    geometry.getAttribute("position").needsUpdate = true;
    geometry.getAttribute("shade").needsUpdate = true;
    this.mesh.visible = n > 0;
  }

  dispose() {
    this.mesh.geometry.dispose();
    this.mesh.material.dispose();
  }
}
