import GUI from "lil-gui";
import type { Controller } from "lil-gui";
import type { DebugSettings } from "../debugMode";
import type { Flight } from "../flight";
import type { World } from "../world/World";
import { DEBUG_CONTROLS, DEBUG_DEFAULTS } from "../tuning";
import { FlightTelemetry } from "./telemetry";
import { DEBUG_ACTIONS, debugActionFor, type DebugAction } from "./actions";
import "./panel.css";

// Adding a readout or control requires one registry entry, not another UI component.
const METRICS = [
  ["altitude", "Altitude, world Y (m)"],
  ["groundDistance", "Ground distance (m)"],
  ["speed", "Speed (m/s)"],
  ["climbRate", "Climb rate (m/s)"],
  ["acceleration", "Acceleration (m/s²)"],
  ["speedChange", "Speed change (m/s²)"],
] as const;
type Metric = typeof METRICS[number][0];

/** Loaded only for an opted-in local game on a dev server. Settings die with this game. */
export class DebugPanel {
  readonly settings: DebugSettings = { ...DEBUG_DEFAULTS };
  readonly telemetry = new FlightTelemetry();
  private readonly gui: GUI;
  private readonly readouts = Object.fromEntries(METRICS.map(([key]) => [key, "0.0"])) as Record<Metric, string>;
  private readonly controllers: Controller[] = [];
  private readonly metricsFolder: GUI;
  private readonly onAction: (action: DebugAction) => void;

  constructor(container: HTMLElement, flight: Flight, world: World, onAction: (action: DebugAction) => void) {
    this.onAction = onAction;
    this.telemetry.idle(flight);
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
    this.metricsFolder = this.gui.addFolder("Flight telemetry");
    for (const [key, label] of METRICS) this.controllers.push(this.metricsFolder.add(this.readouts, key).name(label).disable());
    this.update(flight, false, world);
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

  /** Called at the existing HUD cadence (10 Hz), rather than writing to the DOM every frame. */
  update(flight: Flight, moving: boolean, world: World) {
    if (!moving) this.telemetry.idle(flight);
    this.telemetry.sampleGround(flight, world);
    for (const [key] of METRICS) this.readouts[key] = this.telemetry[key].toFixed(1);
    for (const controller of this.controllers) controller.updateDisplay();
    this.metricsFolder.show(this.settings.showFlight);
  }

  dispose() {
    this.gui.destroy();
  }
}
