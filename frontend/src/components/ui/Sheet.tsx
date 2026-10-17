import { IconX } from "@tabler/icons-react";
import { type PointerEvent as ReactPointerEvent, type ReactNode, useEffect, useEffectEvent, useId, useRef, useState } from "react";
import { holdGame } from "../../game/hold";
import { capture } from "./dnd";
import { pushNavLayer } from "./gamepad";
import { reducedMotion, useBreakpoint } from "./hooks";
import { type SheetPlacement, sheetDismissed, sheetPlacement } from "./nav";
import { STRINGS } from "./strings";
import "./ui.css";

export interface SheetProps {
  title: string;
  /** The small capitals over the title */
  eyebrow?: string;
  /** The round badge's sign */
  icon?: ReactNode;
  onClose: () => void;
  /** Where it opens; `auto` follows the breakpoint (side on wide, centre on medium, bottom below) */
  placement?: "auto" | SheetPlacement;
  /** Pauses the game under it while open (default: yes; nothing happens without a game) */
  holdsGame?: boolean;
  /** Buttons under the scrolling part, always in view */
  footer?: ReactNode;
  className?: string;
  /** LB / RB on a gamepad (the sheet's tabs) */
  onShoulder?: (step: -1 | 1) => void;
  children: ReactNode;
}

/**
 * A sheet (plan F7): the glass dialog every open-world screen lives in. A modal `<dialog>`, so the page
 * behind is inert and the focus stays inside; Escape, B, the close button, a click beside it or (bottom
 * sheets) a drag down on the handle closes it. One scroll: the body; the header and footer stay put.
 */
export function Sheet({ title, eyebrow, icon, onClose, placement = "auto", holdsGame = true, footer, className = "", onShoulder, children }: SheetProps) {
  const dialog = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const at = sheetPlacement(useBreakpoint(), placement);
  const [still] = useState(reducedMotion);
  const close = useEffectEvent(() => onClose());
  const shoulder = useEffectEvent((step: -1 | 1) => onShoulder?.(step));

  useEffect(() => {
    const el = dialog.current!;
    el.showModal();
    const release = holdsGame ? holdGame() : () => {};
    const pop = pushNavLayer({ root: el, onBack: () => close(), onShoulder: (step) => shoulder(step) });
    return () => {
      pop();
      release();
      el.close();
    };
  }, [holdsGame]);

  // The bottom sheet's handle: the sheet follows the finger down, and closes past a distance or a flick
  const drag = useRef<{ y: number; at: number; last: number; lastAt: number } | null>(null);
  const [pulled, setPulled] = useState(0);
  const grab = (event: ReactPointerEvent) => {
    capture(event.currentTarget, event.pointerId);
    drag.current = { y: event.clientY, at: event.timeStamp, last: event.clientY, lastAt: event.timeStamp };
  };
  const pull = (event: ReactPointerEvent) => {
    const d = drag.current;
    if (!d) return;
    d.last = event.clientY;
    d.lastAt = event.timeStamp;
    setPulled(Math.max(0, event.clientY - d.y));
  };
  const letGo = (event: ReactPointerEvent) => {
    const d = drag.current;
    drag.current = null;
    if (!d) return;
    const dragged = Math.max(0, event.clientY - d.y);
    const speed = dragged / Math.max(1, event.timeStamp - d.at);
    setPulled(0);
    if (sheetDismissed(dragged, speed)) onClose();
  };

  return (
    <dialog
      ref={dialog}
      className={`sheet ui-sheet ui-sheet--${at}${still ? " ui-still" : ""}${pulled ? " ui-pulled" : ""} ${className}`}
      style={pulled ? { transform: `translateY(${pulled}px)` } : undefined}
      aria-labelledby={titleId}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      // A click on the backdrop lands on the dialog itself
      onClick={(event) => event.target === event.currentTarget && onClose()}
    >
      {at === "bottom" && (
        <div className="ui-sheet-handle" onPointerDown={grab} onPointerMove={pull} onPointerUp={letGo} onPointerCancel={letGo} aria-hidden="true">
          <span />
        </div>
      )}
      <header className="sheet-head ui-sheet-head">
        {icon && <span className="overlay-badge">{icon}</span>}
        <div>
          {eyebrow && <small>{eyebrow}</small>}
          <h2 id={titleId}>{title}</h2>
        </div>
        <button className="sheet-close" onClick={onClose} aria-label={STRINGS.close}>
          <IconX size={20} />
        </button>
      </header>
      <div className="ui-sheet-body">{children}</div>
      {footer && <footer className="ui-sheet-foot">{footer}</footer>}
    </dialog>
  );
}
