import * as THREE from "three";
import { hashToUnit } from "../rng";
import type { Ring } from "./course";
import { Arch, Pillar, Rock } from "./obstacles";
import { CELL, CHUNK_CELLS, CHUNK_SIZE, smoothstep } from "./terrain";
import type { World } from "./World";

export const VIEW_DISTANCE = 1500;
const FOG_NEAR = 250;
const FOG_FAR = 1350;
const SUN_DIRECTION = new THREE.Vector3(-0.45, 0.55, 0.7).normalize();
const FINISH_COLOR = new THREE.Color("#ffd23f");

export type RingMode = "race" | "free" | "hidden";

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

/** All the meshes for one World: terrain chunks streamed around the camera, obstacles, rings, sky */
export class WorldView {
  readonly group = new THREE.Group();
  private readonly world: World;
  private readonly chunks = new Map<number, THREE.Mesh>();
  private readonly terrainMaterial: THREE.MeshLambertMaterial;
  private readonly materials: THREE.Material[] = [];
  private readonly geometries: THREE.BufferGeometry[] = [];
  private readonly ringMeshes: THREE.Mesh<THREE.TorusGeometry, THREE.MeshBasicMaterial>[] = [];
  private readonly instanced: THREE.InstancedMesh[] = [];
  private readonly sky: THREE.Mesh;
  private readonly sun: THREE.Mesh;
  private readonly colors: { ground: THREE.Color; rock: THREE.Color; top: THREE.Color; accent: THREE.Color };
  private ringMode: RingMode = "free";
  private nextRing = 0;

  constructor(world: World, scene: THREE.Scene) {
    this.world = world;
    const palette = world.palette;
    this.colors = {
      ground: new THREE.Color(palette.ground),
      rock: new THREE.Color(palette.rock),
      top: new THREE.Color(palette.top),
      accent: new THREE.Color(palette.accent),
    };

    scene.background = new THREE.Color(palette.horizon);
    scene.fog = new THREE.Fog(palette.horizon, FOG_NEAR, FOG_FAR);

    const hemi = new THREE.HemisphereLight(palette.horizon, palette.ground, palette.ambient);
    const sunLight = new THREE.DirectionalLight(palette.sun, palette.sunIntensity);
    sunLight.position.copy(SUN_DIRECTION);
    this.group.add(hemi, sunLight);

    this.terrainMaterial = this.material(new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true }));
    this.sky = this.buildSky();
    this.sun = new THREE.Mesh(
      this.geometry(new THREE.CircleGeometry(110, 24)),
      this.material(new THREE.MeshBasicMaterial({ color: palette.sun, fog: false, depthWrite: false })),
    );
    this.sun.renderOrder = -1;
    this.group.add(this.sky, this.sun);
    this.buildObstacles();
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

  // --- terrain chunks ----------------------------------------------------------

  private chunkKey(ix: number, iz: number): number {
    return (ix + 32768) * 65536 + (iz + 32768);
  }

  private buildChunk(ix: number, iz: number): THREE.Mesh {
    const { terrain } = this.world;
    const n = CHUNK_CELLS + 1;
    const x0 = ix * CHUNK_SIZE;
    const z0 = iz * CHUNK_SIZE;

    // Heights with a one-cell border, for slopes at the edges
    const stride = n + 2;
    const heights = new Float32Array(stride * stride);
    for (let j = -1; j <= n; j++) {
      for (let i = -1; i <= n; i++) {
        heights[(j + 1) * stride + (i + 1)] = terrain.rawHeight(x0 + i * CELL, z0 + j * CELL);
      }
    }

    const positions = new Float32Array(n * n * 3);
    const colors = new Float32Array(n * n * 3);
    const color = new THREE.Color();
    const { ground, rock, top } = this.colors;
    for (let j = 0; j < n; j++) {
      for (let i = 0; i < n; i++) {
        const h = heights[(j + 1) * stride + (i + 1)];
        const sx = (heights[(j + 1) * stride + (i + 2)] - heights[(j + 1) * stride + i]) / (2 * CELL);
        const sz = (heights[(j + 2) * stride + (i + 1)] - heights[j * stride + (i + 1)]) / (2 * CELL);
        const slope = Math.sqrt(sx * sx + sz * sz);
        const wz = z0 + j * CELL;
        const above = h - terrain.floorY(wz);

        const rocky = smoothstep(0.5, 1.2, slope);
        const high = smoothstep(120, 200, above) * (1 - rocky * 0.7);
        color.copy(ground).lerp(rock, rocky).lerp(top, high);
        // A little noise per vertex for the low-poly look
        color.multiplyScalar(0.93 + 0.14 * hashToUnit(`${x0 + i * CELL},${wz}`));

        const v = (j * n + i) * 3;
        positions[v] = i * CELL;
        positions[v + 1] = h;
        positions[v + 2] = j * CELL;
        colors[v] = color.r;
        colors[v + 1] = color.g;
        colors[v + 2] = color.b;
      }
    }

    // Two triangles per cell, split along the 00-11 diagonal (Terrain.height does the same)
    const index = new Uint16Array(CHUNK_CELLS * CHUNK_CELLS * 6);
    let k = 0;
    for (let j = 0; j < CHUNK_CELLS; j++) {
      for (let i = 0; i < CHUNK_CELLS; i++) {
        const a = j * n + i;
        const b = a + 1;
        const c = a + n;
        const d = c + 1;
        index.set([a, c, d, a, d, b], k);
        k += 6;
      }
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
    geometry.setIndex(new THREE.BufferAttribute(index, 1));
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
    const rockMaterial = this.material(new THREE.MeshLambertMaterial({ flatShading: true }));
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
    for (const mesh of this.chunks.values()) mesh.geometry.dispose();
    this.chunks.clear();
    this.instanced.forEach((m) => m.dispose());
    this.geometries.forEach((g) => g.dispose());
    this.materials.forEach((m) => m.dispose());
    this.group.clear();
  }
}
