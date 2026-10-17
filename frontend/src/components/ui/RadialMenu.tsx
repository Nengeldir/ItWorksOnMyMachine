import { type ReactNode, useEffect, useEffectEvent, useRef, useState } from "react";
import { pushNavLayer } from "./gamepad";
import { type Direction, wedgeAt, wedgeDirection } from "./nav";
import { STRINGS } from "./strings";
import "./ui.css";

export interface RadialOption {
  id: string;
  label: string;
  icon?: ReactNode;
  disabled?: boolean;
}

interface RadialMenuProps {
  /** 4 to 8 choices, the first straight up, then clockwise */
  options: readonly RadialOption[];
  onPick: (id: string) => void;
  onCancel: () => void;
  /** The centre on screen (default: the window's centre; a thumb's press point on touch) */
  at?: { x: number; y: number };
  /** Opened by a press that is still down: letting go picks the wedge under it (thumb or mouse) */
  pressed?: boolean;
}

const SIZE = 236;
const R_OUT = 112;
const R_IN = 46;
const DEAD = 28;

/** An annulus sector, the wedge `i` of `n` (centre up, clockwise), as an SVG path round 0,0 */
function wedgePath(i: number, n: number): string {
  const gap = 0.035;
  const a0 = ((i - 0.5) / n + gap / n) * Math.PI * 2;
  const a1 = ((i + 0.5) / n - gap / n) * Math.PI * 2;
  const p = (r: number, a: number) => `${(Math.sin(a) * r).toFixed(2)} ${(-Math.cos(a) * r).toFixed(2)}`;
  const large = a1 - a0 > Math.PI ? 1 : 0;
  return `M${p(R_IN, a0)} L${p(R_OUT, a0)} A${R_OUT} ${R_OUT} 0 ${large} 1 ${p(R_OUT, a1)} L${p(R_IN, a1)} A${R_IN} ${R_IN} 0 ${large} 0 ${p(R_IN, a0)} Z`;
}

/**
 * A radial menu (plan F7): a ring of 4 to 8 glass wedges round a point. Point (mouse, thumb or stick)
 * at a wedge and click, let go, press A or Enter; arrows step round it, number keys pick directly;
 * Escape, B or a click in the middle cancels. A modal dialog, so it sits above any sheet
 */
export function RadialMenu({ options, onPick, onCancel, at, pressed = false }: RadialMenuProps) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [choice, setChoice] = useState(-1);
  const centre = at ?? { x: window.innerWidth / 2, y: window.innerHeight / 2 };
  const n = options.length;
  const usable = (i: number) => i >= 0 && !options[i]?.disabled;
  const choose = (i: number) => (usable(i) ? onPick(options[i].id) : onCancel());
  const pick = useEffectEvent((i: number) => choose(i));
  const step = (by: number) => {
    setChoice((c) => {
      for (let k = 1; k <= n; k++) {
        const next = (((c < 0 ? (by > 0 ? -1 : 0) : c) + by * k) % n + n) % n;
        if (usable(next)) return next;
      }
      return c;
    });
  };
  const towards = useEffectEvent((direction: Direction) => {
    const v = { up: [0, -1], right: [1, 0], down: [0, 1], left: [-1, 0] }[direction];
    const i = wedgeAt(v[0], v[1], n);
    if (usable(i)) setChoice(i);
    return true;
  });
  const cancel = useEffectEvent(() => onCancel());
  const current = useRef(choice);
  useEffect(() => {
    current.current = choice;
  });

  useEffect(() => {
    const el = dialog.current!;
    el.showModal();
    const pop = pushNavLayer({
      root: el,
      onBack: () => cancel(),
      onDirection: (d) => towards(d),
      onConfirm: () => {
        pick(current.current);
        return true;
      },
    });
    // The right stick points straight at a wedge
    let frame = requestAnimationFrame(function poll() {
      frame = requestAnimationFrame(poll);
      const pad = navigator.getGamepads?.().find((p) => p?.connected);
      if (!pad) return;
      const i = wedgeAt(pad.axes[2] ?? 0, pad.axes[3] ?? 0, n, 0.5);
      if (usable(i)) setChoice(i);
    });
    return () => {
      cancelAnimationFrame(frame);
      pop();
      el.close();
    };
    // `usable` reads the latest options through the closure each frame
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [n]);

  // Pointers are followed on the window: a press that opened the menu is captured by what it pressed,
  // and its release must still pick. A release only picks after a press seen here, or for that press
  const pointer = useEffectEvent((type: string, x: number, y: number) => {
    const i = wedgeAt(x - centre.x, y - centre.y, n, DEAD);
    if (type !== "pointerup") {
      if (type === "pointerdown") armed.current = true;
      setChoice(usable(i) ? i : -1);
    } else if (armed.current) pick(i);
  });
  const armed = useRef(pressed);
  useEffect(() => {
    const on = (event: PointerEvent) => pointer(event.type, event.clientX, event.clientY);
    const types = ["pointermove", "pointerdown", "pointerup"] as const;
    types.forEach((type) => window.addEventListener(type, on, true));
    return () => types.forEach((type) => window.removeEventListener(type, on, true));
  }, []);

  return (
    <dialog
      ref={dialog}
      className="ui-radial-veil"
      aria-label={STRINGS.pickOne}
      onCancel={(event) => {
        event.preventDefault();
        onCancel();
      }}
      onKeyDown={(event) => {
        if (event.key === "ArrowRight" || event.key === "ArrowDown") step(1);
        else if (event.key === "ArrowLeft" || event.key === "ArrowUp") step(-1);
        else if (event.key === "Enter" || event.key === " ") choose(choice);
        else if (/^[1-8]$/.test(event.key)) choose(Number(event.key) - 1);
        else return;
        event.preventDefault();
      }}
    >
      <div className="ui-radial" style={{ left: centre.x, top: centre.y, width: SIZE, height: SIZE }}>
        <svg viewBox={`${-SIZE / 2} ${-SIZE / 2} ${SIZE} ${SIZE}`} aria-hidden="true">
          {options.map((option, i) => (
            <path key={option.id} d={wedgePath(i, n)} className={`ui-radial-wedge${i === choice ? " is-on" : ""}${option.disabled ? " is-off" : ""}`} />
          ))}
          <circle r={R_IN - 8} className="ui-radial-core" />
        </svg>
        {options.map((option, i) => {
          const d = wedgeDirection(i, n);
          const r = (R_IN + R_OUT) / 2;
          return (
            <button
              key={option.id}
              className={`ui-radial-label${i === choice ? " is-on" : ""}`}
              style={{ left: SIZE / 2 + d.x * r, top: SIZE / 2 + d.y * r }}
              disabled={option.disabled}
              tabIndex={-1}
              onFocus={() => setChoice(i)}
              aria-label={option.label}
            >
              {option.icon}
              <small>{option.label}</small>
            </button>
          );
        })}
        <span className="ui-radial-name" aria-live="polite">{choice >= 0 ? options[choice].label : ""}</span>
      </div>
    </dialog>
  );
}
