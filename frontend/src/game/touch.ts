import type { Input, InputAction } from "./input";

// Phones and tablets: a stick that appears under your thumb anywhere on the
// view, and buttons for everything the keyboard does in flight. Shown only in
// touch mode (`html.touch`, see `watchTouchMode`); styled in
// components/Touch.css. It feeds `Input`, nothing else.

const STICK_RADIUS = 56; // px of thumb travel for full deflection

type OrientationLock = { lock?: (orientation: string) => Promise<void> };
type WakeLock = { release(): Promise<void> };

/**
 * Keeps `html.touch` in step with how the player is pointing: on from the
 * start on phones and tablets, and switching with the last press elsewhere
 * (a laptop with a touch screen)
 */
export function watchTouchMode() {
  const root = document.documentElement;
  root.classList.toggle("touch", window.matchMedia?.("(pointer: coarse)").matches ?? false);
  window.addEventListener("pointerdown", (event) => {
    if (event.pointerType === "touch") root.classList.add("touch");
    else if (event.pointerType === "mouse") root.classList.remove("touch");
  }, true);
}

function button(className: string, label: string, title: string): HTMLButtonElement {
  const element = document.createElement("button");
  element.type = "button";
  element.className = className;
  element.textContent = label;
  element.setAttribute("aria-label", title);
  return element;
}

/** A button held down: the finger on it, or -1 */
interface Held {
  element: HTMLElement;
  pointer: number;
}

export class TouchControls {
  private readonly root = document.createElement("div");
  private readonly stick = document.createElement("div");
  private readonly knob = document.createElement("div");
  private readonly pause = button("touch-pill", "Pause", "Pause");
  private readonly flap = button("touch-button", "Flap", "Wingbeat");
  private readonly hover = button("touch-button", "Hover", "Hover");
  private readonly plunge = button("touch-button", "Plunge", "Plunging Attack");
  private readonly gale = button("touch-button", "Gale", "Gale Force");
  private readonly boost: Held;
  private readonly brake: Held;
  private readonly canvas: HTMLElement;
  private readonly input: Input;
  private stickPointer = -1;
  private stickX = 0;
  private stickY = 0;
  private wentFullscreen = false;
  private askedFullscreen = false;
  private wakeLock: WakeLock | null = null;
  private waking = false;
  private paused = false;

  constructor(container: HTMLElement, canvas: HTMLElement, input: Input) {
    this.canvas = canvas;
    this.input = input;
    this.root.className = "touch-controls";
    this.stick.className = "touch-stick";
    this.knob.className = "touch-knob";
    this.stick.appendChild(this.knob);

    const top = document.createElement("div");
    top.className = "touch-top";
    const respawn = button("touch-pill", "Respawn", "Respawn");
    top.append(respawn, this.pause);

    const pad = document.createElement("div");
    pad.className = "touch-pad";
    const left = button("touch-button small", "‹", "Dodge left");
    const right = button("touch-button small", "›", "Dodge right");
    const brake = button("touch-button", "Brake", "Brake");
    const boost = button("touch-button big", "Boost", "Boost");
    this.flap.hidden = this.hover.hidden = this.plunge.hidden = this.gale.hidden = true;
    // Laid out from the bottom right corner, leftwards and then up
    pad.append(boost, brake, right, left, this.hover, this.flap, this.plunge, this.gale);
    this.root.append(this.stick, top, pad);
    container.appendChild(this.root);

    this.boost = this.hold(boost);
    this.brake = this.hold(brake);
    this.press(left, "barrelLeft");
    this.press(right, "barrelRight");
    this.press(this.flap, "flap");
    this.press(this.hover, "hover");
    this.press(this.plunge, "plunge");
    this.press(this.gale, "burst");
    this.press(respawn, "respawn");
    this.pause.addEventListener("click", () => input.dispatchAction("pause", true));
    // A long press must stay a held button, never a menu that takes the finger away
    this.root.addEventListener("contextmenu", this.noMenu);

    canvas.addEventListener("pointerdown", this.onStickDown);
    canvas.addEventListener("pointermove", this.onStickMove);
    canvas.addEventListener("pointerup", this.onStickUp);
    canvas.addEventListener("pointercancel", this.onStickUp);
    window.addEventListener("pointerup", this.onRelease, true);
    window.addEventListener("pointercancel", this.onRelease, true);
    window.addEventListener("pointerup", this.onGesture, true);
    document.addEventListener("visibilitychange", this.onVisibility);
  }

  dispose() {
    this.canvas.removeEventListener("pointerdown", this.onStickDown);
    this.canvas.removeEventListener("pointermove", this.onStickMove);
    this.canvas.removeEventListener("pointerup", this.onStickUp);
    this.canvas.removeEventListener("pointercancel", this.onStickUp);
    window.removeEventListener("pointerup", this.onRelease, true);
    window.removeEventListener("pointercancel", this.onRelease, true);
    window.removeEventListener("pointerup", this.onGesture, true);
    document.removeEventListener("visibilitychange", this.onVisibility);
    this.input.touchBoost = this.input.touchBrake = false;
    void this.wakeLock?.release().catch(() => {});
    this.wakeLock = null;
    if (this.wentFullscreen && document.fullscreenElement) void document.exitFullscreen().catch(() => {});
    this.root.remove();
  }

