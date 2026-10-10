import * as THREE from "three";
import { fxTime } from "../../particles";
import { TOON_LIGHT } from "../../toon";
import { FLORA } from "../../tuning";
import { ATMOSPHERE, MIST, atmospheric } from "../atmosphere";
import type { FloraSpecies, VegetationSpec } from "../biomes/types";
import { sunDirection } from "../palette";
import type { World } from "../World";
import { speciesGeometry } from "./meshes";
import { InstancePool } from "./pool";
import { PLANT_STRIDE, SPECIES, TUFT_STRIDE } from "./species";

// Draws a biome's plants: full meshes near the camera (one instanced pool per
// species, swaying in the wind), camera-facing impostors further out (one pool
// for every species, drawn from an atlas baked at load), and grass tufts and
// flowers close by. Land nodes hand over their plants when they come on screen
// and take them back when they go.

/** Shared by every plant material: wind, time and how much caps and crystals glow */
const FLORA_UNIFORMS = {
  time: fxTime,
  glow: { value: 0.2 },
  gust: { value: 1 },
};

const ATLAS_COLUMNS = 4;
const ATLAS_ROWS = 4;
const CELL_W = 256;
const CELL_H = 128;
/** The atlas frames each species from x = -FRAME_X..FRAME_X and y = FRAME_Y0..FRAME_Y1, in unit sizes */
const FRAME_X = 1.15;
const FRAME_Y0 = -0.05;
const FRAME_Y1 = 1.1;

/** Lambert, hazed by the atmosphere, with leaves moving in the wind and self-lit parts */
function plantMaterial(sway: number, grass = false): THREE.MeshLambertMaterial {
  const material = atmospheric(new THREE.MeshLambertMaterial({ vertexColors: !grass, side: grass ? THREE.DoubleSide : THREE.FrontSide }), 0);
  const atmosphere = material.onBeforeCompile;
  const wind = { value: sway };
  material.onBeforeCompile = (shader, renderer) => {
    atmosphere(shader, renderer);
    shader.uniforms.floraTime = FLORA_UNIFORMS.time;
    shader.uniforms.floraGlow = FLORA_UNIFORMS.glow;
    shader.uniforms.floraGust = FLORA_UNIFORMS.gust;
    shader.uniforms.floraWind = wind;
    shader.uniforms.floraFade = { get value() { return FLORA.grassDistance; } };
    shader.vertexShader = shader.vertexShader
      .replace(
        "void main() {",
        `attribute float sway;
        ${grass ? "" : "attribute float glow;"}
        uniform float floraTime;
        uniform float floraWind;
        uniform float floraGust;
        uniform float floraFade;
        varying float vGlow;
        varying float vBlade;
        void main() {`,
      )
      .replace(
        "#include <beginnormal_vertex>",
        grass ? "vec3 objectNormal = vec3(0.0, 1.0, 0.0);" : "#include <beginnormal_vertex>",
      )
      .replace(
        "#include <begin_vertex>",
        `#include <begin_vertex>
        {
          #ifdef USE_INSTANCING
            vec3 root = vec3(instanceMatrix[3][0], instanceMatrix[3][1], instanceMatrix[3][2]);
          #else
            vec3 root = vec3(0.0);
          #endif
          float phase = root.x * 0.11 + root.z * 0.07;
          // Gusts roll across the land
          float gust = 0.55 + 0.45 * sin(floraTime * 0.7 - root.x * 0.012 - root.z * 0.008);
          float w = sway * floraWind * floraGust * gust;
          transformed.x += w * (sin(floraTime * 1.7 + phase) * 0.7 + sin(floraTime * 3.3 + phase * 1.9) * 0.3);
          transformed.z += w * cos(floraTime * 1.3 + phase) * 0.5;
          ${grass ? `
          // Tufts shrink away with distance instead of popping
          float far = distance(root, cameraPosition);
          transformed *= 1.0 - smoothstep(floraFade * 0.7, floraFade, far);
          vBlade = sway;` : "vGlow = glow;"}
        }`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        "void main() {",
        `uniform float floraGlow;
        varying float vGlow;
        varying float vBlade;
        void main() {`,
      )
      .replace(
        "#include <color_fragment>",
        grass
          ? `#include <color_fragment>
          diffuseColor.rgb *= 0.55 + 0.6 * vBlade;`
          : "#include <color_fragment>",
      )
      .replace(
        "#include <emissivemap_fragment>",
        grass
          ? "#include <emissivemap_fragment>"
          : `#include <emissivemap_fragment>
          totalEmissiveRadiance += diffuseColor.rgb * vGlow * floraGlow;`,
      );
  };
  material.customProgramCacheKey = () => `wingrace-flora-${grass}`;
  return material;
}

