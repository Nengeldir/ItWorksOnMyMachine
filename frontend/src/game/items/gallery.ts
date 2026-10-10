import * as THREE from "three";
import { Avatar, createLabel, disposeLabel } from "../avatar";
import { Particles, fxTime } from "../particles";
import { Equipment, ItemDisplay } from "./equip";
import { ITEMS, type ItemId } from "./models";

// The item gallery (/?gallery): every item floating as a pickup with its
// name, and the pilot in the middle showing the animations: pulling out the
// giant firework and strapping it on, its flame, a helmet dropping on, fruit
// and candy held up and eaten. A demo loop plays until you pick something.

const DEMO: [number, (e: Equipment) => void][] = [
  [0.5, (e) => e.equip("firework")],
  [2.4, (e) => e.setThrust(1)],
  [4.6, (e) => e.setThrust(0)],
  [5.2, (e) => e.equip("wingedHelm")],
  [6.6, (e) => e.equip("apple")],
  [8.0, (e) => e.use()],
  [9.4, (e) => e.equip("lollipop")],
  [10.8, (e) => e.use()],
  [12.0, (e) => e.equip("aviatorCap")],
  [13.4, (e) => e.equip("goldenFeather")],
  [14.8, (e) => e.use()],
  [15.6, (e) => e.unequip("back")],
  [16.4, (e) => e.unequip("head")],
];
const DEMO_LENGTH = 17.5;

export class ItemGallery {
  private readonly container: HTMLElement;
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(40, 1, 0.1, 200);
  private readonly particles = new Particles(3000);
  private readonly avatar: Avatar;
  private readonly equipment: Equipment;
  private readonly displays: ItemDisplay[] = [];
  private readonly labels: THREE.Sprite[] = [];
  private readonly background: THREE.CanvasTexture;
  private readonly resizeObserver: ResizeObserver;
  private frame = 0;
  private last = 0;
  private time = 0;
  private demoTime = 0;
  private demoStep = 0;
  /** The demo loop plays until the visitor picks an item */
  demo = true;

  constructor(container: HTMLElement) {
    this.container = container;
    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.domElement.className = "game-canvas";
    container.appendChild(this.renderer.domElement);

    // A soft painted sky, warm at the bottom
    const canvas = document.createElement("canvas");
    canvas.width = 4;
    canvas.height = 256;
    const ctx = canvas.getContext("2d")!;
    const gradient = ctx.createLinearGradient(0, 0, 0, 256);
    gradient.addColorStop(0, "#7cc0f5");
    gradient.addColorStop(0.55, "#cfe6fb");
    gradient.addColorStop(1, "#ffe3cc");
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, 4, 256);
    this.background = new THREE.CanvasTexture(canvas);
    this.background.colorSpace = THREE.SRGBColorSpace;
    this.scene.background = this.background;

    const sun = new THREE.DirectionalLight("#fff1dc", 2.2);
    sun.position.set(4, 6, 5);
    this.scene.add(new THREE.HemisphereLight("#d6ecff", "#ffe2c8", 1.3), sun, this.particles.points);

    // The pilot, flying in place and turned three-quarters to the camera
    this.avatar = new Avatar("#ff5d73");
    this.avatar.group.position.set(-1.6, 0.1, 3.6);
    this.avatar.group.rotation.set(0.15, Math.PI * 0.78, 0);
    this.scene.add(this.avatar.group);
    this.equipment = new Equipment(this.avatar, this.particles);

    // Every item on a curved wall of three rows behind the pilot, with its name
    const columns = Math.ceil(ITEMS.length / 4);
    ITEMS.forEach((info, i) => {
      const row = Math.floor(i / columns);
      const a = (((i % columns) + 0.5) / columns - 0.5) * 1.5;
      const display = new ItemDisplay(info.id, info.id === "firework" ? 1.3 : 0.85);
      display.group.position.set(Math.sin(a) * 7, 3.5 - row * 1.6, -Math.cos(a) * 7 + 1);
      this.scene.add(display.group);
      this.displays.push(display);
      const label = createLabel(info.name, "#ffffff");
      label.scale.set(0.09, 0.0225, 1);
      label.position.copy(display.group.position).add(new THREE.Vector3(0, -0.8, 0));
      this.scene.add(label);
      this.labels.push(label);
    });

    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(container);
    this.resize();
    this.frame = requestAnimationFrame(this.loop);
  }

  /** Puts an item on the pilot (and stops the demo) */
  equip(id: ItemId) {
    this.demo = false;
    this.equipment.equip(id);
  }

  use() {
    this.demo = false;
    this.equipment.use();
  }

  thrust(on: boolean) {
    this.demo = false;
    this.equipment.setThrust(on ? 1 : 0);
  }

  clear() {
    this.demo = false;
    this.equipment.unequip("back");
    this.equipment.unequip("head");
    this.equipment.unequip("hand");
    this.equipment.unequip("feet");
    this.equipment.setThrust(0);
  }

  private loop = (now: number) => {
    this.frame = requestAnimationFrame(this.loop);
    const dt = this.last ? Math.min(0.1, (now - this.last) / 1000) : 0;
    this.last = now;
    this.step(dt);
  };

  /** One frame (the dev tools call this by hand in hidden tabs) */
  step(dt: number) {
    this.time += dt;
    fxTime.value = this.time;
    if (this.demo) {
      this.demoTime += dt;
      while (this.demoStep < DEMO.length && this.demoTime >= DEMO[this.demoStep][0]) DEMO[this.demoStep++][1](this.equipment);
      if (this.demoTime > DEMO_LENGTH) {
        this.demoTime = 0;
        this.demoStep = 0;
      }
    }
    // A slow camera sway, so the models turn in the light
    const a = Math.sin(this.time * 0.15) * 0.35;
    this.camera.position.set(Math.sin(a) * 10, 2.0, Math.cos(a) * 10 + 1);
    // Aimed left of the middle, so the scene sits right of the panel
    this.camera.lookAt(-2.2, 1.2, 0);
    this.avatar.update(dt, 26, 0);
    this.equipment.update(dt);
    this.displays.forEach((d) => d.update(dt, this.particles));
    this.particles.update();
    this.renderer.render(this.scene, this.camera);
  }

  private resize() {
    const width = this.container.clientWidth || 1;
    const height = this.container.clientHeight || 1;
    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.particles.setViewport(height * this.renderer.getPixelRatio(), this.camera.fov);
  }

  dispose() {
    cancelAnimationFrame(this.frame);
    this.resizeObserver.disconnect();
    this.equipment.dispose();
    this.displays.forEach((d) => d.dispose());
    this.labels.forEach(disposeLabel);
    this.avatar.dispose();
    this.particles.dispose();
    this.background.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }
}
