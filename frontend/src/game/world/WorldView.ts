import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { hash3, hashToUnit, makeRng, range } from "../rng";
import { ATMOSPHERE, atmospheric, skyMaterial } from "./atmosphere";
import { CrystalGates, type RingMode } from "./crystals";
import { LandCollider } from "./landCollider";
import { type ChunkMesh, CHUNK_SIZE, VOXEL, chunkKey, rockChunks } from "./mesher";
import type { MeshRequest } from "./mesher.worker";
import { levelId } from "./biomes";
import type { Layers } from "./biomes/types";
import { applyTerrainTuning, type TerrainUniforms, terrainMaterial } from "./terrain/material";
import { LandStreamer, type NodeRequest, type NodeResult } from "./terrain/streamer";
import { FloraView } from "./flora/view";
import { WaterView } from "./water";
import { SoftClouds } from "./clouds";
import { LightShafts, SeaLife } from "./deep";
import { Tree } from "./trees";
import { sunDirection } from "./palette";
import type { World } from "./World";
import { reloadForNewBuild } from "../../staleBuild";
import { DEEP } from "../tuning";

export const VIEW_DISTANCE = 1400;
const FOG_NEAR = 250;
const FOG_FAR = 1300;
/** The game waits until the rock this close to the camera is on screen */
const READY_RADIUS = 260;
const REQUESTS_PER_WORKER = 4;

export type { RingMode };

type ChunkRequestBody = { kind: "chunk"; key: number; ix: number; iy: number; iz: number };

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

type MeshResult = (ChunkMesh & { kind: "chunk"; level: string; key: number }) | (NodeResult & { kind: "node"; level: string });

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
 * All the meshes for one World, as its biome describes them: land streamed in
 * around the camera (cut in web workers), what grows on it, mist and clouds,
 * crystal gates and sky.
 */
export class WorldView {
  readonly group = new THREE.Group();
  /** False until the rock near the camera has arrived */
  ready = false;
  private readonly world: World;
  private readonly levelId: string;
  /** The race map's chunks (Sky Isles) */
  private readonly chunks: RockChunk[] = [];
  /** Generator-v2 land, streamed with levels of detail */
  private readonly land: LandStreamer | null = null;
  private readonly terrainUniforms: TerrainUniforms | null = null;
  private readonly flora: FloraView | null = null;
  private readonly water: WaterView | null = null;
  private readonly softClouds: SoftClouds | null = null;
  /** Under the sea: shafts of light from the surface, fish and jellyfish */
  private readonly shafts: LightShafts | null = null;
  private readonly seaLife: SeaLife | null = null;
  private readonly byKey = new Map<number, RockChunk>();
  /** The land on screen, as triangles: collisions with exactly what is drawn */
  readonly collider = new LandCollider();
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
  private streamDirty = true;