const impostorVertex = /* glsl */ `
  uniform vec2 cells;
  varying vec2 vUv;
  varying vec3 vTint;
  varying vec3 vWorld;
  #include <fog_pars_vertex>
  void main() {
    // instanceMatrix carries the plant's foot (column 3), width and height (scales of x and y) and atlas cell (z scale)
    vec3 foot = vec3(instanceMatrix[3][0], instanceMatrix[3][1], instanceMatrix[3][2]);
    float width = instanceMatrix[0][0];
    float height = instanceMatrix[1][1];
    float cell = floor(instanceMatrix[2][2] + 0.5);
    // Turn to face the camera, about the vertical only
    vec3 toCamera = cameraPosition - foot;
    vec3 right = normalize(vec3(toCamera.z, 0.0, -toCamera.x) + vec3(1e-4, 0.0, 0.0));
    vec3 world = foot + right * position.x * width + vec3(0.0, (position.y + ${FRAME_Y0.toFixed(3)}) * height, 0.0);
    vec2 corner = vec2(mod(cell, cells.x), floor(cell / cells.x));
    vUv = (corner + vec2(position.x * 0.5 + 0.5, position.y / ${(FRAME_Y1 - FRAME_Y0).toFixed(3)})) / cells;
    vTint = instanceColor;
    vWorld = world;
    vec4 mvPosition = viewMatrix * vec4(world, 1.0);
    gl_Position = projectionMatrix * mvPosition;
    #include <fog_vertex>
  }
`;

const impostorFragment = /* glsl */ `
  uniform sampler2D atlas;
  uniform vec3 atmoSunDirection;
  uniform vec3 atmoSunColor;
  uniform vec3 atmoMistColor;
  uniform float atmoMistDensity;
  uniform float atmoMistMode;
  uniform float atmoMistHeight;
  uniform float atmoMistThickness;
  ${MIST}
  varying vec2 vUv;
  varying vec3 vTint;
  varying vec3 vWorld;
  #include <fog_pars_fragment>
  void main() {
    vec4 texel = texture2D(atlas, vUv);
    if (texel.a < 0.5) discard;
    vec3 color = texel.rgb * vTint;
    #ifdef USE_FOG
      vec3 toFrag = vWorld - cameraPosition;
      float dist = length(toFrag);
      vec3 viewDir = toFrag / max(dist, 0.001);
      float d = max(dot(viewDir, atmoSunDirection), 0.0);
      vec3 glow = atmoSunColor * (pow(d, 6.0) * 0.35 + pow(d, 48.0) * 0.5);
      float fogFactor = smoothstep(fogNear, fogFar, vFogDepth);
      color = mix(color, atmoMistColor, clamp(atmoMist(vWorld, dist), 0.0, 0.85) * (1.0 - fogFactor));
      color = mix(color, fogColor + glow, fogFactor);
    #endif
    gl_FragColor = vec4(color, 1.0);
    #include <colorspace_fragment>
  }
`;

/** A grass tuft: five bent blades, 1 m tall; sway runs from 0 at the root to 1 at the tip */
function tuftGeometry(): THREE.BufferGeometry {
  const positions: number[] = [];
  const sway: number[] = [];
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2 + i * 0.7;
    const r = 0.12 + (i % 2) * 0.1;
    const bx = Math.cos(a) * r;
    const bz = Math.sin(a) * r;
    const lean = 0.25 + (i % 3) * 0.1;
    const w = 0.07;
    const tx = bx * (1 + lean * 2);
    const tz = bz * (1 + lean * 2);
    const h = 0.75 + (i % 3) * 0.12;
    positions.push(bx - Math.sin(a) * w, 0, bz + Math.cos(a) * w, bx + Math.sin(a) * w, 0, bz - Math.cos(a) * w, tx, h, tz);
    sway.push(0, 0, 1);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  g.setAttribute("sway", new THREE.Float32BufferAttribute(sway, 1));
  g.computeVertexNormals();
  return g;
}

