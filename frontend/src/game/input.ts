import type { FlightInput } from "./flight";
import { clamp } from "./math";

export interface ControlSettings {
  invertPitch: boolean;
  mouseSensitivity: number; // 0.25..3, 1 = default
}

/** One-off presses. Wingbeat needs its adventure upgrade. */
export type InputAction = "pause" | "respawn" | "mute" | "barrelLeft" | "barrelRight" | "flap";

/** KeyboardEvent.code bindings. Change these here; control hints use the same values. */
export const KEY_BINDINGS = { pause: "KeyP" } as const;

export function keyLabel(code: string): string {
  return code.replace(/^(Key|Digit)/, "");
}

const DEAD_ZONE = 0.12;

function deadZone(value: number): number {
  if (Math.abs(value) < DEAD_ZONE) return 0;
  return (value - Math.sign(value) * DEAD_ZONE) / (1 - DEAD_ZONE);
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
  /** Optional mode-specific shortcuts take precedence over normal bindings. */
  onShortcut?: (event: KeyboardEvent) => boolean;
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
    if (isTyping(event)) return;
    if (this.onShortcut?.(event)) {
      event.preventDefault();
      return;
    }
    if (event.repeat && !this.keys.has(event.code)) return;
    this.keys.add(event.code);
    // Arrow keys would scroll the page; leave them alone on buttons and panels
    const target = event.target as HTMLElement | null;
    const atGame = !target || target === document.body || target === this.element;
    if (atGame && (event.code.startsWith("Arrow") || event.code === "Space")) event.preventDefault();
    if (event.repeat) return;
    if (event.code === KEY_BINDINGS.pause) {
      event.preventDefault();
      this.onAction?.("pause");
      return;
    }
    if (event.code === "KeyR") this.onAction?.("respawn");
    if (event.code === "KeyM") this.onAction?.("mute");
    // Explicit barrel rolls only: steering taps should never trigger a stunt.
    if (event.code === "KeyQ") this.onAction?.("barrelLeft");
    if (event.code === "KeyE") this.onAction?.("barrelRight");

    if (event.code === "KeyC") {
      if (atGame) event.preventDefault();
      this.onAction?.("flap");
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
    if (!this.locked) return;
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
    return this.keys.has("KeyF") || this.padButtons[1];
  }

  private key(...codes: string[]): number {
    return codes.some((code) => this.keys.has(code)) ? 1 : 0;
  }

  sample(dt: number): FlightInput {
    if (!document.hasFocus()) { this.reset(); return { pitch: 0, roll: 0, boost: 0, brake: 0 }; }
    const recenter = Math.exp(-dt * 3.5);
    this.stickX *= recenter;
    this.stickY *= recenter;

    // Positive pitch = nose up. Forward on keys, mouse and stick dives.
    // (Moving the mouse up gives a negative movementY, like pushing a stick forward.)
    let pitch = this.key("KeyS", "ArrowDown") - this.key("KeyW", "ArrowUp") + this.stickY;
    let roll = this.key("KeyD", "ArrowRight") - this.key("KeyA", "ArrowLeft") + this.stickX;

    let boost = this.key("ShiftLeft", "ShiftRight");
    let brake = this.key("Space");
    const pad = navigator.getGamepads?.().find((p) => p?.connected);
    if (pad) {
      roll += deadZone(pad.axes[0] ?? 0);
      pitch += deadZone(pad.axes[1] ?? 0);
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

    if (this.settings.invertPitch) pitch = -pitch;
    return { pitch: clamp(pitch, -1, 1), roll: clamp(roll, -1, 1), boost, brake };
  }
}
