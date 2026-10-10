import { useEffect, useRef } from "react";
import * as THREE from "three";
import { Avatar } from "../game/avatar";
import { collectionModel } from "../game/run/collection";
import type { Appearance } from "../game/cosmetics/storage";
import type { Collectible } from "../profile/types";

/** One renderer for the selected entry, with graceful text fallback if WebGL is unavailable. */
export default function CollectionPreview({ item, appearance, rear = false }: { item: Collectible; appearance: Appearance; rear?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const container = ref.current!;
    let renderer: THREE.WebGLRenderer;
    try { renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true }); }
    catch { container.dataset.unavailable = "true"; return; }
    delete container.dataset.unavailable;
    renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    const scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera(38, 1, .01, 100);
    const light = new THREE.DirectionalLight("#fff1d4", 3); light.position.set(-3, 5, -4);
    scene.add(light, new THREE.HemisphereLight("#d9ecff", "#7f6e94", 2));
    const root = new THREE.Group(); scene.add(root);
    let avatar: Avatar | null = null;
    let model: ReturnType<typeof collectionModel> | null = null;
    if (item.slot && item.kind !== "pet") {
      avatar = new Avatar("#c47f9d");
      avatar.setAppearance({ ...appearance, [item.slot]: item.asset });
      avatar.update(.01, 24, 0); root.add(avatar.group);
    } else if (item.asset !== "none") {
      model = collectionModel(item); root.add(model.group);
    }
    const bounds = new THREE.Box3().setFromObject(root);
    if (bounds.isEmpty()) { bounds.min.set(-.5, -.5, -.5); bounds.max.set(.5, .5, .5); }
    const center = bounds.getCenter(new THREE.Vector3()), size = bounds.getSize(new THREE.Vector3());
    root.position.sub(center);
    // Fit both axes when the preview becomes narrow on phones.
    const resize = () => {
      const width = Math.max(1, container.clientWidth), height = Math.max(1, container.clientHeight);
      renderer.setSize(width, height); camera.aspect = width / height;
      const distance = Math.max(size.y, size.x / camera.aspect, size.z) / (2 * Math.tan(THREE.MathUtils.degToRad(19))) * 1.4;
      camera.position.set(distance * .15, distance * .15, distance * (rear ? 1 : -1));
      camera.lookAt(0, 0, 0); camera.updateProjectionMatrix(); renderer.render(scene, camera);
    };
    container.appendChild(renderer.domElement);
    const observer = new ResizeObserver(resize); observer.observe(container); resize();
    let frame = 0, last = performance.now(), time = 0;
    const loop = (now: number) => {
      const dt = Math.min(.04, Math.max(0, (now - last) / 1000)); last = now; time += dt;
      if (!matchMedia("(prefers-reduced-motion: reduce)").matches) {
        root.rotation.y = Math.sin(time * .45) * .45;
        avatar?.update(dt, 24, 0); model?.animate?.(dt);
      }
      renderer.render(scene, camera); frame = requestAnimationFrame(loop);
    };
    frame = requestAnimationFrame(loop);
    return () => { cancelAnimationFrame(frame); observer.disconnect(); avatar?.dispose(); model?.dispose(); renderer.dispose(); renderer.domElement.remove(); };
  }, [item, appearance, rear]);
  return <div className="collection-preview" ref={ref} role="img" aria-label={`Animated preview of ${item.name}`}>
    <span className="preview-error">3D preview unavailable</span>
  </div>;
}
