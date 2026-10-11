import { useEffect, useRef } from "react";
import * as THREE from "three";
import { Avatar } from "../game/avatar";
import { PetModel } from "../game/pets/models";
import type { PetId } from "../game/pets/catalog";
import { validateAppearance, type Appearance } from "../game/cosmetics/storage";
import { drawInto, fitCanvas, previewLights, previewRenderer } from "./preview3d";

/**
 * The pilot as a little standing figurine, in everything equipped, the companion floating at its
 * shoulder: drag (or swipe) to turn it, and it keeps turning a moment with the flick, then sways
 * gently on its own. Used by the inventory and the public pilot pages. Looks only
 */
export default function Minifigure({ appearance, style = 1, color = "#c47f9d", label, className = "" }: {
  appearance: Partial<Appearance>;
  style?: 1 | 2;
  color?: string;
  label: string;
  className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  // Keyed by the look, so the figure is rebuilt only when what it wears changes
  const look = JSON.stringify(validateAppearance(appearance));
  useEffect(() => {
    const container = ref.current!;
    const canvas = canvasRef.current!;
    try { previewRenderer(); }
    catch { container.dataset.unavailable = "true"; return; }
    delete container.dataset.unavailable;
    const outfit = JSON.parse(look) as Appearance;
    const scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera(30, 1, 0.05, 100);
    previewLights(scene);
    const turntable = new THREE.Group();
    scene.add(turntable);
    const avatar = new Avatar(color);
    avatar.setStyle(style);
    avatar.setAppearance(outfit);
    avatar.stance.stand = 1;
    avatar.update(0.016, 18, 0);
    turntable.add(avatar.group);
    // A soft disc of light to stand on
    const plinth = new THREE.Mesh(new THREE.CircleGeometry(0.62, 40), new THREE.MeshBasicMaterial({ color: "#fff4dc", transparent: true, opacity: 0.35, depthWrite: false }));
    plinth.rotation.x = -Math.PI / 2;
    turntable.add(plinth);
    let pet: PetModel | null = null;
    if (outfit.pet !== "none") {
      pet = new PetModel(outfit.pet as Exclude<PetId, "none">);
      pet.group.scale.setScalar(0.42);
      pet.group.position.set(0.72, 0.1, -0.1);
      turntable.add(pet.group);
    }
    // Framed on the standing pilot (feet to hat, the companion beside), not on loose cloth and wingtips
    const FEET = -0.98, TOP = 1.42, WIDTH = 2.1;
    plinth.position.y = FEET;
    const frame = () => {
      fitCanvas(canvas);
      camera.aspect = canvas.width / canvas.height;
      const height = TOP - FEET;
      const fit = Math.max(height, WIDTH / camera.aspect) / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)));
      camera.position.set(0, (TOP + FEET) / 2 + height * 0.1, fit * 1.12);
      camera.lookAt(0, (TOP + FEET) / 2, 0);
      camera.updateProjectionMatrix();
    };
    const observer = new ResizeObserver(frame);
    observer.observe(canvas);
    frame();

    // Drag to turn, with a little momentum; it starts three-quarters towards you (the face is at -z)
    let yaw = Math.PI - 0.45, spin = 0, dragging = -1, lastX = 0, idle = 0;
    const down = (event: PointerEvent) => {
      dragging = event.pointerId;
      lastX = event.clientX;
      canvas.setPointerCapture?.(event.pointerId);
      container.classList.add("dragging");
    };
    const move = (event: PointerEvent) => {
      if (event.pointerId !== dragging) return;
      const dx = event.clientX - lastX;
      lastX = event.clientX;
      yaw += dx * 0.012;
      spin = dx * 0.6;
      idle = 0;
    };
    const up = (event: PointerEvent) => {
      if (event.pointerId !== dragging) return;
      dragging = -1;
      container.classList.remove("dragging");
    };
    const keys = (event: KeyboardEvent) => {
      if (event.key === "ArrowLeft") { yaw -= 0.3; idle = 0; }
      else if (event.key === "ArrowRight") { yaw += 0.3; idle = 0; }
    };
    canvas.addEventListener("pointerdown", down);
    canvas.addEventListener("pointermove", move);
    canvas.addEventListener("pointerup", up);
    canvas.addEventListener("pointercancel", up);
    container.addEventListener("keydown", keys);
    const motion = matchMedia("(prefers-reduced-motion: reduce)");
    let raf = 0, last = performance.now(), time = 0;
    const loop = (now: number) => {
      const dt = Math.min(0.05, Math.max(0, (now - last) / 1000));
      last = now;
      time += dt;
      if (dragging < 0) {
        yaw += spin * dt;
        spin *= Math.exp(-dt * 3);
        idle += dt;
        // Left alone, it sways back and forth a little to show itself off
        if (idle > 2.5 && !motion.matches) yaw += Math.sin(time * 0.4) * dt * 0.25;
      }
      turntable.rotation.y = yaw;
      if (!motion.matches) {
        avatar.update(dt, 18, 0);
        if (pet) {
          pet.group.position.y = 0.1 + Math.sin(time * 1.8) * 0.05;
          pet.group.rotation.y = Math.PI - 0.5 + Math.sin(time * 0.6) * 0.25;
          pet.animate(dt);
        }
      }
      drawInto(canvas, scene, camera);
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => {
      cancelAnimationFrame(raf);
      observer.disconnect();
      canvas.removeEventListener("pointerdown", down);
      canvas.removeEventListener("pointermove", move);
      canvas.removeEventListener("pointerup", up);
      canvas.removeEventListener("pointercancel", up);
      container.removeEventListener("keydown", keys);
      avatar.dispose();
      pet?.dispose();
      plinth.geometry.dispose();
      (plinth.material as THREE.Material).dispose();
      previewRenderer().renderLists.dispose();
    };
  }, [look, style, color]);
  return (
    <div className={`minifigure ${className}`} ref={ref} role="img" tabIndex={0} aria-label={`${label}. Drag or use the arrow keys to turn it.`}>
      <canvas ref={canvasRef} />
      <span className="preview-error">3D figure unavailable</span>
      <small className="minifigure-hint" aria-hidden="true">drag to turn</small>
    </div>
  );
}
