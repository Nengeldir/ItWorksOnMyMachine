import type { Game } from "./Game";
import { fxTime } from "./particles";
import { raceLevel } from "./world/biomes";
import { meshChunk, rockChunks } from "./world/mesher";
import { World } from "./world/World";

// Development helpers on `window` (dev builds only), for looking at the game
// from the console or from browser automation. Automated or background tabs
// throttle requestAnimationFrame and timers, so these drive the game by hand
// and yield through MessageChannel, which isn't throttled.

const settle = () =>
  new Promise<void>((resolve) => {
    const channel = new MessageChannel();
    channel.port1.onmessage = () => resolve();
    channel.port2.postMessage(0);
  });

/** Camera poses relative to the course: behind the start, or high above it looking down the line */
type View = 0 | 1 | { position: [number, number, number]; target: [number, number, number] } | { along: number; height: number; side: number; ahead: number };

export function installDevtools() {
  /**
   * Freezes the loop, puts the camera at a pose, streams the land around it for
   * `ms`, fixes the shader clock and renders once. Take the screenshot after.
   */
  const shot = async (view: View = 0, ms = 4000, time = 10) => {
    // The live game (React's strict mode builds and drops one first in development)
    const g = (window as unknown as { __game: Game }).__game as unknown as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
    cancelAnimationFrame(g.frame);
    document.querySelectorAll<HTMLElement>(".panel,.topbar,.hud,.ring-marker,.speed-vignette,.banner,.ghost-note").forEach((e) => (e.style.visibility = "hidden"));
    if (g.quality !== 2) g.setQuality(2);
    g.render();
    g.respawn(0);
    g.avatar.group.position.copy(g.flight.position);
    g.avatar.group.quaternion.copy(g.flight.quaternion);
    const cam = g.rig.camera;
    const course = g.world.course;
    const s = course.start;
    const d = course.startDirection;
    if (view === 0) {
      cam.position.copy(s).addScaledVector(d, -14);
      cam.position.y += 5;
      cam.lookAt(s.x + d.x * 100, s.y + d.y * 100 - 8, s.z + d.z * 100);
    } else if (view === 1) {
      const p = course.pointAt(600);
      cam.position.copy(s);
      cam.position.y += 90;
      cam.position.x += 60;
      cam.lookAt(p);
    } else if ("along" in view) {
      // Along the course at z = along, raised and moved sideways, looking `ahead` metres further down the line
      const p = course.pointAt(view.along);
      cam.position.set(p.x + view.side, p.y + view.height, p.z);
      const q = course.pointAt(view.along + view.ahead);
      cam.lookAt(q.x, q.y, q.z);
    } else {
      cam.position.set(...view.position);
      cam.lookAt(...view.target);
    }
    cam.fov = 70;
    cam.updateProjectionMatrix();
    cam.updateMatrixWorld();
    const end = performance.now() + ms;
    while (performance.now() < end) {
      g.view.update(cam, 0);
      await settle();
    }
    fxTime.value = time;
    g.particles.clear();
    g.particles.update();
    g.speedLines.reset();
    g.view.update(cam, 0);
    g.render();
    await settle();
    g.render();
    return { ready: g.view.ready, biome: g.world.biome.name, mood: g.world.palette.name };
  };
  /**
   * Runs the game loop by hand for `seconds` of game time at 60 fps (the tab's own
   * requestAnimationFrame doesn't run when it's hidden), yielding now and then so
   * worker results arrive. The pilot flies on whatever input is held.
   */
  const run = async (seconds = 2) => {
    const g = (window as unknown as { __game: Game }).__game as unknown as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
    document.querySelectorAll<HTMLElement>(".panel,.topbar,.hud,.ring-marker,.speed-vignette,.banner,.ghost-note").forEach((e) => (e.style.visibility = "hidden"));
    let t = performance.now();
    for (let i = 0; i < seconds * 60; i++) {
      t += 1000 / 60;
      g.loop(t);
      cancelAnimationFrame(g.frame);
      if (i % 4 === 0) await settle();
    }
    return { position: g.flight.position.toArray().map(Math.round), speed: Math.round(g.flight.speed) };
  };
  Object.assign(window, { __shot: shot, __raceHashes: raceHashes, __run: run });
}

/**
 * Hashes the race map (Sky Isles) of seeds 1, 7 and 42: rock meshes and colors
 * (mesh), tree colliders (trees), 4000 collision distances (dist) and the rings.
 * trees, dist and rings must never change, or recorded ghosts stop matching
 * their maps; mesh may change when the looks do. Expected values are in
 * docs/dev-snippets.js.
 */
function raceHashes() {
  const fnv = (h: number, array: Float32Array) => {
    const u = new Uint32Array(array.buffer, array.byteOffset, array.length);
    for (let i = 0; i < u.length; i++) {
      h ^= u[i];
      h = Math.imul(h, 16777619) >>> 0;
    }
    return h;
  };
  const out: Record<number, Record<string, string>> = {};
  for (const seed of [1, 7, 42]) {
    const w = new World(raceLevel(seed));
    const chunks = rockChunks(w).sort((a, b) => a.key - b.key);
    let mesh = 2166136261;
    let trees = 2166136261;
    const step = Math.max(1, Math.floor(chunks.length / 120));
    for (let i = 0; i < chunks.length; i += step) {
      const c = chunks[i];
      const m = meshChunk(w, c.ix, c.iy, c.iz);
      mesh = fnv(mesh, m.positions);
      mesh = fnv(mesh, m.colors);
      mesh = fnv(mesh, m.trees);
      trees = fnv(trees, m.trees);
    }
    const d = new Float32Array(4000);
    for (let i = 0; i < 4000; i++) {
      const p = w.course.pointAt((i * 0.61) % 2300);
      d[i] = w.distance(p.x + ((i * 37) % 200) - 100, p.y + ((i * 13) % 120) - 60, p.z);
    }
    const rings = new Float32Array(w.course.rings.flatMap((r) => [r.position.x, r.position.y, r.position.z, r.normal.x, r.normal.y, r.normal.z, r.radius]));
    out[seed] = {
      mesh: mesh.toString(16),
      trees: trees.toString(16),
      dist: fnv(2166136261, d).toString(16),
      rings: fnv(2166136261, rings).toString(16),
      palette: w.palette.name,
    };
  }
  return out;
}
