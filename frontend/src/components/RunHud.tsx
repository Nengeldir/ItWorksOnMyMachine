import { useEffect } from "react";
import { formatTime } from "../format";
import type { RunHud as RunHudState, RunSummary } from "../game/run/run";
import { UPGRADES, type Upgrade, type UpgradeId } from "../game/run/upgrades";
import type { BindingAction } from "../game/bindings";
import { BIOMES, type BiomeId } from "../game/world/biomes";
import { boundKeys } from "./keys";
import "./RunHud.css";

const icon = (id: UpgradeId) => UPGRADES.find((u) => u.id === id)?.icon ?? "•";

// Abilities use the keys the player bound in the settings, not the defaults written in the upgrades
const TOUCH_ABILITY: Partial<Record<UpgradeId, string>> = {
  dash: "Hold Boost", flap: "Tap Flap", hoverStall: "Tap Hover",
  plunge: "Tap Plunge", galeForce: "Tap Gale", windShear: "Tap ‹ or ›",
};

const ABILITY_ACTIONS: Partial<Record<UpgradeId, BindingAction>> = {
  dash: "boost",
  flap: "flap",
  hoverStall: "hover",
  plunge: "plunge",
  galeForce: "burst",
};

/** The ability's key as bound now, else the upgrade's own label */
function abilityKey(id: UpgradeId, fallback: string): string {
  const action = ABILITY_ACTIONS[id];
  const key = action ? boundKeys(action)[0]?.[0] : undefined;
  return key ?? fallback;
}

/** The run on top of the flight HUD: score, objectives, the portal compass, abilities */
export const RunHud = ({ run, compassScale, toasts }: { run: RunHudState; compassScale: number; toasts: boolean }) => (
  <div className="run-hud">
    {/* Like the race timer: a glass pill at the top, the score big, where you are small */}
    <div className="run-score glass">
      <strong>{run.score.toLocaleString()}</strong>
      <span>
        Level {run.level} / {run.length}
        {run.chain > 1 && <b className="run-chain"> · chain ×{run.chain}</b>}
      </span>
    </div>

    {run.compass && run.phase !== "pick" && run.phase !== "portal" && (
      <div className="run-compass" style={{ transform: `translateX(-50%) scale(${compassScale})` }}>
        <div className="arrow" style={{ transform: `rotate(${run.compass.angle}rad)` }}>
          ▲
        </div>
        <div className="label">
          portal · {run.compass.distance} m{run.compass.ahead ? "" : " · behind you"}
        </div>
      </div>
    )}

    {run.objectives.length > 0 && (
      <ul className="run-objectives glass">
        {run.objectives.map((o) => (
          <li key={o.title} className={o.done ? "done" : o.failed ? "failed" : undefined}>
            <span className="check">{o.done ? "✔" : o.failed ? "✖" : "◇"}</span>
            <span className="title">{o.title}</span>
            <span className="progress">{o.progress}</span>
            {!o.done && !o.failed && o.fraction > 0 && (
              <span className="bar">
                <span style={{ width: `${Math.round(o.fraction * 100)}%` }} />
              </span>
            )}
          </li>
        ))}
      </ul>
    )}

    {run.abilities.length > 0 && (
      <div className="run-abilities">
        {run.abilities.map((a) => (
          <div key={a.id} className={`glass ${a.ready ? "ready" : ""}`}>
            <span className="icon">{icon(a.id)}</span>
            <span className="key">{abilityKey(a.id, a.key)}</span>
            {a.count !== undefined && <span className="count">{a.count}</span>}
            <span className="charge" style={{ height: `${Math.round(Math.min(1, a.charge) * 100)}%` }} />
          </div>
        ))}
      </div>
    )}

    {run.upgrades.length > 0 && (
      <div className="run-upgrades" title="Upgrades">
        {run.upgrades.map((id, i) => (
          <span key={i}>{icon(id)}</span>
        ))}
      </div>
    )}

    {toasts && run.toast && (
      <div className="run-toast glass" key={run.toast.id}>
        {run.toast.text}
        {run.toast.points > 0 && <b> +{run.toast.points.toLocaleString()}</b>}
      </div>
    )}
  </div>
);

