import { useState, useSyncExternalStore } from "react";
import { IconAward, IconCheck, IconLock } from "@tabler/icons-react";
import { type AchievementMode, achievements, formatCounter } from "../game/achievements";

const filters: { id: AchievementMode | "all"; label: string }[] = [
  { id: "all", label: "All" },
  { id: "any", label: "Flight" },
  { id: "adventure", label: "Adventure" },
  { id: "racing", label: "Racing" },
  { id: "zen", label: "Zen" },
  { id: "collection", label: "Collection" },
];

/**
 * The journal's achievements: points earned, then every achievement by mode. One-time ones are done or
 * not; progressive ones climb tiers, each worth its points; hidden ones show ??? and a hint until found
 */
export default function AchievementsView() {
  useSyncExternalStore(achievements.subscribe, achievements.getVersion);
  const [filter, setFilter] = useState<AchievementMode | "all">("all");
  const states = achievements.states();
  const { points, max } = achievements.score();
  const done = states.filter((s) => s.done).length;
  const shown = states.filter((s) => filter === "all" || s.achievement.mode === filter);
  return (
    <div className="achievements">
      <section className="achievements-summary sheet-panel">
        <span className="achievements-badge"><IconAward size={30} /></span>
        <div>
          <b>{points.toLocaleString()} <small>/ {max.toLocaleString()} points</small></b>
          <small>{done} of {states.length} achievements complete · kept in this browser</small>
          <div className="meter" role="progressbar" aria-label="Achievement points" aria-valuemin={0} aria-valuemax={max} aria-valuenow={points}>
            <span style={{ width: `${Math.round((points / Math.max(1, max)) * 100)}%` }} />
          </div>
        </div>
      </section>
      <div className="segmented achievements-filter" role="tablist" aria-label="Achievements by mode">
        {filters.map((f) => <button key={f.id} role="tab" aria-selected={f.id === filter} onClick={() => setFilter(f.id)}>{f.label}</button>)}
      </div>
      <div className="achievements-grid">
        {shown.map(({ achievement: a, done: complete, tier, value, next, points: earned, secret }) => {
          const tiers = a.kind === "progress" ? a.tiers : null;
          const unit = a.kind === "progress" ? a.unit : undefined;
          const fraction = tiers ? (next === null ? 1 : value / next) : complete ? 1 : 0;
          return (
            <article key={a.id} className={`achievement ${complete ? "done" : ""} ${secret ? "secret" : ""}`}>
              <span className="achievement-icon" aria-hidden="true">{complete ? <IconCheck size={20} /> : secret ? <IconLock size={18} /> : <IconAward size={20} />}</span>
              <div className="achievement-body">
                <header>
                  <b>{secret ? "???" : a.name}</b>
                  <em>{a.kind === "progress" ? `${earned} / ${a.tiers.reduce((sum, t) => sum + t.points, 0)}` : a.points} pts</em>
                </header>
                <p>{secret && a.kind === "once" ? <>Hidden · <i>{a.hidden}</i></> : a.description}</p>
                {tiers && (
                  <>
                    <div className="achievement-tiers" aria-label={`Tier ${tier} of ${tiers.length}`}>
                      {tiers.map((t, i) => <span key={t.at} className={i < tier ? "reached" : ""} title={`${formatCounter(t.at, unit)} · ${t.points} pts`} />)}
                    </div>
                    <small>{next === null ? `All ${tiers.length} tiers · ${formatCounter(value, unit)}` : `${formatCounter(value, unit)} / ${formatCounter(next, unit)} for tier ${tier + 1}`}</small>
                  </>
                )}
                {!tiers && complete && <small>Done</small>}
              </div>
              <div className="achievement-bar"><span style={{ width: `${Math.min(100, Math.round(fraction * 100))}%` }} /></div>
            </article>
          );
        })}
      </div>
    </div>
  );
}
