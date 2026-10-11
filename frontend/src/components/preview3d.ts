import * as THREE from "three";

// One WebGL renderer (one context) for every 3D preview on the page: the
// inventory's item card and figurine, the market's cards, pilot pages and
// leaderboard portraits. A context per preview was never freed by dispose():
// after about 16 the browser dropped its oldest, the game's. Each preview
// owns a plain 2D canvas instead; the shared renderer draws its scene and the
// picture is copied over in the same task (before WebGL clears its buffer).

let shared: THREE.WebGLRenderer | null = null;

export function previewRenderer(): THREE.WebGLRenderer {
  if (!shared) {
    shared = new THREE.WebGLRenderer({ alpha: true, antialias: true });
    shared.setPixelRatio(1);
    shared.outputColorSpace = THREE.SRGBColorSpace;
  }
  return shared;
}

/** Sizes a preview canvas to its box (device pixels, at most 1.5× on dense screens); true if it changed */
export function fitCanvas(canvas: HTMLCanvasElement): boolean {
  const ratio = Math.min(devicePixelRatio || 1, 1.5);
  const width = Math.max(1, Math.round(canvas.clientWidth * ratio));
  const height = Math.max(1, Math.round(canvas.clientHeight * ratio));
  if (canvas.width === width && canvas.height === height) return false;
  canvas.width = width;
  canvas.height = height;
  return true;
}

/** Draws `scene` from `camera` into a 2D canvas through the shared renderer */
export function drawInto(canvas: HTMLCanvasElement, scene: THREE.Scene, camera: THREE.Camera) {
  const renderer = previewRenderer();
  const { width, height } = canvas;
  const size = renderer.getSize(new THREE.Vector2());
  if (size.x !== width || size.y !== height) renderer.setSize(width, height, false);
  renderer.render(scene, camera);
  const context = canvas.getContext("2d");
  if (!context) return;
  context.clearRect(0, 0, width, height);
  context.drawImage(renderer.domElement, 0, 0, width, height);
}

/** A soft key light, a sky fill and a warm rim: the toon models' light in every preview */
export function previewLights(scene: THREE.Scene) {
  const key = new THREE.DirectionalLight("#fff1d4", 3);
  key.position.set(-3, 5, -4);
  const rim = new THREE.DirectionalLight("#ffd9a8", 1.2);
  rim.position.set(4, 2, 5);
  scene.add(key, rim, new THREE.HemisphereLight("#d9ecff", "#7f6e94", 2));
}
