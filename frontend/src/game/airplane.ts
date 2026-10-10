import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";

// Compact airplane, in metres: forward is -z, right is +x.
// Keep its scale close to the old avatar so gates and the chase camera still fit.
export const WINGTIPS = [
  new THREE.Vector3(-1.8, 0, 0.32),
  new THREE.Vector3(1.8, 0, 0.32),
];

let sharedGeometry: THREE.BufferGeometry | null = null;

function airplaneGeometry(): THREE.BufferGeometry {
  if (sharedGeometry) return sharedGeometry;
  const parts: THREE.BufferGeometry[] = [];
  const add = (geometry: THREE.BufferGeometry, shade: string) => {
    const part = geometry.index ? geometry.toNonIndexed() : geometry;
    if (part !== geometry) geometry.dispose();
    const color = new THREE.Color(shade);
    const count = part.getAttribute("position").count;
    const colors = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) color.toArray(colors, i * 3);
    part.setAttribute("color", new THREE.BufferAttribute(colors, 3));
    // All pieces use the same attributes when merged; no textures are needed.
    part.deleteAttribute("uv");
    parts.push(part);
  };
  const wing = (points: [number, number][], thickness: number) => {
    const shape = new THREE.Shape();
    points.forEach(([x, z], i) => i === 0 ? shape.moveTo(x, z) : shape.lineTo(x, z));
    shape.closePath();
    return new THREE.ExtrudeGeometry(shape, { depth: thickness, bevelEnabled: false })
      .rotateX(Math.PI / 2).translate(0, thickness / 2, 0);
  };

  // A rounded body and dark raised canopy make the nose unmistakable.
  add(new THREE.SphereGeometry(1, 12, 8).scale(0.24, 0.24, 1.65), "#ffffff");
  add(new THREE.SphereGeometry(1, 12, 8).scale(0.19, 0.2, 0.5)
    .translate(0, 0.2, -0.55), "#172b40");

  // Swept main wings, with a thin solid profile visible when banking.
  for (const side of [-1, 1]) {
    add(wing([[side * 0.16, -0.55], [side * 1.8, 0.22],
      [side * 1.8, 0.42], [side * 0.16, 0.48]], 0.065), "#ffffff");
    // Dark wingtip panels keep the silhouette readable against bright terrain.
    add(wing([[side * 1.55, 0.1], [side * 1.8, 0.22],
      [side * 1.8, 0.42], [side * 1.55, 0.43]], 0.075), "#334155");
    add(wing([[side * 0.1, 0.94], [side * 0.72, 1.3],
      [side * 0.72, 1.48], [side * 0.1, 1.43]], 0.05), "#ffffff");
  }

  // Vertical tail: shape coordinates are (-z, y), extrusion becomes x.
  const fin = new THREE.Shape();
  fin.moveTo(-0.85, 0.12);
  fin.lineTo(-1.3, 0.82);
  fin.lineTo(-1.53, 0.82);
  fin.lineTo(-1.5, 0.1);
  fin.closePath();
  add(new THREE.ExtrudeGeometry(fin, { depth: 0.07, bevelEnabled: false })
    .rotateY(Math.PI / 2).translate(-0.035, 0, 0), "#ffffff");

  sharedGeometry = mergeGeometries(parts)!;
  parts.forEach((part) => part.dispose());
  sharedGeometry.computeBoundingSphere();
  return sharedGeometry;
}

export function createAirplane(color: string, ghost = false): THREE.Mesh {
  const material = new THREE.MeshLambertMaterial({
    color,
    vertexColors: true,
    flatShading: true,
    transparent: ghost,
    opacity: ghost ? 0.45 : 1,
    depthWrite: !ghost,
  });
  return new THREE.Mesh(airplaneGeometry(), material);
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
