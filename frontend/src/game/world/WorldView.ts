import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { hash3, hashToUnit, makeRng, range } from "../rng";
import { ATMOSPHERE, atmospheric, skyMaterial } from "./atmosphere";
import { CrystalGates, type RingMode } from "./crystals";
import { type ChunkMesh, CHUNK_SIZE, rockChunks } from "./mesher";
import type { MeshRequest } from "./mesher.worker";
import { Tree } from "./trees";
import { sunDirection } from "./palette";
import type { World } from "./World";

export const VIEW_DISTANCE = 1400;
const FOG_NEAR = 250;
const FOG_FAR = 1300;
/** The game waits until the rock this close to the camera is on screen */
const READY_RADIUS = 260;
const REQUESTS_PER_WORKER = 4;
const CLOUDS = 70;
/** The sea of clouds lies this far below the racing line */
const CLOUD_SEA_DEPTH = 260;

export type { RingMode };

interface RockChunk {
  ix: number;
  iy: number;
  iz: number;
  key: number;
  center: THREE.Vector3;
  state: "idle" | "pending" | "loaded";
  mesh: THREE.Mesh | null;
  trees: THREE.InstancedMesh | null;
}

type MeshResult = ChunkMesh & { seed: number; key: number };

/** Moves a geometry's vertices a little, the same way for vertices that share a spot */
function roughen(geometry: THREE.BufferGeometry, amount: number, salt: string) {
  const position = geometry.getAttribute("position");
  for (let i = 0; i < position.count; i++) {
    const x = position.getX(i);
    const y = position.getY(i);
    const z = position.getZ(i);
    const key = `${salt}:${x.toFixed(3)},${y.toFixed(3)},${z.toFixed(3)}`;
    const s = 1 + (hashToUnit(key) - 0.5) * 2 * amount;
    position.setXYZ(i, x * s, y + (hashToUnit(key + "y") - 0.5) * amount * 0.5, z * s);
  }
  geometry.computeVertexNormals();
}

/** Paints every vertex of a geometry one color */
function paint(geometry: THREE.BufferGeometry, color: THREE.Color): THREE.BufferGeometry {
  const count = geometry.getAttribute("position").count;
  const colors = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) color.toArray(colors, i * 3);
  geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  return geometry;
}

/** A low-poly pine, 1 m tall with branches 1 m wide at the bottom; instances scale it */
function pineGeometry(foliage: THREE.Color, trunk: THREE.Color): THREE.BufferGeometry {
  const parts = [
    paint(new THREE.CylinderGeometry(0.1, 0.14, 0.3, 5).translate(0, 0.15, 0), trunk),
    paint(new THREE.ConeGeometry(1, 0.5, 6).translate(0, 0.43, 0), foliage.clone().multiplyScalar(0.9)),
    paint(new THREE.ConeGeometry(0.75, 0.42, 6).translate(0, 0.63, 0), foliage),
    paint(new THREE.ConeGeometry(0.5, 0.38, 6).translate(0, 0.81, 0), foliage.clone().multiplyScalar(1.12)),
  ];
  const merged = mergeGeometries(parts)!;
  parts.forEach((p) => p.dispose());
  return merged;
}

/**
 * All the meshes for one World: floating islands streamed in around the camera
 * (cut in web workers), their pines, the sea of clouds, crystal gates and sky.
 */
export class WorldView {
  readonly group = new THREE.Group();
  /** False until the rock near the camera has arrived */
  ready = false;
  private readonly world: World;
  private readonly chunks: RockChunk[];
  private readonly byKey = new Map<number, RockChunk>();
  private readonly workers: Worker[] = [];
  private readonly busy: number[] = [];
  private readonly rockMaterial: THREE.MeshLambertMaterial;
  private readonly treeMaterial: THREE.MeshLambertMaterial;
  private readonly treeGeometry: THREE.BufferGeometry;
  private readonly materials: THREE.Material[] = [];
  private readonly geometries: THREE.BufferGeometry[] = [];
  private readonly instanced: THREE.InstancedMesh[] = [];
  readonly gates: CrystalGates;
  private readonly sky: THREE.Mesh;
  private readonly lastStream = new THREE.Vector3(Infinity, 0, 0);
  private disposed = false;

