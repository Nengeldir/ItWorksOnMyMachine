import { useEffect, useRef } from "react";
import * as THREE from "three";
import { Avatar } from "../game/avatar";
import { collectionModel } from "../game/run/collection";
import type { Appearance } from "../game/cosmetics/storage";
import type { Collectible } from "../profile/types";
import { loadSettings } from "../storage";
import { drawInto, fitCanvas, previewLights, previewRenderer } from "./preview3d";

/**
 * The selected entry, turning slowly in the light; a text fallback if WebGL is unavailable. The scene is
 * built once per entry: equipping something (`appearance`) or turning it round (`rear`) changes the one
 * on screen in place, so it never jumps back to its start
 */
export default function CollectionPreview({ item, appearance, rear = false }: { item: Collectible; appearance: Appearance; rear?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const look = JSON.stringify(appearance);
  const state = useRef({ look, rear });
  const dress = useRef<((look: Appearance) => void) | null>(null);
  const turn = useRef<(() => void) | null>(null);
  useEffect(() => {
    state.current.look = look;
    dress.current?.(JSON.parse(look) as Appearance);
  }, [look]);
  useEffect(() => {
    state.current.rear = rear;
    turn.current?.();
  }, [rear]);
  const { key, kind, slot, asset } = item;
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
    if (slot && kind !== "pet" && kind !== "item") {
      avatar = new Avatar("#c47f9d");
      avatar.setStyle(loadSettings().pilotStyle ?? 1);
      avatar.setAppearance({ ...(JSON.parse(state.current.look) as Appearance), [slot]: asset });
      avatar.update(.01, 24, 0); root.add(avatar.group);
      // The rest of the outfit follows what's equipped; the piece on show stays on
      dress.current = (look) => avatar?.setAppearance({ ...look, [slot]: asset });
    } else if (asset !== "none") {
      model = collectionModel({ kind, asset, rarity: "common" }); root.add(model.group);
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
      camera.position.set(distance * .15, distance * .15, distance * (state.current.rear ? 1 : -1));
      camera.lookAt(0, 0, 0); camera.updateProjectionMatrix();
    };
    turn.current = frame;
    const observer = new ResizeObserver(frame); observer.observe(canvas); frame();
    const motion = matchMedia("(prefers-reduced-motion: reduce)");
    let raf = 0, last = performance.now(), time = 0;
    const loop = (now: number) => {
      const dt = Math.min(.04, Math.max(0, (now - last) / 1000)); last = now; time += dt;
      if (!motion.matches) {
        root.rotation.y = Math.sin(time * .45) * .45;
        avatar?.update(dt, 24, 0); model?.animate?.(dt);
      }
      // A canvas the layout hasn't sized yet (a sheet still opening, a tab in the background) draws nothing
      if (canvas.clientWidth > 0 && canvas.clientHeight > 0) {
        if (fitCanvas(canvas)) frame();
        drawInto(canvas, scene, camera);
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => {
      dress.current = turn.current = null;
      cancelAnimationFrame(raf); observer.disconnect(); avatar?.dispose(); model?.dispose();
      // Keep the context; free this scene's GPU buffers and programs only
      previewRenderer().renderLists.dispose();
    };
  }, [key, kind, slot, asset]);
  return <div className="collection-preview" ref={ref} role="img" aria-label={`Animated preview of ${item.name}`}>
    <canvas ref={canvasRef} />
    <span className="preview-error">3D preview unavailable</span>
  </div>;
}
