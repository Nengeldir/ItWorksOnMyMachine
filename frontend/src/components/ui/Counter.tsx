import { useEffect, useRef, useState } from "react";
import { formatNumber } from "../world/format";
import { reducedMotion } from "./hooks";
import { counterAt } from "./motion";
import "./ui.css";

/**
 * A number that rolls to its new value (plan F7): crystals, stacks, scores. A server correction lands
 * the same way, quietly. Even-width digits, abbreviated past 10 000 (`formatNumber`); jumps with
 * reduced motion
 */
export function Counter({ value, duration = 600, format = formatNumber, className = "" }: { value: number; duration?: number; format?: (n: number) => string; className?: string }) {
  const [shown, setShown] = useState(value);
  const from = useRef(value);
  const shownRef = useRef(value);
  shownRef.current = shown;
  useEffect(() => {
    if (reducedMotion()) {
      setShown(value);
      return;
    }
    from.current = shownRef.current;
    const start = performance.now();
    let frame = requestAnimationFrame(function tick(now) {
      const next = counterAt(from.current, value, now - start, duration);
      setShown(next);
      if (next !== value) frame = requestAnimationFrame(tick);
    });
    return () => cancelAnimationFrame(frame);
  }, [value, duration]);
  return <span className={`ui-counter ${shown !== value ? "is-rolling" : ""} ${className}`}>{format(shown)}</span>;
}