/** A flower: a stem and a little star of petals on top */
function flowerGeometry(): THREE.BufferGeometry {
  const positions: number[] = [];
  const sway: number[] = [];
  const h = 0.55;
  positions.push(-0.015, 0, 0, 0.015, 0, 0, 0, h, 0);
  sway.push(0, 0, 0.8);
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2;
    const b = a + Math.PI / 5;
    positions.push(0, h + 0.03, 0, Math.cos(a) * 0.13, h, Math.sin(a) * 0.13, Math.cos(b) * 0.06, h + 0.02, Math.sin(b) * 0.06);
    sway.push(1, 1, 1);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  g.setAttribute("sway", new THREE.Float32BufferAttribute(sway, 1));
  g.computeVertexNormals();
  return g;
}

interface NodeFlora {
  lod: number;
  plants: Float32Array;
  tufts: Float32Array;
  box: THREE.Box3;
  impostors: boolean;
  full: boolean;
  grass: boolean;
}

const matrix = new THREE.Matrix4();
const position = new THREE.Vector3();
const rotation = new THREE.Quaternion();
const scale = new THREE.Vector3();
const color = new THREE.Color();
const YAXIS = new THREE.Vector3(0, 1, 0);

export class FloraView {
  private readonly world: World;
  private readonly group = new THREE.Group();
  private readonly species: FloraSpecies[];
  private readonly full: InstancePool[] = [];
  private readonly impostors: InstancePool | null = null;
  private readonly grass: InstancePool | null = null;
  private readonly flowers: InstancePool | null = null;
  private readonly flowerColors: THREE.Color[] = [];
  private readonly grassBase = new THREE.Color();
  private readonly grassTip = new THREE.Color();
  private readonly tints: THREE.Color[][] = [];
  private readonly nodes = new Map<number, NodeFlora>();
  private readonly geometries: THREE.BufferGeometry[] = [];
  private readonly materials: THREE.Material[] = [];
  private readonly atlas: THREE.WebGLRenderTarget | null = null;
  private readonly impostorMaterial: THREE.ShaderMaterial | null = null;
  private baked = false;
  private lastGrassCheck = new THREE.Vector3(Infinity, 0, 0);