  constructor(world: World, scene: THREE.Scene) {
    this.world = world;
    this.levelId = levelId(world.level.key);
    const palette = world.palette;
    const accent = new THREE.Color(palette.accent);

    // One set of light uniforms for the sky and the rock: this biome's mood
    const sun = sunDirection(palette);
    ATMOSPHERE.sunDirection.value.copy(sun);
    ATMOSPHERE.sunColor.value.set(palette.sun);
    ATMOSPHERE.mistColor.value.set(palette.mist);
    ATMOSPHERE.mistDensity.value = palette.mistDensity;
    const mist = world.biome.sky.mist;
    ATMOSPHERE.mistMode.value = mist.mode === "valley" ? 1 : 0;
    ATMOSPHERE.mistThickness.value = mist.mode === "valley" ? mist.thickness : 120;
    ATMOSPHERE.horizon.value.set(palette.horizon);
    ATMOSPHERE.zenith.value.set(palette.zenith);
    ATMOSPHERE.clouds.value.set(palette.cloud);
    ATMOSPHERE.night.value = palette.night;
    ATMOSPHERE.aurora.value = palette.aurora ?? 0;
    ATMOSPHERE.underglow.value.set(palette.underglow ?? "#000000");
    const underwater = world.biome.sky.underwater;
    ATMOSPHERE.underwater.value = underwater ? 1 : 0;
    if (underwater) ATMOSPHERE.surface.value = world.course.start.y + underwater.surface;

    scene.background = new THREE.Color(palette.horizon);
    const [fogNear, fogFar] = world.biome.sky.fog ?? [FOG_NEAR, FOG_FAR];
    scene.fog = new THREE.Fog(palette.horizon, fogNear, fogFar);
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
    const { cloudSea, puffs, puffsBelow, puffLift, banks } = world.biome.sky;
    if (cloudSea) this.buildCloudSea(cloudSea.depth);
    if (world.biome.terrain.kind === "legacyIslands") {
      if (puffs > 0) this.buildClouds(puffs, puffsBelow, puffLift);
    } else if (puffs > 0 || banks) {
      this.softClouds = new SoftClouds(world, puffs, puffLift, banks ?? 0);
      this.group.add(this.softClouds.mesh);
    }
    if (underwater) {
      this.shafts = new LightShafts();
      this.seaLife = new SeaLife(world, underwater);
      this.group.add(this.shafts.mesh, ...this.seaLife.meshes);
    }
    this.gates = new CrystalGates(
      world.seed,
      world.course.rings,
      { ice: new THREE.Color("#e6f7ff").lerp(accent, 0.12), accent },
      sun,
    );
    this.group.add(this.gates.group);
    this.setRings("free", 0);

    const terrain = world.biome.terrain;
    if (terrain.kind === "legacyIslands") {
      this.chunks = rockChunks(world).map((c) => ({
        ...c,
        center: new THREE.Vector3((c.ix + 0.5) * CHUNK_SIZE, (c.iy + 0.5) * CHUNK_SIZE, (c.iz + 0.5) * CHUNK_SIZE),
        state: "idle" as const,
        mesh: null,
        trees: null,
      }));
      for (const chunk of this.chunks) this.byKey.set(chunk.key, chunk);
    } else {
      const { material, uniforms } = terrainMaterial(terrain.layers);
      this.material(material);
      this.terrainUniforms = uniforms;
      if (world.biome.vegetation.kind === "flora") this.flora = new FloraView(world, this.group);
      if (world.steps || world.hasSea || world.islandFalls.length) {
        this.water = new WaterView(world);
        this.group.add(this.water.group);
      }
      this.land = new LandStreamer(world, this.group, material, this.flora, this.collider);
    }

    const count = Math.max(1, Math.min(3, (navigator.hardwareConcurrency || 4) - 1));
    for (let i = 0; i < count; i++) {
      const worker = new Worker(new URL("./mesher.worker.ts", import.meta.url), { type: "module" });
      worker.onmessage = (event: MessageEvent<MeshResult>) => {
        this.busy[i]--;
        const result = event.data;
        if (this.disposed || result.level !== this.levelId) return;
        if (result.kind === "node") this.land?.receive(result);
        else this.receive(result);
      };
      // Fires when the worker's script can't be loaded, e.g. it belongs to an older build
      worker.onerror = (event) => reloadForNewBuild(event.message || "mesher worker failed to load");
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
  private buildCloudSea(depth: number) {
    const { course, palette } = this.world;
    const step = 50;
    const columns = 80;
    const z0 = course.start.z - 1500;
    const rows = Math.ceil((course.endZ + 2000 - z0) / step);
    const point = (row: number, column: number) => {
      const z = z0 + row * step;
      const bump = (hash3(row, column, 11) - 0.5) * 14;
      return [course.x(z) + (column - columns / 2) * step, course.y(z) - depth + bump, z];
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
  private buildClouds(count: number, below: boolean, lift: number) {
    const { course, seed, palette } = this.world;
    const rng = makeRng(seed, "clouds");
    const geometry = this.geometry(new THREE.IcosahedronGeometry(1, 1));
    roughen(geometry, 0.15, `cloud${seed}`);
    // Partly self-lit, so they stay white from every side; by night, moonlit veils
    // close to the sky's color rather than dark discs
    const material = new THREE.MeshLambertMaterial({ color: palette.cloud, flatShading: true });
    material.color.lerp(new THREE.Color(palette.horizon), palette.night * 0.5);
    material.emissive.set(palette.cloud).lerp(new THREE.Color(palette.horizon), palette.night * 0.6).multiplyScalar(0.55 + palette.night * 0.35);
    if (palette.night > 0.5) {
      material.transparent = true;
      material.opacity = 1 - palette.night * 0.45;
      material.depthWrite = false;
    }
    const mesh = new THREE.InstancedMesh(geometry, this.material(material), count);
    const matrix = new THREE.Matrix4();
    const rotation = new THREE.Quaternion();
    for (let i = 0; i < count; i++) {
      const z = range(rng, course.start.z - 400, course.endZ + 1200);
      // The race map draws the same numbers either way, so its clouds stay where they were
      const low = rng() < 0.6 && below;
      const position = new THREE.Vector3(
        course.x(z) + range(rng, -800, 800),
        course.y(z) + (low ? range(rng, -230, -150) : range(rng, 160, 380) + lift),
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

  /** Posts a request to the least busy worker; false if they all have enough to do */
  private dispatch = (request: ChunkRequestBody | NodeRequest): boolean => {
    let worker = 0;
    for (let i = 1; i < this.busy.length; i++) if (this.busy[i] < this.busy[worker]) worker = i;
    if (this.busy[worker] >= REQUESTS_PER_WORKER) return false;
    this.busy[worker]++;
    const message: MeshRequest = { level: this.world.level.key, ...request };
    this.workers[worker].postMessage(message);
    return true;
  };

  /** Asks the workers for the nearest missing chunks, drops far ones */
  private stream(at: THREE.Vector3) {
    // Re-plan only after moving a bit; the queues keep the workers fed meanwhile
    const moved = this.lastStream.distanceToSquared(at) > 15 * 15;
    if (!moved && !this.streamDirty) return;
    if (moved) this.lastStream.copy(at);
    this.streamDirty = false;

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
      if (!this.dispatch({ kind: "chunk", key: chunk.key, ix: chunk.ix, iy: chunk.iy, iz: chunk.iz })) break;
      chunk.state = "pending";
    }
  }

  private receive(result: ChunkMesh & { key: number }) {
    this.streamDirty = true;
    const chunk = this.byKey.get(result.key);
    if (!chunk) return;
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
      this.collider.add(chunk.key, result.positions, VOXEL);
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
        // Drawn from the rock up to the collider's top: a tree whose rock was snapped lower reaches down to it
        const sink = result.treeSink[i] ?? 0;
        mesh.setMatrixAt(
          i,
          matrix.compose(position.set(tree.x, tree.ground - sink, tree.z), rotation, scale.set(tree.radius, tree.height + sink, tree.radius)),
        );
        const shade = 0.82 + 0.3 * hash3(Math.floor(tree.x * 10), Math.floor(tree.z * 10), 2);
        mesh.setColorAt(i, color.setRGB(shade, shade * (0.97 + 0.06 * spin), shade));
      });
      mesh.computeBoundingSphere();
      chunk.trees = mesh;
      this.group.add(mesh);
    }
  }

  /**
   * Is the land at this point on screen (or is there none to show)? Until it
   * is, collisions there fall back to the distance field
   */
  covers(x: number, y: number, z: number): boolean {
    if (this.land) return this.land.covers(x, y, z);
    const chunk = this.byKey.get(chunkKey(Math.floor(x / CHUNK_SIZE), Math.floor(y / CHUNK_SIZE), Math.floor(z / CHUNK_SIZE)));
    return !chunk || chunk.state === "loaded";
  }

  private unload(chunk: RockChunk) {
    this.collider.remove(chunk.key);
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

  /** One-off GPU work that needs the renderer: the plants' impostor atlas */
  prepare(renderer: THREE.WebGLRenderer) {
    this.flora?.bake(renderer);
  }

  /** "race": the next gate glows, passed ones are gone. "free": all shown quietly. */
  setRings(mode: RingMode, next: number) {
    this.gates.setMode(mode, next);
  }

  /** Plays a gate's pass animation: the crystals flare, burst and dissolve */
  passRing(index: number) {
    this.gates.pass(index);
  }

  /** Per frame: stream rock around the camera, the sky follows it, the gates animate */
  update(camera: THREE.Camera, dt: number, velocity?: THREE.Vector3) {
    const mist = this.world.biome.sky.mist;
    if (mist.mode === "valley") ATMOSPHERE.mistHeight.value = this.world.valleyFloor(camera.position.z) + mist.above;
    const underwater = this.world.biome.sky.underwater;
    if (underwater) {
      // The surface stays the same height over the racing line all the way down; moonlight ripples less
      const dim = 1 - this.world.palette.night * 0.5;
      ATMOSPHERE.surface.value = this.world.course.y(camera.position.z) + underwater.surface;
      ATMOSPHERE.caustics.value = DEEP.caustics * dim;
      ATMOSPHERE.surfaceGlow.value = DEEP.surface;
      this.shafts!.update(DEEP.shafts * dim);
      this.seaLife!.update(DEEP.life);
    }
    if (this.land) {
      this.land.update(camera.position, this.dispatch, velocity);
      this.ready = this.land.ready;
      applyTerrainTuning(this.terrainUniforms!, (this.world.biome.terrain as { layers: Layers }).layers);
      this.flora?.update(camera);
      this.water?.update();
    } else {
      this.stream(camera.position);
    }
    this.sky.position.copy(camera.position);
    this.gates.update(dt, camera);
  }

  dispose() {
    this.disposed = true;
    this.workers.forEach((w) => w.terminate());
    for (const chunk of this.chunks) this.unload(chunk);
    this.land?.dispose();
    this.collider.clear();
    this.flora?.dispose();
    this.water?.dispose();
    this.softClouds?.dispose();
    this.shafts?.dispose();
    this.seaLife?.dispose();
    this.instanced.forEach((m) => m.dispose());
    this.geometries.forEach((g) => g.dispose());
    this.materials.forEach((m) => m.dispose());
    this.gates.dispose();
    this.group.clear();
  }
}
