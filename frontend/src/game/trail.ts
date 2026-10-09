import * as THREE from "three";

const LENGTH = 48;
const MIN_STEP = 0.8;

/** A fading ribbon behind a wingtip */
export class Trail {
  readonly mesh: THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>;
  private readonly points: THREE.Vector3[] = [];
  private readonly sides: THREE.Vector3[] = [];
  private readonly positions: Float32Array;
  private readonly width: number;

  constructor(color: string, width = 0.14) {
    this.width = width;
    this.positions = new Float32Array(LENGTH * 2 * 3);
    const colors = new Float32Array(LENGTH * 2 * 4);
    const c = new THREE.Color(color);
    for (let i = 0; i < LENGTH; i++) {
      // Newest point first, fading out along the ribbon
      const alpha = (1 - i / (LENGTH - 1)) ** 1.5;
      for (let s = 0; s < 2; s++) colors.set([c.r, c.g, c.b, alpha], (i * 2 + s) * 4);
    }
    const index: number[] = [];
    for (let i = 0; i < LENGTH - 1; i++) {
      const a = i * 2;
      index.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(this.positions, 3).setUsage(THREE.DynamicDrawUsage));
    geometry.setAttribute("color", new THREE.BufferAttribute(colors, 4));
    geometry.setIndex(index);
    this.mesh = new THREE.Mesh(
      geometry,
      new THREE.MeshBasicMaterial({
        vertexColors: true,
        transparent: true,
        depthWrite: false,
        side: THREE.DoubleSide,
        opacity: 0,
      }),
    );
    this.mesh.frustumCulled = false;
  }

  reset() {
    this.points.length = 0;
    this.sides.length = 0;
  }

  /** Adds the wingtip's current position; `side` is the direction the ribbon spans */
  push(point: THREE.Vector3, side: THREE.Vector3) {
    const last = this.points[0];
    if (last && last.distanceToSquared(point) < MIN_STEP * MIN_STEP) {
      // Keep the newest end glued to the wingtip
      last.copy(point);
      this.sides[0].copy(side);
    } else {
      this.points.unshift(point.clone());
      this.sides.unshift(side.clone());
      if (this.points.length > LENGTH) {
        this.points.pop();
        this.sides.pop();
      }
    }
    this.write();
  }

  private write() {
    const count = this.points.length;
    for (let i = 0; i < LENGTH; i++) {
      // Unused slots collapse onto the oldest point
      const p = this.points[Math.min(i, count - 1)];
      const s = this.sides[Math.min(i, count - 1)];
      const w = this.width * (1 - i / LENGTH);
      this.positions.set([p.x + s.x * w, p.y + s.y * w, p.z + s.z * w], i * 6);
      this.positions.set([p.x - s.x * w, p.y - s.y * w, p.z - s.z * w], i * 6 + 3);
    }
    this.mesh.geometry.getAttribute("position").needsUpdate = true;
  }

  set opacity(value: number) {
    this.mesh.material.opacity = value;
    this.mesh.visible = value > 0.01 && this.points.length > 1;
  }

  dispose() {
    this.mesh.geometry.dispose();
    this.mesh.material.dispose();
  }
}
