// The performance meter behind `?perf` (plan F11): frame and step time, draw calls and triangles of
// the whole frame (every bloom pass), particles alive, sound voices, network kB/s, and whatever counts
// later systems report (`perf.count("nodes", n)`, enemies, remote pilots). Loaded only when the URL
// asks for it (perfFlag.ts): then it wraps the game's loop and step once; a normal frame never runs it.

import { PERF_ON } from "./perfFlag";

export interface PerfSnapshot {
  fps: number;
  /** CPU ms of a frame (the loop: step, effects, render submission) */
  frameMs: number;
  /** CPU ms of the 120 Hz steps in a frame */
  stepMs: number;
  calls: number;
  triangles: number;
  particles: number;
  voices: number;
  quality: number;
  /** kB/s over the last second: finished requests, plus what live connections report */
  netKBs: number;
  heapMB: number | null;
  counters: Record<string, number>;
}

// What the meter reads from the game; kept loose so the game's privates stay private to TypeScript
interface Measured {
  loop: (now: number) => void;
  step: (...args: unknown[]) => void;
  renderer: { info: { autoReset: boolean; reset(): void; render: { calls: number; triangles: number } } };
  particles: { alive(): number };
  softParticles: { alive(): number };
  quality: number;
  audio: { engine: { voices: number } | null };
}

const EMA = 0.1;

class PerfMeter {
  private game: Measured | null = null;
  private frameMs = 0;
  private stepMs = 0;
  private stepThisFrame = 0;
  private lastFrame = 0;
  private fps = 0;
  private calls = 0;
  private triangles = 0;
  private netBytes: { at: number; bytes: number }[] = [];
  private readonly counters = new Map<string, number>();
  private observer: PerformanceObserver | null = null;

  /** A system's count for the overlay (nodes drawn, enemies active, remote pilots) */
  count(name: string, value: number) {
    if (PERF_ON) this.counters.set(name, value);
  }

  /** Bytes a live connection moved (WebSocket shards report here; finished requests are seen anyway) */
  net(bytes: number) {
    if (PERF_ON) this.netBytes.push({ at: performance.now(), bytes });
  }

  /** Called by the game when `?perf` is on: wraps its loop and step to time them */
  attach(target: object) {
    const game = target as Measured;
    this.game = game;
    const loop = game.loop;
    const step = game.step.bind(game);
    game.step = (...args: unknown[]) => {
      const t = performance.now();
      step(...args);
      this.stepThisFrame += performance.now() - t;
    };
    // Calls and triangles add up over the frame's passes (bloom renders several), reset per frame here
    game.renderer.info.autoReset = false;
    game.loop = (now: number) => {
      game.renderer.info.reset();
      this.stepThisFrame = 0;
      const t = performance.now();
      loop(now);
      const ms = performance.now() - t;
      this.frameMs += (ms - this.frameMs) * EMA;
      this.stepMs += (this.stepThisFrame - this.stepMs) * EMA;
      if (this.lastFrame) this.fps += (1000 / Math.max(1, now - this.lastFrame) - this.fps) * EMA;
      this.lastFrame = now;
      this.calls = game.renderer.info.render.calls;
      this.triangles = game.renderer.info.render.triangles;
    };
    if (!this.observer && typeof PerformanceObserver !== "undefined") {
      this.observer = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) this.net((entry as PerformanceResourceTiming).transferSize ?? 0);
      });
      try {
        this.observer.observe({ type: "resource", buffered: false });
      } catch {
        this.observer = null;
      }
    }
  }

  detach(target: object) {
    if (this.game === target) this.game = null;
  }

  /** The overlay's numbers (call a few times a second, not per frame: it counts particles) */
  snapshot(): PerfSnapshot | null {
    const game = this.game;
    if (!game) return null;
    const now = performance.now();
    this.netBytes = this.netBytes.filter((n) => now - n.at < 1000);
    const memory = (performance as { memory?: { usedJSHeapSize: number } }).memory;
    return {
      fps: Math.round(this.fps),
      frameMs: +this.frameMs.toFixed(2),
      stepMs: +this.stepMs.toFixed(2),
      calls: this.calls,
      triangles: this.triangles,
      particles: game.particles.alive() + game.softParticles.alive(),
      voices: game.audio.engine?.voices ?? 0,
      quality: game.quality,
      netKBs: +(this.netBytes.reduce((sum, n) => sum + n.bytes, 0) / 1024).toFixed(1),
      heapMB: memory ? +(memory.usedJSHeapSize / 1048576).toFixed(1) : null,
      counters: Object.fromEntries(this.counters),
    };
  }
}

export const perf = new PerfMeter();
