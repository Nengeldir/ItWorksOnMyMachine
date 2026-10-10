import type { FlightInput } from "./flight";
import { clamp } from "./math";
import { DEFAULT_BINDINGS, type Bindings, type BindingAction } from "./bindings";
import { tilt } from "./tilt";
export { keyLabel } from "./bindings";

export interface ControlSettings {
  invertPitch: boolean;
  mouseSensitivity: number; // 0.3..6, 2 = default
  invertMouse?: boolean;
  invertGamepad?: boolean;
  /** The touch stick and tilting: up / top away from you climbs instead of diving */
  invertTouch?: boolean;
  tiltSensitivity?: number; // 0.4..2.5, 1 = default
  bindings?: Bindings;
  deadZone?: number;
  reducedMotion?: boolean;
  quality?: "auto" | "high" | "medium" | "low";
  musicVolume?: number;
  effectsVolume?: number;
  muted?: boolean;
}

/** URL test mode only: Shift+P, Shift+O, Shift+S, Shift+I */
export type TestAction = "portal" | "win" | "speed" | "item";

/**
 * One-off presses. Wingbeat, hover-stall, plunge, Gale Force, Resonance, Ascension and the stances need
 * their adventure upgrades; items (use, next) need something in the bag
 */
export type InputAction = "pause" | "respawn" | "mute" | "barrelLeft" | "barrelRight" | "flap" | "hover" | "plunge" | "burst" | "resonance" | "ascend" | "stance" | "useItem" | "nextItem";

export interface InputObserver {
  sample?: (input: FlightInput) => void;
  action?: (action: InputAction) => void;
}

export function controlsBlocked(): boolean {
  return !!document.querySelector?.("dialog[open]");
}
const ACTIONS: InputAction[] = ["pause", "respawn", "mute", "barrelLeft", "barrelRight", "flap", "hover", "plunge", "burst", "resonance", "ascend", "stance", "useItem", "nextItem"];
/** The mouse wheel cycles items at most this often (ms): one notch of a free-spinning wheel is many events */
const WHEEL_GAP = 160;

function deadZone(value: number, threshold = 0.12): number {
  if (Math.abs(value) < threshold) return 0;
  return (value - Math.sign(value) * threshold) / (1 - threshold);
}

// Tilting the phone: how far is full deflection, and how much of it around level does nothing
const TILT_ROLL = 0.5; // radians, about 29°
const TILT_PITCH = 0.36; // about 21°
const TILT_DEAD = 0.035; // about 2°

function tiltAxis(angle: number, full: number, sensitivity: number): number {
  const beyond = Math.max(0, Math.abs(angle) - TILT_DEAD);
  return clamp((Math.sign(angle) * beyond * sensitivity) / (full - TILT_DEAD), -1, 1);
}

function isTyping(event: KeyboardEvent): boolean {
  const target = event.target as HTMLElement | null;
  return !!target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.tagName === "SELECT" || target.isContentEditable);
}

