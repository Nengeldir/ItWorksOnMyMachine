import { IconX } from "@tabler/icons-react";
import { type ReactElement, type ReactNode, useLayoutEffect, useRef, useState } from "react";
import { useTouchMode } from "./hooks";
import { STRINGS } from "./strings";
import "./ui.css";

/** How long a pointer rests on something before its card shows, and a finger before its bottom card does */
const TIP = { hoverDelay: 280, longPress: 450, gap: 10 };

/**
 * A hover card beside `anchor` (a rect on screen): to the right if it fits, else to the left, kept
 * inside the window. Never takes the pointer
 */
export function TipCard({ anchor, children }: { anchor: DOMRect; children: ReactNode }) {
  const card = useRef<HTMLDivElement>(null);
  const [place, setPlace] = useState<{ left: number; top: number } | null>(null);
  useLayoutEffect(() => {
    const el = card.current;
    if (!el) return;
    const { width, height } = el.getBoundingClientRect();
    const room = window.innerWidth;
    let left = anchor.right + TIP.gap;
    if (left + width > room - 8) left = anchor.left - TIP.gap - width;
    if (left < 8) left = Math.max(8, Math.min(room - width - 8, anchor.left + anchor.width / 2 - width / 2));
    let top = anchor.top + anchor.height / 2 - height / 2;
    top = Math.max(8, Math.min(window.innerHeight - height - 8, top));
    setPlace({ left, top });
    // By value: callers measure a new rect each render
  }, [anchor.left, anchor.top, anchor.right, anchor.width, anchor.height]);
  return (
    <div ref={card} className="ui-tip glass" role="tooltip" style={place ? { left: place.left, top: place.top } : { visibility: "hidden" }}>
      {children}
    </div>
  );
}

/** The touch version: a card along the bottom edge that stays until closed or tapped beside */
export function TipBottom({ onClose, children }: { onClose: () => void; children: ReactNode }) {
  return (
    <div className="ui-tip-bottom-veil" onPointerDown={(event) => event.target === event.currentTarget && onClose()}>
      <div className="ui-tip-bottom glass" role="dialog" aria-modal="false">
        <button className="sheet-close ui-tip-close" onClick={onClose} aria-label={STRINGS.close}>
          <IconX size={18} />
        </button>
        {children}
      </div>
    </div>
  );
}

/**
 * A tooltip round one element (plan F7). With a mouse: a hover card after a short rest, also on keyboard
 * focus. On touch: a long press opens a bottom card, and letting go keeps it open
 */
export function Tooltip({ content, children }: { content: ReactNode; children: ReactElement }) {
  const touch = useTouchMode();
  const anchor = useRef<HTMLSpanElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [hover, setHover] = useState<DOMRect | null>(null);
  const [card, setCard] = useState(false);
  const clear = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
  };
  const showSoon = () => {
    clear();
    timer.current = setTimeout(() => anchor.current && setHover(anchor.current.getBoundingClientRect()), TIP.hoverDelay);
  };
  const hide = () => {
    clear();
    setHover(null);
  };
  return (
    <span
      ref={anchor}
      className="ui-tip-anchor"
      onPointerEnter={(event) => event.pointerType === "mouse" && showSoon()}
      onPointerLeave={hide}
      onFocus={() => !touch && anchor.current && setHover(anchor.current.getBoundingClientRect())}
      onBlur={hide}
      onPointerDown={(event) => {
        if (event.pointerType !== "touch") return hide();
        clear();
        timer.current = setTimeout(() => setCard(true), TIP.longPress);
      }}
      onPointerUp={clear}
      onPointerCancel={clear}
      onContextMenu={(event) => touch && event.preventDefault()}
    >
      {children}
      {hover && !touch && <TipCard anchor={hover}>{content}</TipCard>}
      {card && <TipBottom onClose={() => setCard(false)}>{content}</TipBottom>}
    </span>
  );
}
