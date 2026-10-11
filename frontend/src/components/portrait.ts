import * as THREE from "three";
import { Avatar } from "../game/avatar";
import { validateAppearance, type Appearance } from "../game/cosmetics/storage";
import { drawInto, previewLights } from "./preview3d";

// Little head-and-shoulders portraits of pilots in what they wear, for the
// leaderboard: drawn once per look through the shared preview renderer and
// kept as images. One pilot at a time, a frame apart, so a long board never
// stalls the page.

const cache = new Map<string, string>();
const waiting = new Map<string, ((url: string) => void)[]>();
const queue: { key: string; look: Appearance; style: 1 | 2 }[] = [];
let working = false;

function draw(look: Appearance, style: 1 | 2): string {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 112;
  const scene = new THREE.Scene();
  previewLights(scene);
  const avatar = new Avatar("#c47f9d");
  avatar.setStyle(style);
  avatar.setAppearance({ ...look, pet: "none" });
  avatar.stance.stand = 1;
  avatar.update(0.016, 18, 0);
  avatar.group.rotation.y = Math.PI - 0.35; // three-quarters towards us (the face is at -z)
  scene.add(avatar.group);
  const camera = new THREE.PerspectiveCamera(26, 1, 0.05, 50);
  camera.position.set(0, 0.85, 3.1);
  camera.lookAt(0, 0.72, 0);
  drawInto(canvas, scene, camera);
  avatar.dispose();
  return canvas.toDataURL("image/png");
}

async function work() {
  if (working) return;
  working = true;
  while (queue.length) {
    const { key, look, style } = queue.shift()!;
    let url = "";
    try { url = draw(look, style); } catch { /* No WebGL: the board shows initials instead */ }
    cache.set(key, url);
    for (const done of waiting.get(key) ?? []) done(url);
    waiting.delete(key);
    await new Promise((resolve) => requestAnimationFrame(() => resolve(null)));
  }
  working = false;
}

/** A portrait of this look (an image URL, or "" without WebGL) */
export function portrait(look: Partial<Appearance>, style: 1 | 2): Promise<string> {
  const outfit = validateAppearance(look);
  const key = `${style}:${outfit.cape}:${outfit.hat}:${outfit.shoes}:${outfit.wings}`;
  const done = cache.get(key);
  if (done !== undefined) return Promise.resolve(done);
  return new Promise((resolve) => {
    if (!waiting.has(key)) {
      waiting.set(key, []);
      queue.push({ key, look: outfit, style });
    }
    waiting.get(key)!.push(resolve);
    void work();
  });
}
