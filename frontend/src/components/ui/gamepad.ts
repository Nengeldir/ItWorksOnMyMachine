import { type Direction, nextFocus } from "./nav";

// Gamepad navigation for the UI (plan F7): the D-pad (or the left stick) moves the focus, A presses,
// B goes back, the shoulders turn pages. Whatever opened last (a sheet, a radial menu) owns the pad: a
// stack of layers, polled with requestAnimationFrame only while one is open. A direction is first
// offered to the focused element as an arrow key (a grid moves inside itself); if nobody takes it, the
// focus jumps spatially to the nearest focusable thing that way inside the layer.

export interface NavLayer {
  root: HTMLElement;
  /** B */
  onBack?: () => void;
  /** Takes a direction before anything else does; return true when used (the radial menu) */
  onDirection?: (direction: Direction) => boolean;
  /** A, before it presses the focused element; return true when used */
  onConfirm?: () => boolean;
  /** LB / RB: -1 / +1 (tabs) */
  onShoulder?: (step: -1 | 1) => void;
}

const FOCUSABLE = 'button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/** The focusable elements in `root` that are on screen */
export function focusables(root: HTMLElement): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((el) => {
    if (el.closest("[inert]")) return false;
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  });
}

/** Moves the focus in `root` one step `direction`, spatially. True when it moved */
export function moveFocus(root: HTMLElement, direction: Direction): boolean {
  const list = focusables(root);
  if (!list.length) return false;
  const from = list.indexOf(document.activeElement as HTMLElement);
  if (from < 0) {
    list[0].focus();
    return true;
  }
  const to = nextFocus(list.map((el) => el.getBoundingClientRect()), from, direction);
  if (to < 0) return false;
  list[to].focus();
  list[to].scrollIntoView?.({ block: "nearest", inline: "nearest" });
  return true;
}

const ARROWS: Record<Direction, string> = { up: "ArrowUp", down: "ArrowDown", left: "ArrowLeft", right: "ArrowRight" };

function offerKey(key: string): boolean {
  const target = (document.activeElement as HTMLElement | null) ?? document.body;
  const event = new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true });
  target.dispatchEvent(event);
  return event.defaultPrevented;
}

const layers: NavLayer[] = [];
let frame = 0;
// Buttons held last poll, and when each direction repeats next
const held = new Set<string>();
const repeatAt: Partial<Record<Direction, number>> = {};
const REPEAT = { first: 380, then: 120 };

function pressed(pad: Gamepad, button: number) {
  return (pad.buttons[button]?.value ?? 0) > 0.5;
}

function poll(now: number) {
  frame = layers.length ? requestAnimationFrame(poll) : 0;
  const layer = layers.at(-1);
  const pad = navigator.getGamepads?.().find((p) => p?.connected);
  if (!layer || !pad) return;
  const x = pad.axes[0] ?? 0;
  const y = pad.axes[1] ?? 0;
  const directions: Record<Direction, boolean> = {
    up: pressed(pad, 12) || y < -0.6,
    down: pressed(pad, 13) || y > 0.6,
    left: pressed(pad, 14) || x < -0.6,
    right: pressed(pad, 15) || x > 0.6,
  };
  for (const direction of Object.keys(directions) as Direction[]) {
    if (!directions[direction]) {
      delete repeatAt[direction];
      continue;
    }
    const due = repeatAt[direction];
    if (due !== undefined && now < due) continue;
    repeatAt[direction] = now + (due === undefined ? REPEAT.first : REPEAT.then);
    if (layer.onDirection?.(direction)) continue;
    if (!offerKey(ARROWS[direction])) moveFocus(layer.root, direction);
  }
  const edge = (button: number, name: string) => {
    const down = pressed(pad, button);
    const was = held.has(name);
    if (down) held.add(name);
    else held.delete(name);
    return down && !was;
  };
  if (edge(0, "a") && !layer.onConfirm?.() && !offerKey("Enter")) (document.activeElement as HTMLElement | null)?.click();
  if (edge(1, "b")) layer.onBack?.();
  if (edge(4, "lb")) layer.onShoulder?.(-1);
  if (edge(5, "rb")) layer.onShoulder?.(1);
}

/** Gives the pad to `layer` until the returned function is called */
export function pushNavLayer(layer: NavLayer): () => void {
  layers.push(layer);
  // Buttons already down (the A that opened this) don't press again in the new layer
  const pad = navigator.getGamepads?.().find((p) => p?.connected);
  if (pad) {
    if (pressed(pad, 0)) held.add("a");
    if (pressed(pad, 1)) held.add("b");
  }
  if (!frame) frame = requestAnimationFrame(poll);
  return () => {
    const at = layers.indexOf(layer);
    if (at >= 0) layers.splice(at, 1);
    if (!layers.length && frame) {
      cancelAnimationFrame(frame);
      frame = 0;
    }
  };
}
