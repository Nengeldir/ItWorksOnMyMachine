// Background music: one looping track per mood, crossfaded when the biome
// changes. Biomes that sound alike share a track (Sky Isles and Archipelago
// keep playing without a break). At night the same track is dimmed and
// muffled, so every biome has a day and a night feel without extra files.
// Files live in public/audio/music, named `<biome>_<title>.mp3`.

import { AUDIO } from "./tuning";
import type { BiomeId } from "./world/biomes/types";

const TRACKS = {
  sky: "audio/music/sky-isles_soaring-above-the-clouds.mp3",
  glacier: "audio/music/glacier_blue-shadows-over-cold-peaks.mp3",
  verdant: "audio/music/verdant_dewdrop-stream.mp3",
  twilight: "audio/music/twilight_blue-hour-fireflies.mp3",
  ember: "audio/music/ember_red-orange-embers.mp3",
} as const;

type TrackId = keyof typeof TRACKS;

/** Which track plays in which biome */
const TRACK_OF: Record<BiomeId, TrackId> = {
  skyIsles: "sky",
  archipelago: "sky",
  glacier: "glacier",
  aurora: "glacier", // until the finale gets a track of its own
  verdant: "verdant",
  lagoon: "verdant",
  twilight: "twilight",
  ember: "ember",
};

/** The file that plays in `biome`, without the folder (for the debug panel) */
export function trackFile(biome: BiomeId): string {
  return TRACKS[TRACK_OF[biome]].split("/").pop()!;
}

interface Voice {
  id: TrackId;
  source: AudioBufferSourceNode;
  gain: GainNode;
}

export class MusicPlayer {
  private readonly bus: GainNode;
  private readonly tone: BiquadFilterNode;
  private readonly buffers = new Map<TrackId, Promise<AudioBuffer | null>>();
  private voice: Voice | null = null;
  private wanted: TrackId | null = null;
  private night = 0;
  private readonly ctx: AudioContext;

  constructor(ctx: AudioContext, out: AudioNode) {
    this.ctx = ctx;
    this.tone = ctx.createBiquadFilter();
    this.tone.type = "lowpass";
    this.tone.frequency.value = 20000;
    this.bus = ctx.createGain();
    this.bus.gain.value = 0;
    this.tone.connect(this.bus).connect(out);
  }

  /** Plays the track of `biome`; `night` (0..1) dims and muffles it. Same track: no restart */
  setBiome(biome: BiomeId, night: number) {
    this.night = night;
    const id = TRACK_OF[biome];
    if (id === this.wanted) return;
    this.wanted = id;
    void this.crossfadeTo(id);
  }

  /** The file that is actually playing now (or fading in), if any */
  get playing(): string | null {
    return this.voice ? TRACKS[this.voice.id].split("/").pop()! : null;
  }

  /** Per frame: follows the volume and night sliders */
  update() {
    const now = this.ctx.currentTime;
    this.bus.gain.setTargetAtTime(AUDIO.music * (1 - AUDIO.nightDim * this.night), now, 0.3);
    this.tone.frequency.setTargetAtTime(20000 * Math.pow(0.12, AUDIO.nightMuffle * this.night), now, 0.5);
  }

  private load(id: TrackId): Promise<AudioBuffer | null> {
    let buffer = this.buffers.get(id);
    if (!buffer) {
      buffer = fetch(import.meta.env.BASE_URL + TRACKS[id])
        .then((res) => (res.ok ? res.arrayBuffer() : Promise.reject(new Error(res.statusText))))
        .then((data) => this.ctx.decodeAudioData(data))
        .catch(() => null); // no music is better than a crash
      this.buffers.set(id, buffer);
    }
    return buffer;
  }

  private async crossfadeTo(id: TrackId) {
    const buffer = await this.load(id);
    // Another biome was asked for while this one loaded, or it failed to load
    if (!buffer || this.wanted !== id || this.ctx.state === "closed") return;

    const now = this.ctx.currentTime;
    const fade = Math.max(0.1, AUDIO.crossfade);
    const source = this.ctx.createBufferSource();
    source.buffer = buffer;
    source.loop = true;
    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(1, now + fade);
    source.connect(gain).connect(this.tone);
    source.start(now);

    const old = this.voice;
    if (old) {
      old.gain.gain.cancelScheduledValues(now);
      old.gain.gain.setValueAtTime(old.gain.gain.value, now);
      old.gain.gain.linearRampToValueAtTime(0, now + fade);
      old.source.stop(now + fade + 0.1);
    }
    this.voice = { id, source, gain };
  }
}
