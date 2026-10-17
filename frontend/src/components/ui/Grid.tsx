import { type CSSProperties, type KeyboardEvent, type PointerEvent, type ReactNode, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { DRAG, DragTracker, capture, type SlotRef, sameSlot } from "./dnd";
import { useTouchMode } from "./hooks";
import { gridMove, isNavKey } from "./nav";
import { Slot, type SlotItem } from "./Slot";
import { STRINGS } from "./strings";
import { TipBottom, TipCard } from "./Tooltip";
import "./ui.css";

export interface GridProps {
  /** Names the grid in moves (`bag`, `storage`, `loom-inputs`) */
  id: string;
  label: string;
  items: readonly (SlotItem | null)[];
  columns: number;
  /** An item put in another slot (of this grid or another): the grid it came from is asked */
  onMove?: (from: SlotRef, to: SlotRef) => void;
  /** Whether the item from `from` may go to `to` (default: anywhere but where it is) */
  accepts?: (from: SlotRef, to: SlotRef) => boolean;
  /** A click, a tap or Space: the slot chosen */
  onSelect?: (index: number) => void;
  selected?: number;
  /** The item's card: shown on hover and keyboard focus, or as a bottom card after a tap on touch */
  details?: (item: SlotItem, index: number) => ReactNode;
}

// The item lifted by the keyboard (Enter), shared by every grid so it can be put down in another
interface Held {
  from: SlotRef;
  item: SlotItem;
  move?: GridProps["onMove"];
  accepts?: GridProps["accepts"];
}
let held: Held | null = null;
const heldListeners = new Set<() => void>();
const setHeld = (next: Held | null) => {
  held = next;
  heldListeners.forEach((listener) => listener());
};
const subscribeHeld = (listener: () => void) => {
  heldListeners.add(listener);
  return () => {
    heldListeners.delete(listener);
  };
};

/** The slot (of any grid) under a point on screen */
function slotAt(x: number, y: number): SlotRef | null {
  const el = document.elementFromPoint(x, y)?.closest<HTMLElement>("[data-grid][data-index]");
  return el ? { grid: el.dataset.grid!, index: Number(el.dataset.index) } : null;
}

const accepted = (h: { from: SlotRef; accepts?: GridProps["accepts"] }, to: SlotRef) => !sameSlot(h.from, to) && (h.accepts?.(h.from, to) ?? true);

/**
 * A grid of slots (plan F7). Mouse: drag an item to another slot (of any grid), click to choose, hover
 * for its card. Touch: rest a finger on an item to pick it up, then drag; tap for its card. Keyboard and
 * gamepad: arrows move, Enter lifts the item and Enter again puts it down (Escape cancels), Space chooses.
 */
export function Grid({ id, label, items, columns, onMove, accepts, onSelect, selected, details }: GridProps) {
  const touch = useTouchMode();
  const slots = useRef<(HTMLDivElement | null)[]>([]);
  const [focus, setFocus] = useState(0);
  const [keyboard, setKeyboard] = useState(false);
  // The slot whose card shows, and where it is on screen (measured in the handlers, not in render)
  const [hover, setHover] = useState<{ index: number; rect: DOMRect } | null>(null);
  const [focusRect, setFocusRect] = useState<DOMRect | null>(null);
  const [card, setCard] = useState(-1);
  const lifted = useSyncExternalStore(subscribeHeld, () => held);
  const tracker = useRef(new DragTracker());
  const press = useRef<{ index: number; timer: ReturnType<typeof setTimeout> | null } | null>(null);
  const [drag, setDrag] = useState<{ from: number; x: number; y: number; over: SlotRef | null } | null>(null);
  const [said, setSaid] = useState("");

  // While a finger drags an item the sheet mustn't scroll under it
  useEffect(() => {
    if (!drag || !touch) return;
    const stop = (event: TouchEvent) => event.preventDefault();
    window.addEventListener("touchmove", stop, { passive: false });
    return () => window.removeEventListener("touchmove", stop);
  }, [drag, touch]);
  // A held item is let go when its grid leaves
  useEffect(() => () => {
    if (held?.from.grid === id) setHeld(null);
  }, [id]);

  const indexOf = (target: EventTarget) => {
    const el = (target as HTMLElement).closest<HTMLElement>("[data-index]");
    return el && el.dataset.grid === id ? Number(el.dataset.index) : -1;
  };
  const endPress = () => {
    if (press.current?.timer) clearTimeout(press.current.timer);
    press.current = null;
  };
  const startDrag = (index: number, x: number, y: number) => {
    setDrag({ from: index, x, y, over: null });
    setCard(-1);
    setHover(null);
    navigator.vibrate?.(8);
  };

  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    setKeyboard(false);
    const index = indexOf(event.target);
    if (index < 0) return;
    setFocus(index);
    tracker.current.down(event.pointerType as "mouse" | "touch" | "pen", event.clientX, event.clientY, event.timeStamp);
    press.current = { index, timer: null };
    if (!items[index] || !onMove) return;
    capture(event.currentTarget, event.pointerId);
    if (event.pointerType === "touch") {
      const { clientX, clientY } = event;
      // Event times and performance.now() share a clock
      press.current.timer = setTimeout(() => {
        if (tracker.current.tick(performance.now() + 1)) startDrag(index, clientX, clientY);
      }, DRAG.longPress);
    }
  };
  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    const p = press.current;
    if (!p) {
      if (event.pointerType !== "mouse") return;
      const index = indexOf(event.target);
      if (index !== hover?.index) setHover(index < 0 ? null : { index, rect: slots.current[index]!.getBoundingClientRect() });
      return;
    }
    if (tracker.current.move(event.clientX, event.clientY, event.timeStamp) && items[p.index] && onMove) startDrag(p.index, event.clientX, event.clientY);
    if (tracker.current.phase === "idle") endPress();
    if (tracker.current.phase === "dragging") setDrag((d) => d && { ...d, x: event.clientX, y: event.clientY, over: slotAt(event.clientX, event.clientY) });
  };
  const onPointerUp = (event: PointerEvent<HTMLDivElement>) => {
    const p = press.current;
    endPress();
    const outcome = tracker.current.up();
    setDrag(null);
    if (!p) return;
    // The pressed slot, not the drag state: a quick flick lets go before React has drawn the drag
    if (outcome === "drop" && items[p.index] && onMove) {
      const to = slotAt(event.clientX, event.clientY);
      const from = { grid: id, index: p.index };
      if (to && accepted({ from, accepts }, to)) onMove?.(from, to);
    } else if (outcome === "tap") {
      onSelect?.(p.index);
      if (event.pointerType === "touch" && items[p.index] && details) setCard(p.index);
    }
  };
  const onPointerCancel = () => {
    endPress();
    tracker.current.cancel();
    setDrag(null);
  };

  const moveFocus = (index: number) => {
    setFocus(index);
    slots.current[index]?.focus();
  };
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const index = indexOf(event.target);
    if (index < 0) return;
    setKeyboard(true);
    if (isNavKey(event.key)) {
      const next = gridMove(index, event.key, columns, items.length);
      // At the edge the move isn't used: the gamepad's spatial focus (or the page) takes it on
      if (next === index || next < 0) return;
      event.preventDefault();
      moveFocus(next);
    } else if (event.key === "Enter") {
      event.preventDefault();
      const here = { grid: id, index };
      if (held) {
        const h = held;
        setHeld(null);
        if (accepted(h, here)) {
          h.move?.(h.from, here);
          setSaid("");
        }
      } else if (items[index] && onMove) {
        setHeld({ from: here, item: items[index]!, move: onMove, accepts });
        setSaid(STRINGS.holding(items[index]!.name));
      }
    } else if (event.key === "Escape" && held) {
      event.preventDefault();
      event.stopPropagation();
      setHeld(null);
      setSaid("");
    } else if (event.key === " ") {
      event.preventDefault();
      onSelect?.(index);
    }
  };

  const tip = !details || drag || touch ? null : keyboard ? (focusRect ? { index: focus, rect: focusRect } : null) : hover;
  const detailsItem = tip ? items[tip.index] : null;
  const cardItem = card >= 0 ? items[card] : null;
  return (
    <div
      className="ui-grid"
      role="group"
      aria-label={label}
      style={{ "--grid-columns": columns } as CSSProperties}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerCancel}
      onPointerLeave={() => !press.current && setHover(null)}
      onKeyDown={onKeyDown}
      onBlur={(event) => !event.currentTarget.contains(event.relatedTarget as Node) && setKeyboard(false)}
      onContextMenu={(event) => touch && event.preventDefault()}
    >
      {items.map((item, index) => {
        const here = { grid: id, index };
        return (
          <Slot
            key={index}
            ref={(el) => {
              slots.current[index] = el;
            }}
            item={item}
            data-grid={id}
            data-index={index}
            role="button"
            tabIndex={index === focus ? 0 : -1}
            onFocus={(event) => {
              setFocus(index);
              setFocusRect(event.currentTarget.getBoundingClientRect());
            }}
            selected={selected === index}
            lifted={(drag?.from === index) || (lifted !== null && sameSlot(lifted.from, here))}
            target={(drag?.over && sameSlot(drag.over, here) && accepted({ from: { grid: id, index: drag.from }, accepts }, here)) || (lifted !== null && index === focus && keyboard && accepted(lifted, here))}
          />
        );
      })}
      {drag && items[drag.from] && (
        <Slot item={items[drag.from]} className="ui-slot-ghost" style={{ left: drag.x, top: drag.y }} aria-hidden="true" />
      )}
      {tip && detailsItem && <TipCard anchor={tip.rect}>{details!(detailsItem, tip.index)}</TipCard>}
      {cardItem && <TipBottom onClose={() => setCard(-1)}>{details!(cardItem, card)}</TipBottom>}
      <span className="ui-sr" aria-live="polite">{said}</span>
    </div>
  );
}
