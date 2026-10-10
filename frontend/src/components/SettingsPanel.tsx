import { useEffect, useEffectEvent, useRef, useState } from "react";
import { ACTION_LABELS, bindingActions, bindable, defaultBindings, keyLabel, type BindingAction } from "../game/bindings";
import { defaultSettings, type Settings } from "../storage";
import "./SettingsPanel.css";

interface Props { settings: Settings; onSettings: (settings: Settings) => void; onClose: () => void }

export default function SettingsPanel({ settings, onSettings, onClose }: Props) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [waiting, setWaiting] = useState<{ action: BindingAction; slot: number } | null>(null);
  const [message, setMessage] = useState("");
  const bindings = settings.bindings ?? defaultBindings();
  const update = (change: Partial<Settings>) => onSettings({ ...settings, ...change });
  const capture = useEffectEvent((event: KeyboardEvent) => {
    // The modal owns keyboard input; game and menu shortcuts must not see it.
    event.stopPropagation();
    if (event.code === "Escape") {
      event.preventDefault();
      if (waiting) { setWaiting(null); setMessage("Binding cancelled."); }
      else onClose();
      return;
    }
    if (!waiting) return;
    event.preventDefault();
    if (event.repeat) return;
    if (event.metaKey || (!event.code.startsWith("Control") && event.ctrlKey) || (!event.code.startsWith("Alt") && event.altKey) || !bindable(event.code)) {
      setMessage("That key is reserved for menus, upgrades, the browser or world switching. Choose another key.");
      return;
    }
    const conflict = bindingActions.find(action => bindings[action].some((code, slot) => code === event.code && (action !== waiting.action || slot !== waiting.slot)));
    if (conflict) { setMessage(`${keyLabel(event.code)} is already used for ${ACTION_LABELS[conflict]}. Change that binding first.`); return; }
    const codes = [...bindings[waiting.action]]; codes[waiting.slot] = event.code;
    update({ bindings: { ...bindings, [waiting.action]: codes } });
    setMessage(`${ACTION_LABELS[waiting.action]} bound to ${keyLabel(event.code)}.`); setWaiting(null);
  });
  useEffect(() => {
    const el = dialog.current!;
    el.showModal();
    window.addEventListener("keydown", capture, true);
    const stop = (event: KeyboardEvent) => event.stopPropagation();
    window.addEventListener("keyup", stop, true);
    return () => { window.removeEventListener("keydown", capture, true); window.removeEventListener("keyup", stop, true); el.close(); };
  }, []);
  const toggle = (key: "invertPitch" | "invertMouse" | "invertGamepad" | "invertTouch" | "reducedMotion" | "muted", label: string) => (
    <label className="check"><input type="checkbox" checked={!!settings[key]} onChange={e => update({ [key]: e.target.checked })} />{label}</label>
  );
  const slider = (key: "mouseSensitivity" | "tiltSensitivity" | "deadZone" | "musicVolume" | "effectsVolume", label: string, min: number, max: number, step: number, fallback: number) => (
    <label className="field"><span>{label} <output>{(settings[key] ?? fallback).toFixed(2)}</output></span>
      <input type="range" aria-label={label} min={min} max={max} step={step} value={settings[key] ?? fallback} onChange={e => update({ [key]: Number(e.target.value) })} />
    </label>
  );
  return <dialog ref={dialog} className="settings-dialog glass" aria-labelledby="settings-title" onCancel={e => e.preventDefault()}>
    <header><div><h2 id="settings-title">Settings</h2><p>Saved automatically on this device.</p></div><button autoFocus onClick={onClose} aria-label="Close settings">Close</button></header>
    <section><h3>Flight controls</h3>
      {slider("mouseSensitivity", "Mouse sensitivity", 0.3, 6, 0.1, 2)}
      <p className="settings-help">Default: 2×. Mouse up and forward stick dive unless inverted.</p>
      {toggle("invertMouse", "Invert mouse up / down")}
      {toggle("invertGamepad", "Invert gamepad up / down")}
      {toggle("invertPitch", "Invert keyboard pitch")}
      {slider("deadZone", "Gamepad stick dead zone", 0, 0.4, 0.01, 0.12)}
      <h3>Touch and tilt</h3>
      <p className="settings-help">On a phone or tablet, drag anywhere on the view to steer and use the on-screen buttons. The Tilt button in the game steers by tilting the device instead; level is how you hold it when you turn it on or resume.</p>
      {slider("tiltSensitivity", "Tilt sensitivity", 0.4, 2.5, 0.1, 1)}
      {toggle("invertTouch", "Invert touch and tilt up / down")}
      <h3>Keyboard bindings</h3>
      <p className="settings-help">Select a key, then press its replacement. Escape cancels. Gamepad buttons keep their standard layout.</p>
      <p className="binding-message" role="status">{waiting ? `Press a key for ${ACTION_LABELS[waiting.action]}. ${message}` : message || "You can set a primary and an alternate key."}</p>
      <div className="binding-list">{bindingActions.map(action => <div className="binding-row" key={action}>
        <span>{ACTION_LABELS[action]}</span>
        {[0,1].map(slot => <button key={slot} className={waiting?.action === action && waiting.slot === slot ? "listening" : ""}
          aria-label={`${ACTION_LABELS[action]} ${slot === 0 ? "primary" : "alternate"} key`}
          onClick={() => { setWaiting({action,slot}); setMessage(""); }}>
          {waiting?.action === action && waiting.slot === slot ? "Press a key…" : bindings[action][slot] ? keyLabel(bindings[action][slot]) : "Add key"}
        </button>)}
        {bindings[action][1] && <button className="binding-remove" aria-label={`Remove ${ACTION_LABELS[action]} alternate key`} onClick={() => update({bindings:{...bindings,[action]:[bindings[action][0]]}})}>×</button>}
      </div>)}</div>
      <button onClick={() => { const defaults = defaultSettings(); update({bindings:defaultBindings(),mouseSensitivity:2,invertPitch:false,invertMouse:false,invertGamepad:false,invertTouch:false,tiltSensitivity:1,deadZone:defaults.deadZone}); setWaiting(null); setMessage("Flight controls reset."); }}>Reset controls</button>
    </section>
    <section><h3>Sound</h3>
      {toggle("muted", "Mute all audio")}
      {slider("musicVolume", "Music volume", 0, 1, 0.05, 1)}
      {slider("effectsVolume", "Effects and wind volume", 0, 1, 0.05, 1)}
    </section>
    <section><h3>Display and camera</h3>
      <label className="field"><span>Graphics quality</span><select value={settings.quality ?? "auto"} onChange={e => update({quality:e.target.value as Settings["quality"]})}>
        <option value="auto">Automatic</option><option value="high">High</option><option value="medium">Medium</option><option value="low">Low</option>
      </select></label>
      {toggle("reducedMotion", "Reduce camera shake and field-of-view effects")}
    </section>
    <footer><button onClick={onClose}>Done</button></footer>
  </dialog>;
}
