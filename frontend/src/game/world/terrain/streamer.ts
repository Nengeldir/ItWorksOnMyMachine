import * as THREE from "three";
import { TERRAIN } from "../../tuning";
import { PLANT_STRIDE } from "../flora/species";
import type { FloraView } from "../flora/view";
import { kindInfo } from "../structures/kinds";
import { Plant } from "../trees";
import type { LandCollider } from "../landCollider";
import type { World } from "../World";
import { NODE_SIZE, type TerrainMesh, VOXEL, nodeKey } from "./mesh";

// Streams generator-v2 land around the camera as an octree of nodes: 384 m
// nodes far away, split into 192, 96 and finally 48 m nodes as you get close. Every
// node has 16 cells a side, so the triangle count per node stays the same and
// far land is coarse. A coarse node stays on screen until all of its finer
// replacements have arrived (and the other way round when merging), so the land
// never shows holes or two levels at once.

export const LOD_LEVELS = 4;
const ROOT_LOD = LOD_LEVELS - 1;

export interface NodeRequest {
  kind: "node";
  key: number;
  lod: number;
  ix: number;
  iy: number;
  iz: number;
}

export type NodeResult = TerrainMesh & { key: number; plants: Float32Array; tufts: Float32Array };

interface Node {
  lod: number;
  ix: number;
  iy: number;
  iz: number;
  key: number;
  box: THREE.Box3;
  parent: Node | null;
  children: Node[] | null; // null until first needed
  state: "idle" | "pending" | "loaded";
  mesh: THREE.Mesh | null; // null when loaded but empty
  plants: Float32Array | null;
  tufts: Float32Array | null;
  shown: boolean;
  split: boolean; // hysteresis: keep fine detail until beyond the outer threshold
  desired: number; // the update stamp it was last wanted in
}

export class LandStreamer {
  ready = false;
  private readonly world: World;
  private readonly group: THREE.Group;
  private readonly material: THREE.Material;
  private readonly flora: FloraView | null;
  private readonly collider: LandCollider;
  private readonly roots: Node[] = [];
  private readonly byKey = new Map<number, Node>();
  private readonly ranges = new Map<number, [number, number] | null>();
  private readonly lastUpdate = new THREE.Vector3(Infinity, 0, 0);
  private stamp = 0;
  private readonly lookAhead = new THREE.Vector3();
  private readonly lastLookAhead = new THREE.Vector3(Infinity, 0, 0);
  private predicting = false;
  private readonly cache = new Map<number, { node: Node; bytes: number }>();
  private cacheBytes = 0;
  private desired: Node[] = [];
  private readonly wanted: { node: Node; d: number }[] = [];

  constructor(world: World, group: THREE.Group, material: THREE.Material, flora: FloraView | null, collider: LandCollider) {
    this.world = world;
    this.collider = collider;
    this.group = group;
    this.material = material;
    this.flora = flora;
    const field = world.land!;
    const { course } = world;
    const extent = field.ground?.spec.extent ?? 900;
    const size = NODE_SIZE << ROOT_LOD;
    // The land's footprint: the course from before the start to past the end, out to its extent either side
    let xMin = Infinity;
    let xMax = -Infinity;
    for (let z = course.start.z - 600; z <= course.endZ + 900; z += 50) {
      xMin = Math.min(xMin, course.x(z));
      xMax = Math.max(xMax, course.x(z));
    }
    for (const s of field.shapes) {
      xMin = Math.min(xMin, s.min.x + extent);
      xMax = Math.max(xMax, s.max.x - extent);
    }
    const ix0 = Math.floor((xMin - extent) / size);
    const ix1 = Math.floor((xMax + extent) / size);
    const iz0 = Math.floor((course.start.z - 600) / size);
    const iz1 = Math.floor((course.endZ + 900) / size);
    for (let ix = ix0; ix <= ix1; ix++) {
      for (let iz = iz0; iz <= iz1; iz++) {
        const range = this.columnRange(ROOT_LOD, ix, iz);
        if (!range) continue;
        for (let iy = Math.floor(range[0] / size); iy <= Math.floor(range[1] / size); iy++) {
          this.roots.push(this.node(ROOT_LOD, ix, iy, iz, null));
        }
      }
    }
  }

