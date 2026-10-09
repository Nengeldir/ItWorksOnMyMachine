import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { hash3, hashToUnit, makeRng, range } from "../rng";
import type { Ring } from "./course";
import { Arch, Pillar, Rock } from "./obstacles";
import { CELL, CHUNK_CELLS, CHUNK_SIZE, SNOW_LINE, smoothstep } from "./terrain";
import type { World } from "./World";

export const VIEW_DISTANCE = 2200;
const FOG_NEAR = 400;
const FOG_FAR = 2100;
const SUN_DIRECTION = new THREE.Vector3(-0.45, 0.55, 0.7).normalize();
const FINISH_COLOR = new THREE.Color("#ffd23f");
const CLOUDS = 60;

export type RingMode = "race" | "free" | "hidden";

interface Chunk {
  terrain: THREE.Mesh;
  trees: THREE.InstancedMesh | null;
}

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

/** All the meshes for one World: terrain, forests and river streamed around the camera, plus the rest */
export class WorldView {
  readonly group = new THREE.Group();
  private readonly world: World;
  private readonly chunks = new Map<number, Chunk>();
  private readonly water = new Map<number, THREE.Mesh>();
  private readonly terrainMaterial: THREE.MeshLambertMaterial;
  private readonly waterMaterial: THREE.MeshLambertMaterial;
  private readonly treeMaterial: THREE.MeshLambertMaterial;
  private readonly treeGeometry: THREE.BufferGeometry;
  private readonly materials: THREE.Material[] = [];
  private readonly geometries: THREE.BufferGeometry[] = [];
  private readonly instanced: THREE.InstancedMesh[] = [];
  private readonly ringMeshes: THREE.Mesh<THREE.TorusGeometry, THREE.MeshBasicMaterial>[] = [];
  private readonly sky: THREE.Mesh;
  private readonly sun: THREE.Mesh;
  private readonly colors: {
    grass: THREE.Color;
    forestFloor: THREE.Color;
    rock: THREE.Color;
    snow: THREE.Color;
    water: THREE.Color;
    accent: THREE.Color;
  };
  private ringMode: RingMode = "free";
  private nextRing = 0;

