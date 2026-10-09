import { type ReactNode, useEffect, useEffectEvent, useRef, useState, useSyncExternalStore } from "react";
import type { Screen } from "../App";
import { formatTime, ordinal } from "../format";
import { RoomSession } from "../session/RoomSession";
import { SoloSession } from "../session/SoloSession";
import { type Settings, clientId } from "../storage";
import Controls from "./Controls";
import Hud from "./Hud";
import Leaderboard from "./Leaderboard";
import "./GameScreen.css";

interface Mountable {
  mount(container: HTMLElement): void;
  unmount(): void;
  setSettings(settings: Settings): void;
}

/** Attaches a session's game to a div for as long as the component lives */
function useMountedSession(session: Mountable, settings: Settings) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    session.mount(ref.current!);
    return () => session.unmount();
  }, [session]);
  useEffect(() => session.setSettings(settings), [session, settings]);
  return ref;
}

/** Keyboard shortcuts for the panels, since the mouse is often locked to the game */
function useHotkeys(keys: Record<string, () => void>) {
  const onKeyDown = useEffectEvent((event: KeyboardEvent) => {
    const target = event.target as HTMLElement | null;
    if (target && ["INPUT", "BUTTON", "TEXTAREA"].includes(target.tagName)) return;
    keys[event.code]?.();
  });
  useEffect(() => {
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);
}

interface ScreenProps {
  settings: Settings;
  onSettings: (settings: Settings) => void;
  onExit: () => void;
}

const TopBar = ({ title, onExit, children }: { title: string; onExit: () => void; children?: ReactNode }) => (
  <div className="topbar">
    <button onClick={onExit}>← Menu</button>
    <span className="topbar-title">{title}</span>
    {children}
  </div>
);

// --- Time trial ------------------------------------------------------------------

const SoloScreen = ({ seed, settings, onSettings, onExit }: ScreenProps & { seed: number }) => {
  const [session] = useState(() => new SoloSession(seed, clientId(), settings));
  const ref = useMountedSession(session, settings);
  const { hud, stage, result, leaderboard, ghosts } = useSyncExternalStore(session.store.subscribe, session.store.get);

  useHotkeys({
    Enter: () => stage !== "racing" && session.start(),
    Backspace: () => stage === "racing" && session.abort(),
  });

  return (
    <div className="game">
      <div ref={ref} className="game-view" />
      {hud && <Hud hud={hud} />}
      <TopBar title={`Time trial · course #${seed}${hud ? ` · ${hud.paletteName}` : ""}`} onExit={onExit} />

      {stage === "ready" && (
        <aside className="panel">
          <h2>Course #{seed}</h2>
          <p>
            Fly through all the rings, in order, as fast as you can. Warm up first if you like: the clock only starts
            when you do.
          </p>
          <button className="primary" onClick={() => session.start()}>
            Start the run <kbd>Enter</kbd>
          </button>
          <h3>Best times</h3>
          <Leaderboard entries={leaderboard} empty="No times yet on this course." />
          <details>
            <summary>Controls</summary>
            <Controls settings={settings} onSettings={onSettings} />
          </details>
        </aside>
      )}

      {stage === "racing" && ghosts.length > 0 && hud?.raceState !== "finished" && (
        <div className="ghost-note">Racing the ghosts of {ghosts.join(", ")}</div>
      )}

      {stage === "results" && result && (
        <aside className="panel results">
          <h2>{formatTime(result.timeMs)}</h2>
          {result.saving && <p>Saving your time…</p>}
          {result.error && <p className="error">{result.error}</p>}
          {result.rank !== undefined && (
            <p>
              <strong>{ordinal(result.rank)}</strong> on this course
              {result.personalBestMs !== undefined && result.personalBestMs < result.timeMs && (
                <> · your best is {formatTime(result.personalBestMs)}</>
              )}
              {result.personalBestMs === result.timeMs && <> · new personal best!</>}
            </p>
          )}
          <button className="primary" onClick={() => session.start()}>
            Fly again <kbd>Enter</kbd>
          </button>
          <h3>Best times</h3>
          <Leaderboard entries={leaderboard} empty="No times yet on this course." />
        </aside>
      )}
    </div>
  );
};

// --- Race room -------------------------------------------------------------------

const RoomScreen = ({ code, settings, onExit }: ScreenProps & { code: string }) => {
  const [session] = useState(
    () => new RoomSession(code, { clientId: clientId(), nickname: settings.nickname }, settings),
  );
  const ref = useMountedSession(session, settings);
  const { hud, connection, message, room, selfId, lastPlace } = useSyncExternalStore(
    session.store.subscribe,
    session.store.get,
  );
  const [copied, setCopied] = useState(false);
  const me = room?.players.find((p) => p.id === selfId);
  const lobby = room?.phase === "lobby";
  const inviteLink = `${location.origin}/?room=${code}`;

  useHotkeys({
    Enter: () => lobby && session.start(),
    KeyN: () => lobby && session.newMap(),
  });

  const copyInvite = () => {
    navigator.clipboard
      ?.writeText(inviteLink)
      .then(() => setCopied(true))
      .catch(() => {});
  };

  return (
    <div className="game">
      <div ref={ref} className="game-view" />
      {hud && <Hud hud={hud} />}
      <TopBar title={`Room ${code}${hud ? ` · course #${hud.seed} · ${hud.paletteName}` : ""}`} onExit={onExit}>
        <span className={`connection ${connection}`}>{connection === "connected" ? "online" : connection}</span>
      </TopBar>

      {(connection !== "connected" || message) && (
        <div className="banner">{message ?? "Connecting to the room…"}</div>
      )}

      {room && lobby && (
        <aside className="panel">
          <h2>Room {code}</h2>
          <div className="invite">
            <input readOnly value={inviteLink} aria-label="Invite link" onFocus={(e) => e.target.select()} />
            <button onClick={copyInvite}>{copied ? "Copied" : "Copy"}</button>
          </div>
          <h3>Pilots</h3>
          <ul className="pilots">
            {room.players.map((p) => (
              <li key={p.id}>
                <span className="dot" style={{ background: p.color }} />
                {p.name}
                {p.id === selfId && <span className="you">you</span>}
              </li>
            ))}
          </ul>
          {room.results.length > 0 && (
            <>
              <h3>Last race</h3>
              <ol className="leaderboard">
                {room.results.map((r, i) => (
                  <li key={r.id} className={r.id === selfId ? "me" : undefined}>
                    <span className="rank">{i + 1}</span>
                    <span className="name">{r.name}</span>
                    <span className="time">{formatTime(r.time_ms)}</span>
                  </li>
                ))}
              </ol>
            </>
          )}
          <p className="hint">Fly around while everyone joins. Anyone can start the race.</p>
          <div className="row">
            <button className="primary" onClick={() => session.start()}>
              Start race <kbd>Enter</kbd>
            </button>
            <button onClick={() => session.newMap()}>
              New map <kbd>N</kbd>
            </button>
          </div>
        </aside>
      )}

      {room && !lobby && me && !me.racing && (
        <div className="banner">Race in progress: you're in the next one. Fly around meanwhile.</div>
      )}

      {room && !lobby && me?.finish_ms != null && (
        <aside className="panel results">
          <h2>{formatTime(me.finish_ms)}</h2>
          {lastPlace !== null && (
            <p>
              You finished <strong>{ordinal(lastPlace)}</strong>. Waiting for the others…
            </p>
          )}
        </aside>
      )}
    </div>
  );
};

const GameScreen = ({ screen, ...props }: ScreenProps & { screen: Exclude<Screen, { kind: "menu" }> }) =>
  screen.kind === "solo" ? <SoloScreen seed={screen.seed} {...props} /> : <RoomScreen code={screen.code} {...props} />;

export default GameScreen;
