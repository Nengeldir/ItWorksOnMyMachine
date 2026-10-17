import { useEffect, useState } from "react";
import { type PerfSnapshot, perf } from "../game/perf";
import "./PerfOverlay.css";

// The plan's budget per frame (§4) by quality level 0, 1, 2: a number past it shows warm
const BUDGET = {
  calls: [180, 260, 320],
  triangles: [500_000, 1_000_000, 1_600_000],
  stepMs: [4, 3, 3],
};

const short = (n: number) => (n >= 1e6 ? `${(n / 1e6).toFixed(2)}M` : n >= 1e4 ? `${(n / 1e3).toFixed(0)}k` : String(n));

/**
 * `?perf` (plan F11): a small corner panel with the frame's numbers, four times a second. Read in a
 * focused window: automation tabs are throttled
 */
export default function PerfOverlay() {
  const [s, setS] = useState<PerfSnapshot | null>(null);
  useEffect(() => {
    const timer = setInterval(() => setS(perf.snapshot()), 250);
    return () => clearInterval(timer);
  }, []);
  if (!s) return <aside className="perf-overlay">perf: no game running</aside>;
  const q = Math.max(0, Math.min(2, s.quality));
  const over = (value: number, key: keyof typeof BUDGET) => (value > BUDGET[key][q] ? "over" : undefined);
  return (
    <aside className="perf-overlay" aria-label="Performance">
      <dl>
        <dt>fps</dt><dd>{s.fps}</dd>
        <dt>frame</dt><dd>{s.frameMs} ms</dd>
        <dt>step</dt><dd className={over(s.stepMs, "stepMs")}>{s.stepMs} ms</dd>
        <dt>calls</dt><dd className={over(s.calls, "calls")}>{s.calls} / {BUDGET.calls[q]}</dd>
        <dt>tris</dt><dd className={over(s.triangles, "triangles")}>{short(s.triangles)}</dd>
        <dt>particles</dt><dd>{short(s.particles)}</dd>
        <dt>voices</dt><dd className={s.voices > 24 ? "over" : undefined}>{s.voices}</dd>
        <dt>net</dt><dd>{s.netKBs} kB/s</dd>
        {s.heapMB !== null && <><dt>heap</dt><dd>{s.heapMB} MB</dd></>}
        {Object.entries(s.counters).map(([name, value]) => (
          <span key={name} className="perf-row"><dt>{name}</dt><dd>{short(value)}</dd></span>
        ))}
        <dt>quality</dt><dd>{s.quality}</dd>
      </dl>
    </aside>
  );
}
