import { type FormEvent, useEffect, useState } from "react";
import { type LeaderboardEntry, type User, getLeaderboard } from "../api";
import type { Screen } from "../App";
import { randomRoomCode } from "../format";
import { dailySeed, randomSeed } from "../game/rng";
import { type Settings, clientId } from "../storage";
import Controls from "./Controls";
import Leaderboard from "./Leaderboard";
import "./Menu.css";

interface MenuProps {
  me: User | null;
  settings: Settings;
  onSettings: (settings: Settings) => void;
  joinCode?: string;
  go: (screen: Screen) => void;
}

const Menu = ({ me, settings, onSettings, joinCode, go }: MenuProps) => {
  const [daily] = useState(() => dailySeed());
  const [code, setCode] = useState(joinCode ?? "");
  const [seedText, setSeedText] = useState("");
  const [board, setBoard] = useState<LeaderboardEntry[]>([]);

  useEffect(() => {
    getLeaderboard(daily, clientId())
      .then(setBoard)
      .catch(() => {});
  }, [daily]);

  const joinRoom = (e: FormEvent) => {
    e.preventDefault();
    const room = code.trim().toUpperCase();
    if (/^[A-Z0-9]{3,8}$/.test(room)) go({ kind: "room", code: room });
  };

  const flySeed = (e: FormEvent) => {
    e.preventDefault();
    const seed = Number(seedText);
    if (Number.isInteger(seed) && seed >= 1 && seed < 2 ** 31) go({ kind: "solo", seed });
  };

  return (
    <main className="menu">
      <header className="menu-title">
        <h1>
          Wing<span>race</span>
        </h1>
        <p>Wingsuit races down endless mountain valleys. Skim the pines, beat your friends to the last ring.</p>
      </header>

      <section className="menu-card pilot">
        <h2>Pilot</h2>
        {me?.verified ? (
          <p>
            Flying as <strong>{me.name}</strong>
          </p>
        ) : (
          <label className="field">
            <span>Your name</span>
            <input
              value={settings.nickname}
              maxLength={24}
              placeholder="Guest"
              onChange={(e) => onSettings({ ...settings, nickname: e.target.value })}
            />
          </label>
        )}
        <Controls settings={settings} onSettings={onSettings} />
      </section>

      <section className={`menu-card race ${joinCode ? "highlight" : ""}`}>
        <h2>Race friends</h2>
        <p className="hint">Everyone in a room flies the same map at the same time.</p>
        <form onSubmit={joinRoom} className="row">
          <input
            value={code}
            onChange={(e) => setCode(e.target.value.toUpperCase())}
            placeholder="Room code"
            maxLength={8}
            aria-label="Room code"
            autoFocus={!!joinCode}
          />
          <button type="submit" disabled={!/^[A-Za-z0-9]{3,8}$/.test(code.trim())}>
            Join
          </button>
        </form>
        <button className="primary" onClick={() => go({ kind: "room", code: randomRoomCode() })}>
          Create a room
        </button>
      </section>

      <section className="menu-card solo">
        <h2>Time trial</h2>
        <p className="hint">Race the clock and the ghosts of the fastest runs.</p>
        <button className="primary" onClick={() => go({ kind: "solo", seed: daily })}>
          Today's course <small>#{daily}</small>
        </button>
        <div className="row">
          <button onClick={() => go({ kind: "solo", seed: randomSeed() })}>Random course</button>
          <form onSubmit={flySeed} className="row">
            <input
              value={seedText}
              onChange={(e) => setSeedText(e.target.value.replace(/\D/g, ""))}
              placeholder="Seed"
              inputMode="numeric"
              aria-label="Seed"
            />
            <button type="submit" disabled={!seedText}>
              Fly
            </button>
          </form>
        </div>
        <h3>Today's best</h3>
        <Leaderboard entries={board} empty="No times yet. Be the first!" />
      </section>
    </main>
  );
};

export default Menu;