  constructor(world: World, scene: THREE.Scene) {
    this.world = world;
    const palette = world.palette;
    const grass = new THREE.Color(palette.grass);
    this.colors = {
      grass,
      forestFloor: grass.clone().lerp(new THREE.Color(palette.forest), 0.5).multiplyScalar(0.8),
      rock: new THREE.Color(palette.rock),
      snow: new THREE.Color(palette.snow),
      water: new THREE.Color(palette.water),
      accent: new THREE.Color(palette.accent),
    };

    scene.background = new THREE.Color(palette.horizon);
    scene.fog = new THREE.Fog(palette.horizon, FOG_NEAR, FOG_FAR);

    const hemi = new THREE.HemisphereLight(palette.horizon, palette.grass, palette.ambient);
    const sunLight = new THREE.DirectionalLight(palette.sun, palette.sunIntensity);
    sunLight.position.copy(SUN_DIRECTION);
    this.group.add(hemi, sunLight);

    // Normals are per face already (no shared vertices), so every triangle is one flat color
    this.terrainMaterial = this.material(new THREE.MeshLambertMaterial({ vertexColors: true }));
    this.waterMaterial = this.material(new THREE.MeshLambertMaterial({ vertexColors: true }));
    this.treeMaterial = this.material(new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true }));
    this.treeGeometry = this.geometry(pineGeometry(new THREE.Color(palette.forest), new THREE.Color(palette.trunk)));

    this.sky = this.buildSky();
    this.sun = new THREE.Mesh(
      this.geometry(new THREE.CircleGeometry(110, 24)),
      this.material(new THREE.MeshBasicMaterial({ color: palette.sun, fog: false, depthWrite: false })),
    );
    this.sun.renderOrder = -1;
    this.group.add(this.sky, this.sun);
    this.buildObstacles();
    this.buildClouds();
    this.buildRings();
  }

  private material<T extends THREE.Material>(material: T): T {
    this.materials.push(material);
    return material;
  }

  private geometry<T extends THREE.BufferGeometry>(geometry: T): T {
    this.geometries.push(geometry);
    return geometry;
  }

  // --- sky ------------------------------------------------------------------

  private buildSky(): THREE.Mesh {
    const geometry = this.geometry(new THREE.SphereGeometry(4000, 32, 16));
    const horizon = new THREE.Color(this.world.palette.horizon);
    const zenith = new THREE.Color(this.world.palette.zenith);
    const position = geometry.getAttribute("position");
    const colors = new Float32Array(position.count * 3);
    const color = new THREE.Color();
    for (let i = 0; i < position.count; i++) {
      const t = Math.pow(Math.max(0, position.getY(i) / 4000), 0.6);
      color.copy(horizon).lerp(zenith, t);
      color.toArray(colors, i * 3);
    }
    geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
    const sky = new THREE.Mesh(
      geometry,
      this.material(
        new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide, fog: false, depthWrite: false }),
      ),
    );
    sky.renderOrder = -2;
    return sky;
  }

  private buildClouds() {
    const { terrain, course, seed, palette } = this.world;
    const rng = makeRng(seed, "clouds");
    const geometry = this.geometry(new THREE.IcosahedronGeometry(1, 1));
    roughen(geometry, 0.15, `cloud${seed}`);
    // Partly self-lit, so their undersides don't pick up the grass color
    const material = new THREE.MeshLambertMaterial({ color: palette.cloud, flatShading: true });
    material.emissive.set(palette.cloud).multiplyScalar(0.55);
    const mesh = new THREE.InstancedMesh(geometry, this.material(material), CLOUDS);
    const endZ = course.rings[course.rings.length - 1].position.z + 1200;
    const matrix = new THREE.Matrix4();
    const rotation = new THREE.Quaternion();
    for (let i = 0; i < CLOUDS; i++) {
      const z = range(rng, -600, endZ);
      const position = new THREE.Vector3(
        terrain.centerX(z) + range(rng, -900, 900),
        terrain.floorY(z) + range(rng, 380, 720),
        z,
      );
      rotation.setFromAxisAngle(THREE.Object3D.DEFAULT_UP, range(rng, 0, Math.PI));
      const scale = new THREE.Vector3(range(rng, 45, 95), range(rng, 22, 40), range(rng, 35, 65));
      mesh.setMatrixAt(i, matrix.compose(position, rotation, scale));
    }
    mesh.computeBoundingSphere();
    this.instanced.push(mesh);
    this.group.add(mesh);
  }

  // --- terrain, forests and the river, streamed in chunks ------------------------

  private chunkKey(ix: number, iz: number): number {
    return (ix + 32768) * 65536 + (iz + 32768);
  }

  /** The color of one terrain triangle, from its height above the valley and its steepness */
  private faceColor(out: THREE.Color, x: number, y: number, z: number, upness: number, salt: number) {
    const { terrain, forest } = this.world;
    const { grass, forestFloor, rock, snow } = this.colors;
    const above = y - terrain.floorY(z);
    const steep = 1 - upness; // 0 flat, 1 vertical
    const jitter = hash3(Math.floor(x), Math.floor(z), salt);

    // Meadows, darker where the forest grows
    out.copy(grass).lerp(forestFloor, forest.density(x, z) * 0.7);
    // Pebbles along the river
    if (above < -1) out.lerp(rock, 0.45);
    // Bare rock on steep faces and on the high slopes
    out.lerp(rock, Math.max(smoothstep(0.22, 0.42, steep), smoothstep(SNOW_LINE * 0.55, SNOW_LINE * 0.85, above)));
    // Snow caps, thinner on cliffs
    const snowy = smoothstep(SNOW_LINE - 30, SNOW_LINE + 10, above + 70 * (jitter - 0.5));
    out.lerp(snow, snowy * (1 - 0.6 * smoothstep(0.45, 0.7, steep)));
    // A little variation per triangle, for the faceted look
    out.multiplyScalar(0.93 + 0.14 * jitter);
  }

  private buildTerrain(ix: number, iz: number): THREE.Mesh {
    const { terrain } = this.world;
    const n = CHUNK_CELLS + 1;
    const x0 = ix * CHUNK_SIZE;
    const z0 = iz * CHUNK_SIZE;
    const heights = new Float32Array(n * n);
    for (let j = 0; j < n; j++) {
      for (let i = 0; i < n; i++) heights[j * n + i] = terrain.rawHeight(x0 + i * CELL, z0 + j * CELL);
    }

    // Two triangles per cell, split along the 00-11 diagonal (Terrain.height does the same).
    // No shared vertices: each triangle gets its own flat color.
    const faces = CHUNK_CELLS * CHUNK_CELLS * 2;
    const positions = new Float32Array(faces * 9);
    const colors = new Float32Array(faces * 9);
    const color = new THREE.Color();
    let f = 0;
    const face = (ax: number, az: number, bx: number, bz: number, cx: number, cz: number) => {
      const ha = heights[az * n + ax];
      const hb = heights[bz * n + bx];
      const hc = heights[cz * n + cx];
      // Normal of (b - a) x (c - a); only how upright it is matters
      const e1x = (bx - ax) * CELL;
      const e1y = hb - ha;
      const e1z = (bz - az) * CELL;
      const e2x = (cx - ax) * CELL;
      const e2y = hc - ha;
      const e2z = (cz - az) * CELL;
      const nx = e1y * e2z - e1z * e2y;
      const ny = e1z * e2x - e1x * e2z;
      const nz = e1x * e2y - e1y * e2x;
      const upness = ny / Math.hypot(nx, ny, nz);
      const mx = x0 + ((ax + bx + cx) / 3) * CELL;
      const mz = z0 + ((az + bz + cz) / 3) * CELL;
      this.faceColor(color, mx, (ha + hb + hc) / 3, mz, upness, f);
      const o = f * 9;
      positions.set([ax * CELL, ha, az * CELL, bx * CELL, hb, bz * CELL, cx * CELL, hc, cz * CELL], o);
      for (let k = 0; k < 3; k++) color.toArray(colors, o + k * 3);
      f++;
    };
    for (let j = 0; j < CHUNK_CELLS; j++) {
      for (let i = 0; i < CHUNK_CELLS; i++) {
        face(i, j, i, j + 1, i + 1, j + 1);
        face(i, j, i + 1, j + 1, i + 1, j);
      }
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
    geometry.computeVertexNormals();
    geometry.computeBoundingSphere();
    const mesh = new THREE.Mesh(geometry, this.terrainMaterial);
    mesh.position.set(x0, 0, z0);
    mesh.matrixAutoUpdate = false;
    mesh.updateMatrix();
    return mesh;
  }

  private buildTrees(ix: number, iz: number): THREE.InstancedMesh | null {
    const trees = this.world.forest.trees(ix, iz);
    if (!trees.length) return null;
    const mesh = new THREE.InstancedMesh(this.treeGeometry, this.treeMaterial, trees.length);
    const matrix = new THREE.Matrix4();
    const rotation = new THREE.Quaternion();
    const position = new THREE.Vector3();
    const scale = new THREE.Vector3();
    const color = new THREE.Color();
    trees.forEach((tree, i) => {
      const spin = hash3(Math.floor(tree.x * 10), Math.floor(tree.z * 10), 1);
      rotation.setFromAxisAngle(THREE.Object3D.DEFAULT_UP, spin * Math.PI * 2);
      matrix.compose(
        position.set(tree.x, tree.ground, tree.z),
        rotation,
        scale.set(tree.radius, tree.height, tree.radius),
      );
      mesh.setMatrixAt(i, matrix);
      // Each tree a slightly different shade
      const shade = 0.82 + 0.3 * hash3(Math.floor(tree.x * 10), Math.floor(tree.z * 10), 2);
      mesh.setColorAt(i, color.setRGB(shade, shade * (0.97 + 0.06 * spin), shade));
    });
    mesh.computeBoundingSphere();
    return mesh;
  }

  /** The river's surface for one band of z, as a faceted ribbon */
  private buildWater(iz: number): THREE.Mesh {
    const { terrain } = this.world;
    const rows = CHUNK_CELLS + 1;
    const across = [-2, -1, 0, 1, 2]; // in river half-widths: the edges tuck under the banks
    const z0 = iz * CHUNK_SIZE;
    const grid: number[][] = [];
    for (let j = 0; j < rows; j++) {
      const z = z0 + j * CELL;
      const cx = terrain.centerX(z);
      const half = terrain.riverWidth(z);
      const level = terrain.waterLevel(z);
      grid.push(
        across.flatMap((k, i) => [cx + k * half, level + (hash3(j + iz * rows, i, 7) - 0.5) * 0.4, z]),
      );
    }
    const positions: number[] = [];
    const colors: number[] = [];
    const color = new THREE.Color();
    const vertex = (j: number, i: number) => grid[j].slice(i * 3, i * 3 + 3);
    for (let j = 0; j < rows - 1; j++) {
      for (let i = 0; i < across.length - 1; i++) {
        for (const tri of [
          [vertex(j, i), vertex(j + 1, i), vertex(j + 1, i + 1)],
          [vertex(j, i), vertex(j + 1, i + 1), vertex(j, i + 1)],
        ]) {
          color.copy(this.colors.water).multiplyScalar(0.92 + 0.16 * hash3(j + iz * rows, i, positions.length));
          for (const v of tri) {
            positions.push(...v);
            colors.push(color.r, color.g, color.b);
          }
        }
      }
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
    geometry.computeVertexNormals();
    geometry.computeBoundingSphere();
    return new THREE.Mesh(geometry, this.waterMaterial);
  }

  /** Builds missing chunks near (x, z), nearest first, within a time budget; drops far ones */
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
      const chunk: Chunk = { terrain: this.buildTerrain(ix, iz), trees: this.buildTrees(ix, iz) };
      this.chunks.set(this.chunkKey(ix, iz), chunk);
      this.group.add(chunk.terrain);
      if (chunk.trees) this.group.add(chunk.trees);
      if (performance.now() - started > budgetMs) break;
    }

    // The river along z, wherever x is
    for (let iz = cz - reach; iz <= cz + reach; iz++) {
      if (!this.water.has(iz)) {
        const mesh = this.buildWater(iz);
        this.water.set(iz, mesh);
        this.group.add(mesh);
      }
    }

    // Drop what is far behind
    const far = VIEW_DISTANCE + CHUNK_SIZE * 2.5;
    for (const [key, chunk] of this.chunks) {
      const d = Math.hypot(
        chunk.terrain.position.x + CHUNK_SIZE / 2 - x,
        chunk.terrain.position.z + CHUNK_SIZE / 2 - z,
      );
      if (d > far) {
        this.disposeChunk(chunk);
        this.chunks.delete(key);
      }
    }
    for (const [iz, mesh] of this.water) {
      if (Math.abs((iz + 0.5) * CHUNK_SIZE - z) > far) {
        this.group.remove(mesh);
        mesh.geometry.dispose();
        this.water.delete(iz);
      }
    }
  }

  private disposeChunk(chunk: Chunk) {
    this.group.remove(chunk.terrain);
    chunk.terrain.geometry.dispose();
    if (chunk.trees) {
      this.group.remove(chunk.trees);
      chunk.trees.dispose(); // its instance buffers; the pine geometry is shared
    }
  }

  // --- obstacles ---------------------------------------------------------------

  private buildObstacles() {
    const { obstacles, seed } = this.world;
    const rockMaterial = this.material(new THREE.MeshLambertMaterial({ flatShading: true }));
    const pillars = obstacles.filter((o): o is Pillar => o instanceof Pillar);
    const rocks = obstacles.filter((o): o is Rock => o instanceof Rock);
    const arches = obstacles.filter((o): o is Arch => o instanceof Arch);
    const matrix = new THREE.Matrix4();
    const rotation = new THREE.Quaternion();
    const scale = new THREE.Vector3();
    const position = new THREE.Vector3();
    const color = new THREE.Color();
    const tint = (i: number, salt: number) =>
      color.copy(this.colors.rock).multiplyScalar(0.85 + 0.3 * hash3(seed, i, salt));

    // Rock needles. Matches Pillar.distance: radius 1 at the base, 0.35 at the top
    const pillarGeometry = this.geometry(new THREE.CylinderGeometry(0.35, 1, 1, 7, 4));
    pillarGeometry.translate(0, 0.5, 0);
    roughen(pillarGeometry, 0.14, `pillar${seed}`);
    const pillarMesh = new THREE.InstancedMesh(pillarGeometry, rockMaterial, Math.max(1, pillars.length));
    pillarMesh.count = pillars.length;
    pillars.forEach((p, i) => {
      rotation.setFromAxisAngle(THREE.Object3D.DEFAULT_UP, hash3(seed, i, 3) * Math.PI * 2);
      matrix.compose(position.set(p.x, p.bottom, p.z), rotation, scale.set(p.radius, p.top - p.bottom, p.radius));
      pillarMesh.setMatrixAt(i, matrix);
      pillarMesh.setColorAt(i, tint(i, 4));
    });

    const rockGeometry = this.geometry(new THREE.IcosahedronGeometry(1, 1));
    roughen(rockGeometry, 0.12, `rock${seed}`);
    const rockMesh = new THREE.InstancedMesh(rockGeometry, rockMaterial, Math.max(1, rocks.length));
    rockMesh.count = rocks.length;
    rocks.forEach((r, i) => {
      rotation.setFromEuler(new THREE.Euler(hash3(seed, i, 5) * 6, hash3(seed, i, 6) * 6, 0));
      matrix.compose(position.set(r.x, r.y, r.z), rotation, scale.setScalar(r.radius));
      rockMesh.setMatrixAt(i, matrix);
      rockMesh.setColorAt(i, tint(i, 7));
    });
    pillarMesh.computeBoundingSphere();
    rockMesh.computeBoundingSphere();
    this.instanced.push(pillarMesh, rockMesh);
    this.group.add(pillarMesh, rockMesh);

    const archMaterial = this.material(new THREE.MeshLambertMaterial({ color: this.colors.rock, flatShading: true }));
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

  // --- rings -------------------------------------------------------------------

  private buildRings() {
    const forward = new THREE.Vector3(0, 0, 1);
    for (const ring of this.world.course.rings) {
      const mesh = new THREE.Mesh(
        this.geometry(new THREE.TorusGeometry(ring.radius, ring.finish ? 1.6 : 1, 8, 48)),
        this.material(new THREE.MeshBasicMaterial({ transparent: true })),
      );
      mesh.position.copy(ring.position);
      mesh.quaternion.setFromUnitVectors(forward, ring.normal);
      this.ringMeshes.push(mesh);
      this.group.add(mesh);
    }
    this.setRings("free", 0);
  }

  /** "race": the next ring glows, passed rings disappear. "free": all rings shown quietly. */
  setRings(mode: RingMode, next: number) {
    this.ringMode = mode;
    this.nextRing = next;
    this.ringMeshes.forEach((mesh, i) => {
      const ring: Ring = this.world.course.rings[i];
      const material = mesh.material;
      mesh.visible = mode !== "hidden" && (mode === "free" || i >= next);
      mesh.scale.setScalar(1);
      const isNext = mode === "race" && i === next;
      material.color.copy(ring.finish ? FINISH_COLOR : isNext ? this.colors.accent : new THREE.Color("#ffffff"));
      material.opacity = isNext || ring.finish ? 1 : mode === "race" ? 0.55 : 0.35;
      // The next ring shows through the fog, so you always know where to go
      material.fog = !isNext;
      material.needsUpdate = true;
    });
  }

  /** Per frame: sky and sun follow the camera, the next ring pulses */
  update(camera: THREE.Camera, time: number) {
    this.sky.position.copy(camera.position);
    this.sun.position.copy(camera.position).addScaledVector(SUN_DIRECTION, 3500);
    this.sun.lookAt(camera.position);
    if (this.ringMode === "race") {
      const mesh = this.ringMeshes[this.nextRing];
      mesh?.scale.setScalar(1 + 0.06 * Math.sin(time * 6));
    }
  }

  dispose() {
    for (const chunk of this.chunks.values()) this.disposeChunk(chunk);
    this.chunks.clear();
    for (const mesh of this.water.values()) mesh.geometry.dispose();
    this.water.clear();
    this.instanced.forEach((m) => m.dispose());
    this.geometries.forEach((g) => g.dispose());
    this.materials.forEach((m) => m.dispose());
    this.group.clear();
  }
}
