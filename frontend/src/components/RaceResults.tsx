import type { ReactNode } from "react";
import { formatTime } from "../format";

const SOLO_RETRY = { hint: "Press Enter to retry and beat your best", touch: "Try again", button: "Fly again" };

/** A small finish reminder in flight; full results only while the pilot is paused. */
export function RaceResults({ paused, timeMs, context, onResume, onRetry, retry = SOLO_RETRY, children }: {
  paused: boolean; timeMs: number; context: string; onResume: () => void;
  onRetry?: () => void; retry?: { hint: string; touch: string; button: string }; children?: ReactNode;
}) {
  if (!paused) return <aside className="race-finish-strip glass" aria-label="Race result">
    <strong>Finished · {formatTime(timeMs)}</strong>
    {onRetry ? <>
      <span className="no-touch">{retry.hint}</span>
      <button className="touch-only" onClick={onRetry}>{retry.touch}</button>
    </> : <span>Waiting for the other racers</span>}
  </aside>;
  return <section className="race-results-overlay" aria-label="Paused race results">
    <div className="race-results-card glass">
      <header><small>{context}</small><h2>Finished · {formatTime(timeMs)}</h2></header>
      <div className="race-results-scroll">{children}</div>
      <footer>
        <button onClick={onResume}>Resume flying</button>
        {onRetry && <button className="primary" onClick={onRetry}>{retry.button} <kbd>Enter</kbd></button>}
      </footer>
    </div>
  </section>;
}
