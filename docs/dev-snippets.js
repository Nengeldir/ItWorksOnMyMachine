// Console snippets for checking the game in a dev build (npm run dev).
// Dev builds install both of these on window by themselves (game/devtools.ts,
// which also has more camera poses); this file keeps a standalone copy and the
// expected race-map hashes. Paste into the console on http://localhost:5173/?seed=42.
// Automated or background tabs throttle requestAnimationFrame and timers, so
// these drive the game by hand and yield through MessageChannel, which isn't
// throttled.

// --- Reproducible screenshots ----------------------------------------------------
// __shot(0): behind the start line. __shot(1): above the start, looking 600 m down
// the course. Freezes the loop, streams the land around the camera for `ms`,
// fixes the shader clock, renders once. Take the screenshot afterwards.
window.__yield = () => new Promise((r) => {
  const ch = new MessageChannel();
  ch.port1.onmessage = () => r();
  ch.port2.postMessage(0);
});
window.__shot = async (view, ms = 4000) => {
  const g = __game;
  cancelAnimationFrame(g.frame);
  document.querySelectorAll(".panel,.topbar,.hud,.ring-marker,.speed-vignette,.banner,.ghost-note").forEach((e) => (e.style.visibility = "hidden"));
  if (g.quality !== 2) g.setQuality(2);
  g.render();
  g.respawn(0);
  g.avatar.group.position.copy(g.flight.position);
  g.avatar.group.quaternion.copy(g.flight.quaternion);
  const cam = g.rig.camera;
  const c = g.world.course;
  const s = c.start;
  const d = c.startDirection;
  if (view === 0) {
    cam.position.copy(s).addScaledVector(d, -14);
    cam.position.y += 5;
    cam.lookAt(s.x + d.x * 100, s.y + d.y * 100 - 8, s.z + d.z * 100);
  } else {
    const p = c.pointAt(600);
    cam.position.copy(s);
    cam.position.y += 90;
    cam.position.x += 60;
    cam.lookAt(p);
  }
  cam.fov = 70;
  cam.updateProjectionMatrix();
  cam.updateMatrixWorld();
  const end = performance.now() + ms;
  while (performance.now() < end) {
    g.view.update(cam, 0);
    await __yield();
  }
  __fxTime.value = 10;
  g.particles.clear();
  g.particles.update();
  g.speedLines.reset();
  g.view.update(cam, 0);
  g.render();
  await __yield();
  g.render();
  return { ready: g.view.ready, palette: g.world.palette.name };
};

// --- Race map determinism ----------------------------------------------------------
// Hashes the race map (Sky Isles) of a few seeds: rock meshes and colors (mesh),
// tree colliders (trees), collision distances (dist) and rings. trees, dist and
// rings must never change, or recorded ghosts stop matching their maps; mesh may
// change when the looks do. Expected (since the Sky Isles port, 2026-10-10):
//   1: mesh 5d108138 trees f4f3226a dist 9086de69 rings 583fd555 (Winter)
//   7: mesh 3ec23ab6 trees fb4fc91d dist 6aab8c08 rings c8cc2d15 (Misty pines)
//  42: mesh cea1915c trees 112f6564 dist 3b43c006 rings 40f33295 (Misty pines)
window.__raceHashes = async () => {
  const v = Date.now();
  const { World } = await import(`/src/game/world/World.ts?t=${v}`);
  const { raceLevel } = await import(`/src/game/world/biomes/index.ts?t=${v}`);
  const { meshChunk, rockChunks } = await import(`/src/game/world/mesher.ts?t=${v}`);
  const fnv = (h, arr) => {
    const u = new Uint32Array(arr.buffer, arr.byteOffset, arr.length);
    for (let i = 0; i < u.length; i++) {
      h ^= u[i];
      h = Math.imul(h, 16777619) >>> 0;
    }
    return h;
  };
  const out = {};
  for (const seed of [1, 7, 42]) {
    const w = new World(raceLevel(seed));
    const chunks = rockChunks(w).sort((a, b) => a.key - b.key);
    let h = 2166136261;
    let t = 2166136261;
    const step = Math.max(1, Math.floor(chunks.length / 120));
    for (let i = 0; i < chunks.length; i += step) {
      const c = chunks[i];
      const m = meshChunk(w, c.ix, c.iy, c.iz);
      h = fnv(h, m.positions);
      h = fnv(h, m.colors);
      h = fnv(h, m.trees);
      t = fnv(t, m.trees);
    }
    const d = new Float32Array(4000);
    for (let i = 0; i < 4000; i++) {
      const p = w.course.pointAt((i * 0.61) % 2300);
      d[i] = w.distance(p.x + ((i * 37) % 200) - 100, p.y + ((i * 13) % 120) - 60, p.z);
    }
    const rings = new Float32Array(w.course.rings.flatMap((r) => [r.position.x, r.position.y, r.position.z, r.normal.x, r.normal.y, r.normal.z, r.radius]));
    out[seed] = { mesh: h.toString(16), trees: t.toString(16), dist: fnv(2166136261, d).toString(16), rings: fnv(2166136261, rings).toString(16), palette: w.palette.name };
  }
  return out;
};
