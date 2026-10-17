import { loadSettings } from "../../storage";
import { Ambience } from "./ambience";
import { type BusId, AudioBuses } from "./buses";
import { RECIPES, type SoundName, familyOf } from "./families";
import { VoicePool, variation } from "./pool";
import { SampleBank } from "./samples";
import { SpatialPool, type Vec3 } from "./spatial";

// The open world's audio engine (plan F9): one per AudioContext. Sounds go through the voice pool (a
// limit per family, 24 in all), get a little random pitch and volume, play a recorded sample if their
// sheet is loaded or their synthesized recipe if not, optionally from a place in the world (pooled
// panners), into a bus. The game's own GameAudio routes into this engine's `world` and `music` buses;
// the menus and the /?ui page share a page-wide engine (`pageAudio`). Only the buses are in the races'
// bundle: GameAudio makes them at once and loads this engine when an open-world mode asks for it.

export interface PlayOptions {
  /** Default: `ui` for ui sounds, `voice` for babble, else `world` */
  bus?: BusId;
  /** A place in the world: heard from there, and not at all past 80 m */
  at?: Vec3;
  /** 0..1, before the random ±2 dB */
  gain?: number;
  /** 0..1, a flavour (an NPC's pitch) */
  variant?: number;
  /** Seconds from now */
  delay?: number;
}

function defaultBus(name: SoundName): BusId {
  const family = familyOf(name);
  return family === "ui" ? "ui" : family === "voice" ? "voice" : family === "impact" ? "combat" : "world";
}

export class AudioEngine {
  readonly ctx: BaseAudioContext;
  readonly buses: AudioBuses;
  readonly pool = new VoicePool();
  readonly spatial: SpatialPool;
  readonly samples: SampleBank;
  readonly ambience: Ambience;
  private readonly noise: AudioBuffer;
  private readonly playing = new Map<number, { gain: GainNode; end: number }>();

  /** `buses`: the context's buses (GameAudio's own), or a node to make new ones into */
  constructor(ctx: BaseAudioContext, buses: AudioBuses | AudioNode, sampleBase = "/audio/sheets/") {
    this.ctx = ctx;
    this.buses = buses instanceof AudioBuses ? buses : new AudioBuses(ctx, buses);
    this.spatial = new SpatialPool(ctx);
    this.samples = new SampleBank(ctx, sampleBase);
    this.ambience = new Ambience(ctx, this.buses.input.ambience);
    const length = Math.floor(ctx.sampleRate * 1.5);
    this.noise = ctx.createBuffer(1, length, ctx.sampleRate);
    const data = this.noise.getChannelData(0);
    for (let i = 0; i < length; i++) data[i] = Math.random() * 2 - 1;
  }

  /** Voices playing now (the ?perf overlay) */
  get voices(): number {
    this.pool.expire(this.ctx.currentTime);
    return this.pool.active();
  }

  /** Plays a sound; false when it was dropped (too quiet to cut a louder one, or too far away) */
  play(name: SoundName, options: PlayOptions = {}): boolean {
    const now = this.ctx.currentTime;
    const when = now + (options.delay ?? 0);
    const { rate, gain } = variation(Math.random(), Math.random());
    const loudness = Math.max(0, Math.min(1, options.gain ?? 1));
    // The pool needs a length before the sound exists: the recipe's is close enough for a sample too
    const claim = this.pool.claim(familyOf(name), loudness, when, 1.2);
    if (!claim) return false;
    if (claim.steal !== null) this.stop(claim.steal);
    const bus = this.buses.input[options.bus ?? defaultBus(name)];
    const voice = this.ctx.createGain();
    voice.gain.value = loudness * gain;
    let target: AudioNode = bus;
    if (options.at) {
      const panner = this.spatial.claim(options.at, 1.5, bus);
      if (!panner) {
        this.pool.release(claim.id);
        return false;
      }
      target = panner;
    }
    voice.connect(target);
    const length = this.samples.play(name, voice, when, rate) || RECIPES[name]({ ctx: this.ctx, out: voice, noise: this.noise }, when, rate, options.variant ?? 0.5);
    this.playing.set(claim.id, { gain: voice, end: when + length });
    // Let the voice go once it's done (one timer per sound, not per frame)
    setTimeout(() => this.finish(claim.id), (length + (options.delay ?? 0)) * 1000 + 80);
    return true;
  }

  private finish(id: number) {
    const voice = this.playing.get(id);
    if (!voice) return;
    this.playing.delete(id);
    this.pool.release(id);
    voice.gain.disconnect();
  }

  /** A stolen voice fades out in ~20 ms instead of cutting (a cut clicks) */
  private stop(id: number) {
    const voice = this.playing.get(id);
    if (!voice) return;
    voice.gain.gain.setTargetAtTime(0, this.ctx.currentTime, 0.006);
    this.playing.delete(id);
    setTimeout(() => voice.gain.disconnect(), 60);
  }

  /** Loads a mode's sample sheet (gathering, combat) in the background */
  preload(sheet: string) {
    void this.samples.load(sheet);
  }

  dispose() {
    this.ambience.dispose();
    for (const id of [...this.playing.keys()]) this.stop(id);
  }
}

/** Each bus's volume from the settings: music and effects as before, the four new ones beside them */
export function busVolumes(settings = loadSettings()): Record<BusId, number> {
  const muted = settings.muted ? 0 : 1;
  const effects = settings.effectsVolume ?? 1;
  return {
    music: (settings.musicVolume ?? 1) * muted,
    world: effects * muted,
    ambience: (settings.ambienceVolume ?? 1) * effects * muted,
    combat: (settings.combatVolume ?? 1) * effects * muted,
    ui: (settings.uiVolume ?? 1) * effects * muted,
    voice: (settings.voiceVolume ?? 1) * effects * muted,
  };
}

let page: { ctx: AudioContext; engine: AudioEngine } | null = null;

/**
 * The page-wide engine for menus and the /?ui page, made on first use (call from a click: browsers
 * start audio only after a gesture). Follows the settings each time it's asked for
 */
export function pageAudio(): AudioEngine | null {
  try {
    if (!page) {
      const ctx = new AudioContext();
      const master = ctx.createGain();
      master.gain.value = 0.9;
      master.connect(ctx.destination);
      page = { ctx, engine: new AudioEngine(ctx, master, import.meta.env.BASE_URL + "audio/sheets/") };
    }
    if (page.ctx.state === "suspended") void page.ctx.resume();
    page.engine.buses.setVolumes(busVolumes());
    return page.engine;
  } catch {
    return null;
  }
}