  constructor(world: World, scene: THREE.Scene) {
    this.world = world;
    const palette = world.palette;
    const accent = new THREE.Color(palette.accent);

    // One set of light uniforms for the sky and the rock: this biome's mood
    const sun = sunDirection(palette);
    ATMOSPHERE.sunDirection.value.copy(sun);
    ATMOSPHERE.sunColor.value.set(palette.sun);
    ATMOSPHERE.mistColor.value.set(palette.mist);
    ATMOSPHERE.mistDensity.value = palette.mistDensity;
    ATMOSPHERE.horizon.value.set(palette.horizon);
    ATMOSPHERE.zenith.value.set(palette.zenith);
    ATMOSPHERE.clouds.value.set(palette.cloud);
    ATMOSPHERE.night.value = palette.night;

    scene.background = new THREE.Color(palette.horizon);
    scene.fog = new THREE.Fog(palette.horizon, FOG_NEAR, FOG_FAR);
    // The sky lights the shadows from above, the sea of clouds bounces light from below
    const hemi = new THREE.HemisphereLight(
      new THREE.Color(palette.horizon).lerp(new THREE.Color(palette.zenith), 0.25),
      palette.cloud,
      palette.ambient,
    );
    const sunLight = new THREE.DirectionalLight(palette.sun, palette.sunIntensity);
    sunLight.position.copy(sun);
    this.group.add(hemi, sunLight);

    // Meshes arrive with one color and normal per triangle: flat, low-poly faces.
    // The rock gets the haze, mist, backlit rims and strata.
    this.rockMaterial = this.material(atmospheric(new THREE.MeshLambertMaterial({ vertexColors: true }), 1));
    this.treeMaterial = this.material(new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true }));
    this.treeGeometry = this.geometry(pineGeometry(new THREE.Color(palette.forest), new THREE.Color(palette.trunk)));

    this.sky = new THREE.Mesh(this.geometry(new THREE.SphereGeometry(4000, 32, 16)), this.material(skyMaterial()));
    this.sky.renderOrder = -2;
    this.group.add(this.sky);
    this.buildCloudSea();
    this.buildClouds();
    this.gates = new CrystalGates(
      world.seed,
      world.course.rings,
      { ice: new THREE.Color("#e6f7ff").lerp(accent, 0.12), accent },
      sun,
    );
    this.group.add(this.gates.group);
    this.setRings("free", 0);

    this.chunks = rockChunks(world).map((c) => ({
      ...c,
      center: new THREE.Vector3((c.ix + 0.5) * CHUNK_SIZE, (c.iy + 0.5) * CHUNK_SIZE, (c.iz + 0.5) * CHUNK_SIZE),
      state: "idle" as const,
      mesh: null,
      trees: null,
    }));
    for (const chunk of this.chunks) this.byKey.set(chunk.key, chunk);

    const count = Math.max(1, Math.min(3, (navigator.hardwareConcurrency || 4) - 1));
    for (let i = 0; i < count; i++) {
      const worker = new Worker(new URL("./mesher.worker.ts", import.meta.url), { type: "module" });
      worker.onmessage = (event: MessageEvent<MeshResult>) => {
        this.busy[i]--;
        this.receive(event.data);
      };
      this.workers.push(worker);
      this.busy.push(0);
    }
  }

  private material<T extends THREE.Material>(material: T): T {
    this.materials.push(material);
    return material;
  }

  private geometry<T extends THREE.BufferGeometry>(geometry: T): T {
    this.geometries.push(geometry);
    return geometry;
  }

  // --- clouds ------------------------------------------------------------------

  /** A lumpy, faceted floor of clouds far below the islands, sloping down with the course */
  private buildCloudSea() {
    const { course, palette } = this.world;
    const step = 50;
    const columns = 80;
    const z0 = course.start.z - 1500;
    const rows = Math.ceil((course.endZ + 2000 - z0) / step);
    const point = (row: number, column: number) => {
      const z = z0 + row * step;
      const bump = (hash3(row, column, 11) - 0.5) * 14;
      return [course.x(z) + (column - columns / 2) * step, course.y(z) - CLOUD_SEA_DEPTH + bump, z];
    };
    const positions: number[] = [];
    const colors: number[] = [];
    const base = new THREE.Color(palette.cloud);
    const color = new THREE.Color();
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < columns; c++) {
        for (const tri of [
          [point(r, c), point(r + 1, c), point(r + 1, c + 1)],
          [point(r, c), point(r + 1, c + 1), point(r, c + 1)],
        ]) {
          color.copy(base).multiplyScalar(0.9 + 0.1 * hash3(r, c, tri[2][0] | 0));
          for (const v of tri) {
            positions.push(...v);
            colors.push(color.r, color.g, color.b);
          }
        }
      }
    }
    const geometry = this.geometry(new THREE.BufferGeometry());
    geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
    geometry.computeVertexNormals();
    const material = new THREE.MeshLambertMaterial({ vertexColors: true });
    material.emissive.set(palette.cloud).multiplyScalar(0.35);
    this.group.add(new THREE.Mesh(geometry, this.material(material)));
  }

  /** Puffy clouds drifting between the islands and the sea of clouds */
  private buildClouds() {
    const { course, seed, palette } = this.world;
    const rng = makeRng(seed, "clouds");
    const geometry = this.geometry(new THREE.IcosahedronGeometry(1, 1));
    roughen(geometry, 0.15, `cloud${seed}`);
    // Partly self-lit, so they stay white from every side
    const material = new THREE.MeshLambertMaterial({ color: palette.cloud, flatShading: true });
    material.emissive.set(palette.cloud).multiplyScalar(0.55);
    const mesh = new THREE.InstancedMesh(geometry, this.material(material), CLOUDS);
    const matrix = new THREE.Matrix4();
    const rotation = new THREE.Quaternion();
    for (let i = 0; i < CLOUDS; i++) {
      const z = range(rng, course.start.z - 400, course.endZ + 1200);
      const low = rng() < 0.6;
      const position = new THREE.Vector3(
        course.x(z) + range(rng, -800, 800),
        course.y(z) + (low ? range(rng, -230, -150) : range(rng, 160, 380)),
        z,
      );
      rotation.setFromAxisAngle(THREE.Object3D.DEFAULT_UP, range(rng, 0, Math.PI));
      const scale = new THREE.Vector3(range(rng, 45, 95), range(rng, 20, 38), range(rng, 35, 65));
      mesh.setMatrixAt(i, matrix.compose(position, rotation, scale));
    }
    mesh.computeBoundingSphere();
    this.instanced.push(mesh);
    this.group.add(mesh);
  }

  // --- rock, streamed in from the workers -------------------------------------------

  /** Asks the workers for the nearest missing chunks, drops far ones */
  private stream(at: THREE.Vector3) {
    // Re-plan only after moving a bit; the queues keep the workers fed meanwhile
    const moved = this.lastStream.distanceToSquared(at) > 15 * 15;
    if (moved) this.lastStream.copy(at);

    let missingNearby = false;
    const wanted: { chunk: RockChunk; d: number }[] = [];
    for (const chunk of this.chunks) {
      const d = chunk.center.distanceTo(at);
      if (chunk.state !== "loaded" && d < READY_RADIUS + CHUNK_SIZE) missingNearby = true;
      if (chunk.state === "idle" && d < VIEW_DISTANCE) wanted.push({ chunk, d });
      else if (chunk.state === "loaded" && d > VIEW_DISTANCE + 400 && moved) this.unload(chunk);
    }
    this.ready = !missingNearby;

    wanted.sort((a, b) => a.d - b.d);
    for (const { chunk } of wanted) {
      const worker = this.busy.indexOf(Math.min(...this.busy));
      if (this.busy[worker] >= REQUESTS_PER_WORKER) break;
      this.busy[worker]++;
      chunk.state = "pending";
      const request: MeshRequest = { seed: this.world.seed, key: chunk.key, ix: chunk.ix, iy: chunk.iy, iz: chunk.iz };
      this.workers[worker].postMessage(request);
    }
  }

  private receive(result: MeshResult) {
    const chunk = this.byKey.get(result.key);
    if (this.disposed || result.seed !== this.world.seed || !chunk) return;
    chunk.state = "loaded";
    if (result.positions.length) {
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute("position", new THREE.BufferAttribute(result.positions, 3));
      geometry.setAttribute("color", new THREE.BufferAttribute(result.colors, 3));
      geometry.computeVertexNormals();
      geometry.computeBoundingSphere();
      chunk.mesh = new THREE.Mesh(geometry, this.rockMaterial);
      chunk.mesh.matrixAutoUpdate = false;
      this.group.add(chunk.mesh);
    }

    const trees: Tree[] = [];
    for (let i = 0; i < result.trees.length; i += 5) {
      const [x, ground, z, height, radius] = result.trees.subarray(i, i + 5);
      trees.push(new Tree(x, z, ground, height, radius));
    }
    // Trees collide from the moment they show up
    this.world.trees.add(chunk.key, trees);
    if (trees.length) {
      const mesh = new THREE.InstancedMesh(this.treeGeometry, this.treeMaterial, trees.length);
      const matrix = new THREE.Matrix4();
      const rotation = new THREE.Quaternion();
      const position = new THREE.Vector3();
      const scale = new THREE.Vector3();
      const color = new THREE.Color();
      trees.forEach((tree, i) => {
        const spin = hash3(Math.floor(tree.x * 10), Math.floor(tree.z * 10), 1);
        rotation.setFromAxisAngle(THREE.Object3D.DEFAULT_UP, spin * Math.PI * 2);
        mesh.setMatrixAt(
          i,
          matrix.compose(position.set(tree.x, tree.ground, tree.z), rotation, scale.set(tree.radius, tree.height, tree.radius)),
        );
        const shade = 0.82 + 0.3 * hash3(Math.floor(tree.x * 10), Math.floor(tree.z * 10), 2);
        mesh.setColorAt(i, color.setRGB(shade, shade * (0.97 + 0.06 * spin), shade));
      });
      mesh.computeBoundingSphere();
      chunk.trees = mesh;
      this.group.add(mesh);
    }
  }

  private unload(chunk: RockChunk) {
    if (chunk.mesh) {
      this.group.remove(chunk.mesh);
      chunk.mesh.geometry.dispose();
      chunk.mesh = null;
    }
    if (chunk.trees) {
      this.group.remove(chunk.trees);
      chunk.trees.dispose(); // its instance buffers; the pine geometry is shared
      chunk.trees = null;
    }
    chunk.state = "idle";
  }

  // --- rings -------------------------------------------------------------------

  /** "race": the next gate glows, passed ones are gone. "free": all shown quietly. */
  setRings(mode: RingMode, next: number) {
    this.gates.setMode(mode, next);
  }

  /** Plays a gate's pass animation: the crystals flare, burst and dissolve */
  passRing(index: number) {
    this.gates.pass(index);
  }

  /** Per frame: stream rock around the camera, the sky follows it, the gates animate */
  update(camera: THREE.Camera, dt: number) {
    this.stream(camera.position);
    this.sky.position.copy(camera.position);
    this.gates.update(dt, camera);
  }

  dispose() {
    this.disposed = true;
    this.workers.forEach((w) => w.terminate());
    for (const chunk of this.chunks) this.unload(chunk);
    this.instanced.forEach((m) => m.dispose());
    this.geometries.forEach((g) => g.dispose());
    this.materials.forEach((m) => m.dispose());
    this.gates.dispose();
    this.group.clear();
  }
}
