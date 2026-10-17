// The particle jars' code is a chunk of its own (cosmetics/jars.ts): nothing loads it until a jar is worn
// or shown, so races and the landing page without one never carry it

export type JarsModule = typeof import("./jars");

let ready: JarsModule | null = null;
let pending: Promise<JarsModule> | null = null;

/** Loads the jars' code (once) */
export function loadJars(): Promise<JarsModule> {
  return (pending ??= import("./jars").then((module) => (ready = module)));
}

/** The jars' code if it has loaded, else null (and it starts loading) */
export function jarsModule(): JarsModule | null {
  if (!ready) void loadJars();
  return ready;
}
