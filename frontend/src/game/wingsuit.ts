import * as THREE from "three";

const SCALE = 1.5;

// Points of a spread-eagle wingsuit, in metres. Forward is -z, right is +x.
const P = {
  nose: [0, 0.02, -1.12],
  headTop: [0, 0.16, -0.98],
  headL: [-0.1, 0.02, -0.92],
  headR: [0.1, 0.02, -0.92],
  shoulderL: [-0.22, 0, -0.74],
  shoulderR: [0.22, 0, -0.74],
  back: [0, 0.13, -0.3],
  handL: [-0.95, 0.06, -0.12],
  handR: [0.95, 0.06, -0.12],
  hipL: [-0.2, 0, 0.25],
  hipR: [0.2, 0, 0.25],
  crotch: [0, 0, 0.92],
  footL: [-0.34, 0.02, 1.02],
  footR: [0.34, 0.02, 1.02],
} as const;

type Point = keyof typeof P;

const TRIANGLES: [Point, Point, Point][] = [
  ["shoulderL", "handL", "hipL"],
  ["shoulderR", "hipR", "handR"],
  ["shoulderL", "back", "shoulderR"],
  ["shoulderL", "hipL", "back"],
  ["shoulderR", "back", "hipR"],
  ["hipL", "hipR", "back"],
  ["hipL", "footL", "crotch"],
  ["hipL", "crotch", "hipR"],
  ["hipR", "crotch", "footR"],
  ["headL", "headTop", "headR"],
  ["headL", "nose", "headTop"],
  ["headR", "headTop", "nose"],
  ["headL", "headR", "nose"],
];

/** Where the trails start, in the wingsuit's own frame */
export const WINGTIPS = [
  new THREE.Vector3(...P.handL).multiplyScalar(SCALE),
  new THREE.Vector3(...P.handR).multiplyScalar(SCALE),
];

let sharedGeometry: THREE.BufferGeometry | null = null;

function wingsuitGeometry(): THREE.BufferGeometry {
  if (!sharedGeometry) {
    const positions = TRIANGLES.flatMap((triangle) => triangle.flatMap((name) => P[name].map((v) => v * SCALE)));
    sharedGeometry = new THREE.BufferGeometry();
    sharedGeometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
    sharedGeometry.computeVertexNormals();
  }
  return sharedGeometry;
}

export function createWingsuit(color: string, ghost = false): THREE.Mesh {
  const material = new THREE.MeshLambertMaterial({
    color,
    flatShading: true,
    side: THREE.DoubleSide,
    transparent: ghost,
    opacity: ghost ? 0.45 : 1,
    depthWrite: !ghost,
  });
  return new THREE.Mesh(wingsuitGeometry(), material);
}

/** A name tag that keeps the same size on screen */
export function createLabel(text: string, color: string): THREE.Sprite {
  const canvas = document.createElement("canvas");
  canvas.width = 256;
  canvas.height = 64;
  const ctx = canvas.getContext("2d")!;
  ctx.font = "600 30px system-ui, sans-serif";
  const width = Math.min(240, ctx.measureText(text).width + 28);
  ctx.fillStyle = "rgba(10, 12, 20, 0.6)";
  ctx.beginPath();
  ctx.roundRect((256 - width) / 2, 8, width, 48, 24);
  ctx.fill();
  ctx.fillStyle = color;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(text, 128, 33, 220);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const sprite = new THREE.Sprite(
    new THREE.SpriteMaterial({ map: texture, sizeAttenuation: false, fog: false, depthWrite: false }),
  );
  sprite.scale.set(0.16, 0.04, 1);
  sprite.renderOrder = 10;
  return sprite;
}

export function disposeObject(object: THREE.Object3D) {
  object.traverse((child) => {
    if (child instanceof THREE.Mesh || child instanceof THREE.Sprite) {
      if (child.geometry !== sharedGeometry) child.geometry.dispose();
      const materials = Array.isArray(child.material) ? child.material : [child.material];
      for (const material of materials) {
        (material as THREE.MeshBasicMaterial).map?.dispose();
        material.dispose();
      }
    }
  });
}
