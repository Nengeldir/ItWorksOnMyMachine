import * as THREE from "three";
import { fieldNormal } from "./death";
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
    // The chase camera carries its own up vector through loops: shots are level
    cam.up.set(0, 1, 0);
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
  /**
   * Frame cost at a quality level: steps the loop by hand for `frames` frames
   * (flying on) and measures the CPU time of each frame and, with
   * EXT_disjoint_timer_query_webgl2, the GPU time of its rendering (bloom
   * passes included). Hidden tabs don't throttle this, unlike
   * requestAnimationFrame. Stream the land first (__shot).
   */
  const bench = async (quality: 0 | 1 | 2 = 2, frames = 240) => {
    const g = (window as unknown as { __game: Game }).__game as unknown as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
    cancelAnimationFrame(g.frame);
    const fx = (window as unknown as { __tuning: Record<string, Record<string, unknown>> }).__tuning["Trails & particles"];
    const wasAuto = fx.autoQuality;
    fx.autoQuality = false;
    if (g.quality !== quality) g.setQuality(quality);
    const gl = g.renderer.getContext() as WebGL2RenderingContext;
    const ext = gl.getExtension("EXT_disjoint_timer_query_webgl2") as { TIME_ELAPSED_EXT: number; GPU_DISJOINT_EXT: number } | null;
    const render = g.render.bind(g);
    const queries: WebGLQuery[] = [];
    // Time the rendering on the GPU: wrap render() in a query
    g.render = () => {
      if (!ext) return render();
      const q = gl.createQuery()!;
      gl.beginQuery(ext.TIME_ELAPSED_EXT, q);
      render();
      gl.endQuery(ext.TIME_ELAPSED_EXT);
      queries.push(q);
    };
    let t = performance.now();
    const cpu: number[] = [];
    for (let i = 0; i < 30 + frames; i++) {
      t += 1000 / 60;
      const start = performance.now();
      g.loop(t);
      if (i >= 30) cpu.push(performance.now() - start);
      cancelAnimationFrame(g.frame);
      if (i % 4 === 0) await settle();
    }
    g.render = render;
    // Collect the GPU times as they become available
    const gpu: number[] = [];
    const deadline = performance.now() + 3000;
    for (const [i, q] of queries.entries()) {
      while (!gl.getQueryParameter(q, gl.QUERY_RESULT_AVAILABLE) && performance.now() < deadline) await settle();
      if (i >= 30 && gl.getQueryParameter(q, gl.QUERY_RESULT_AVAILABLE) && !gl.getParameter(ext!.GPU_DISJOINT_EXT)) gpu.push(gl.getQueryParameter(q, gl.QUERY_RESULT) / 1e6);
      gl.deleteQuery(q);
    }
    fx.autoQuality = wasAuto;
    const summary = (a: number[]) => {
      if (!a.length) return null;
      const sorted = [...a].sort((x, y) => x - y);
      return { mean: +(a.reduce((x, y) => x + y, 0) / a.length).toFixed(2), p50: +sorted[Math.floor(a.length / 2)].toFixed(2), p95: +sorted[Math.floor(a.length * 0.95)].toFixed(2) };
    };
    g.renderer.info.autoReset = false;
    g.renderer.info.reset();
    render();
    const info = { calls: g.renderer.info.render.calls, triangles: g.renderer.info.render.triangles };
    g.renderer.info.autoReset = true;
    return { quality, cpu: summary(cpu), gpu: summary(gpu), ...info, pixels: `${g.renderer.domElement.width}x${g.renderer.domElement.height}` };
  };

  /**
   * Plays a crash for looking at its animation: finds rock near the start of
   * the course that suits `kind` (a wall for "headfirst" and "wing", a slope
   * for "slide"), flies the pilot into it through the real physics step (so
   * the game classifies the crash itself), and stops `after` seconds into the
   * crash. `pick` chooses another spot. Returns the kind the game chose.
   */
  const crash = async (kind: "headfirst" | "slide" | "wing" = "headfirst", after = 0.5, pick = 0) => {
    const g = (window as unknown as { __game: Game }).__game as unknown as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
    cancelAnimationFrame(g.frame);
    const w = g.world;
    const n = new THREE.Vector3();
    const p = new THREE.Vector3();
    const spots: { p: THREE.Vector3; n: THREE.Vector3 }[] = [];
    for (let z = -40; z < 400 && spots.length < 200; z += 7) {
      const c = w.course.pointAt(z);
      for (let dx = -90; dx <= 90; dx += 6) {
        for (let dy = -70; dy <= 20; dy += 6) {
          p.set(c.x + dx, c.y + dy, z);
          if (Math.abs(w.rock.distance(p.x, p.y, p.z)) > 1.5) continue;
          fieldNormal((x, y, z) => w.distance(x, y, z), p, n);
          const wall = Math.abs(n.y) < 0.25;
          if ((kind === "slide" && n.y > 0.7) || (kind !== "slide" && wall)) spots.push({ p: p.clone(), n: n.clone() });
        }
      }
    }
    const spot = spots[pick % Math.max(1, spots.length)];
    if (!spot) return { error: "no rock near the course for this kind" };
    // Onto the surface, then aim at it the way this kind of crash needs
    for (let i = 0; i < 30; i++) spot.p.addScaledVector(spot.n, -w.distance(spot.p.x, spot.p.y, spot.p.z));
    const dir = new THREE.Vector3();
    if (kind === "headfirst") dir.copy(spot.n).negate();
    else if (kind === "slide") dir.set(0, 0, 1).addScaledVector(spot.n, -spot.n.z).normalize().addScaledVector(spot.n, -0.3).normalize();
    else dir.crossVectors(THREE.Object3D.DEFAULT_UP, spot.n).normalize().addScaledVector(spot.n, -0.3).normalize();
    g.flight.reset(spot.p.clone().addScaledVector(dir, -5), dir, 35);
    g.crashedAt = null;
    g.avatar.revive();
    g.prevPosition.copy(g.flight.position);
    g.prevQuaternion.copy(g.flight.quaternion);
    g.rig.snap(g.flight.position, g.flight.forward, g.flight.up, 35);
    // Steer into the wall with the wing for "wing": roll so the wall is to the side
    const input = { pitch: 0, roll: 0 };
    let t = performance.now();
    let crashedAt: number | null = null;
    for (let i = 0; i < 600; i++) {
      t += 1000 / 60;
      g.input.sample = () => input;
      g.loop(t);
      cancelAnimationFrame(g.frame);
      if (g.crashedAt !== null && crashedAt === null) crashedAt = g.elapsed;
      if (crashedAt !== null && g.elapsed - crashedAt >= after) break;
      if (i % 6 === 0) await settle();
    }
    delete g.input.sample;
    return { wanted: kind, played: g.death.kind, crashed: crashedAt !== null, normal: spot.n.toArray().map((v: number) => +v.toFixed(2)) };
  };

  /**
   * In a run: puts the pilot 30 m in front of the level's portal, aimed at it,
   * streams the land there, then flies in and steps the loop for `after`
   * seconds past the moment of crossing (the transition's stages: blur in,
   * the wormhole, the upgrade pick). Returns the run's phase.
   */
  const portal = async (after = 0.3) => {
    const g = (window as unknown as { __game: Game }).__game as unknown as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
    cancelAnimationFrame(g.frame);
    const r = g.run;
    if (!r) return { error: "not a run" };
    const p = r.portals[0];
    g.freeze(false);
    g.flight.reset(p.position.clone().addScaledVector(p.normal, -30), p.normal.clone(), 35);
    g.glide.stop();
    g.prevPosition.copy(g.flight.position);
    g.prevQuaternion.copy(g.flight.quaternion);
    g.rig.snap(g.flight.position, g.flight.forward, g.flight.up, 35);
    const deadline = performance.now() + 15000;
    while (!g.view.ready && performance.now() < deadline) {
      g.rig.camera.updateMatrixWorld();
      g.view.update(g.rig.camera, 0);
      await settle();
    }
    const input = { pitch: 0, roll: 0 };
    g.input.sample = () => input;
    let t = performance.now();
    let crossed: number | null = null;
    for (let i = 0; i < 60 * 20; i++) {
      t += 1000 / 60;
      g.loop(t);
      cancelAnimationFrame(g.frame);
      if (crossed === null && (r.phase === "portal" || r.phase === "finale")) crossed = g.elapsed;
      if (crossed !== null && g.elapsed - crossed >= after) break;
      if (i % 6 === 0) await settle();
    }
    delete g.input.sample;
    return { phase: r.phase, crossed: crossed !== null };
  };

  Object.assign(window, { __shot: shot, __raceHashes: raceHashes, __run: run, __bench: bench, __crash: crash, __portal: portal });
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
