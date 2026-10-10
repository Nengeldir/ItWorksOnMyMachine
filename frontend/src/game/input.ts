import type { FlightInput } from "./flight";
import { clamp } from "./math";
import { DEFAULT_BINDINGS, type Bindings, type BindingAction } from "./bindings";
export { keyLabel } from "./bindings";

export interface ControlSettings {
  invertPitch: boolean;
  mouseSensitivity: number; // 0.3..6, 2 = default
  invertMouse?: boolean;
  invertGamepad?: boolean;
  bindings?: Bindings;
  deadZone?: number;
  reducedMotion?: boolean;
  quality?: "auto" | "high" | "medium" | "low";
  musicVolume?: number;
  effectsVolume?: number;
  muted?: boolean;
}

/** One-off presses. Wingbeat needs its adventure upgrade. */
export type TestAction = "portal" | "win" | "speed";

export type InputAction = "pause" | "respawn" | "mute" | "barrelLeft" | "barrelRight" | "flap";

export function controlsBlocked(): boolean {
  return !!document.querySelector?.("dialog[open]");
}
function deadZone(value: number, threshold = 0.12): number {
  if (Math.abs(value) < threshold) return 0;
  return (value - Math.sign(value) * threshold) / (1 - threshold);
}

function isTyping(event: KeyboardEvent): boolean {
  const target = event.target as HTMLElement | null;
  return !!target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.tagName === "SELECT" || target.isContentEditable);
}

/**
 * Keyboard, mouse (pointer lock) and gamepad, merged into pitch and roll.
 * Flight-stick convention by default: forward / W / mouse up dives.
 */
export class Input {
  settings: ControlSettings;
  onAction?: (action: InputAction) => void;
  /** Installed only by the URL test mode. */
  onTestAction?: (action: TestAction) => void;
  locked = false;
  private readonly element: HTMLElement;
  private readonly keys = new Set<string>();
  // The mouse moves a virtual stick that drifts back to center
  private stickX = 0;
  private stickY = 0;
  private padButtons: boolean[] = [];

  constructor(element: HTMLElement, settings: ControlSettings) {
    this.element = element;
    this.settings = settings;
    window.addEventListener("keydown", this.onKeyDown);
    window.addEventListener("keyup", this.onKeyUp);
    window.addEventListener("blur", this.onBlur);
    document.addEventListener("mousemove", this.onMouseMove);
    document.addEventListener("pointerlockchange", this.onLockChange);
  }

  dispose() {
    window.removeEventListener("keydown", this.onKeyDown);
    window.removeEventListener("keyup", this.onKeyUp);
    window.removeEventListener("blur", this.onBlur);
    document.removeEventListener("mousemove", this.onMouseMove);
    document.removeEventListener("pointerlockchange", this.onLockChange);
    if (document.pointerLockElement === this.element) document.exitPointerLock();
  }

  /** Call from a click handler: browsers only lock the pointer on a user gesture */
  lockPointer() {
    if (document.pointerLockElement !== this.element) {
      this.element.requestPointerLock()?.catch?.(() => {});
    }
  }

  releasePointer() {
    if (document.pointerLockElement === this.element) document.exitPointerLock();
  }

  private onKeyDown = (event: KeyboardEvent) => {
    if (event.defaultPrevented || controlsBlocked() || isTyping(event)) return;
    if (this.onTestAction && event.shiftKey && !event.ctrlKey && !event.altKey && !event.metaKey) {
      const action = event.code === "KeyP" ? "portal" : event.code === "KeyO" ? "win" : event.code === "KeyS" ? "speed" : null;
      if (action) {
        event.preventDefault();
        // Consume the chord before P pauses or S pitches, including held Shift boost.
        this.reset();
        if (!event.repeat) this.onTestAction(action);
        return;
      }
    }
    if (event.repeat && !this.keys.has(event.code)) return;
    this.keys.add(event.code);
    // Arrow keys would scroll the page; leave them alone on buttons and panels
    const target = event.target as HTMLElement | null;
    const atGame = !target || target === document.body || target === this.element;
    if (atGame && (event.code.startsWith("Arrow") || event.code === "Space")) event.preventDefault();
    if (event.repeat) return;
    const actions: InputAction[] = ["pause", "respawn", "mute", "barrelLeft", "barrelRight", "flap"];
    for (const action of actions) {
      if (this.binding(action).includes(event.code)) {
        if (atGame || action === "pause") event.preventDefault();
        this.onAction?.(action);
        break;
      }
    }
  };

