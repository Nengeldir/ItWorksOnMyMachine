import { formatTime } from "../format";
import type { HudState } from "../game/Game";
import { FLIGHT } from "../game/flight";
import { bindingLabel } from "../game/bindings";
import type { Settings } from "../storage";
import "./Hud.css";

// Skimming rock, from Game.step and flight.ts: style points per second are proximity² × speed (m/s) ×
// multiplier × 0.5, and the flight model adds FLIGHT.proximityBoost × proximity² m/s² of speed
const STYLE_RATE = 0.5;

/** In an adventure the boost doesn't recharge by itself: it points you at the stamina orbs */
const boostLabel = (hud: HudState) =>
  hud.boosting ? "Boosting" : hud.boostCharge >= 0.999 ? "Boost ready" : hud.run ? (hud.boostCharge < 0.05 ? "Boost empty · fly through orange orbs" : "Refill at orange orbs") : "Boost charging";

/** What skimming the rock is earning right now: points in a run, speed in a race */
function skimLabel(hud: HudState, points: boolean): string {
  const closeness = hud.proximity ** 2;
  if (points) {
    const rate = Math.round(closeness * (hud.speedKmh / 3.6) * hud.multiplier * STYLE_RATE);
    return rate >= 1 ? `Gaining ${rate} points/s` : "Skim the rock for points";
  }
  const rate = Math.round(closeness * FLIGHT.proximityBoost * 3.6);
  return rate >= 1 ? `Gaining ${rate} km/h per second` : "Skim the rock for speed";
}

/** Where a crash puts you back: the last ring in a race, the last gate in a run, else the start (nowhere once a run is out of lives) */
function respawnLabel(hud: HudState): string {
  if (hud.run?.phase === "lost") return "The journey ends here";
  if (hud.run) return hud.run.checkpoint > 0 ? `Back to gate ${hud.run.checkpoint}` : "Back to the start";
  return hud.raceState !== "free" && hud.checkpoints > 0 ? `Back to ring ${hud.checkpoints}` : "Back to the start";
}

/** A labelled meter in the flight panel, 0..1 */
const Bar = ({ kind, label, value }: { kind: "boost" | "skim"; label: string; value: number }) => (
  <div className={`hud-meter ${kind}`}>
    <span>{label}</span>
    <div className="hud-bar" role="progressbar" aria-label={label} aria-valuenow={Math.round(value * 100)}>
      <div style={{ width: `${Math.round(value * 100)}%` }} />
    </div>
  </div>
);

/** Speed, timer, rings and standings over the game view; style points only where they score (runs) */
const Hud = ({ hud, settings, showStyle = false }: { hud: HudState; settings: Settings; showStyle?: boolean }) => {
  const racing = hud.raceState === "racing" || hud.raceState === "countdown";
  const go = hud.raceState === "racing" && hud.raceTimeMs !== null && hud.raceTimeMs < 1000;
  return (
    <div className="hud">
      {hud.raceState !== "free" && (
        <div className="hud-race glass">
          <div className="hud-timer">{formatTime(hud.raceTimeMs ?? 0)}</div>
          <div className="hud-rings">
            {hud.raceState === "finished"
              ? "Finished"
              : `Ring ${Math.min(hud.checkpoints + 1, hud.totalCheckpoints)} / ${hud.totalCheckpoints}`}
          </div>
        </div>
      )}

      {!hud.paused && hud.countdown !== null && hud.countdown > 0 && (
        <div className="hud-big glass" key={hud.countdown}>
          {hud.countdown}
        </div>
      )}
      {!hud.paused && go && <div className="hud-big glass go">GO!</div>}
      {!hud.paused && hud.crashed && (
        <div className="hud-crash glass">
          {hud.run?.phase === "lost" ? "Out of feathers" : "Crashed!"}
          <small>
            {respawnLabel(hud)}
          </small>
        </div>
      )}
      {hud.paused && (
        <div className="hud-pause glass" role="status">
          <strong>Paused</strong>
          <span className="no-touch">Press <kbd>{bindingLabel(settings.bindings, "pause")}</kbd> to resume</span>
          <span className="touch-only">Tap Resume to fly on</span>
          {racing && <small>The race clock keeps running</small>}
        </div>
      )}
      {!hud.paused && hud.loading && hud.raceState === "free" && <div className="hud-loading glass">Gliding in while the land loads…</div>}

      {hud.standings.length > 1 && (
        <ol className="hud-standings glass">
          {hud.standings.map((s) => (
            <li key={s.id} className={s.me ? "me" : undefined}>
              <span className="dot" style={{ background: s.color }} />
              <span className="name">{s.name}</span>
              <span className="progress">
                {s.finishMs !== null ? formatTime(s.finishMs) : `${s.checkpoints}/${hud.totalCheckpoints}`}
              </span>
            </li>
          ))}
        </ol>
      )}

      {/* Compact flight instruments at the screen edge */}
      <div className="hud-bottom">
        <div className={`hud-flight glass ${hud.crashed ? "crashed" : ""}`}>
          <Bar kind="boost" label={boostLabel(hud)} value={hud.boostCharge} />
          <Bar kind="skim" label={skimLabel(hud, showStyle)} value={hud.proximity} />
          <div className="hud-speed">
            <strong>{hud.speedKmh}</strong> km/h
          </div>
          {showStyle && (
            <div className="hud-style">
              Style {hud.style.toLocaleString()} {hud.multiplier > 1 && <b>×{hud.multiplier}</b>}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default Hud;
