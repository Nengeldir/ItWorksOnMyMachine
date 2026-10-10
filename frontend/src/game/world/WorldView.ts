import * as THREE from "three";
import { hashToUnit } from "../rng";
import { ATMOSPHERE, atmospheric, skyMaterial } from "./atmosphere";
import { CrystalGates, type RingMode } from "./crystals";
import { sunDirection } from "./palette";
import { Arch, Pillar, Rock } from "./obstacles";
import { CELL, CHUNK_CELLS, CHUNK_SIZE, smoothstep } from "./terrain";
import type { World } from "./World";

export const VIEW_DISTANCE = 1400;
const FOG_NEAR = 250;
const FOG_FAR = 1350;
export type { RingMode };

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
 * (cut in web workers), their pines, the sea of clouds, rings and sky.
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
  readonly gates: CrystalGates;
  private readonly sky: THREE.Mesh;
  private readonly colors: { ground: THREE.Color; rock: THREE.Color; top: THREE.Color; accent: THREE.Color };

  constructor(world: World, scene: THREE.Scene) {
    this.world = world;
    const palette = world.palette;
    this.accent = new THREE.Color(palette.accent);

    scene.background = new THREE.Color(palette.horizon);
    scene.fog = new THREE.Fog(palette.horizon, FOG_NEAR, FOG_FAR);

    // One set of light uniforms for the sky, terrain and rocks: this biome's mood
    const sun = sunDirection(palette);
    ATMOSPHERE.sunDirection.value.copy(sun);
    ATMOSPHERE.sunColor.value.set(palette.sun);
    ATMOSPHERE.mistColor.value.set(palette.mist);
    ATMOSPHERE.mistDensity.value = palette.mistDensity;
    ATMOSPHERE.horizon.value.set(palette.horizon);
    ATMOSPHERE.zenith.value.set(palette.zenith);
    ATMOSPHERE.clouds.value.set(palette.clouds);
    ATMOSPHERE.night.value = palette.night;

    // The sky lights the shadows from above, the ground bounces its color from below
    const hemi = new THREE.HemisphereLight(
      new THREE.Color(palette.horizon).lerp(new THREE.Color(palette.zenith), 0.25),
      palette.ground,
      palette.ambient,
    );
    const sunLight = new THREE.DirectionalLight(palette.sun, palette.sunIntensity);
    sunLight.position.copy(sun);
    this.group.add(hemi, sunLight);

    this.terrainMaterial = this.material(
      atmospheric(new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true }), 1),
    );
    this.sky = new THREE.Mesh(this.geometry(new THREE.SphereGeometry(4000, 32, 16)), this.material(skyMaterial()));
    this.sky.renderOrder = -2;
    this.group.add(this.sky);
    this.buildObstacles();
    this.gates = new CrystalGates(
      world.seed,
      world.course.rings,
      { ice: new THREE.Color("#e6f7ff").lerp(this.colors.accent, 0.12), accent: this.colors.accent },
      sun,
    );
    this.group.add(this.gates.group);
    this.setRings("free", 0);
  }

  private material<T extends THREE.Material>(material: T): T {
    this.materials.push(material);
    return material;
  }

  private geometry<T extends THREE.BufferGeometry>(geometry: T): T {
    this.geometries.push(geometry);
    return geometry;
  }

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
    geometry.computeBoundingSphere();

    const mesh = new THREE.Mesh(geometry, this.terrainMaterial);
    mesh.position.set(x0, 0, z0);
    mesh.matrixAutoUpdate = false;
    mesh.updateMatrix();
    return mesh;
  }

  /** Builds missing chunks near (x, z), nearest first, within a time budget */
  updateChunks(x: number, z: number, budgetMs: number) {
    const cx = Math.floor(x / CHUNK_SIZE);
    const cz = Math.floor(z / CHUNK_SIZE);
    const reach = Math.ceil(VIEW_DISTANCE / CHUNK_SIZE);
    const missing: { ix: number; iz: number; d: number }[] = [];
    for (let iz = cz - reach; iz <= cz + reach; iz++) {
      for (let ix = cx - reach; ix <= cx + reach; ix++) {
        const d = Math.hypot((ix + 0.5) * CHUNK_SIZE - x, (iz + 0.5) * CHUNK_SIZE - z);
        if (d < VIEW_DISTANCE + CHUNK_SIZE * 0.71 && !this.chunks.has(this.chunkKey(ix, iz))) {
          missing.push({ ix, iz, d });
        }
      }
    }
    missing.sort((a, b) => a.d - b.d);
    const started = performance.now();
    for (const { ix, iz } of missing) {
      const mesh = this.buildChunk(ix, iz);
      this.chunks.set(this.chunkKey(ix, iz), mesh);
      this.group.add(mesh);
      if (performance.now() - started > budgetMs) break;
    }

    // Drop chunks far behind
    for (const [key, mesh] of this.chunks) {
      const d = Math.hypot(mesh.position.x + CHUNK_SIZE / 2 - x, mesh.position.z + CHUNK_SIZE / 2 - z);
      if (d > VIEW_DISTANCE + CHUNK_SIZE * 2.5) {
        this.group.remove(mesh);
        mesh.geometry.dispose();
        this.chunks.delete(key);
      }
    }
  }

  // --- obstacles ---------------------------------------------------------------

  private buildObstacles() {
    const { obstacles, seed } = this.world;
    const rockMaterial = this.material(atmospheric(new THREE.MeshLambertMaterial({ flatShading: true }), 0.6));
    const pillars = obstacles.filter((o): o is Pillar => o instanceof Pillar);
    const rocks = obstacles.filter((o): o is Rock => o instanceof Rock);
    const arches = obstacles.filter((o): o is Arch => o instanceof Arch);
    const matrix = new THREE.Matrix4();
    const rotation = new THREE.Quaternion();
    const scale = new THREE.Vector3();
    const position = new THREE.Vector3();
    const color = new THREE.Color();
    const tint = (i: number, salt: string) =>
      color.copy(this.colors.rock).lerp(this.colors.ground, 0.35 * hashToUnit(`${seed}:${salt}:${i}`));

    // Matches Pillar.distance: radius 1 at the base, 0.6 at the top
    const pillarGeometry = this.geometry(new THREE.CylinderGeometry(0.6, 1, 1, 7, 5));
    pillarGeometry.translate(0, 0.5, 0);
    roughen(pillarGeometry, 0.08, `pillar${seed}`);
    const pillarMesh = new THREE.InstancedMesh(pillarGeometry, rockMaterial, Math.max(1, pillars.length));
    pillarMesh.count = pillars.length;
    pillars.forEach((p, i) => {
      rotation.setFromAxisAngle(THREE.Object3D.DEFAULT_UP, hashToUnit(`${seed}:pr:${i}`) * Math.PI * 2);
      matrix.compose(position.set(p.x, p.bottom, p.z), rotation, scale.set(p.radius, p.top - p.bottom, p.radius));
      pillarMesh.setMatrixAt(i, matrix);
      pillarMesh.setColorAt(i, tint(i, "pc"));
    });

    const rockGeometry = this.geometry(new THREE.IcosahedronGeometry(1, 1));
    roughen(rockGeometry, 0.12, `rock${seed}`);
    const rockMesh = new THREE.InstancedMesh(rockGeometry, rockMaterial, Math.max(1, rocks.length));
    rockMesh.count = rocks.length;
    rocks.forEach((r, i) => {
      rotation.setFromEuler(
        new THREE.Euler(hashToUnit(`${seed}:rx:${i}`) * 6, hashToUnit(`${seed}:ry:${i}`) * 6, 0),
      );
      matrix.compose(position.set(r.x, r.y, r.z), rotation, scale.setScalar(r.radius));
      rockMesh.setMatrixAt(i, matrix);
      rockMesh.setColorAt(i, tint(i, "rc"));
    });
    this.group.add(pillarMesh, rockMesh);

    const archMaterial = this.material(
      atmospheric(new THREE.MeshLambertMaterial({ color: this.colors.rock, flatShading: true }), 0.6),
    );
    for (const arch of arches) {
      const mesh = new THREE.Mesh(
        this.geometry(new THREE.TorusGeometry(arch.radius, arch.tube, 7, 36, Math.PI)),
        archMaterial,
      );
      mesh.position.set(arch.x, arch.y, arch.z);
      mesh.rotation.y = arch.angle;
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

  // --- rings ---------------------------------------------------------------------

  /** "race": the next gate glows, passed ones are gone. "free": all shown quietly. */
  setRings(mode: RingMode, next: number) {
    this.gates.setMode(mode, next);
  }

  /** Plays a gate's pass animation: the crystals flare, burst and dissolve */
  passRing(index: number) {
    this.gates.pass(index);
  }

  /** Per frame: the sky follows the camera, the gates animate */
  update(camera: THREE.Camera, dt: number) {
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