  private onKeyUp = (event: KeyboardEvent) => {
    this.keys.delete(event.code);
  };

  private onBlur = () => {
    this.reset();
  };

  reset() {
    this.keys.clear();
    this.stickX = this.stickY = 0;
    this.padButtons = [];
  }

  private onMouseMove = (event: MouseEvent) => {
    if (!this.locked || controlsBlocked()) return;
    const sensitivity = 0.0045 * this.settings.mouseSensitivity;
    this.stickX = clamp(this.stickX + event.movementX * sensitivity, -1, 1);
    this.stickY = clamp(this.stickY + event.movementY * sensitivity, -1, 1);
  };

  private onLockChange = () => {
    this.locked = document.pointerLockElement === this.element;
    if (!this.locked) {
      this.stickX = 0;
      this.stickY = 0;
    }
  };

  /** Is the hover button held? (F, or the gamepad's B / circle) */
  get hovering(): boolean {
    return !!this.key("hover") || !!this.padButtons[1];
  }

  private binding(action: BindingAction): string[] {
    return (this.settings.bindings ?? DEFAULT_BINDINGS)[action];
  }

  private key(action: BindingAction): number {
    return this.binding(action).some((code) => this.keys.has(code)) ? 1 : 0;
  }

  sample(dt: number): FlightInput {
    if (controlsBlocked() || !document.hasFocus()) { this.reset(); return { pitch: 0, roll: 0, boost: 0, brake: 0 }; }
    const recenter = Math.exp(-dt * 3.5);
    this.stickX *= recenter;
    this.stickY *= recenter;

    // Positive pitch = nose up. Forward on keys, mouse and stick dives.
    // (Moving the mouse up gives a negative movementY, like pushing a stick forward.)
    let pitch = (this.key("pitchUp") - this.key("pitchDown")) * (this.settings.invertPitch ? -1 : 1)
      + this.stickY * ((this.settings.invertMouse ?? this.settings.invertPitch) ? -1 : 1);
    let roll = this.key("turnRight") - this.key("turnLeft") + this.stickX;

    let boost = this.key("boost");
    let brake = this.key("brake");
    const pad = navigator.getGamepads?.().find((p) => p?.connected);
    if (pad) {
      roll += deadZone(pad.axes[0] ?? 0, this.settings.deadZone);
      pitch += deadZone(pad.axes[1] ?? 0, this.settings.deadZone) * ((this.settings.invertGamepad ?? this.settings.invertPitch) ? -1 : 1);
      // Y / triangle respawns, the shoulder buttons barrel roll
      const pressed = pad.buttons.map((b) => b.pressed);
      if (pressed[3] && !this.padButtons[3]) this.onAction?.("respawn");
      if (pressed[4] && !this.padButtons[4]) this.onAction?.("barrelLeft");
      if (pressed[5] && !this.padButtons[5]) this.onAction?.("barrelRight");
      // A flaps and B hovers in adventure; triggers control speed in every mode.
      if (pressed[0] && !this.padButtons[0]) this.onAction?.("flap");
      boost = Math.max(boost, deadZone(pad.buttons[7]?.value ?? 0));
      brake = Math.max(brake, deadZone(pad.buttons[6]?.value ?? 0));
      this.padButtons = pressed;
    } else {
      this.padButtons = [];
    }

    return { pitch: clamp(pitch, -1, 1), roll: clamp(roll, -1, 1), boost, brake };
  }
}
