// The primitives' small bits of motion as pure functions (node tests run them): the hold ring, the
// rolling counter.

/** Fills over `seconds` while held, drains back twice as fast when let go */
export function holdProgress(progress: number, holding: boolean, dt: number, seconds: number): number {
  const rate = dt / Math.max(0.05, seconds);
  return Math.max(0, Math.min(1, progress + (holding ? rate : -2 * rate)));
}

/** Where a count rolling from `from` to `to` over `duration` ms is after `t` ms: eased out, whole numbers */
export function counterAt(from: number, to: number, t: number, duration: number): number {
  if (t >= duration || duration <= 0) return to;
  const k = 1 - (1 - Math.max(0, t) / duration) ** 3;
  return Math.round(from + (to - from) * k);
}
