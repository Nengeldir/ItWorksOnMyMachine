import * as THREE from "three";
import { makeRng, range } from "../rng";
import { ATMOSPHERE } from "./atmosphere";
import type { World } from "./World";

// Soft clouds for the generator-v2 biomes: each cloud a cluster of puffs drawn
// as camera-facing billboards in one instanced draw call. Puffs are lit from
// the sun's side, darker underneath, with a silver lining against the sun, dim
// by moonlight, and they thin out as you fly into them, so cloud banks across
// the line can be flown straight through.

const vertexShader = /* glsl */ `
  attribute vec4 puff; // center x, y, z and size
  attribute vec2 shade; // height within its cloud (0 bottom … 1 top), seed
  varying vec2 vUv;
  varying vec2 vShade;
  varying vec3 vWorld;
  #include <fog_pars_vertex>
  void main() {
    vec3 right = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]);
    vec3 up = vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]);
    vec3 world = puff.xyz + (right * position.x + up * position.y) * puff.w;
    vUv = position.xy;
    vShade = shade;
    vWorld = world;
    vec4 mvPosition = viewMatrix * vec4(world, 1.0);
    gl_Position = projectionMatrix * mvPosition;
    #include <fog_vertex>
  }
`;

const fragmentShader = /* glsl */ `
  uniform vec3 cloudColor;
  uniform vec3 horizon;
  uniform vec3 atmoSunDirection;
  uniform vec3 atmoSunColor;
  uniform float night;
  varying vec2 vUv;
  varying vec2 vShade;
  varying vec3 vWorld;
  #include <fog_pars_fragment>
  float cloudHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float cloudNoise(vec2 p) {
    vec2 i = floor(p), f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(cloudHash(i), cloudHash(i + vec2(1.0, 0.0)), u.x), mix(cloudHash(i + vec2(0.0, 1.0)), cloudHash(i + vec2(1.0, 1.0)), u.x), u.y);
  }
  void main() {
    float r = length(vUv);
    float lumps = cloudNoise(vUv * 2.6 + vShade.y * 17.0) * 0.6 + cloudNoise(vUv * 5.3 - vShade.y * 9.0) * 0.4;
    float a = smoothstep(1.0, 0.25, r + (lumps - 0.5) * 0.45);
    if (a < 0.01) discard;
    vec3 toFrag = vWorld - cameraPosition;
    float dist = length(toFrag);
    vec3 viewDir = toFrag / max(dist, 0.001);
    // Lit on top and towards the sun, greyer underneath
    float lit = clamp(vShade.x * 0.7 + vUv.y * 0.25 + 0.25, 0.0, 1.0);
    // By night clouds are moonlit veils, close to the sky behind them, not dark blots
    vec3 shadow = mix(mix(cloudColor, horizon, 0.45) * 0.72, horizon * 1.1, night * 0.7);
    vec3 color = mix(shadow, mix(cloudColor * 1.05, mix(cloudColor, horizon, 0.5) * 1.35, night), lit);
    float towardsSun = max(dot(viewDir, atmoSunDirection), 0.0);
    color += atmoSunColor * pow(towardsSun, 8.0) * (1.0 - a) * 1.2 * (1.0 - night * 0.6);
    // Thin out up close, so flying into a cloud is a soft whiteout, not a wall
    a *= smoothstep(8.0, 70.0, dist) * mix(0.92, 0.6, night);
    #ifdef USE_FOG
      color = mix(color, fogColor, smoothstep(fogNear, fogFar, vFogDepth) * 0.85);
    #endif
    gl_FragColor = vec4(color, a);
    #include <colorspace_fragment>
  }
`;

export class SoftClouds {
  readonly mesh: THREE.Mesh;

  constructor(world: World, count: number, lift: number, banks: number) {
    const { course, seed, palette } = world;
    const rng = makeRng(seed, "soft clouds");
    const puffs: number[] = [];
    const shades: number[] = [];
    const cloud = (cx: number, cy: number, cz: number, width: number, height: number, n: number) => {
      for (let i = 0; i < n; i++) {
        const u = range(rng, -1, 1);
        const v = range(rng, 0, 1);
        const size = range(rng, 0.45, 0.8) * height * (1 - Math.abs(u) * 0.4);
        puffs.push(cx + u * width * 0.5, cy + v * height * 0.6, cz + range(rng, -0.3, 0.3) * width, size);
        shades.push(v, rng());
      }
    };
    for (let i = 0; i < count; i++) {
      const z = range(rng, course.start.z - 500, course.endZ + 1300);
      const width = range(rng, 110, 260);
      cloud(course.x(z) + range(rng, -900, 900), course.y(z) + range(rng, 160, 380) + lift, z, width, width * range(rng, 0.3, 0.45), 6 + Math.floor(rng() * 6));
    }
    // Banks across the racing line: fly straight through them
    for (let i = 0; i < banks; i++) {
      const z = range(rng, course.start.z + 200, course.endZ - 100);
      const width = range(rng, 120, 200);
      cloud(course.x(z) + range(rng, -40, 40), course.y(z) - width * 0.12, z, width, width * 0.35, 10);
    }
    const geometry = new THREE.InstancedBufferGeometry();
    geometry.setAttribute("position", new THREE.Float32BufferAttribute([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0], 3));
    geometry.setIndex([0, 1, 2, 0, 2, 3]);
    geometry.setAttribute("puff", new THREE.InstancedBufferAttribute(new Float32Array(puffs), 4));
    geometry.setAttribute("shade", new THREE.InstancedBufferAttribute(new Float32Array(shades), 2));
    geometry.instanceCount = puffs.length / 4;
    const material = new THREE.ShaderMaterial({
      uniforms: {
        ...THREE.UniformsUtils.clone(THREE.UniformsLib.fog),
        cloudColor: { value: new THREE.Color(palette.cloud) },
        horizon: ATMOSPHERE.horizon,
        atmoSunDirection: ATMOSPHERE.sunDirection,
        atmoSunColor: ATMOSPHERE.sunColor,
        night: ATMOSPHERE.night,
      },
      vertexShader,
      fragmentShader,
      transparent: true,
      depthWrite: false,
      fog: true,
    });
    this.mesh = new THREE.Mesh(geometry, material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 3;
  }

  dispose() {
    this.mesh.geometry.dispose();
    (this.mesh.material as THREE.Material).dispose();
  }
}