  /** From the game, a few times a second: what to show */
  sync(paused: boolean, flying: boolean, flap: boolean, hover: boolean, plunge: boolean, gale: boolean) {
    if (paused !== this.paused) {
      this.paused = paused;
      this.root.classList.toggle("paused", paused);
      this.pause.textContent = paused ? "Resume" : "Pause";
      this.pause.setAttribute("aria-label", paused ? "Resume" : "Pause");
      if (paused) {
        this.releaseStick();
        this.let(this.boost);
        this.let(this.brake);
      }
    }
    if (!flying) {
      this.let(this.boost);
      this.let(this.brake);
    }
    this.root.classList.toggle("idle", !flying);
    this.flap.hidden = !flap;
    this.hover.hidden = !hover;
    this.plunge.hidden = !plunge;
    this.gale.hidden = !gale;
  }

  /**
   * Every frame, before the input is read: a finger still on Boost or Brake
   * keeps it on, whatever let go of the other held controls meanwhile (a
   * respawn, the window losing focus for a moment)
   */
  update() {
    this.input.touchBoost = this.boost.pointer !== -1;
    this.input.touchBrake = this.brake.pointer !== -1;
  }

  /**
   * A button that acts for as long as a finger is on it. Only that finger
   * lifting (or the browser taking it away) lets go, wherever on the page the
   * event lands: no reliance on pointer capture, which some browsers drop
   * mid-hold
   */
  private hold(element: HTMLElement): Held {
    const held: Held = { element, pointer: -1 };
    element.addEventListener("pointerdown", (event) => {
      event.preventDefault();
      if (held.pointer !== -1) return;
      held.pointer = event.pointerId;
      element.classList.add("held");
      this.update();
    });
    return held;
  }

  private let(held: Held) {
    held.pointer = -1;
    held.element.classList.remove("held");
  }

  private onRelease = (event: PointerEvent) => {
    if (event.pointerId === this.boost.pointer) this.let(this.boost);
    if (event.pointerId === this.brake.pointer) this.let(this.brake);
    this.update();
  };

  /** A button that acts the moment it is touched */
  private press(element: HTMLElement, action: InputAction) {
    element.addEventListener("pointerdown", (event) => {
      event.preventDefault();
      this.input.dispatchAction(action, true);
    });
  }

  private noMenu = (event: Event) => event.preventDefault();

  // --- the stick ---------------------------------------------------------------

  private onStickDown = (event: PointerEvent) => {
    if (event.pointerType !== "touch" || this.stickPointer !== -1 || this.paused) return;
    this.stickPointer = event.pointerId;
    this.canvas.setPointerCapture?.(event.pointerId);
    this.stickX = event.clientX;
    this.stickY = event.clientY;
    const box = this.root.getBoundingClientRect();
    this.stick.style.transform = `translate(${event.clientX - box.left}px, ${event.clientY - box.top}px)`;
    this.knob.style.transform = "";
    this.stick.classList.add("on");
  };

  private onStickMove = (event: PointerEvent) => {
    if (event.pointerId !== this.stickPointer) return;
    let x = (event.clientX - this.stickX) / STICK_RADIUS;
    let y = (event.clientY - this.stickY) / STICK_RADIUS;
    const length = Math.hypot(x, y);
    if (length > 1) {
      x /= length;
      y /= length;
    }
    this.input.touchX = x;
    this.input.touchY = y;
    this.knob.style.transform = `translate(${x * STICK_RADIUS}px, ${y * STICK_RADIUS}px)`;
  };

  private onStickUp = (event: PointerEvent) => {
    if (event.pointerId === this.stickPointer) this.releaseStick();
  };

  private releaseStick() {
    this.stickPointer = -1;
    this.input.touchX = this.input.touchY = 0;
    this.stick.classList.remove("on");
  }

  // --- the screen: sideways, full, and awake -------------------------------------

  /** A finished tap anywhere: the only moment a browser lets a page ask for these */
  private onGesture = (event: PointerEvent) => {
    if (event.pointerType !== "touch") return;
    void this.keepAwake();
    if (this.askedFullscreen) return;
    this.askedFullscreen = true;
    // Android turns the screen sideways for a full-screen page that asks; iOS has neither
    const page = document.documentElement;
    if (document.fullscreenElement || !page.requestFullscreen) return;
    page.requestFullscreen({ navigationUI: "hide" })
      .then(() => {
        this.wentFullscreen = true;
        return (screen.orientation as unknown as OrientationLock | undefined)?.lock?.("landscape");
      })
      .catch(() => {});
  };

  private async keepAwake() {
    // A long glide with a thumb resting on the stick: the screen would dim and lock
    const locks = (navigator as { wakeLock?: { request(type: "screen"): Promise<WakeLock> } }).wakeLock;
    if (this.wakeLock || this.waking || !locks) return;
    this.waking = true;
    try {
      const lock = await locks.request("screen");
      if (this.root.isConnected) this.wakeLock = lock;
      else void lock.release().catch(() => {});
    } catch {
      // Low battery or not allowed: the screen may dim
    }
    this.waking = false;
  }

  private onVisibility = () => {
    // The browser drops the wake lock when the page is hidden; the next tap takes it again
    if (document.visibilityState !== "visible") this.wakeLock = null;
  };
}
