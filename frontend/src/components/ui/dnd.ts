// Dragging items between slots (plan F7), as pure logic. A mouse or pen picks an item up once it has
// moved a few pixels; a finger has to rest on it first (a long press), because a finger that moves at
// once is scrolling the sheet. The `Grid` feeds pointer events in and acts on what comes out.

export const DRAG = {
  /** px a mouse or pen moves before the press becomes a drag */
  mouseSlop: 6,
  /** ms a finger rests before the item is picked up */
  longPress: 350,
  /** px a finger may wander during the long press before it counts as a scroll */
  touchSlop: 10,
};

export type DragPhase = "idle" | "pressed" | "dragging";
/** What a press ended as: a tap (inspect / select), a drop (move), or nothing (scrolled, cancelled) */
export type DragOutcome = "tap" | "drop" | "cancel";

export class DragTracker {
  phase: DragPhase = "idle";
  private touch = false;
  private startX = 0;
  private startY = 0;
  private startAt = 0;
  x = 0;
  y = 0;

  down(pointer: "mouse" | "pen" | "touch", x: number, y: number, at: number) {
    this.phase = "pressed";
    this.touch = pointer === "touch";
    this.startX = this.x = x;
    this.startY = this.y = y;
    this.startAt = at;
  }

  /** Returns true when this move started the drag */
  move(x: number, y: number, at: number): boolean {
    this.x = x;
    this.y = y;
    if (this.phase !== "pressed") return false;
    const moved = Math.hypot(x - this.startX, y - this.startY);
    if (this.touch) {
      if (moved > DRAG.touchSlop && at - this.startAt < DRAG.longPress) this.phase = "idle";
      return false;
    }
    if (moved > DRAG.mouseSlop) {
      this.phase = "dragging";
      return true;
    }
    return false;
  }

  /** Call while pressed (a timer): a finger that rested long enough picks the item up. True when it did */
  tick(at: number): boolean {
    if (this.phase !== "pressed" || !this.touch || at - this.startAt < DRAG.longPress) return false;
    this.phase = "dragging";
    return true;
  }

  up(): DragOutcome {
    const was = this.phase;
    this.phase = "idle";
    return was === "dragging" ? "drop" : was === "pressed" ? "tap" : "cancel";
  }

  cancel() {
    this.phase = "idle";
  }
}

/** Where an item is: a grid (bag, storage, a station's inputs) and a slot in it */
export interface SlotRef { grid: string; index: number }

export const sameSlot = (a: SlotRef, b: SlotRef) => a.grid === b.grid && a.index === b.index;

/** Keeps a pointer's events coming to `el`; a pointer that is already gone (or a scripted one) can't be held */
export function capture(el: Element, pointerId: number) {
  try {
    el.setPointerCapture(pointerId);
  } catch {
    // Not capturable: its events still arrive while it stays over the element
  }
}