  private node(lod: number, ix: number, iy: number, iz: number, parent: Node | null): Node {
    const size = NODE_SIZE << lod;
    const key = nodeKey(lod, ix, iy, iz);
    const node: Node = {
      lod,
      ix,
      iy,
      iz,
      key,
      box: new THREE.Box3(new THREE.Vector3(ix * size, iy * size, iz * size), new THREE.Vector3((ix + 1) * size, (iy + 1) * size, (iz + 1) * size)),
      parent,
      children: null,
      state: "idle",
      mesh: null,
      plants: null,
      tufts: null,
      shown: false,
      split: false,
      desired: -1,
    };
    this.byKey.set(key, node);
    return node;
  }

  /** Land height range over a node column, cached (null: no land) */
  private columnRange(lod: number, ix: number, iz: number): [number, number] | null {
    const key = nodeKey(lod, ix, 0, iz);
    let range = this.ranges.get(key);
    if (range === undefined) {
      const size = NODE_SIZE << lod;
      range = this.world.land!.columnRange(ix * size, iz * size, (ix + 1) * size, (iz + 1) * size);
      this.ranges.set(key, range);
    }
    return range;
  }

  private childrenOf(node: Node): Node[] {
    if (!node.children) {
      node.children = [];
      const lod = node.lod - 1;
      const size = NODE_SIZE << lod;
      for (let dx = 0; dx < 2; dx++) {
        for (let dz = 0; dz < 2; dz++) {
          const ix = node.ix * 2 + dx;
          const iz = node.iz * 2 + dz;
          const range = this.columnRange(lod, ix, iz);
          if (!range) continue;
          for (let dy = 0; dy < 2; dy++) {
            const iy = node.iy * 2 + dy;
            if ((iy + 1) * size < range[0] || iy * size > range[1]) continue;
            node.children.push(this.node(lod, ix, iy, iz, node));
          }
        }
      }
    }
    return node.children;
  }

  /** Which nodes should be on screen from here, and which to ask the workers for next */
  update(at: THREE.Vector3, request: (r: NodeRequest) => boolean, velocity?: THREE.Vector3) {
    this.lookAhead.copy(at);
    this.predicting = !!velocity && velocity.lengthSq() > 1;
    if (this.predicting) {
      const seconds = Math.min(TERRAIN.lodLookAheadSeconds, TERRAIN.lodLookAheadMax / velocity!.length());
      this.lookAhead.addScaledVector(velocity!, seconds);
    }
    // Take in a few of the arrived meshes (all of them while nothing is on screen yet)
    this.trimCache();
    if (this.arrived.length) {
      const budget = this.ready ? TERRAIN.uploadsPerFrame : this.arrived.length;
      for (const result of this.arrived.splice(0, budget)) this.take(result);
      this.settle();
    }
    if (this.lastUpdate.distanceToSquared(at) > 8 * 8 || this.lastLookAhead.distanceToSquared(this.lookAhead) > 8 * 8 || this.stamp === 0) {
      this.lastUpdate.copy(at);
      this.lastLookAhead.copy(this.lookAhead);
      this.stamp++;
      this.desired.length = 0;
      for (const root of this.roots) this.visit(root, at);
      for (const root of this.roots) this.pruneTree(root, false);
      this.settle();
    }

    // Ask for missing nodes, nearest first
    const wanted = this.wanted;
    wanted.length = 0;
    let missingNearby = false;
    for (const node of this.desired) {
      if (node.shown) continue;
      const d = node.box.distanceToPoint(at);
      if (d < TERRAIN.readyRadius && !this.shownAncestor(node) && !this.visibleCoverage(node)) missingNearby = true;
      if (node.state === "idle") wanted.push({ node, d: d + node.lod * 120 });
    }
    this.ready = !missingNearby;
    wanted.sort((a, b) => a.d - b.d);
    for (const { node } of wanted) {
      if (!request({ kind: "node", key: node.key, lod: node.lod, ix: node.ix, iy: node.iy, iz: node.iz })) break;
      node.state = "pending";
    }
  }

