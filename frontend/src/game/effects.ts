import * as THREE from "three";

const PIECES = 18;
const LIFETIME = 2.2;

/** A small leaf-shaped feather, 0.5 m long, lying in the xy plane along +y */
function featherGeometry(): THREE.BufferGeometry {
  const shape = new THREE.Shape();
  shape.moveTo(0, 0);
  shape.quadraticCurveTo(0.13, 0.2, 0.02, 0.5);
  shape.quadraticCurveTo(-0.1, 0.22, 0, 0);
  return new THREE.ShapeGeometry(shape, 4).translate(0, -0.25, 0);
}

/** Feathers knocked loose in a crash: they burst out, then flutter down, rocking like real ones */
export class Debris {
  readonly mesh: THREE.InstancedMesh;
  private readonly positions: THREE.Vector3[] = [];
  private readonly velocities: THREE.Vector3[] = [];
  private readonly spins: THREE.Vector3[] = [];
  private readonly phases: number[] = [];
  private readonly rotation = new THREE.Euler();
  private readonly quaternion = new THREE.Quaternion();
  private readonly matrix = new THREE.Matrix4();
  private readonly scale = new THREE.Vector3();
  private readonly white = new THREE.Color("#ffffff");
  private age = LIFETIME;

  constructor(color: string) {
    this.mesh = new THREE.InstancedMesh(
      featherGeometry(),
      new THREE.MeshLambertMaterial({ color, side: THREE.DoubleSide }),
      PIECES,
    );
    this.mesh.frustumCulled = false;
    this.mesh.visible = false;
    for (let i = 0; i < PIECES; i++) {
      this.positions.push(new THREE.Vector3());
      this.velocities.push(new THREE.Vector3());
      this.spins.push(new THREE.Vector3());
      this.phases.push(0);
    }
    this.setColor(color);
  }

  burst(at: THREE.Vector3, velocity: THREE.Vector3) {
    this.age = 0;
    this.mesh.visible = true;
    for (let i = 0; i < PIECES; i++) {
      this.positions[i].copy(at);
      this.velocities[i]
        .set(Math.random() - 0.5, Math.random() * 0.9, Math.random() - 0.5)
        .multiplyScalar(16)
        .addScaledVector(velocity, -0.08);
      this.spins[i].set(Math.random() * 4, Math.random() * 6, Math.random() * 4);
      this.phases[i] = Math.random() * Math.PI * 2;
    }
  }

  update(dt: number) {
    if (!this.mesh.visible) return;
    this.age += dt;
    if (this.age >= LIFETIME) {
      this.mesh.visible = false;
      return;
    }
    const size = Math.min(1, (LIFETIME - this.age) * 2.5);
    for (let i = 0; i < PIECES; i++) {
      const v = this.velocities[i];
      // Heavy air drag and a slow sink, swaying side to side like a falling feather
      v.y -= 6 * dt;
      v.multiplyScalar(1 - 2.6 * dt);
      const sway = Math.sin(this.age * 5 + this.phases[i]);
      v.x += sway * 4 * dt;
      this.positions[i].addScaledVector(v, dt);
      const s = this.spins[i];
      this.rotation.set(sway * 0.8 + s.x * this.age * 0.2, s.y * this.age, sway * 0.5 + s.z * this.age * 0.2);
      this.quaternion.setFromEuler(this.rotation);
      this.matrix.compose(this.positions[i], this.quaternion, this.scale.setScalar(size));
      this.mesh.setMatrixAt(i, this.matrix);
    }
    this.mesh.instanceMatrix.needsUpdate = true;
  }

  setColor(color: string) {
    (this.mesh.material as THREE.MeshLambertMaterial).color.set(color).lerp(this.white, 0.45);
  }

  dispose() {
    this.mesh.geometry.dispose();
    (this.mesh.material as THREE.Material).dispose();
  }
}
