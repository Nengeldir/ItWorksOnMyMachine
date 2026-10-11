import { useEffect, useRef } from "react";
import * as THREE from "three";
import { Avatar } from "../game/avatar";
import { collectionModel } from "../game/run/collection";
import type { Appearance } from "../game/cosmetics/storage";
import type { Collectible } from "../profile/types";
import { loadSettings } from "../storage";
import { drawInto, fitCanvas, previewLights, previewRenderer } from "./preview3d";

/** The selected entry, turning slowly in the light; a text fallback if WebGL is unavailable */
export default function CollectionPreview({ item, appearance, rear = false }: { item: Collectible; appearance: Appearance; rear?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const container = ref.current!;
    const canvas = canvasRef.current!;
    try { previewRenderer(); }
    catch { container.dataset.unavailable = "true"; return; }
    delete container.dataset.unavailable;
    const scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera(38, 1, .01, 100);
    previewLights(scene);
    const root = new THREE.Group(); scene.add(root);
    let avatar: Avatar | null = null;
    let model: ReturnType<typeof collectionModel> | null = null;
    // Cosmetics are shown on the pilot; pets and keepsakes by themselves
    if (item.slot && item.kind !== "pet" && item.kind !== "item") {
      avatar = new Avatar("#c47f9d");
      avatar.setStyle(loadSettings().pilotStyle ?? 1);
      avatar.setAppearance({ ...appearance, [item.slot]: item.asset });
      avatar.update(.01, 24, 0); root.add(avatar.group);
    } else if (item.asset !== "none") {
      model = collectionModel(item); root.add(model.group);
    }
    const bounds = new THREE.Box3().setFromObject(root);
    if (bounds.isEmpty()) { bounds.min.set(-.5, -.5, -.5); bounds.max.set(.5, .5, .5); }
    const center = bounds.getCenter(new THREE.Vector3()), size = bounds.getSize(new THREE.Vector3());
    root.position.sub(center);
    const frame = () => {
      fitCanvas(canvas);
      camera.aspect = canvas.width / canvas.height;
      // Fit both axes when the preview becomes narrow on phones
      const distance = Math.max(size.y, size.x / camera.aspect, size.z) / (2 * Math.tan(THREE.MathUtils.degToRad(19))) * 1.4;
      camera.position.set(distance * .15, distance * .15, distance * (rear ? 1 : -1));
      camera.lookAt(0, 0, 0); camera.updateProjectionMatrix();
    };
    const observer = new ResizeObserver(frame); observer.observe(canvas); frame();
    const motion = matchMedia("(prefers-reduced-motion: reduce)");
    let raf = 0, last = performance.now(), time = 0;
    const loop = (now: number) => {
      const dt = Math.min(.04, Math.max(0, (now - last) / 1000)); last = now; time += dt;
      if (!motion.matches) {
        root.rotation.y = Math.sin(time * .45) * .45;
        avatar?.update(dt, 24, 0); model?.animate?.(dt);
      }
      drawInto(canvas, scene, camera); raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => {
      cancelAnimationFrame(raf); observer.disconnect(); avatar?.dispose(); model?.dispose();
      // Keep the context; free this scene's GPU buffers and programs only
      previewRenderer().renderLists.dispose();
    };
  }, [item, appearance, rear]);
  return <div className="collection-preview" ref={ref} role="img" aria-label={`Animated preview of ${item.name}`}>
    <canvas ref={canvasRef} />
    <span className="preview-error">3D preview unavailable</span>
  </div>;
}