  private visit(node: Node, at: THREE.Vector3) {
    const d = node.box.distanceToPoint(at);
    if (d > TERRAIN.viewDistance) return;
    const split = node.lod === 3 ? TERRAIN.lodFar : node.lod === 2 ? TERRAIN.lodNear : TERRAIN.lodDetail;
    const detailDistance = this.predicting ? Math.min(d, node.box.distanceToPoint(this.lookAhead)) : d;
    node.split = node.lod > 0 && detailDistance < split + (node.split ? TERRAIN.lodHysteresis : 0);
    if (node.split) {
      for (const child of this.childrenOf(node)) this.visit(child, at);
    } else {
      node.desired = this.stamp;
      this.desired.push(node);
    }
  }

  /** Results wait here and are taken in a few per frame, so uploads don't pile into one frame */
  private readonly arrived: NodeResult[] = [];

  receive(result: NodeResult) {
    this.arrived.push(result);
  }

  private take(result: NodeResult) {
    const node = this.byKey.get(result.key);
    if (!node || node.state !== "pending") return;
    // A worker may finish after we have flown away. Avoid uploading obsolete
    // geometry or planting its colliders; it can be requested again if needed.
    if (node.desired !== this.stamp) {
      node.state = "idle";
      return;
    }
    node.state = "loaded";
    if (result.positions.length) {
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute("position", new THREE.BufferAttribute(result.positions, 3));
      geometry.setAttribute("rock", new THREE.BufferAttribute(result.rock, 4, true));
      geometry.setAttribute("cover", new THREE.BufferAttribute(result.cover, 4, true));
      geometry.setAttribute("crystal", new THREE.BufferAttribute(result.crystal ?? new Uint8Array(result.positions.length / 3), 1, true));
      geometry.setAttribute("snow", new THREE.BufferAttribute(result.snow, 1));
      geometry.computeBoundingSphere();
      node.mesh = new THREE.Mesh(geometry, this.material);
      node.mesh.matrixAutoUpdate = false;
    }
    node.plants = result.plants;
    node.tufts = result.tufts;
    // Full-detail nodes are the ones near you: their plants collide from now on
    if (node.lod === 0) this.world.trees.add(node.key, this.colliders(result.plants));
  }

  private colliders(plants: Float32Array): Plant[] {
    const out: Plant[] = [];
    for (let o = 0; o < plants.length; o += PLANT_STRIDE) {
      const info = kindInfo(this.world.biome, plants[o]);
      out.push(new Plant(plants[o + 1], plants[o + 2], plants[o + 3], plants[o + 4], plants[o + 5], plants[o + 6], info.collider));
    }
    return out;
  }

  /** Puts arrived nodes on screen once they cover their area, and takes off what they replace */
  private settle() {
    for (const node of this.desired) {
      if (node.state !== "loaded" || node.shown) continue;
      const shownAncestor = this.shownAncestor(node);
      if (shownAncestor) {
        // Splitting: wait until everything wanted under the coarse node has arrived
        if (!this.allLoaded(shownAncestor)) continue;
        this.showUnder(shownAncestor);
        this.hide(shownAncestor);
      } else {
        this.show(node);
        // Merging: the finer nodes it replaces go
        if (node.children) for (const child of node.children) this.hideTree(child);
      }
    }
  }

  private shownAncestor(node: Node): Node | null {
    for (let a = node.parent; a; a = a.parent) if (a.shown) return a;
    return null;
  }

  /** Existing collision/render coverage remains usable while its LOD replacement loads. */
  private visibleCoverage(node: Node): boolean {
    return node.shown || (!!node.children?.length && node.children.every(child => this.visibleCoverage(child)));
  }

  /** Are all the nodes wanted under `node` loaded? */
  private allLoaded(node: Node): boolean {
    if (!node.children) return true;
    for (const child of node.children) {
      if (child.desired === this.stamp) {
        if (child.state !== "loaded") return false;
      } else if (!this.allLoaded(child)) {
        return false;
      }
    }
    return true;
  }

