import * as THREE from "three";

const PIECES = 28;
const LIFETIME = 1.6;

/** Fragments of the airplane that scatter on a crash */
export class Debris {
  readonly mesh: THREE.InstancedMesh;
  private readonly positions: THREE.Vector3[] = [];
  private readonly velocities: THREE.Vector3[] = [];
  private readonly spins: THREE.Vector3[] = [];
  private readonly rotation = new THREE.Euler();
  private readonly quaternion = new THREE.Quaternion();
  private readonly matrix = new THREE.Matrix4();
  private readonly scale = new THREE.Vector3();
  private age = LIFETIME;

  constructor(color: string) {
    this.mesh = new THREE.InstancedMesh(
      new THREE.TetrahedronGeometry(0.35),
      new THREE.MeshLambertMaterial({ color, flatShading: true }),
      PIECES,
    );
    this.mesh.frustumCulled = false;
    this.mesh.visible = false;
    for (let i = 0; i < PIECES; i++) {
      this.positions.push(new THREE.Vector3());
      this.velocities.push(new THREE.Vector3());
      this.spins.push(new THREE.Vector3());
    }
  }

  burst(at: THREE.Vector3, velocity: THREE.Vector3) {
    this.age = 0;
    this.mesh.visible = true;
    for (let i = 0; i < PIECES; i++) {
      this.positions[i].copy(at);
      this.velocities[i]
        .set(Math.random() - 0.5, Math.random() * 0.8, Math.random() - 0.5)
        .multiplyScalar(30)
        .addScaledVector(velocity, -0.15);
      this.spins[i].set(Math.random() * 10, Math.random() * 10, Math.random() * 10);
    }
  }

  update(dt: number) {
    if (!this.mesh.visible) return;
    this.age += dt;
    if (this.age >= LIFETIME) {
      this.mesh.visible = false;
      return;
    }
    const size = 1 - this.age / LIFETIME;
    for (let i = 0; i < PIECES; i++) {
      this.velocities[i].y -= 20 * dt;
      this.velocities[i].multiplyScalar(1 - 1.5 * dt);
      this.positions[i].addScaledVector(this.velocities[i], dt);
      const s = this.spins[i];
      this.rotation.set(s.x * this.age, s.y * this.age, s.z * this.age);
      this.quaternion.setFromEuler(this.rotation);
      this.matrix.compose(this.positions[i], this.quaternion, this.scale.setScalar(size));
      this.mesh.setMatrixAt(i, this.matrix);
    }
    this.mesh.instanceMatrix.needsUpdate = true;
  }

  setColor(color: string) {
    (this.mesh.material as THREE.MeshLambertMaterial).color.set(color);
  }

  dispose() {
    this.mesh.geometry.dispose();
    (this.mesh.material as THREE.Material).dispose();
  }
}
