import { IconArrowLeft, IconCheck, IconChevronDown, IconChevronUp, IconCopy } from "@tabler/icons-react";
import { type ReactNode, useEffect, useEffectEvent, useRef, useState, useSyncExternalStore } from "react";
import type { Screen } from "../App";
import { formatTime, ordinal } from "../format";
import { RoomSession } from "../session/RoomSession";
import { SoloSession } from "../session/SoloSession";
import { useMediaToggle } from "../media";
import { type Settings, clientId } from "../storage";
import { useUiTheme } from "../theme";
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
    if (target && ["INPUT", "TEXTAREA"].includes(target.tagName)) return;
    const action = keys[event.code];
    if (!action || event.repeat) return;
    // Otherwise Enter would also click whichever button still has focus
    event.preventDefault();
    action();
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

interface TopBarProps {
  title: string;
  onExit: () => void;
  /** Set while leaving would cost something: Menu then asks first */
  leaveWarning?: string;
  children?: ReactNode;
}

const TopBar = ({ title, onExit, leaveWarning, children }: TopBarProps) => {
  const [confirming, setConfirming] = useState(false);
  return (
    <div className="topbar">
      <button className="glass" onClick={() => (leaveWarning ? setConfirming(true) : onExit())}>
        <IconArrowLeft size={18} /> Menu
      </button>
      <span className="topbar-title glass">{title}</span>
      {children}
      {confirming && leaveWarning && (
        <div className="leave-confirm glass" role="alertdialog" aria-label="Leave?">
          <p>{leaveWarning}</p>
          <div className="row">
            <button onClick={() => setConfirming(false)}>Keep flying</button>
            <button className="primary" onClick={onExit}>
              Leave
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

// Roomy screens show panels in full; narrow ones only the heading and the main buttons until opened
const ROOMY = "(min-width: 700px)";

interface PanelProps {
  head: ReactNode;
  /** Above the main buttons, while open */
  intro?: ReactNode;
  /** The main buttons: shown even when the panel is folded */
  actions?: ReactNode;
  className?: string;
  /** Below the main buttons, while open */
  children?: ReactNode;
}

const Panel = ({ head, intro, actions, className = "", children }: PanelProps) => {
  const [open, setOpen] = useMediaToggle(ROOMY);
  return (
    <aside className={`panel glass ${className}`}>
      <header className="panel-head">
        <div>{head}</div>
        <button
          className="panel-toggle"
          aria-label={open ? "Show less" : "Show more"}
          aria-expanded={open}
          onClick={() => setOpen(!open)}
        >
          {open ? <IconChevronUp size={18} /> : <IconChevronDown size={18} />}
        </button>
      </header>
      {open && intro}
      {actions}
      {open && children}
    </aside>
  );
};

// --- Time trial ------------------------------------------------------------------

const SoloScreen = ({ seed, settings, onSettings, onExit }: ScreenProps & { seed: number }) => {
  const [session] = useState(() => new SoloSession(seed, clientId(), settings));
  const ref = useMountedSession(session, settings);
  const { hud, stage, result, leaderboard, ghosts, error } = useSyncExternalStore(
    session.store.subscribe,
    session.store.get,
  );
  useUiTheme(seed);

  useHotkeys({
    Enter: () => stage !== "racing" && session.start(),
    Backspace: () => stage === "racing" && session.abort(),
  });

  return (
    <div className="game">
      <div ref={ref} className="game-view" />
      {hud && <Hud hud={hud} />}
      <TopBar
        // A new key per stage, so a confirmation left open doesn't come back with the next run
        key={stage}
        title={`Time trial · #${seed}${hud ? ` · ${hud.paletteName}` : ""}`}
        onExit={onExit}
        leaveWarning={stage === "racing" ? "Leave the run? This time won't count." : undefined}
      />
      {error && <div className="banner glass">{error}</div>}

      {stage === "ready" && !error && (
        <Panel
          head={
            <>
              <small>Time trial · #{seed}</small>
              <h2>{hud ? `${hud.paletteName} isles` : `Course #${seed}`}</h2>
              {hud && (
                <div className="chips">
                  <span>{hud.totalCheckpoints} gates</span>
                </div>
              )}
            </>
          }
          intro={
            <p>
              Fly through all the rings, in order, as fast as you can. Warm up first if you like: the clock only starts
              when you do.
            </p>
          }
          actions={
            <button className="primary" onClick={() => session.start()}>
              Start the run <kbd>Enter</kbd>
            </button>
          }
        >
          <h3>Best times</h3>
          <Leaderboard entries={leaderboard} empty="No times yet on this course." />
          <details>
            <summary>Controls</summary>
            <Controls settings={settings} onSettings={onSettings} />
          </details>
        </Panel>
      )}

      {stage === "racing" && ghosts.length > 0 && hud?.raceState !== "finished" && (
        <div className="ghost-note glass">Racing the ghosts of {ghosts.join(", ")}</div>
      )}

      {stage === "results" && result && (
        <Panel
          className="results"
          head={
            <>
              <small>Finished · #{seed}</small>
              <h2>{formatTime(result.timeMs)}</h2>
            </>
          }
          intro={
            <>
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
            </>
          }
          actions={
            <button className="primary" onClick={() => session.start()}>
              Fly again <kbd>Enter</kbd>
            </button>
          }
        >
          <h3>Best times</h3>
          <Leaderboard entries={leaderboard} empty="No times yet on this course." />
        </Panel>
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
  useUiTheme(hud?.seed);
  const me = room?.players.find((p) => p.id === selfId);
  const lobby = room?.phase === "lobby";
  const racing = !!room && !lobby && !!me?.racing && me.finish_ms == null;
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
      <TopBar
        // A new key per race, so a confirmation left open doesn't come back with the next one
        key={racing ? "racing" : "free"}
        title={`Room ${code}${hud ? ` · course #${hud.seed} · ${hud.paletteName}` : ""}`}
        onExit={onExit}
        leaveWarning={racing ? "Leave the race? You'll drop out of it." : undefined}
      >
        <span className={`connection glass ${connection}`}>
          <span className="dot" />
          {connection === "connected" ? "online" : connection}
        </span>
      </TopBar>

      {(connection !== "connected" || message) && (
        <div className="banner glass">{message ?? "Connecting to the room…"}</div>
      )}

      {room && lobby && (
        <Panel
          head={
            <>
              <small>
                Race room · {room.players.length} {room.players.length === 1 ? "pilot" : "pilots"}
              </small>
              <h2>Room {code}</h2>
            </>
          }
          actions={
            <div className="row">
              <button className="primary" onClick={() => session.start()}>
                Start race <kbd>Enter</kbd>
              </button>
              <button onClick={() => session.newMap()}>
                New map <kbd>N</kbd>
              </button>
            </div>
          }
          intro={
            <>
              <div className="invite">
                <input readOnly value={inviteLink} aria-label="Invite link" onFocus={(e) => e.target.select()} />
                <button onClick={copyInvite}>
                  {copied ? <IconCheck size={18} /> : <IconCopy size={18} />}
                  {copied ? "Copied" : "Copy"}
                </button>
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
            </>
          }
        />
      )}

      {room && !lobby && me && !me.racing && (
        <div className="banner glass">Race in progress: you're in the next one. Fly around meanwhile.</div>
      )}

      {room && !lobby && me?.finish_ms != null && (
        <Panel
          className="results"
          head={
            <>
              <small>Finished · Room {code}</small>
              <h2>{formatTime(me.finish_ms)}</h2>
            </>
          }
          intro={
            lastPlace !== null && (
              <p>
                You finished <strong>{ordinal(lastPlace)}</strong>. Waiting for the others…
              </p>
            )
          }
        />
      )}
    </div>
  );
};

const GameScreen = ({ screen, ...props }: ScreenProps & { screen: Exclude<Screen, { kind: "menu" }> }) =>
  screen.kind === "solo" ? <SoloScreen seed={screen.seed} {...props} /> : <RoomScreen code={screen.code} {...props} />;

export default GameScreen;
