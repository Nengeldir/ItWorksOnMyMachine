// The bench's scenes (plan F11): `__bench(q, "reaches-farm")` sets one up, then measures it. They are
// placeholders until the steps that build them land (each names its step); until then the bench
// measures whatever is on screen and says the scene isn't ready, so the harness and its output exist
// from the start and every later step only fills its scene in.

export interface BenchScene {
  /** Built yet? */
  ready: boolean;
  /** What it will show, and which step builds it */
  note: string;
  /** Puts the scene on screen (the game as `unknown`: scenes reach into its parts); returns its undo */
  setup?: (game: unknown) => void | (() => void);
}

export const BENCH_SCENES: Record<string, BenchScene> = {
  "reaches-farm": { ready: false, note: "A sky garden at golden hour: 3 000 crop instances, harvest particles, ambience (step R5)" },
  "windspire-room": { ready: false, note: "A Windspire combat room: 24 Murk, telegraphs, purification bursts (steps A8, A9)" },
  "gathering-30": { ready: false, note: "Lanternhaven with 30 fake remote pilots, emotes and chat bubbles (step G2)" },
};
