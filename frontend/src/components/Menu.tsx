import { IconSettings, IconUser, IconX } from "@tabler/icons-react";
import { type FormEvent, useEffect, useState } from "react";
import { type LeaderboardEntry, type User, getLeaderboard } from "../api";
import type { Screen } from "../App";
import { randomRoomCode } from "../format";
import { dailySeed, randomSeed } from "../game/rng";
import { Course } from "../game/world/course";
import { paletteFor } from "../game/world/palette";
import { type Settings, clientId } from "../storage";
import { useUiTheme } from "../theme";
import Controls from "./Controls";
import MenuBackdrop from "./MenuBackdrop";
import TodaysBest from "./TodaysBest";
import "./Menu.css";

interface MenuProps {
  me: User | null;
  settings: Settings;
  onSettings: (settings: Settings) => void;
  joinCode?: string;
  go: (screen: Screen) => void;
}

/** Until the next UTC midnight, when the daily course changes */
function untilTomorrow(): string {
  const now = new Date();
  const ms = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1) - now.getTime();
  const s = Math.floor(ms / 1000);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${Math.floor(s / 3600)}:${pad(Math.floor(s / 60) % 60)}:${pad(s % 60)}`;
}

const Menu = ({ me, settings, onSettings, joinCode, go }: MenuProps) => {
  const [daily] = useState(() => dailySeed());
  const [course] = useState(() => ({ palette: paletteFor(daily).name, gates: new Course(daily).rings.length }));
  const [tab, setTab] = useState<"solo" | "friends">(joinCode ? "friends" : "solo");
  const [code, setCode] = useState(joinCode ?? "");
  const [seedText, setSeedText] = useState("");
  const [board, setBoard] = useState<LeaderboardEntry[]>([]);
  const [panel, setPanel] = useState<"none" | "settings" | "pilot">(joinCode && !settings.nickname ? "pilot" : "none");
  const [countdown, setCountdown] = useState(untilTomorrow);
  useUiTheme(daily);

  useEffect(() => {
    getLeaderboard(daily, clientId())
      .then(setBoard)
      .catch(() => {});
  }, [daily]);

  useEffect(() => {
    const timer = setInterval(() => setCountdown(untilTomorrow()), 1000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    // Enter flies today's course, unless a field or button has the focus
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Enter" && e.target === document.body && tab === "solo") go({ kind: "solo", seed: daily });
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [daily, tab, go]);

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

  const pilotName = me?.verified ? me.name : settings.nickname || "Guest";

  return (
    <main className="menu">
      <MenuBackdrop seed={daily} mode="drift" />

      <button
        className="menu-icon glass settings-button"
        aria-label="Settings"
        onClick={() => setPanel(panel === "settings" ? "none" : "settings")}
      >
        <IconSettings size={22} />
      </button>
      {panel === "settings" && (
        <section className="menu-popover glass settings-panel">
          <header>
            <h2>Controls</h2>
            <button className="menu-icon" aria-label="Close" onClick={() => setPanel("none")}>
              <IconX size={18} />
            </button>
          </header>
          <Controls settings={settings} onSettings={onSettings} />
        </section>
      )}

      <header className="menu-title">
        <h1>Wingrace</h1>
        <p>Race through floating islands</p>
      </header>

      <section className="menu-card glass">
        <div className="menu-tabs" role="tablist">
          <button role="tab" aria-selected={tab === "solo"} onClick={() => setTab("solo")}>
            Solo
          </button>
          <button role="tab" aria-selected={tab === "friends"} onClick={() => setTab("friends")}>
            With friends
          </button>
        </div>

        {tab === "solo" ? (
          <>
            <div className="menu-course">
              <div>
                <small>Today's course · #{daily}</small>
                <b>{course.palette} isles</b>
              </div>
              <span>{course.gates} gates</span>
              <span>New in {countdown}</span>
            </div>
            <button className="primary" onClick={() => go({ kind: "solo", seed: daily })}>
              Fly today's course <kbd>Enter</kbd>
            </button>
            <div className="menu-more">
              <button className="menu-link" onClick={() => go({ kind: "solo", seed: randomSeed() })}>
                Random course
              </button>
              <form onSubmit={flySeed} className="menu-seed">
                <input
                  value={seedText}
                  onChange={(e) => setSeedText(e.target.value.replace(/\D/g, ""))}
                  placeholder="Seed"
                  inputMode="numeric"
                  aria-label="Seed"
                />
                <button type="submit" className="menu-link" disabled={!seedText}>
                  Fly
                </button>
              </form>
            </div>
          </>
        ) : (
          <>
            <p className="menu-hint">Everyone in a room flies the same map at the same time.</p>
            <button className="primary" onClick={() => go({ kind: "room", code: randomRoomCode() })}>
              Create a room
            </button>
            <form onSubmit={joinRoom} className="menu-join">
              <input
                value={code}
                onChange={(e) => setCode(e.target.value.toUpperCase())}
                placeholder="Room code"
                maxLength={8}
                aria-label="Room code"
                autoFocus={!!joinCode}
              />
              <button type="submit" className="primary" disabled={!/^[A-Za-z0-9]{3,8}$/.test(code.trim())}>
                Join
              </button>
            </form>
          </>
        )}
      </section>

      <TodaysBest entries={board} />

      {panel === "pilot" && (
        <section className="menu-popover glass pilot-panel">
          <header>
            <h2>Pilot</h2>
            <button className="menu-icon" aria-label="Close" onClick={() => setPanel("none")}>
              <IconX size={18} />
            </button>
          </header>
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
                autoFocus
                onChange={(e) => onSettings({ ...settings, nickname: e.target.value })}
              />
            </label>
          )}
        </section>
      )}
      <button
        className="menu-pilot glass"
        aria-label={`Pilot: ${pilotName}`}
        onClick={() => setPanel(panel === "pilot" ? "none" : "pilot")}
      >
        <span className="menu-badge">
          <IconUser size={22} />
        </span>
        {pilotName}
      </button>
    </main>
  );
};

export default Menu;
