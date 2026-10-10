import * as THREE from "three";
import { fxTime } from "../particles";
import { makeRng, range } from "../rng";
import { ATMOSPHERE } from "../world/atmosphere";
import type { Course } from "../world/course";
import type { Palette } from "../world/palette";
import { type CloudLane, laneAt, laneFade } from "../run/abilities";

// The rivers of cloud Cloud-Surfing gathers along the racing line: soft
// puffs packed into a long, low bank just under the line, so its top is a
// rolling surface to skim. Drawn like the soft clouds (camera-facing puffs
// in one instanced draw, lit from the sun's side, moonlit at night), but
// they stay solid-looking up close, since you surf a few metres over them.
// Looks only: what surfing does is in run/abilities.ts.

const vertexShader = /* glsl */ `
  attribute vec4 puff; // center x, y, z and size
  attribute vec2 shade; // height within the bank (0 bottom … 1 top), seed
  uniform float time;
  varying vec2 vUv;
  varying vec2 vShade;
  varying vec3 vWorld;
  #include <fog_pars_vertex>
  void main() {
    vec3 right = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]);
    vec3 up = vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]);
    // Puffs breathe and roll gently
    vec3 center = puff.xyz + vec3(0.0, sin(time * 0.7 + shade.y * 40.0) * 0.25, sin(time * 0.4 + shade.y * 17.0) * 0.4);
    float size = puff.w * (1.0 + 0.05 * sin(time * 0.9 + shade.y * 23.0));
    vec3 world = center + (right * position.x + up * position.y) * size;
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
  uniform float heat; // Thermal Vision: a warm glow on the lanes seen from afar
  uniform vec3 heatColor;
  varying vec2 vUv;
  varying vec2 vShade;
  varying vec3 vWorld;
  #include <fog_pars_fragment>
  float laneHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float laneNoise(vec2 p) {
    vec2 i = floor(p), f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(laneHash(i), laneHash(i + vec2(1.0, 0.0)), u.x), mix(laneHash(i + vec2(0.0, 1.0)), laneHash(i + vec2(1.0, 1.0)), u.x), u.y);
  }
  void main() {
    float r = length(vUv);
    float lumps = laneNoise(vUv * 2.4 + vShade.y * 17.0) * 0.6 + laneNoise(vUv * 5.1 - vShade.y * 9.0) * 0.4;
    float a = smoothstep(1.0, 0.3, r + (lumps - 0.5) * 0.5);
    if (a < 0.01) discard;
    vec3 toFrag = vWorld - cameraPosition;
    float dist = length(toFrag);
    vec3 viewDir = toFrag / max(dist, 0.001);
    // Lit on top, greyer underneath; moonlit veils by night
    float lit = clamp(vShade.x * 0.75 + vUv.y * 0.3 + 0.2, 0.0, 1.0);
    vec3 shadow = mix(mix(cloudColor, horizon, 0.4) * 0.75, horizon * 1.1, night * 0.7);
    vec3 color = mix(shadow, mix(cloudColor * 1.08, mix(cloudColor, horizon, 0.5) * 1.35, night), lit);
    float towardsSun = max(dot(viewDir, atmoSunDirection), 0.0);
    color += atmoSunColor * pow(towardsSun, 8.0) * (1.0 - a) * 1.2 * (1.0 - night * 0.6);
    // A soft shimmer of light running along the top, like Sky's cloud seas
    color += vec3(1.0, 0.97, 0.9) * smoothstep(0.7, 1.0, vShade.x) * smoothstep(0.2, 0.9, vUv.y) * 0.18 * (1.0 + night);
    color += heatColor * heat * smoothstep(60.0, 220.0, dist) * (0.5 + 0.5 * vShade.x);
    // Up close they thin out (you surf a few metres over them, the camera just behind)
    a *= smoothstep(3.0, 14.0, dist) * mix(0.85, 0.7, night);
    // Soft, never glaring: clouds stay under the bloom threshold, even stacked
    color = min(color, vec3(0.97));
    #ifdef USE_FOG
      color = mix(color, fogColor, smoothstep(fogNear, fogFar, vFogDepth) * 0.85);
    #endif
    gl_FragColor = vec4(color, a);
    #include <colorspace_fragment>
  }
`;

export class CloudLanes {
  readonly mesh: THREE.Mesh<THREE.InstancedBufferGeometry, THREE.ShaderMaterial>;

  /** `clearance` is the distance to anything solid: puffs shrink away from rock, so none cuts into it */
  constructor(course: Course, lanes: readonly CloudLane[], palette: Palette, seed: number, clearance: (x: number, y: number, z: number) => number) {
    const rng = makeRng(seed, "cloud lane puffs");
    const puffs: number[] = [];
    const shades: number[] = [];
    const top = new THREE.Vector3();
    const puff = (x: number, y: number, z: number, size: number, height: number) => {
      const fit = Math.min(size, clearance(x, y, z) * 0.9);
      if (fit < 1.2) return;
      puffs.push(x, y, z, fit);
      shades.push(height, rng());
    };
    for (const lane of lanes) {
      for (let z = lane.z0; z < lane.z1; z += 3.2) {
        const fade = laneFade(lane, z);
        if (fade < 0.05) continue;
        laneAt(course, lane, z, top);
        const half = (lane.width / 2) * (0.35 + 0.65 * fade);
        // The top: a row of puffs across, biggest in the middle
        for (let i = 0; i < 6; i++) {
          const u = range(rng, -1, 1);
          const size = range(rng, 3.4, 6.5) * (1 - Math.abs(u) * 0.45) * (0.55 + 0.45 * fade);
          puff(top.x + u * half, top.y - size * 0.62 + range(rng, -0.3, 0.3), z + range(rng, -1.6, 1.6), size, range(rng, 0.7, 1));
        }
        // Body: fewer, bigger puffs underneath, so it reads as a bank from the side
        if (rng() < 0.6) {
          const size = range(rng, 5, 7.5) * (0.6 + 0.4 * fade);
          puff(top.x + range(rng, -0.6, 0.6) * half, top.y - size * 1.1, z, size, range(rng, 0.1, 0.4));
        }
      }
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
        time: fxTime,
        heat: { value: 0 },
        heatColor: { value: new THREE.Color("#ff9a5a") },
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

  /** Thermal Vision's warm glow, 0..1 */
  set heat(value: number) {
    this.mesh.material.uniforms.heat.value = value;
  }

  dispose() {
    this.mesh.geometry.dispose();
    this.mesh.material.dispose();
  }
}
