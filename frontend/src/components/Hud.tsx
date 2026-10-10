import { formatTime } from "../format";
import type { HudState } from "../game/Game";
import { KEY_BINDINGS, keyLabel } from "../game/input";
import "./Hud.css";

/** Speed, timer, rings, style and standings over the game view */
const Hud = ({ hud }: { hud: HudState }) => {
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
      {!hud.paused && hud.crashed && <div className="hud-crash glass">Crashed!</div>}
      {hud.paused && (
        <div className="hud-pause glass" role="status">
          <strong>Paused</strong>
          <span>Press <kbd>{keyLabel(KEY_BINDINGS.pause)}</kbd> to resume</span>
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

      <div className="hud-flight glass">
        <div className="hud-speed">
          <strong>{hud.speedKmh}</strong> km/h
        </div>
        <div className="hud-proximity" title="Proximity">
          <div style={{ width: `${Math.round(hud.proximity * 100)}%` }} />
        </div>
        <div className="hud-style">
          Style {hud.style.toLocaleString()} {hud.multiplier > 1 && <b>×{hud.multiplier}</b>}
        </div>
        <div className="hud-altitude">{hud.clearance < 40 ? `${hud.clearance} m to the rock` : "\u00a0"}</div>
      </div>

      {!hud.locked && !hud.paused && (
        <div className="hud-hint glass">
          {racing ? "Click to steer with the mouse" : "Click the view to steer with the mouse · keys and gamepads work anytime"}
        </div>
      )}
    </div>
  );
};

export default Hud;
