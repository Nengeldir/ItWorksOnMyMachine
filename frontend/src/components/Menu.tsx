import { IconDice5, IconMap, IconSettings, IconUser, IconX } from "@tabler/icons-react";
import { type FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { type LeaderboardEntry, type User, getLeaderboard } from "../api";
import type { Screen } from "../App";
import { randomRoomCode } from "../format";
import { dailySeed, randomSeed } from "../game/rng";
import { raceLevel } from "../game/world/biomes";
import type { Level } from "../game/world/biomes/types";
import { Course } from "../game/world/course";
import { bestRun } from "../session/RunSession";
import { type Settings, clientId } from "../storage";
import { usePaletteTheme } from "../theme";
import SettingsPanel from "./SettingsPanel";
import BiomeSelect from "./BiomeSelect";
import CourseSelect from "./CourseSelect";
import { HelpButton } from "./Help";
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
  const [daily, setDaily] = useState(() => dailySeed());
  const course = useMemo(
    () => ({ palette: raceLevel(daily).palette.name, gates: new Course(daily).rings.length }),
    [daily],
  );
  const [tab, setTab] = useState<"solo" | "friends" | "adventure">(joinCode ? "friends" : "solo");
  const [code, setCode] = useState(joinCode ?? "");
  const [board, setBoard] = useState<LeaderboardEntry[]>([]);
  const best = useMemo(() => bestRun(daily), [daily]);
  const [panel, setPanel] = useState<"none" | "settings" | "pilot">(joinCode && !settings.nickname ? "pilot" : "none");
  const [countdown, setCountdown] = useState(untilTomorrow);
  // The map select shows its course behind the glass, and the UI takes its colors
  // The course select (Solo) or the map select (Adventure)
  const [picking, setPicking] = useState<"course" | "map" | null>(null);
  const [preview, setPreview] = useState<number | null>(null);
  const [previewLevel, setPreviewLevel] = useState<Level | null>(null);
  const shown = picking === "course" && preview !== null ? preview : daily;
  const level = picking === "map" ? previewLevel : null;
  const shownPalette = useMemo(() => raceLevel(shown).palette, [shown]);
  // Pictures of the courses the backdrop has shown, for the map select's cards
  const [art, setArt] = useState<Record<number, string>>({});
  const keepArt = useCallback((seed: number, url: string) => setArt((all) => ({ ...all, [seed]: url })), []);
  usePaletteTheme(level ? level.palette : shownPalette);

  useEffect(() => {
    getLeaderboard(daily, clientId())
      .then(setBoard)
      .catch(() => {});
  }, [daily]);

  useEffect(() => {
    // Past UTC midnight the countdown starts over, and today's course becomes the new one
    const timer = setInterval(() => {
      setCountdown(untilTomorrow());
      setDaily(dailySeed());
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    // Enter flies today's course (Solo) or run (Adventure), unless a field or button has the focus
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "Enter" || e.target !== document.body || picking) return;
      if (tab === "solo") go({ kind: "solo", seed: daily });
      else if (tab === "adventure") go({ kind: "run", seed: daily });
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [daily, tab, picking, go]);

  const joinRoom = (e: FormEvent) => {
    e.preventDefault();
    const room = code.trim().toUpperCase();
    if (/^[A-Z0-9]{3,8}$/.test(room)) go({ kind: "room", code: room });
  };

  const closePicker = () => {
    setPicking(null);
    setPreview(null);
    setPreviewLevel(null);
  };

  const pilotName = me?.verified ? me.name : settings.nickname || "Guest";

  return (
    <main className="menu">
      <MenuBackdrop seed={shown} level={level} mode="drift" onSnapshot={keepArt} settings={settings} />

      <HelpButton className="menu-help" />
      <button
        className="menu-icon glass settings-button"
        aria-label="Settings"
        onClick={() => setPanel(panel === "settings" ? "none" : "settings")}
      >
        <IconSettings size={22} />
      </button>
      {panel === "settings" && <SettingsPanel settings={settings} onSettings={onSettings} onClose={() => setPanel("none")} />}

      {picking === "map" ? (
        <BiomeSelect onPreview={setPreviewLevel} onStart={() => go({ kind: "run", seed: daily })} onBack={closePicker} />
      ) : picking === "course" ? (
        <CourseSelect
          daily={daily}
          countdown={countdown}
          art={art}
          onPreview={setPreview}
          onFly={(seed) => go({ kind: "solo", seed })}
          onBack={closePicker}
        />
      ) : (
        <>
          <header className="menu-title">
            <h1>WindRider</h1>
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
              <button role="tab" aria-selected={tab === "adventure"} onClick={() => setTab("adventure")}>
                Adventure
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
                  <button className="menu-link" onClick={() => setPicking("course")}>
                    <IconMap size={18} /> Choose a course
                  </button>
                </div>
              </>
            ) : tab === "adventure" ? (
              <>
                <div className="menu-course">
                  <div>
                    <small>Today's run · #{daily}</small>
                    <b>Eight biomes</b>
                  </div>
                  {best !== null && <span>Best {best.toLocaleString()}</span>}
                  <span>New in {countdown}</span>
                </div>
                <button className="primary" onClick={() => go({ kind: "run", seed: daily })}>
                  Start today's run <kbd>Enter</kbd>
                </button>
                <div className="menu-more">
                  <button className="menu-link" onClick={() => setPicking("map")}>
                    <IconMap size={18} /> Choose a map
                  </button>
                  <button className="menu-link" onClick={() => go({ kind: "run", seed: randomSeed() })}>
                    <IconDice5 size={18} /> New random run
                  </button>
                  {import.meta.env.DEV && (
                    <button className="menu-link" onClick={() => go({ kind: "explore", biome: "skyIsles", seed: 1 })}>
                      Debug: explore worlds
                    </button>
                  )}
                </div>
              </>
            ) : (
              <>
                <div className="menu-course">
                  <div>
                    <small>Race room</small>
                    <b>Same map, same time</b>
                  </div>
                  <span>Up to 12 pilots</span>
                </div>
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
                  <button type="submit" disabled={!/^[A-Za-z0-9]{3,8}$/.test(code.trim())}>
                    Join
                  </button>
                </form>
              </>
            )}
          </section>
        </>
      )}

      {!picking && <TodaysBest entries={board} />}

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