/** "Level 3 · Coral Lagoon", over the land as you arrive */
export const TitleCard = ({ level, length, biome }: { level: number; length: number; biome: BiomeId }) => (
  <div className="run-title" key={`${level}/${biome}`}>
    <small>
      Level {level} of {length}
    </small>
    <h2>{BIOMES[biome].name}</h2>
    <p>{BIOMES[biome].tagline}</p>
  </div>
);

/**
 * The finish screen, over the default sky map flown on autopilot: the run's
 * stats on a translucent card, and the next actions in a column beside it
 */
export const FinishScreen = ({
  summary,
  best,
  onAgain,
  onNewRun,
  onMenu,
  testMode = false,
}: {
  summary: RunSummary;
  best: number | null;
  onAgain: () => void;
  onNewRun?: () => void;
  onMenu: () => void;
  testMode?: boolean;
}) => {
  const verdict = testMode ? "test result · not saved" :
    best === null || summary.score > best ? "a new best on this run" : summary.score === best ? "ties your best" : `your best: ${best.toLocaleString()}`;
  const stats: [string, string][] = [
    ["Flying time", formatTime(summary.timeMs)],
    ["Biomes", `${summary.levels} of 8`],
    ["Gates", summary.gates.toLocaleString()],
    ["Best chain", `×${summary.bestChain}`],
    ["Style", summary.style.toLocaleString()],
    ["Crashes", summary.crashes.toLocaleString()],
  ];
  return (
    <div className="run-finish">
      <section className="finish-card">
        <small>{testMode ? "Test" : "Run"} #{summary.seed} · complete</small>
        <h2>Journey's end</h2>
        <div className="finish-score">
          <strong>{summary.score.toLocaleString()}</strong>
          <span>{verdict}</span>
        </div>
        <dl className="finish-stats">
          {stats.map(([label, value]) => (
            <div key={label}>
              <dt>{label}</dt>
              <dd>{value}</dd>
            </div>
          ))}
        </dl>
        <ol className="finish-path">
          {summary.path.map((b, i) => (
            <li key={i}>{BIOMES[b].name}</li>
          ))}
        </ol>
        {summary.upgrades.length > 0 && (
          <p className="finish-upgrades">
            {summary.upgrades.map((id, i) => (
              <span key={i} title={UPGRADES.find((u) => u.id === id)?.name}>
                {icon(id)}
              </span>
            ))}
          </p>
        )}
      </section>
      <nav className="finish-actions">
        <button className="primary" onClick={onAgain}>
          Fly it again <kbd>Enter</kbd>
        </button>
        {onNewRun && <button onClick={onNewRun}>
          New run <kbd>N</kbd>
        </button>}
        <button onClick={onMenu}>
          Return to menu <kbd>⌫</kbd>
        </button>
      </nav>
    </div>
  );
};

/** The upgrade picker, shown in the tunnel between biomes */
export const UpgradePicker = ({
  offers,
  next,
  onPick,
}: {
  offers: Upgrade[];
  next: BiomeId | null;
  onPick: (id: UpgradeId) => void;
}) => {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const n = Number(event.key);
      if (n >= 1 && n <= offers.length) onPick(offers[n - 1].id);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [offers, onPick]);
  return (
    <div className="run-picker">
      <h2>Choose an upgrade</h2>
      {next && (
        <p>
          The portal leads to <strong>{BIOMES[next].name}</strong>
        </p>
      )}
      <div className="cards">
        {offers.map((u, i) => (
          <button key={u.id} className={`card ${u.kind}`} onClick={() => onPick(u.id)}>
            <span className="icon">{u.icon}</span>
            <strong>{u.name}</strong>
            <span className="kind">{u.kind === "ability" ? <>
              ability <span className="no-touch">· {abilityKey(u.id, u.key ?? "")}</span>
              <span className="touch-only">· {TOUCH_ABILITY[u.id]}</span>
            </> : "passive"}</span>
            <span className="text">{u.description}</span>
            <kbd>{i + 1}</kbd>
          </button>
        ))}
      </div>
    </div>
  );
};
