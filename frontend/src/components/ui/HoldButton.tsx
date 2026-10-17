import { type ReactNode, useEffect, useRef, useState } from "react";
import { holdProgress } from "./motion";
import { capture } from "./dnd";
import { STRINGS } from "./strings";
import "./ui.css";

interface HoldButtonProps {
  /** Seconds to hold */
  seconds?: number;
  onComplete: () => void;
  children: ReactNode;
  className?: string;
  disabled?: boolean;
}

/**
 * A button that has to be held (plan F7: selling a stack, salvaging, leaving a dungeon): a ring of light
 * fills round it, and it acts when the ring closes. Mouse, finger, Space or Enter held, or the gamepad's A
 * (the pad sends one Enter press, then the button watches A until it's let go)
 */
export function HoldButton({ seconds = 0.9, onComplete, children, className = "", disabled }: HoldButtonProps) {
  const [progress, setProgress] = useState(0);
  const holding = useRef<"pointer" | "key" | "pad" | null>(null);
  const value = useRef(0);
  const done = useRef(false);
  const frame = useRef(0);
  const complete = useRef(onComplete);
  useEffect(() => {
    complete.current = onComplete;
  });

  useEffect(() => () => cancelAnimationFrame(frame.current), []);

  const run = () => {
    if (frame.current) return;
    let last = performance.now();
    const tick = (now: number) => {
      if (holding.current === "pad" && !((navigator.getGamepads?.().find((p) => p?.connected)?.buttons[0]?.value ?? 0) > 0.5)) holding.current = null;
      value.current = holdProgress(value.current, holding.current !== null, (now - last) / 1000, seconds);
      last = now;
      setProgress(value.current);
      if (value.current >= 1 && !done.current) {
        done.current = true;
        holding.current = null;
        complete.current();
      }
      if (value.current <= 0) done.current = false;
      frame.current = value.current > 0 || holding.current ? requestAnimationFrame(tick) : 0;
    };
    frame.current = requestAnimationFrame(tick);
  };
  const start = (how: "pointer" | "key" | "pad") => {
    if (disabled || done.current) return;
    holding.current = how;
    run();
  };
  const stop = () => {
    holding.current = null;
  };

  const circumference = 2 * Math.PI * 46;
  return (
    <button
      className={`ui-hold ${progress >= 1 ? "is-done" : ""} ${className}`}
      disabled={disabled}
      aria-description={STRINGS.holdToConfirm}
      onPointerDown={(event) => {
        capture(event.currentTarget, event.pointerId);
        start("pointer");
      }}
      onPointerUp={stop}
      onPointerCancel={stop}
      onContextMenu={(event) => event.preventDefault()}
      onKeyDown={(event) => {
        if (event.key !== " " && event.key !== "Enter") return;
        event.preventDefault();
        if (!event.repeat) start(event.isTrusted ? "key" : "pad");
      }}
      onKeyUp={(event) => (event.key === " " || event.key === "Enter") && stop()}
      onBlur={stop}
      // A plain click does nothing: the hold is the confirmation
      onClick={(event) => event.preventDefault()}
    >
      <svg className="ui-hold-ring" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
        <rect x="3" y="3" width="94" height="94" rx="30" pathLength={circumference} strokeDasharray={circumference} strokeDashoffset={circumference * (1 - progress)} />
      </svg>
      <span className="ui-hold-label">{children}</span>
    </button>
  );
}
