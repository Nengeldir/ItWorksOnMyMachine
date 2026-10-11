import type { ReactNode } from "react";
import { formatTime } from "../format";

/** A small finish reminder in flight; full results only while the pilot is paused. */
export function RaceResults({ paused, timeMs, context, onResume, onRetry, children }: {
  paused: boolean; timeMs: number; context: string; onResume: () => void;
  onRetry?: () => void; children?: ReactNode;
}) {
  if (!paused) return <aside className="race-finish-strip glass" aria-label="Race result">
    <strong>Finished · {formatTime(timeMs)}</strong>
    {onRetry ? <>
      <span className="no-touch">Press Enter to retry and beat your best</span>
      <button className="touch-only" onClick={onRetry}>Try again</button>
    </> : <span>Waiting for the other racers</span>}
  </aside>;
  return <section className="race-results-overlay" aria-label="Paused race results">
    <div className="race-results-card glass">
      <header><small>{context}</small><h2>Finished · {formatTime(timeMs)}</h2></header>
      <div className="race-results-scroll">{children}</div>
      <footer>
        <button onClick={onResume}>Resume flying</button>
        {onRetry && <button className="primary" onClick={onRetry}>Fly again <kbd>Enter</kbd></button>}
      </footer>
    </div>
  </section>;
}
