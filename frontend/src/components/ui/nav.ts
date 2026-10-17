// The UI primitives' pure logic (plan F7), kept apart from React so node tests can run it: the layout
// breakpoints, where a sheet goes, the grid's keyboard model, spatial focus moves (the gamepad's D-pad)
// and the radial menu's wedges.

/** Plan §5: by the game container's size. `short` wins over the widths (a phone held sideways) */
export type Breakpoint = "wide" | "medium" | "compact" | "short";

export function breakpoint(width: number, height: number): Breakpoint {
  if (height < 480) return "short";
  if (width < 760) return "compact";
  if (width < 1100) return "medium";
  return "wide";
}

/** Where a sheet opens: a full-height side sheet on wide, a centred panel on medium, a bottom sheet below */
export type SheetPlacement = "side" | "centre" | "bottom";

export function sheetPlacement(at: Breakpoint, wanted: "auto" | SheetPlacement = "auto"): SheetPlacement {
  // A side sheet needs the room; asked for on a phone it becomes the bottom sheet
  if (wanted === "side") return at === "wide" || at === "medium" ? "side" : "bottom";
  if (wanted !== "auto") return wanted;
  return at === "wide" ? "side" : at === "medium" ? "centre" : "bottom";
}

/** A bottom sheet's drag handle: let go past this far down, or flicked down this fast, and it closes */
export const SHEET_DISMISS = { distance: 96, speed: 0.6 /* px per ms */ };

export function sheetDismissed(dragged: number, speed: number): boolean {
  return dragged > SHEET_DISMISS.distance || (dragged > 16 && speed > SHEET_DISMISS.speed);
}

export type NavKey = "ArrowUp" | "ArrowDown" | "ArrowLeft" | "ArrowRight" | "Home" | "End" | "PageUp" | "PageDown";

export const isNavKey = (key: string): key is NavKey =>
  key === "ArrowUp" || key === "ArrowDown" || key === "ArrowLeft" || key === "ArrowRight" || key === "Home" || key === "End" || key === "PageUp" || key === "PageDown";

/**
 * The grid's keyboard model: the slot that `key` moves to from `index` in a grid of `count` slots,
 * `columns` wide. Left and right run on along the rows; up and down stay in their column and stop at
 * the edge (returning `index`, so the caller can hand the move on, e.g. to the next grid). Home and End
 * go to the row's ends, PageUp and PageDown to the column's.
 */
export function gridMove(index: number, key: NavKey, columns: number, count: number): number {
  if (count <= 0) return -1;
  const cols = Math.max(1, Math.floor(columns));
  const at = Math.max(0, Math.min(count - 1, index));
  const row = Math.floor(at / cols);
  const lastRow = Math.floor((count - 1) / cols);
  switch (key) {
    case "ArrowLeft": return Math.max(0, at - 1);
    case "ArrowRight": return Math.min(count - 1, at + 1);
    case "ArrowUp": return row > 0 ? at - cols : at;
    case "ArrowDown": return at + cols < count ? at + cols : row < lastRow ? count - 1 : at;
    case "Home": return row * cols;
    case "End": return Math.min(count - 1, row * cols + cols - 1);
    case "PageUp": return at % cols;
    case "PageDown": {
      const bottom = lastRow * cols + (at % cols);
      return bottom < count ? bottom : bottom - cols;
    }
  }
}

export interface Box { x: number; y: number; width: number; height: number }
export type Direction = "up" | "down" | "left" | "right";

/**
 * Spatial focus: of `boxes`, the one to move to from `from` going `direction` (-1: none that way). Only
 * boxes whose centre lies ahead count; the score favours the nearest along the way and punishes the
 * sideways offset twice as hard, so a D-pad press goes where the eye expects
 */
export function nextFocus(boxes: readonly Box[], from: number, direction: Direction): number {
  const origin = boxes[from];
  if (!origin) return boxes.length ? 0 : -1;
  const ox = origin.x + origin.width / 2;
  const oy = origin.y + origin.height / 2;
  let best = -1;
  let bestScore = Infinity;
  for (let i = 0; i < boxes.length; i++) {
    if (i === from) continue;
    const b = boxes[i];
    const dx = b.x + b.width / 2 - ox;
    const dy = b.y + b.height / 2 - oy;
    const along = direction === "up" ? -dy : direction === "down" ? dy : direction === "left" ? -dx : dx;
    const across = direction === "up" || direction === "down" ? Math.abs(dx) : Math.abs(dy);
    if (along <= 1) continue;
    const score = along + across * 2;
    if (score < bestScore) {
      bestScore = score;
      best = i;
    }
  }
  return best;
}

/**
 * The radial menu's wedge under a pointer or stick offset (dx right, dy down, any unit) of `count`
 * wedges, the first centred straight up and going clockwise. Inside `deadZone` (same unit) none (-1)
 */
export function wedgeAt(dx: number, dy: number, count: number, deadZone = 0): number {
  if (count <= 0 || Math.hypot(dx, dy) <= deadZone) return -1;
  const turn = (Math.atan2(dx, -dy) / (Math.PI * 2) + 1) % 1; // 0 up, 0.25 right
  return Math.floor((turn * count + 0.5) % count);
}

/** A wedge's centre direction as a unit vector (x right, y down), for laying out labels */
export function wedgeDirection(index: number, count: number): { x: number; y: number } {
  const angle = (index / count) * Math.PI * 2;
  return { x: Math.sin(angle), y: -Math.cos(angle) };
}

/** The next tab `step` away, wrapping round */
export function tabStep<T>(tabs: readonly { id: T }[], value: T, step: number): T {
  const at = Math.max(0, tabs.findIndex((t) => t.id === value));
  return tabs[(((at + step) % tabs.length) + tabs.length) % tabs.length].id;
}
