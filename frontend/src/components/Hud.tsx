import { formatTime } from "../format";
import type { HudState } from "../game/Game";
import "./Hud.css";

/** Speed, timer, rings, style and standings over the game view */
const Hud = ({ hud }: { hud: HudState }) => {
  const racing = hud.raceState === "racing" || hud.raceState === "countdown";
  const go = hud.raceState === "racing" && hud.raceTimeMs !== null && hud.raceTimeMs < 1000;
  return (
    <div className="hud">
      {hud.raceState !== "free" && (
        <div className="hud-race">
          <div className="hud-timer">{formatTime(hud.raceTimeMs ?? 0)}</div>
          <div className="hud-rings">
            {hud.raceState === "finished"
              ? "Finished"
              : `Ring ${Math.min(hud.checkpoints + 1, hud.totalCheckpoints)} / ${hud.totalCheckpoints}`}
          </div>
        </div>
      )}

      {hud.countdown !== null && hud.countdown > 0 && (
        <div className="hud-big" key={hud.countdown}>
          {hud.countdown}
        </div>
      )}
      {go && <div className="hud-big go">GO!</div>}
      {hud.crashed && <div className="hud-big crashed">Crashed!</div>}

      {hud.standings.length > 1 && (
        <ol className="hud-standings">
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

      <div className="hud-flight">
        <div className="hud-speed">
          <strong>{hud.speedKmh}</strong> km/h
        </div>
        <div className="hud-proximity" title="Proximity">
          <div style={{ width: `${Math.round(hud.proximity * 100)}%` }} />
        </div>
        <div className="hud-style">
          Style {hud.style.toLocaleString()} {hud.multiplier > 1 && <b>×{hud.multiplier}</b>}
        </div>
        <div className="hud-altitude">{hud.altitude} m above ground</div>
      </div>

      {!hud.locked && (
        <div className="hud-hint">
          {racing ? "Click to steer with the mouse" : "Click the view to steer with the mouse"} · keys and
          gamepads work anytime
        </div>
      )}
    </div>
  );
};

export default Hud;