  constructor(world: World, parent: THREE.Group) {
    this.world = world;
    parent.add(this.group);
    const veg = world.biome.vegetation as Extract<VegetationSpec, { kind: "flora" }>;
    this.species = veg.species;
    const terrain = world.biome.terrain;
    const snow = new THREE.Color(terrain.kind === "v2" ? terrain.layers.snow : "#ffffff");
    for (const spec of veg.species) {
      const geometry = speciesGeometry(spec, snow);
      this.geometries.push(geometry);
      const material = plantMaterial(SPECIES[spec.id].sway);
      this.materials.push(material);
      this.full.push(new InstancePool(geometry, material, this.group, 256));
      this.tints.push((spec.tints ?? []).map((t) => new THREE.Color(t)));
    }
    this.atlas = new THREE.WebGLRenderTarget(CELL_W * ATLAS_COLUMNS, CELL_H * ATLAS_ROWS, { samples: 0 });
    this.atlas.texture.generateMipmaps = true;
    this.atlas.texture.minFilter = THREE.LinearMipmapLinearFilter;
    this.impostorMaterial = new THREE.ShaderMaterial({
      uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, { cells: { value: new THREE.Vector2(ATLAS_COLUMNS, ATLAS_ROWS) } }]),
      vertexShader: impostorVertex,
      fragmentShader: impostorFragment,
      fog: true,
    });
    this.impostorMaterial.uniforms.atlas = { value: this.atlas.texture };
    this.impostorMaterial.uniforms.atmoSunDirection = ATMOSPHERE.sunDirection;
    this.impostorMaterial.uniforms.atmoSunColor = ATMOSPHERE.sunColor;
    this.impostorMaterial.uniforms.atmoMistColor = ATMOSPHERE.mistColor;
    this.impostorMaterial.uniforms.atmoMistDensity = ATMOSPHERE.mistDensity;
    this.impostorMaterial.uniforms.atmoMistMode = ATMOSPHERE.mistMode;
    this.impostorMaterial.uniforms.atmoMistHeight = ATMOSPHERE.mistHeight;
    this.impostorMaterial.uniforms.atmoMistThickness = ATMOSPHERE.mistThickness;
    this.materials.push(this.impostorMaterial);
    const quad = new THREE.PlaneGeometry(2, FRAME_Y1 - FRAME_Y0).translate(0, (FRAME_Y1 - FRAME_Y0) / 2, 0);
    this.geometries.push(quad);
    this.impostors = new InstancePool(quad, this.impostorMaterial, this.group, 1024);

    if (veg.grass) {
      const tuft = tuftGeometry();
      const flower = flowerGeometry();
      this.geometries.push(tuft, flower);
      const grassMaterial = plantMaterial(0.12, true);
      const flowerMaterial = plantMaterial(0.08, true);
      this.materials.push(grassMaterial, flowerMaterial);
      this.grass = new InstancePool(tuft, grassMaterial, this.group, 2048);
      this.flowers = new InstancePool(flower, flowerMaterial, this.group, 512);
      this.grassBase.set(veg.grass.color);
      this.grassTip.set(veg.grass.tip);
      for (const c of veg.grass.flowers) this.flowerColors.push(new THREE.Color(c));
    }
  }

  /** Renders each species once into the impostor atlas, in this level's light */
  bake(renderer: THREE.WebGLRenderer) {
    if (this.baked || !this.atlas) return;
    this.baked = true;
    const palette = this.world.palette;
    const scene = new THREE.Scene();
    scene.add(new THREE.HemisphereLight(new THREE.Color(palette.horizon).lerp(new THREE.Color(palette.zenith), 0.25), palette.cloud, palette.ambient));
    const sun = new THREE.DirectionalLight(palette.sun, palette.sunIntensity);
    // Lit from the camera's side and above, like the sun seen over your shoulder
    sun.position.set(0.5, Math.max(0.35, sunDirection(palette).y), 1);
    scene.add(sun);
    const camera = new THREE.OrthographicCamera(-FRAME_X, FRAME_X, FRAME_Y1, FRAME_Y0, -5, 5);
    camera.position.set(0, 0, 2);
    camera.lookAt(0, 0, 0);
    const previous = renderer.getRenderTarget();
    const clear = renderer.getClearColor(new THREE.Color());
    const clearAlpha = renderer.getClearAlpha();
    const scissor = renderer.getScissorTest();
    renderer.setRenderTarget(this.atlas);
    renderer.setClearColor(new THREE.Color(palette.horizon).multiplyScalar(0.5), 0);
    renderer.clear();
    renderer.setScissorTest(true);
    this.geometries.slice(0, this.species.length).forEach((geometry, i) => {
      const material = new THREE.MeshLambertMaterial({ vertexColors: true });
      material.emissive.setScalar(0);
      const mesh = new THREE.Mesh(geometry, material);
      scene.add(mesh);
      const cx = (i % ATLAS_COLUMNS) * CELL_W;
      const cy = Math.floor(i / ATLAS_COLUMNS) * CELL_H;
      this.atlas!.viewport.set(cx, cy, CELL_W, CELL_H);
      this.atlas!.scissor.set(cx, cy, CELL_W, CELL_H);
      renderer.setRenderTarget(this.atlas);
      renderer.render(scene, camera);
      scene.remove(mesh);
      material.dispose();
    });
    renderer.setScissorTest(scissor);
    renderer.setClearColor(clear, clearAlpha);
    renderer.setRenderTarget(previous);
  }

  /** A node came on screen: its plants appear, as full meshes or impostors by its level of detail */
  show(key: number, lod: number, plants: Float32Array, tufts: Float32Array, box: THREE.Box3) {
    const node: NodeFlora = { lod, plants, tufts, box, impostors: false, full: false, grass: false };
    this.nodes.set(key, node);
    if (lod === 0) this.addFull(key, node);
    else this.addImpostors(key, node);
    this.lastGrassCheck.set(Infinity, 0, 0);
  }

  hide(key: number) {
    const node = this.nodes.get(key);
    if (!node) return;
    this.nodes.delete(key);
    if (node.full) for (const pool of this.full) pool.remove(key);
    if (node.impostors) this.impostors?.remove(key);
    if (node.grass) {
      this.grass?.remove(key);
      this.flowers?.remove(key);
    }
  }

  private plantColor(species: number, variant: number, out: THREE.Color) {
    const tints = this.tints[species];
    if (tints.length) out.copy(tints[Math.floor(variant * tints.length) % tints.length]);
    else out.setScalar(1);
    return out.multiplyScalar(0.86 + 0.28 * ((variant * 7.13) % 1));
  }

  private addFull(key: number, node: NodeFlora) {
    const { plants } = node;
    const count = plants.length / PLANT_STRIDE;
    if (!count) return;
    // Group by species
    const per = this.species.map(() => ({ m: [] as number[], c: [] as number[] }));
    for (let i = 0; i < count; i++) {
      const o = i * PLANT_STRIDE;
      const s = plants[o];
      rotation.setFromAxisAngle(YAXIS, plants[o + 6]);
      matrix.compose(position.set(plants[o + 1], plants[o + 2], plants[o + 3]), rotation, scale.set(plants[o + 5], plants[o + 4], plants[o + 5]));
      per[s].m.push(...matrix.elements);
      this.plantColor(s, plants[o + 7], color);
      per[s].c.push(color.r, color.g, color.b);
    }
    per.forEach((p, s) => {
      if (p.c.length) this.full[s].add(key, new Float32Array(p.m), new Float32Array(p.c));
    });
    node.full = true;
  }

  private addImpostors(key: number, node: NodeFlora) {
    const { plants } = node;
    const count = plants.length / PLANT_STRIDE;
    if (!count || !this.impostors) return;
    const m = new Float32Array(count * 16);
    const c = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      const o = i * PLANT_STRIDE;
      const s = plants[o];
      const radius = plants[o + 5];
      const height = plants[o + 4];
      // Foot, width (x scale), height (y scale) and atlas cell (z scale); see impostorVertex
      matrix.makeScale(radius * FRAME_X, height, s);
      matrix.setPosition(plants[o + 1], plants[o + 2], plants[o + 3]);
      m.set(matrix.elements, i * 16);
      this.plantColor(s, plants[o + 7], color);
      color.toArray(c, i * 3);
    }
    this.impostors.add(key, m, c);
    node.impostors = true;
  }

  private addGrass(key: number, node: NodeFlora) {
    const { tufts } = node;
    const count = tufts.length / TUFT_STRIDE;
    if (!count || !this.grass || !this.flowers) return;
    const gm: number[] = [];
    const gc: number[] = [];
    const fm: number[] = [];
    const fc: number[] = [];
    for (let i = 0; i < count; i++) {
      const o = i * TUFT_STRIDE;
      const kind = tufts[o + 5];
      const shade = tufts[o + 4];
      rotation.setFromAxisAngle(YAXIS, shade * 40);
      const size = tufts[o + 3];
      matrix.compose(position.set(tufts[o], tufts[o + 1], tufts[o + 2]), rotation, scale.set(size * 1.3, size, size * 1.3));
      if (kind > 0) {
        fm.push(...matrix.elements);
        color.copy(this.flowerColors[(kind - 1) % this.flowerColors.length]).multiplyScalar(0.9 + 0.2 * shade);
        fc.push(color.r, color.g, color.b);
      } else {
        gm.push(...matrix.elements);
        color.copy(this.grassBase).lerp(this.grassTip, shade * 0.8).multiplyScalar(0.9 + 0.25 * shade);
        gc.push(color.r, color.g, color.b);
      }
    }
    if (gc.length) this.grass.add(key, new Float32Array(gm), new Float32Array(gc));
    if (fc.length) this.flowers.add(key, new Float32Array(fm), new Float32Array(fc));
    node.grass = true;
  }

  /** Per frame: grass only on full-detail nodes near the camera; light and wind from the biome */
  update(camera: THREE.Camera) {
    FLORA_UNIFORMS.glow.value = TOON_LIGHT.glow.value * FLORA.glow;
    FLORA_UNIFORMS.gust.value = FLORA.wind;
    if (this.grass && this.lastGrassCheck.distanceToSquared(camera.position) > 10 * 10) {
      this.lastGrassCheck.copy(camera.position);
      for (const [key, node] of this.nodes) {
        if (node.lod !== 0) continue;
        const near = node.box.distanceToPoint(camera.position) < FLORA.grassDistance;
        if (near && !node.grass) this.addGrass(key, node);
        else if (!near && node.grass) {
          this.grass.remove(key);
          this.flowers!.remove(key);
          node.grass = false;
        }
      }
    }
    for (const pool of this.full) pool.flush();
    this.impostors?.flush();
    this.grass?.flush();
    this.flowers?.flush();
  }

  dispose() {
    for (const pool of this.full) pool.dispose();
    this.impostors?.dispose();
    this.grass?.dispose();
    this.flowers?.dispose();
    this.geometries.forEach((g) => g.dispose());
    this.materials.forEach((m) => m.dispose());
    this.atlas?.dispose();
    this.group.removeFromParent();
  }
}
