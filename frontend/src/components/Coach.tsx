import { IconCheck } from "@tabler/icons-react";
import { useEffect, useEffectEvent, useState } from "react";
import type { BindingAction } from "../game/bindings";
import type { InputObserver } from "../game/input";
import { loadSettings } from "../storage";
import { boundKeys } from "./keys";
import "./Coach.css";

const DONE_MS = 650; // the tick on a step before the next one
const READY_MS = 1400; // "You're ready!" before the coach goes
const STICK = 0.5; // merged steering and speed input past this counts

interface Step {
  label: string;
  actions: BindingAction[];
  /** Merged flight axis to watch, including touch and tilt. */
  axis?: "x" | "dive" | "climb";
  /** Instruction shown instead of keyboard hints on phones. */
  touchHint: string;
}

function steps(): Step[] {
  // "Invert pitch" swaps what the pitch keys do
  const invert = loadSettings().invertPitch;
  return [
    { label: "Turn", actions: ["turnLeft", "turnRight"], axis: "x", touchHint: "Drag sideways or turn Tilt like a wheel" },
    { label: "Dive", actions: [invert ? "pitchUp" : "pitchDown"], axis: "dive", touchHint: "Drag up or lean the top away with Tilt" },
    { label: "Climb", actions: [invert ? "pitchDown" : "pitchUp"], axis: "climb", touchHint: "Drag down or lean the top towards you with Tilt" },
    { label: "Boost", actions: ["boost"], touchHint: "Hold Boost" },
    { label: "Brake", actions: ["brake"], touchHint: "Hold Brake" },
    { label: "Dodge", actions: ["barrelLeft", "barrelRight"], touchHint: "Tap ‹ or ›" },
  ];
}

/**
 * The tutorial: a card at the top asks for one control at a time (the player's own keys) and moves on
 * once it's used, keys, mouse, gamepad, touch or tilt alike. Six steps, then "You're ready!"; Skip (or Esc) any time.
 * The game flies on underneath: this only watches the controls.
 */
const Coach = ({ onEnd, observeInput }: {
  onEnd: () => void;
  observeInput: (observer: InputObserver) => () => void;
}) => {
  const [all] = useState(steps);
  const [index, setIndex] = useState(0);
  const [done, setDone] = useState(false);
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
      setDone(false);
      setIndex((i) => i + 1);
    }, DONE_MS);
    return () => clearTimeout(timer);
  }, [done, finished]);

  const onSample = useEffectEvent((input: Parameters<NonNullable<InputObserver["sample"]>>[0]) => {
    if (step.axis === "x" && Math.abs(input.roll) > STICK) pass();
    if (step.axis === "dive" && input.pitch < -STICK) pass();
    if (step.axis === "climb" && input.pitch > STICK) pass();
    if (step.actions.includes("boost") && (input.boost ?? 0) > STICK) pass();
    if (step.actions.includes("brake") && (input.brake ?? 0) > STICK) pass();
  });
  const onAction = useEffectEvent((action: Parameters<NonNullable<InputObserver["action"]>>[0]) => {
    if (step.actions.includes(action)) pass();
  });
  const onKey = useEffectEvent((event: KeyboardEvent) => {
    if (event.key === "Escape") end();
  });

  useEffect(() => {
    const stop = observeInput({ sample: (input) => onSample(input), action: (action) => onAction(action) });
    window.addEventListener("keydown", onKey);
    return () => {
      stop();
      window.removeEventListener("keydown", onKey);
    };
  }, [observeInput]);

  return (
    <div className="coach glass" role="status">
      <div className={`coach-step ${done ? "done" : ""}`} key={finished ? "ready" : index}>
        {finished ? (
          <strong>You're ready!</strong>
        ) : (
          <>
            <span className="coach-keys no-touch">
              {boundKeys(...step.actions).map((group, i) => (
                <span key={i} className="key-group">
                  {group.map((key, j) => (
                    <kbd key={j}>{key}</kbd>
                  ))}
                </span>
              ))}
            </span>
            <strong>{step.label}</strong>
            <span className="coach-touch touch-only">{step.axis === "dive" && loadSettings().invertTouch
              ? "Drag down or lean the top towards you with Tilt"
              : step.axis === "climb" && loadSettings().invertTouch
                ? "Drag up or lean the top away with Tilt" : step.touchHint}</span>
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
