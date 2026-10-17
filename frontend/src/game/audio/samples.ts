// The sample bank (plan F9): short recorded one-shots packed in a sprite sheet per mode
// (public/audio/sheets/<sheet>.json naming an audio file and each sound's [start, duration] in it),
// fetched lazily the first time a mode asks, decoded once. Until a sheet is there (or if it never
// is) every sound has a synthesized recipe (families.ts) that plays instead, so nothing waits on a
// download. No sheets ship yet: the recipes carry every family.

export interface SheetEntry {
  start: number;
  duration: number;
}

export interface Sheet {
  file: string;
  sounds: Record<string, SheetEntry>;
}

/** Checks a sheet's JSON; throws a readable error on anything off */
export function parseSheet(json: unknown): Sheet {
  if (!json || typeof json !== "object") throw new Error("sheet: not an object");
  const { file, sounds } = json as { file?: unknown; sounds?: unknown };
  if (typeof file !== "string" || !/^[\w.-]+\.(ogg|opus|webm|mp3|m4a)$/.test(file)) throw new Error("sheet: file must be an audio file name");
  if (!sounds || typeof sounds !== "object") throw new Error("sheet: sounds missing");
  const out: Record<string, SheetEntry> = {};
  for (const [name, value] of Object.entries(sounds)) {
    if (!Array.isArray(value) || value.length !== 2 || !value.every((n) => typeof n === "number" && Number.isFinite(n) && n >= 0)) {
      throw new Error(`sheet: ${name} must be [start, duration] in seconds`);
    }
    if (value[1] <= 0 || value[1] > 6) throw new Error(`sheet: ${name} lasts ${value[1]} s (one-shots are under 6 s)`);
    out[name] = { start: value[0], duration: value[1] };
  }
  return { file, sounds: out };
}

export class SampleBank {
  private readonly ctx: BaseAudioContext;
  private readonly base: string;
  private readonly loading = new Map<string, Promise<boolean>>();
  private readonly sounds = new Map<string, { buffer: AudioBuffer; entry: SheetEntry }>();

  constructor(ctx: BaseAudioContext, base: string) {
    this.ctx = ctx;
    this.base = base;
  }

  /** Fetches and decodes a sheet once; true when its sounds are ready, false when it isn't there */
  load(sheet: string): Promise<boolean> {
    let promise = this.loading.get(sheet);
    if (!promise) {
      promise = (async () => {
        try {
          const res = await fetch(`${this.base}${sheet}.json`);
          if (!res.ok) return false;
          const parsed = parseSheet(await res.json());
          const audio = await fetch(this.base + parsed.file);
          if (!audio.ok) return false;
          const buffer = await this.ctx.decodeAudioData(await audio.arrayBuffer());
          for (const [name, entry] of Object.entries(parsed.sounds)) this.sounds.set(name, { buffer, entry });
          return true;
        } catch {
          return false;
        }
      })();
      this.loading.set(sheet, promise);
    }
    return promise;
  }

  has(name: string): boolean {
    return this.sounds.has(name);
  }

  /** Plays a loaded sound into `out` at `when`; its length in seconds (0: not loaded) */
  play(name: string, out: AudioNode, when: number, rate: number): number {
    const sound = this.sounds.get(name);
    if (!sound) return 0;
    const source = this.ctx.createBufferSource();
    source.buffer = sound.buffer;
    source.playbackRate.value = rate;
    source.connect(out);
    source.start(when, sound.entry.start, sound.entry.duration);
    return sound.entry.duration / rate;
  }
}
