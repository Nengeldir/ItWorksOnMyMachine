import { IconCheck } from "@tabler/icons-react";
import { useEffect, useEffectEvent, useRef, useState } from "react";
import { type BindingAction, defaultBindings } from "../game/bindings";
import { loadSettings } from "../storage";
import { boundKeys } from "./keys";
import "./Coach.css";

const DONE_MS = 650; // the tick on a step before the next one
const READY_MS = 1400; // "You're ready!" before the coach goes
const MOUSE_PX = 80; // this much mouse travel counts as steering with it
const STICK = 0.5; // gamepad sticks and triggers past this count

interface Step {
  label: string;
  actions: BindingAction[];
  /** Also done by moving the mouse (while it steers) or the left stick this way */
  axis?: "x" | "dive" | "climb";
  /** Gamepad buttons that do it: triggers 6 (LT) and 7 (RT), shoulders 4 and 5 */
  pad?: number[];
}

function steps(): Step[] {
  // "Invert pitch" swaps what the pitch keys do
  const invert = loadSettings().invertPitch;
  return [
    { label: "Turn", actions: ["turnLeft", "turnRight"], axis: "x" },
    { label: "Dive", actions: [invert ? "pitchUp" : "pitchDown"], axis: "dive" },
    { label: "Climb", actions: [invert ? "pitchDown" : "pitchUp"], axis: "climb" },
    { label: "Boost", actions: ["boost"], pad: [7] },
    { label: "Brake", actions: ["brake"], pad: [6] },
    { label: "Dodge", actions: ["barrelLeft", "barrelRight"], pad: [4, 5] },
  ];
}

/**
 * The tutorial: a card at the top asks for one control at a time (the player's own keys) and moves on
 * once it's used, keys, mouse or gamepad alike. Six steps, then "You're ready!"; Skip (or Esc) any time.
 * The game flies on underneath: this only watches the controls.
 */
const Coach = ({ onEnd }: { onEnd: () => void }) => {
  const [all] = useState(steps);
  const [index, setIndex] = useState(0);
  const [done, setDone] = useState(false);
  const mouse = useRef({ x: 0, y: 0 });
  const finished = index >= all.length;
  const step = all[Math.min(index, all.length - 1)];

  const end = useEffectEvent(() => onEnd());
  const pass = useEffectEvent(() => {
    if (done || finished) return;
    setDone(true);
  });

  // A step's tick, then the next step; after the last, a moment of "You're ready!"
  useEffect(() => {
    if (finished) {
      const timer = setTimeout(() => end(), READY_MS);
      return () => clearTimeout(timer);
    }
    if (!done) return;
    const timer = setTimeout(() => {
      mouse.current = { x: 0, y: 0 };
      setDone(false);
      setIndex((i) => i + 1);
    }, DONE_MS);
    return () => clearTimeout(timer);
  }, [done, finished]);

  const onKey = useEffectEvent((e: KeyboardEvent) => {
    if (e.key === "Escape") return end();
    const bindings = loadSettings().bindings ?? defaultBindings();
    if (step.actions.some((action) => bindings[action].includes(e.code))) pass();
  });

  const onMouse = useEffectEvent((e: MouseEvent) => {
    if (!document.pointerLockElement || !step.axis) return;
    const settings = loadSettings();
    // Mouse up dives by default, like pushing a stick forward
    const invert = (settings.invertMouse ?? settings.invertPitch) ? -1 : 1;
    mouse.current.x += Math.abs(e.movementX);
    mouse.current.y += e.movementY * invert;
    if (step.axis === "x" && mouse.current.x > MOUSE_PX) pass();
    if (step.axis === "dive" && mouse.current.y < -MOUSE_PX) pass();
    if (step.axis === "climb" && mouse.current.y > MOUSE_PX) pass();
  });

  const onPad = useEffectEvent(() => {
    const pad = navigator.getGamepads?.().find((p) => p?.connected);
    if (!pad) return;
    const invert = (loadSettings().invertGamepad ?? loadSettings().invertPitch) ? -1 : 1;
    const x = pad.axes[0] ?? 0;
    const y = (pad.axes[1] ?? 0) * invert;
    if (step.axis === "x" && Math.abs(x) > STICK) pass();
    if (step.axis === "dive" && y < -STICK) pass();
    if (step.axis === "climb" && y > STICK) pass();
    if (step.pad?.some((button) => (pad.buttons[button]?.value ?? 0) > STICK)) pass();
  });

  useEffect(() => {
    window.addEventListener("keydown", onKey);
    document.addEventListener("mousemove", onMouse);
    let frame = requestAnimationFrame(function poll() {
      onPad();
      frame = requestAnimationFrame(poll);
    });
    return () => {
      window.removeEventListener("keydown", onKey);
      document.removeEventListener("mousemove", onMouse);
      cancelAnimationFrame(frame);
    };
  }, []);

  return (
    <div className="coach glass" role="status">
      <div className={`coach-step ${done ? "done" : ""}`} key={finished ? "ready" : index}>
        {finished ? (
          <strong>You're ready!</strong>
        ) : (
          <>
            <span className="coach-keys">
              {boundKeys(...step.actions).map((group, i) => (
                <span key={i} className="key-group">
                  {group.map((key, j) => (
                    <kbd key={j}>{key}</kbd>
                  ))}
                </span>
              ))}
            </span>
            <strong>{step.label}</strong>
            {done && <IconCheck className="coach-tick" size={22} stroke={3} />}
          </>
        )}
      </div>
      <div className="coach-foot">
        <span className="coach-dots" aria-label={`Step ${Math.min(index + 1, all.length)} of ${all.length}`}>
          {all.map((s, i) => (
            <i key={s.label} className={i < index || (i === index && done) ? "on" : i === index ? "now" : undefined} />
          ))}
        </span>
        {!finished && (
          <button className="coach-skip" onClick={onEnd}>
            Skip
          </button>
        )}
      </div>
    </div>
  );
};

export default Coach;
