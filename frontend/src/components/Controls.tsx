import type { Settings } from "../storage";
import { KEY_BINDINGS, keyLabel } from "../game/input";

interface ControlsProps {
  settings: Settings;
  onSettings: (settings: Settings) => void;
}

/** Control settings and a cheat sheet */
const Controls = ({ settings, onSettings }: ControlsProps) => (
  <div className="controls">
    <ul className="keys">
      <li>
        <kbd>Mouse</kbd> or <kbd>WASD</kbd> / arrows or a gamepad stick: pitch and roll
      </li>
      <li>Bank to turn. Dive for speed, pull up to trade it for height.</li>
      <li>Skim the rock and trees for style points and a speed boost.</li>
      <li>
        <kbd>Q</kbd> / <kbd>E</kbd> or double-tap a roll key: barrel roll
      </li>
      <li>
        <kbd>R</kbd> respawn · <kbd>M</kbd> mute · <kbd>Esc</kbd> free the mouse
      </li>
      <li>
        <kbd>{keyLabel(KEY_BINDINGS.pause)}</kbd> pause / resume
      </li>
    </ul>
    <label className="check">
      <input
        type="checkbox"
        checked={settings.invertPitch}
        onChange={(e) => onSettings({ ...settings, invertPitch: e.target.checked })}
      />
      Invert pitch (mouse up and <kbd>W</kbd> pull up)
    </label>
    <label className="field">
      <span>Mouse sensitivity {settings.mouseSensitivity.toFixed(1)}</span>
      <input
        type="range"
        min={0.3}
        max={3}
        step={0.1}
        value={settings.mouseSensitivity}
        onChange={(e) => onSettings({ ...settings, mouseSensitivity: Number(e.target.value) })}
      />
    </label>
  </div>
);

export default Controls;
