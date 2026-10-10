import { clamp } from "./math";

// Steering by tilting the phone, from the device orientation sensor. One
// device, so one shared sensor: `tilt`. Input reads `roll` and `pitch`.

const WANTED_KEY = "wingrace.tilt";
const SMOOTHING = 0.35; // share of each new reading taken (the sensor is noisy)
const DEG = Math.PI / 180;

export interface TiltAngles {
  /** How far the screen's right edge has dropped below its left, radians (turning a wheel clockwise is positive) */
  roll: number;
  /** How far the screen leans from lying flat, face up: 0 flat, π/2 upright, radians */
  lean: number;
}

/**
 * Roll and lean of the screen from a device orientation reading (degrees, as
 * the event gives them) and the screen's rotation (`screen.orientation.angle`).
 * Worked out from the direction of gravity, so it has no jumps where the
 * event's own angles flip (gamma at ±90° in landscape).
 */
export function tiltAngles(beta: number, gamma: number, screenAngle: number, out: TiltAngles): TiltAngles {
  const b = beta * DEG, g = gamma * DEG, a = screenAngle * DEG;
  // Gravity in the device's frame (x right, y up the portrait screen, z out of it)
  const gx = Math.sin(g) * Math.cos(b), gy = -Math.sin(b), gz = -Math.cos(g) * Math.cos(b);
  // ...and in the frame of the screen as it is turned now
  const sx = gx * Math.cos(a) - gy * Math.sin(a);
  const sy = gx * Math.sin(a) + gy * Math.cos(a);
  out.roll = Math.asin(clamp(sx, -1, 1));
  out.lean = Math.atan2(Math.hypot(sx, sy), -gz);
  return out;
}

type PermissionApi = { requestPermission?: () => Promise<"granted" | "denied"> };

class Tilt {
  /** Readings are arriving */
  active = false;
  /** Radians; pitch is the lean since the last `recenter` (leaning the top towards you is positive) */
  roll = 0;
  pitch = 0;
  private listening = false;
  private neutral: number | null = null;
  private readonly angles: TiltAngles = { roll: 0, lean: 0 };
  private remembered: boolean | null = null;

  /** The player turned tilt steering on (kept for the next visit) */
  get wanted(): boolean {
    if (this.remembered === null) {
      try {
        this.remembered = localStorage.getItem(WANTED_KEY) === "1";
      } catch {
        this.remembered = false;
      }
    }
    return this.remembered;
  }

  private remember(on: boolean) {
    this.remembered = on;
    try {
      localStorage.setItem(WANTED_KEY, on ? "1" : "0");
    } catch {
      // Not persisted, still works for this visit
    }
  }

  /** Does this browser have the sensor at all? (It may still refuse, or never report) */
  get supported(): boolean {
    return typeof window !== "undefined" && "DeviceOrientationEvent" in window && window.isSecureContext !== false;
  }

  /** iOS only hands out readings after asking, and only from a tap */
  get needsGesture(): boolean {
    return this.supported && typeof (DeviceOrientationEvent as unknown as PermissionApi).requestPermission === "function";
  }

  /**
   * Turns tilt steering on. Call from a tap (iOS asks for permission, and only
   * then). Resolves to whether the sensor may be read; `active` follows with
   * the first reading.
   */
  async enable(): Promise<boolean> {
    if (!this.supported) return false;
    const api = DeviceOrientationEvent as unknown as PermissionApi;
    if (api.requestPermission) {
      try {
        if ((await api.requestPermission()) !== "granted") return false;
      } catch {
        return false;
      }
    }
    this.remember(true);
    this.listen();
    return true;
  }

  /** Picks tilt steering up again on a later visit, if it was on. Needs a tap on iOS */
  resume(fromGesture: boolean) {
    if (!this.wanted || this.listening || !this.supported) return;
    if (this.needsGesture) {
      if (fromGesture) void this.enable();
    } else {
      this.listen();
    }
  }

  disable() {
    this.remember(false);
    if (this.listening) window.removeEventListener("deviceorientation", this.onOrientation);
    this.listening = this.active = false;
    this.roll = this.pitch = 0;
  }

  /** The way the phone is held now becomes level flight */
  recenter() {
    this.neutral = null;
    this.pitch = 0;
  }

  private listen() {
    if (this.listening) return;
    this.listening = true;
    this.recenter();
    window.addEventListener("deviceorientation", this.onOrientation);
  }

  private onOrientation = (event: DeviceOrientationEvent) => {
    // Desktop browsers fire one empty event: no sensor
    if (event.beta === null || event.gamma === null) return;
    const turned = screen.orientation?.angle ?? (window as { orientation?: number }).orientation ?? 0;
    const { roll, lean } = tiltAngles(event.beta, event.gamma, turned, this.angles);
    if (this.neutral === null || !this.active) {
      this.neutral = lean;
      this.roll = roll;
      this.pitch = 0;
    } else {
      this.roll += (roll - this.roll) * SMOOTHING;
      this.pitch += (lean - this.neutral - this.pitch) * SMOOTHING;
    }
    this.active = true;
  };
}

export const tilt = new Tilt();
