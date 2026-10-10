import * as THREE from "three";

/**
 * A dense pool of instances in one InstancedMesh: owners (land nodes) add and
 * remove their instances as they come and go, and the last instance moves into
 * any hole, so drawing never touches dead slots. One draw call per pool.
 */
export class InstancePool {
  mesh: THREE.InstancedMesh;
  private capacity: number;
  private count = 0;
  private readonly slots = new Map<number, number[]>();
  private owner = new Float64Array(0); // node keys go past 2³¹
  private index = new Int32Array(0);
  private readonly geometry: THREE.BufferGeometry;
  private readonly material: THREE.Material;
  private readonly group: THREE.Group;
  private dirty = false;
  private dirtyFrom = Infinity; // lowest slot changed since the last upload

  constructor(geometry: THREE.BufferGeometry, material: THREE.Material, group: THREE.Group, capacity = 512) {
    this.geometry = geometry;
    this.material = material;
    this.group = group;
    this.capacity = capacity;
    this.mesh = this.create(capacity);
    this.owner = new Float64Array(capacity);
    this.index = new Int32Array(capacity);
    group.add(this.mesh);
  }

  private create(capacity: number): THREE.InstancedMesh {
    const mesh = new THREE.InstancedMesh(this.geometry, this.material, capacity);
    mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 3), 3);
    mesh.count = 0;
    // Instances are spread all around the camera: no point culling the whole pool
    mesh.frustumCulled = false;
    mesh.matrixAutoUpdate = false;
    return mesh;
  }

  private grow(needed: number) {
    let capacity = this.capacity;
    while (capacity < needed) capacity *= 2;
    const next = this.create(capacity);
    (next.instanceMatrix.array as Float32Array).set(this.mesh.instanceMatrix.array as Float32Array);
    (next.instanceColor!.array as Float32Array).set(this.mesh.instanceColor!.array as Float32Array);
    next.count = this.count;
    const owner = new Float64Array(capacity);
    owner.set(this.owner);
    const index = new Int32Array(capacity);
    index.set(this.index);
    this.owner = owner;
    this.index = index;
    this.group.remove(this.mesh);
    this.mesh.dispose();
    this.mesh = next;
    this.group.add(next);
    this.capacity = capacity;
    this.dirtyFrom = 0;
  }

  /** Adds `n` instances for an owner: 16 floats of matrix and 3 of color each */
  add(owner: number, matrices: Float32Array, colors: Float32Array) {
    const n = colors.length / 3;
    if (!n || this.slots.has(owner)) return;
    if (this.count + n > this.capacity) this.grow(this.count + n);
    const list: number[] = [];
    const m = this.mesh.instanceMatrix.array as Float32Array;
    const c = this.mesh.instanceColor!.array as Float32Array;
    for (let i = 0; i < n; i++) {
      const slot = this.count++;
      m.set(matrices.subarray(i * 16, i * 16 + 16), slot * 16);
      c.set(colors.subarray(i * 3, i * 3 + 3), slot * 3);
      this.owner[slot] = owner;
      this.index[slot] = i;
      list.push(slot);
    }
    this.slots.set(owner, list);
    this.dirty = true;
    this.dirtyFrom = Math.min(this.dirtyFrom, list[0]);
  }

  remove(owner: number) {
    const list = this.slots.get(owner);
    if (!list) return;
    this.slots.delete(owner);
    const m = this.mesh.instanceMatrix.array as Float32Array;
    const c = this.mesh.instanceColor!.array as Float32Array;
    // Highest slots first, so a moved instance is never one we're about to remove
    list.sort((a, b) => b - a);
    this.dirtyFrom = Math.min(this.dirtyFrom, list[list.length - 1]);
    for (const slot of list) {
      const last = --this.count;
      if (slot !== last) {
        m.copyWithin(slot * 16, last * 16, last * 16 + 16);
        c.copyWithin(slot * 3, last * 3, last * 3 + 3);
        const moved = this.owner[last];
        this.owner[slot] = moved;
        this.index[slot] = this.index[last];
        this.slots.get(moved)![this.index[last]] = slot;
      }
    }
    this.dirty = true;
  }

  has(owner: number): boolean {
    return this.slots.has(owner);
  }

  /** Uploads changes, once per frame at most: only the slots from the lowest one changed to the end */
  flush() {
    if (!this.dirty) return;
    this.dirty = false;
    this.mesh.count = this.count;
    const from = Math.min(this.dirtyFrom, this.count);
    this.dirtyFrom = Infinity;
    const length = this.count - from;
    const matrix = this.mesh.instanceMatrix;
    const color = this.mesh.instanceColor!;
    matrix.clearUpdateRanges();
    color.clearUpdateRanges();
    if (length > 0) {
      matrix.addUpdateRange(from * 16, length * 16);
      color.addUpdateRange(from * 3, length * 3);
      matrix.needsUpdate = true;
      color.needsUpdate = true;
    }
  }

  dispose() {
    this.group.remove(this.mesh);
    this.mesh.dispose();
  }
}
