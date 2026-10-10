import GUI from "lil-gui";
import type { DebugSettings } from "../debugMode";
import { DEBUG_CONTROLS, DEBUG_DEFAULTS } from "../tuning";
import { DEBUG_ACTIONS, debugActionFor, type DebugAction } from "./actions";
import "./panel.css";

/** Loaded only for an opted-in local game on a dev server. Settings die with this game. */
export class DebugPanel {
  readonly settings: DebugSettings = { ...DEBUG_DEFAULTS };
  private readonly gui: GUI;
  private readonly onAction: (action: DebugAction) => void;

  constructor(container: HTMLElement, onAction: (action: DebugAction) => void) {
    this.onAction = onAction;
    this.gui = new GUI({ container, title: "Debug playtest · results not saved", width: 320 });
    this.gui.domElement.classList.add("playtest-panel");
    this.gui.domElement.classList.toggle("playtest-with-tuning", new URLSearchParams(location.search).has("tune"));
    if (window.matchMedia("(max-width: 700px)").matches) this.gui.close();
    // Editing controls must not also steer, flap, or trigger screen hotkeys.
    this.gui.domElement.addEventListener("keydown", (event) => event.stopPropagation());
    const note = document.createElement("p");
    note.className = "debug-note";
    note.textContent = "Adventure: take off, then Shift+P spawns a portal ahead. Shift+O opens the victory screen. P pauses. Esc frees the mouse. Results are not saved.";
    this.gui.domElement.appendChild(note);

    const controls = this.gui.addFolder("Playtest controls");
    this.addControls(controls);
  }

  /** Both ?debug and ?tune edit the same per-game settings; nothing goes into localStorage. */
  addControls(folder: GUI) {
    for (const control of DEBUG_CONTROLS) {
      const range = "range" in control ? control.range : undefined;
      const controller = range
        ? folder.add(this.settings, control.key, range[0], range[1], range[2])
        : folder.add(this.settings, control.key);
      controller.name(control.label).listen();
    }
    for (const action of DEBUG_ACTIONS) {
      folder.add({ run: () => this.onAction(action.id) }, "run").name(action.label);
    }
  }

  /** Consume held shortcuts too, so a repeated Shift+P never falls through to pause. */
  handleShortcut(event: KeyboardEvent): boolean {
    const action = debugActionFor(event);
    if (!action) return false;
    if (!event.repeat) this.onAction(action);
    return true;
  }

  dispose() {
    this.gui.destroy();
  }
}
