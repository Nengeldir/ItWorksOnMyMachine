let available: boolean | null = null;

/**
 * Can this browser draw the game? Three.js needs WebGL 2. Browsers turn it off
 * when hardware acceleration is disabled or the GPU process has crashed, and
 * then every page fails with "A WebGL context could not be created".
 */
export function webglAvailable(): boolean {
  if (available === null) {
    try {
      const gl = document.createElement("canvas").getContext("webgl2");
      available = !!gl;
      // Give the test context back right away; browsers only allow a few at once
      gl?.getExtension("WEBGL_lose_context")?.loseContext();
    } catch {
      available = false;
    }
  }
  return available;
}
