import { useEffect, useState } from "react";
import { REGION_BEDS } from "../../../game/audio/ambience";
import { BUSES, type BusId } from "../../../game/audio/buses";
import { type AudioEngine, busVolumes, pageAudio } from "../../../game/audio/engine";
import { type SoundName, soundsByFamily } from "../../../game/audio/families";
import { FAMILY_LIMITS, MAX_VOICES } from "../../../game/audio/pool";

// The sound half of /?ui (plan F9): every family through the voice pool, the buses' sliders, sounds
// placed left and right through the panner pool, bursts that show the pool's limits, ambience beds
// blended between two regions, and ducking.

const REGIONS = Object.keys(REGION_BEDS);

export default function SoundLab() {
  const [engine, setEngine] = useState<AudioEngine | null>(null);
  const [volumes, setVolumes] = useState<Record<BusId, number>>(busVolumes);
  const [voices, setVoices] = useState(0);
  const [variant, setVariant] = useState(0.5);
  const [regionA, setRegionA] = useState("meadow_rise");
  const [regionB, setRegionB] = useState("hollow_deeps");
  const [blend, setBlend] = useState(0);
  const [beds, setBeds] = useState(false);

  useEffect(() => {
    if (!engine) return;
    engine.spatial.setListener({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: -1 });
    const timer = setInterval(() => setVoices(engine.voices), 100);
    return () => clearInterval(timer);
  }, [engine]);
  useEffect(() => {
    engine?.ambience.setWeights(beds ? { [regionA]: 1 - blend, [regionB]: blend } : {});
  }, [engine, beds, regionA, regionB, blend]);
  useEffect(() => () => engine?.ambience.setWeights({}), [engine]);

  const start = () => {
    const made = pageAudio();
    if (made) {
      made.buses.setVolumes(volumes);
      setEngine(made);
    }
    return made;
  };
  const play = (name: SoundName, at?: { x: number; y: number; z: number }) => (engine ?? start())?.play(name, { at, variant });
  const burst = (name: SoundName, count: number) => {
    const e = engine ?? start();
    for (let i = 0; i < count; i++) setTimeout(() => e?.play(name, { gain: 0.4 + Math.random() * 0.6 }), i * 25);
  };

  return (
    <section className="uig-section sheet-panel">
      <h3>Sound (F9)</h3>
      <p className="uig-note">
        Every family through the voice pool ({MAX_VOICES} voices at most; per family {Object.entries(FAMILY_LIMITS).map(([f, n]) => `${f} ${n}`).join(", ")}). Each play varies pitch ±4% and volume ±2 dB. No sample sheets ship yet: these are the synthesized fallbacks.
      </p>
      {!engine && (
        <button className="primary" onClick={start}>
          Start sound
        </button>
      )}
      <p className="uig-status">
        Voices <b className="uig-meter">{voices}</b> / {MAX_VOICES}
      </p>
      <div className="uig-buses">
        {BUSES.map((bus) => (
          <label key={bus} className="field">
            <span>
              {bus} <output>{volumes[bus].toFixed(2)}</output>
            </span>
            <input
              type="range"
              min={0}
              max={1}
              step={0.05}
              value={volumes[bus]}
              aria-label={`${bus} bus`}
              onChange={(e) => {
                const next = { ...volumes, [bus]: Number(e.target.value) };
                setVolumes(next);
                engine?.buses.setVolume(bus, next[bus]);
              }}
            />
          </label>
        ))}
      </div>
      {Object.entries(soundsByFamily()).map(([family, names]) => (
        <div key={family} className="uig-row">
          <b className="uig-family">{family}</b>
          {names.map((name) => (
            <button key={name} onClick={() => play(name)}>
              {name.slice(family.length + 1)}
            </button>
          ))}
        </div>
      ))}
      <label className="field">
        <span>
          NPC voice pitch <output>{variant.toFixed(2)}</output>
        </span>
        <input type="range" min={0} max={1} step={0.05} value={variant} onChange={(e) => setVariant(Number(e.target.value))} aria-label="NPC voice pitch" />
      </label>
      <div className="uig-row">
        <b className="uig-family">spatial</b>
        <button onClick={() => play("chime_crystal", { x: -20, y: 0, z: -4 })}>Chime 20 m left</button>
        <button onClick={() => play("chime_crystal", { x: 20, y: 0, z: -4 })}>Chime 20 m right</button>
        <button onClick={() => play("water_splash", { x: 0, y: 0, z: -70 })}>Splash 70 m ahead</button>
        <button onClick={() => play("water_splash", { x: 0, y: 0, z: -95 })}>Splash 95 m (culled)</button>
      </div>
      <div className="uig-row">
        <b className="uig-family">pool</b>
        <button onClick={() => burst("pluck_leaf", 20)}>20 plucks at once (6 play)</button>
        <button onClick={() => burst("chime_star", 40)}>40 chimes (8, then the cap)</button>
        <button onClick={() => (engine ?? start())?.buses.duck("ambience", 6, 2)}>Duck ambience −6 dB for 2 s</button>
      </div>
      <div className="uig-row">
        <b className="uig-family">ambience</b>
        <label className="check">
          <input
            type="checkbox"
            checked={beds}
            onChange={(e) => {
              if (!engine) start();
              setBeds(e.target.checked);
            }}
          />
          Beds on
        </label>
        <select value={regionA} onChange={(e) => setRegionA(e.target.value)} aria-label="First region">
          {REGIONS.map((r) => (
            <option key={r}>{r}</option>
          ))}
        </select>
        <input type="range" min={0} max={1} step={0.01} value={blend} onChange={(e) => setBlend(Number(e.target.value))} aria-label="Blend between the regions" />
        <select value={regionB} onChange={(e) => setRegionB(e.target.value)} aria-label="Second region">
          {REGIONS.map((r) => (
            <option key={r}>{r}</option>
          ))}
        </select>
      </div>
    </section>
  );
}
