import { useEffect } from "react";
import type { RunHud as RunHudState } from "../game/run/run";
import { UPGRADES, type Upgrade, type UpgradeId } from "../game/run/upgrades";
import { BIOMES, type BiomeId } from "../game/world/biomes";
import "./RunHud.css";

const icon = (id: UpgradeId) => UPGRADES.find((u) => u.id === id)?.icon ?? "•";

/** The run on top of the flight HUD: score, feathers, objectives, the portal compass, abilities */
export const RunHud = ({ run, compassScale }: { run: RunHudState; compassScale: number }) => (
  <div className="run-hud">
    <div className="run-score">
      <strong>{run.score.toLocaleString()}</strong>
      {run.chain > 1 && <span className="run-chain">gate chain ×{run.chain}</span>}
    </div>

    <div className="run-lives" title="Feathers: crashes left">
      {Array.from({ length: Math.max(run.lives, 0) }, (_, i) => (
        <span key={i}>🪶</span>
      ))}
      {run.lives === 0 && <span className="last">last feather</span>}
    </div>

    {run.compass && run.phase !== "pick" && run.phase !== "portal" && (
      <div className={`run-compass ${run.compass.secret ? "secret" : ""}`} style={{ transform: `translateX(-50%) scale(${compassScale})` }}>
        <div className="arrow" style={{ transform: `rotate(${run.compass.angle}rad)` }}>
          ▲
        </div>
        <div className="label">
          {run.compass.secret ? "secret portal" : "portal"} · {run.compass.distance} m{run.compass.ahead ? "" : " · behind you"}
        </div>
      </div>
    )}

    <ul className="run-objectives">
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

    {run.timer !== null && <div className="run-timer">{Math.ceil(run.timer)}</div>}

    {run.abilities.length > 0 && (
      <div className="run-abilities">
        {run.abilities.map((a) => (
          <div key={a.id} className={a.ready ? "ready" : undefined}>
            <span className="icon">{icon(a.id)}</span>
            <span className="key">{a.key}</span>
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

    {run.toast && (
      <div className="run-toast" key={run.toast.id}>
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

/** The upgrade picker, shown in the tunnel between biomes */
export const UpgradePicker = ({
  offers,
  secret,
  next,
  onPick,
}: {
  offers: Upgrade[];
  secret: boolean;
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
      <h2>{secret ? "A secret way: choose a rare gift" : "Choose an upgrade"}</h2>
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
            <span className="kind">{u.kind === "ability" ? `ability · ${u.key}` : "passive"}</span>
            <span className="text">{u.description}</span>
            <kbd>{i + 1}</kbd>
          </button>
        ))}
      </div>
    </div>
  );
};