  private showUnder(node: Node) {
    if (!node.children) return;
    for (const child of node.children) {
      if (child.desired === this.stamp) this.show(child);
      else this.showUnder(child);
    }
  }

  private show(node: Node) {
    const cached = this.cache.get(node.key);
    if (cached) {
      this.cacheBytes -= cached.bytes;
      this.cache.delete(node.key);
    }
    node.shown = true;
    if (node.mesh) {
      this.group.add(node.mesh);
      // What is on screen is what you hit
      this.collider.add(node.key, node.mesh.geometry.getAttribute("position").array as Float32Array, VOXEL << node.lod);
    }
    if (node.plants && this.flora) this.flora.show(node.key, node.lod, node.plants, node.tufts!, node.box);
  }

  private hide(node: Node) {
    if (node.shown) this.flora?.hide(node.key);
    node.shown = false;
    this.collider.remove(node.key);
    if (node.mesh) this.group.remove(node.mesh);
    if (node.state !== "loaded" || this.cache.has(node.key)) return;
    // Retain recently replaced nodes, bounded by both bytes and entry count.
    // This avoids regenerating them when turning around or crossing a LOD ring.
    let bytes = 128 + (node.plants?.byteLength ?? 0) + (node.tufts?.byteLength ?? 0);
    if (node.mesh) for (const attribute of Object.values(node.mesh.geometry.attributes)) bytes += attribute.array.byteLength * 2; // CPU + GPU
    this.cache.set(node.key, { node, bytes });
    this.cacheBytes += bytes;
    this.trimCache();
  }

  private trimCache(budget = TERRAIN.cacheMiB * 1024 * 1024, entries = 256) {
    while (this.cacheBytes > budget || this.cache.size > entries) {
      const entry = this.cache.values().next().value;
      if (!entry) break;
      const { node, bytes } = entry;
      this.cache.delete(node.key);
      this.cacheBytes -= bytes;
      node.mesh?.geometry.dispose();
      node.mesh = null;
      node.plants = null;
      node.tufts = null;
      node.state = "idle";
    }
  }

  private hideTree(node: Node) {
    if (node.shown || node.state === "loaded") this.hide(node);
    if (node.children) for (const child of node.children) this.hideTree(child);
  }

  /**
   * Drops what is no longer wanted (left behind as you fly on). Keeps nodes
   * that still stand in for wanted ones: coarse nodes waiting for their finer
   * replacements, and fine nodes waiting for a coarse one (`covered`).
   * Returns whether anything in this subtree is wanted.
   */
  private pruneTree(node: Node, covered: boolean): boolean {
    const here = node.desired === this.stamp;
    let wanted = here;
    if (node.children) for (const child of node.children) wanted = this.pruneTree(child, covered || here) || wanted;
    if (!wanted && !covered && (node.shown || node.state === "loaded")) this.hide(node);
    return wanted;
  }

  /**
   * Is the land at this point on screen (or is there none to show)? Until it
   * is, collisions there fall back to the distance field
   */
  covers(x: number, y: number, z: number): boolean {
    for (const root of this.roots) if (inside(root.box, x, y, z)) return this.coveredIn(root, x, y, z);
    return true;
  }

  private coveredIn(node: Node, x: number, y: number, z: number): boolean {
    if (node.shown) return true;
    if (!node.children) return false;
    for (const child of node.children) if (inside(child.box, x, y, z)) return this.coveredIn(child, x, y, z);
    // No finer node holds this spot: no land there
    return true;
  }

  /** Set aside (its workers stopped): what was asked for is asked again later, hidden meshes go */
  park() {
    for (const node of this.byKey.values()) if (node.state === "pending") node.state = "idle";
    this.arrived.length = 0;
    this.trimCache(0, 0);
  }

  dispose() {
    for (const node of this.byKey.values()) if (node.mesh) node.mesh.geometry.dispose();
    this.byKey.clear();
    this.cache.clear();
    this.cacheBytes = 0;
    this.arrived.length = 0;
  }
}

function inside(box: THREE.Box3, x: number, y: number, z: number): boolean {
  return x >= box.min.x && x < box.max.x && y >= box.min.y && y < box.max.y && z >= box.min.z && z < box.max.z;
}