/**
 * Keyboard, mouse (pointer lock), gamepad, the touch stick and buttons
 * (`TouchControls`) and tilting the phone (`tilt`), merged into pitch and roll.
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
  private readonly observers = new Set<InputObserver>();
  // The mouse moves a virtual stick that drifts back to center
  private stickX = 0;
  private stickY = 0;
  private padButtons: boolean[] = [];
  // The on-screen stick (-1..1, down and right positive) and held buttons, set by TouchControls
  touchX = 0;
  touchY = 0;
  touchBoost = false;
  touchBrake = false;
  /** The right mouse button, held (while the pointer is locked it uses items) */
  private mouseUse = false;
  private lastWheel = 0;

  constructor(element: HTMLElement, settings: ControlSettings) {
    this.element = element;
    this.settings = settings;
    window.addEventListener("keydown", this.onKeyDown);
    window.addEventListener("keyup", this.onKeyUp);
    window.addEventListener("blur", this.onBlur);
    document.addEventListener("mousemove", this.onMouseMove);
    document.addEventListener("mousedown", this.onMouseDown);
    document.addEventListener("mouseup", this.onMouseUp);
    document.addEventListener("wheel", this.onWheel, { passive: true });
    document.addEventListener("pointerlockchange", this.onLockChange);
    document.addEventListener("contextmenu", this.onContextMenu);
  }

  dispose() {
    this.observers.clear();
    window.removeEventListener("keydown", this.onKeyDown);
    window.removeEventListener("keyup", this.onKeyUp);
    window.removeEventListener("blur", this.onBlur);
    document.removeEventListener("mousemove", this.onMouseMove);
    document.removeEventListener("mousedown", this.onMouseDown);
    document.removeEventListener("mouseup", this.onMouseUp);
    document.removeEventListener("wheel", this.onWheel);
    document.removeEventListener("pointerlockchange", this.onLockChange);
    document.removeEventListener("contextmenu", this.onContextMenu);
    if (document.pointerLockElement === this.element) document.exitPointerLock();
  }

  /** Watch what the pilot actually receives (used by the tutorial). */
  observe(observer: InputObserver): () => void {
    this.observers.add(observer);
    return () => { this.observers.delete(observer); };
  }

  dispatchAction(action: InputAction) {
    if (controlsBlocked() || !document.hasFocus()) return;
    for (const observer of this.observers) observer.action?.(action);
    this.onAction?.(action);
  }

  /** Call from a click handler: browsers only lock the pointer on a user gesture */
  lockPointer() {
    // Phones have no pointer to lock (and Safari there has no such method)
    if (document.pointerLockElement !== this.element) {
      this.element.requestPointerLock?.()?.catch?.(() => {});
    }
  }

  releasePointer() {
    if (document.pointerLockElement === this.element) document.exitPointerLock();
  }

  private onKeyDown = (event: KeyboardEvent) => {
    if (event.defaultPrevented || controlsBlocked() || isTyping(event)) return;
    if (this.onTestAction && event.shiftKey && !event.ctrlKey && !event.altKey && !event.metaKey) {
      const action = event.code === "KeyP" ? "portal" : event.code === "KeyO" ? "win" : event.code === "KeyS" ? "speed" : event.code === "KeyI" ? "item" : null;
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
    for (const action of ACTIONS) {
      if (this.binding(action).includes(event.code)) {
        if (atGame || action === "pause") event.preventDefault();
        this.dispatchAction(action);
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
    this.touchX = this.touchY = 0;
    this.touchBoost = this.touchBrake = false;
    this.mouseUse = false;
  }

  // Flying with the mouse, the right button uses an item and the wheel picks the next one
  private onMouseDown = (event: MouseEvent) => {
    if (!this.locked || controlsBlocked() || event.button !== 2) return;
    this.mouseUse = true;
    this.onAction?.("useItem");
  };

  private onMouseUp = (event: MouseEvent) => {
    if (event.button === 2) this.mouseUse = false;
  };

  private onWheel = (event: WheelEvent) => {
    if (!this.locked || controlsBlocked() || Math.abs(event.deltaY) < 1) return;
    const now = performance.now();
    if (now - this.lastWheel < WHEEL_GAP) return;
    this.lastWheel = now;
    this.onAction?.("nextItem");
  };

  private onContextMenu = (event: Event) => {
    if (this.locked && event.target === this.element) event.preventDefault();
  };

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

  private binding(action: BindingAction): string[] {
    return (this.settings.bindings ?? DEFAULT_BINDINGS)[action];
  }

  private key(action: BindingAction): number {
    return this.binding(action).some((code) => this.keys.has(code)) ? 1 : 0;
  }

  sample(dt: number): FlightInput {
    if (controlsBlocked() || !document.hasFocus()) { this.reset(); return { pitch: 0, roll: 0, boost: 0, brake: 0, use: 0 }; }
    const recenter = Math.exp(-dt * 3.5);
    this.stickX *= recenter;
    this.stickY *= recenter;

    // Positive pitch = nose up. Forward on keys, mouse and stick dives.
    // (Moving the mouse up gives a negative movementY, like pushing a stick forward.)
    let pitch = (this.key("pitchUp") - this.key("pitchDown")) * (this.settings.invertPitch ? -1 : 1)
      + this.stickY * ((this.settings.invertMouse ?? this.settings.invertPitch) ? -1 : 1);
    let roll = this.key("turnRight") - this.key("turnLeft") + this.stickX;

    const touchSign = this.settings.invertTouch ? -1 : 1;
    pitch += this.touchY * touchSign;
    roll += this.touchX;
    if (tilt.active) {
      const sensitivity = this.settings.tiltSensitivity ?? 1;
      roll += tiltAxis(tilt.roll, TILT_ROLL, sensitivity);
      pitch += tiltAxis(tilt.pitch, TILT_PITCH, sensitivity) * touchSign;
    }

    let boost = this.touchBoost ? 1 : this.key("boost");
    let brake = this.touchBrake ? 1 : this.key("brake");
    let use = Math.max(this.key("useItem"), this.mouseUse ? 1 : 0);
    const pad = navigator.getGamepads?.().find((p) => p?.connected);
    if (pad) {
      roll += deadZone(pad.axes[0] ?? 0, this.settings.deadZone);
      pitch += deadZone(pad.axes[1] ?? 0, this.settings.deadZone) * ((this.settings.invertGamepad ?? this.settings.invertPitch) ? -1 : 1);
      // Y / triangle respawns, the shoulder buttons barrel roll
      const pressed = pad.buttons.map((b) => b.pressed);
      if (pressed[3] && !this.padButtons[3]) this.dispatchAction("respawn");
      if (pressed[4] && !this.padButtons[4]) this.dispatchAction("barrelLeft");
      if (pressed[5] && !this.padButtons[5]) this.dispatchAction("barrelRight");
      // In adventure: A flaps, B hover-stalls, X plunges, the right stick's click is Gale Force,
      // the left stick's click sings (Resonance), d-pad up ascends, d-pad down changes stance,
      // d-pad right uses the item and d-pad left picks the next one.
      // Triggers control speed in every mode.
      if (pressed[0] && !this.padButtons[0]) this.dispatchAction("flap");
      if (pressed[1] && !this.padButtons[1]) this.dispatchAction("hover");
      if (pressed[2] && !this.padButtons[2]) this.dispatchAction("plunge");
      if (pressed[11] && !this.padButtons[11]) this.dispatchAction("burst");
      if (pressed[10] && !this.padButtons[10]) this.dispatchAction("resonance");
      if (pressed[12] && !this.padButtons[12]) this.dispatchAction("ascend");
      if (pressed[13] && !this.padButtons[13]) this.dispatchAction("stance");
      if (pressed[15] && !this.padButtons[15]) this.dispatchAction("useItem");
      if (pressed[14] && !this.padButtons[14]) this.dispatchAction("nextItem");
      if (pressed[15]) use = 1;
      boost = Math.max(boost, deadZone(pad.buttons[7]?.value ?? 0));
      brake = Math.max(brake, deadZone(pad.buttons[6]?.value ?? 0));
      this.padButtons = pressed;
    } else {
      this.padButtons = [];
    }

    const sample = { pitch: clamp(pitch, -1, 1), roll: clamp(roll, -1, 1), boost, brake, use };
    for (const observer of this.observers) observer.sample?.(sample);
    return sample;
  }
}
