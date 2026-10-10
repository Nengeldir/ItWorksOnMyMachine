import { type ReactNode, useEffect, useEffectEvent, useRef, useState, useSyncExternalStore } from "react";
import type { Screen } from "../App";
import { formatTime, ordinal } from "../format";
import { webglAvailable } from "../game/webgl";
import type { BiomeId } from "../game/world/biomes";
import { RUN } from "../game/tuning";
import { UPGRADES } from "../game/run/upgrades";
import { BIOMES } from "../game/world/biomes";
import { ExploreSession } from "../session/ExploreSession";
import { RunSession } from "../session/RunSession";
import { RunHud, TitleCard, UpgradePicker } from "./RunHud";
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
  const { hud, stage, result, leaderboard, ghosts, error } = useSyncExternalStore(
    session.store.subscribe,
    session.store.get,
  );

  useHotkeys({
    Enter: () => stage !== "racing" && session.start(),
    Backspace: () => stage === "racing" && session.abort(),
  });

  return (
    <div className="game">
      <div ref={ref} className="game-view" />
      {hud && <Hud hud={hud} />}
      <TopBar title={`Time trial · course #${seed}${hud ? ` · ${hud.paletteName}` : ""}`} onExit={onExit} />
      {error && <div className="banner">{error}</div>}

      {stage === "ready" && !error && (
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

// --- Explore ---------------------------------------------------------------------

const ExploreScreen = ({ biome, seed, settings, onExit }: ScreenProps & { biome: BiomeId; seed: number }) => {
  const [session] = useState(() => new ExploreSession(biome, seed, settings));
  const ref = useMountedSession(session, settings);
  const { hud, error } = useSyncExternalStore(session.store.subscribe, session.store.get);
  return (
    <div className="game">
      <div ref={ref} className="game-view" />
      {hud && <Hud hud={hud} />}
      <TopBar title={`Explore · ${hud ? `${hud.biomeName} · ${hud.paletteName}` : ""} · #${seed}`} onExit={onExit} />
      {error && <div className="banner">{error}</div>}
    </div>
  );
};

// --- Roguelike run ------------------------------------------------------------------

const RunScreen = ({ seed, settings, onSettings, onExit, onNewRun }: ScreenProps & { seed: number; onNewRun: () => void }) => {
  const [session] = useState(() => new RunSession(seed, settings));
  const ref = useMountedSession(session, settings);
  const { hud, stage, offers, secret, next, arrived, summary, best, error } = useSyncExternalStore(session.store.subscribe, session.store.get);
  const run = hud?.run ?? null;

  useHotkeys({
    Enter: () => {
      if (stage === "intro") session.begin();
      else if (stage === "summary") session.again();
    },
    KeyN: () => stage === "summary" && onNewRun(),
  });

  // The title card shows for the run's "arrive" phase, its first seconds in a biome
  const showTitle = arrived && run?.phase === "arrive" && stage === "flying";

  return (
    <div className="game">
      <div ref={ref} className="game-view" />
      {hud && stage !== "pick" && <Hud hud={hud} />}
      {run && stage !== "intro" && stage !== "summary" && stage !== "pick" && <RunHud run={run} compassScale={RUN.compass} />}
      {showTitle && arrived && <TitleCard level={arrived.level} length={run!.length} biome={arrived.biome} />}
      <TopBar
        title={`Run #${seed}${run ? ` · level ${run.level}/${run.length} · ${run.biome} · ${run.mood}` : ""}`}
        onExit={onExit}
      />
      {error && <div className="banner">{error}</div>}

      {stage === "intro" && !error && (
        <aside className="panel">
          <h2>Run #{seed}</h2>
          <p>
            Fly through eight biomes, from Sky Isles to the Aurora Summit. Every level ends at a portal: fly into it
            and choose an upgrade. Gates score more in a chain, skimming the land earns style, and each biome has two
            sidequests. Finish one and a secret portal opens to another biome, with rarer gifts.
          </p>
          <p className="hint">
            You have {3} feathers: each crash costs one. Abilities you pick up: <kbd>Shift</kbd> dash, <kbd>Space</kbd>{" "}
            wingbeat, hold <kbd>F</kbd> to hover. The arrow at the top points to the portal.
          </p>
          {best !== null && <p>Your best on this run: {best.toLocaleString()}</p>}
          <button className="primary" onClick={() => session.begin()}>
            Take off <kbd>Enter</kbd>
          </button>
          <details>
            <summary>Controls</summary>
            <Controls settings={settings} onSettings={onSettings} />
          </details>
        </aside>
      )}

      {stage === "pick" && <UpgradePicker offers={offers} secret={secret} next={next} onPick={(id) => session.pick(id)} />}

      {stage === "summary" && summary && (
        <aside className="panel results">
          <h2>{summary.won ? "The summit!" : "Out of feathers"}</h2>
          <p>
            <strong>{summary.score.toLocaleString()}</strong> points
            {best === null || summary.score > best ? " · a new best on this run!" : ` · your best is ${best.toLocaleString()}`}
          </p>
          <p>
            {summary.levels} of 8 biomes: {summary.path.map((b) => BIOMES[b].name).join(" → ")}
          </p>
          <p>
            {summary.sidequests} sidequest{summary.sidequests === 1 ? "" : "s"} done
            {summary.upgrades.length > 0 && <> · {summary.upgrades.map((id) => UPGRADES.find((u) => u.id === id)?.icon).join(" ")}</>}
          </p>
          <div className="row">
            <button className="primary" onClick={() => session.again()}>
              Fly it again <kbd>Enter</kbd>
            </button>
            <button onClick={onNewRun}>
              New run <kbd>N</kbd>
            </button>
          </div>
        </aside>
      )}
    </div>
  );
};

/** Shown instead of the game when the browser can't create a WebGL context */
const NoWebGL = ({ onExit }: { onExit: () => void }) => (
  <div className="game">
    <TopBar title="Wingrace" onExit={onExit} />
    <aside className="panel no-webgl">
      <h2>Your browser has 3D graphics turned off</h2>
      <p>
        Wingrace needs WebGL 2, and this browser won't create a WebGL context. That's a browser setting, not a
        problem with the server. Usually one of these fixes it:
      </p>
      <ol>
        <li>
          Turn on hardware acceleration. In Chrome or Edge it's under Settings → System → "Use graphics
          acceleration when available". Then relaunch the browser.
        </li>
        <li>
          Restart the browser completely. After its GPU process crashes a few times, Chrome turns WebGL off until
          the next restart.
        </li>
        <li>
          Open <code>chrome://gpu</code> and check that WebGL says "Hardware accelerated". If your GPU is
          blocklisted, try enabling <code>chrome://flags/#ignore-gpu-blocklist</code>, or use another browser.
        </li>
      </ol>
      <button className="primary" onClick={() => location.reload()}>
        Try again
      </button>
    </aside>
  </div>
);

const GameScreen = ({ screen, onNewRun, ...props }: ScreenProps & { screen: Exclude<Screen, { kind: "menu" }>; onNewRun: () => void }) => {
  if (!webglAvailable()) return <NoWebGL onExit={props.onExit} />;
  if (screen.kind === "explore") return <ExploreScreen biome={screen.biome} seed={screen.seed} {...props} />;
  if (screen.kind === "run") return <RunScreen seed={screen.seed} onNewRun={onNewRun} {...props} />;
  return screen.kind === "solo" ? (
    <SoloScreen seed={screen.seed} {...props} />
  ) : (
    <RoomScreen code={screen.code} {...props} />
  );
};

export default GameScreen;
