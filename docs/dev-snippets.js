// Console snippets for checking the game in a dev build (npm run dev).
// Dev builds install these on window by themselves (game/devtools.ts,
// which also has more camera poses); this file keeps a standalone copy. Paste
// into the console on http://localhost:5173/?seed=42.
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
