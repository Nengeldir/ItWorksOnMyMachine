import { IconArrowLeft, IconCheck, IconCopy } from "@tabler/icons-react";
import { type ReactNode, useEffect, useEffectEvent, useRef, useState, useSyncExternalStore } from "react";
import type { Screen } from "../App";
import { formatTime, ordinal } from "../format";
import { webglAvailable } from "../game/webgl";
import type { BiomeId } from "../game/world/biomes";
import { RUN } from "../game/tuning";
import { ExploreSession } from "../session/ExploreSession";
import { RunSession } from "../session/RunSession";
import { ITEMS } from "../game/items/models";
import type { ItemGallery } from "../game/items/gallery";
import { FinishScreen, RunHud, TitleCard, UpgradePicker } from "./RunHud";
import { RoomSession } from "../session/RoomSession";
import { SoloSession } from "../session/SoloSession";
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

const TopBar = ({ title, onExit, children }: { title: string; onExit: () => void; children?: ReactNode }) => (
  <div className="topbar">
    <button className="glass" onClick={onExit}>
      <IconArrowLeft size={18} /> Menu
    </button>
    <span className="topbar-title glass">{title}</span>
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
  useUiTheme(seed);

  useHotkeys({
    Enter: () => stage !== "racing" && session.start(),
    Backspace: () => stage === "racing" && session.abort(),
  });

  return (
    <div className="game">
      <div ref={ref} className="game-view" />
      {hud && <Hud hud={hud} />}
      <TopBar title={`Time trial · #${seed}${hud ? ` · ${hud.paletteName}` : ""}`} onExit={onExit} />
      {error && <div className="banner glass">{error}</div>}

      {stage === "ready" && !error && (
        <aside className="panel glass">
          <header className="panel-head">
            <small>Time trial · #{seed}</small>
            <h2>{hud ? `${hud.paletteName} isles` : `Course #${seed}`}</h2>
            {hud && (
              <div className="chips">
                <span>{hud.totalCheckpoints} gates</span>
              </div>
            )}
          </header>
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
        <div className="ghost-note glass">Racing the ghosts of {ghosts.join(", ")}</div>
      )}

      {stage === "results" && result && (
        <aside className="panel glass results">
          <header className="panel-head">
            <small>Finished · #{seed}</small>
            <h2>{formatTime(result.timeMs)}</h2>
          </header>
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
  useUiTheme(hud?.seed);
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
        <span className={`connection glass ${connection}`}>
          <span className="dot" />
          {connection === "connected" ? "online" : connection}
        </span>
      </TopBar>

      {(connection !== "connected" || message) && (
        <div className="banner glass">{message ?? "Connecting to the room…"}</div>
      )}

      {room && lobby && (
        <aside className="panel glass">
          <header className="panel-head">
            <small>Race room · {room.players.length} {room.players.length === 1 ? "pilot" : "pilots"}</small>
            <h2>Room {code}</h2>
          </header>
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
        <div className="banner glass">Race in progress: you're in the next one. Fly around meanwhile.</div>
      )}

      {room && !lobby && me?.finish_ms != null && (
        <aside className="panel glass results">
          <header className="panel-head">
            <small>Finished · Room {code}</small>
            <h2>{formatTime(me.finish_ms)}</h2>
          </header>
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
  const { hud, error, biome: current, mood, track, playing } = useSyncExternalStore(session.store.subscribe, session.store.get);

  // The mouse is often locked to the game, so everything has a key
  useHotkeys({
    KeyN: () => session.step(1),
    KeyB: () => session.step(-1),
    KeyV: () => session.stepMood(1),
  });

  const moods = BIOMES[current].moods;
  return (
    <div className="game">
      <div ref={ref} className="game-view" />
      {hud && <Hud hud={hud} />}
      <TopBar title={`Explore · ${hud ? `${hud.biomeName} · ${hud.paletteName}` : ""} · #${seed}`} onExit={onExit} />
      {error && <div className="banner">{error}</div>}
      <aside className="debug-panel glass">
        <h3>Worlds</h3>
        <div className="debug-row">
          {(Object.keys(BIOMES) as BiomeId[]).map((id) => (
            <button key={id} className={id === current ? "on" : ""} onClick={() => session.show(id)}>
              {BIOMES[id].name}
            </button>
          ))}
        </div>
        <h3>Light</h3>
        <div className="debug-row">
          {moods.map((m, i) => (
            <button key={m.name} className={i === mood ? "on" : ""} onClick={() => session.show(current, i)}>
              {m.name}
            </button>
          ))}
        </div>
        <p>
          Music for this world: <strong>{track}</strong>
          <br />
          Playing: <strong>{playing ?? "nothing yet (click the game, or still loading)"}</strong>
        </p>
        <p className="debug-keys">
          <kbd>N</kbd> next world · <kbd>B</kbd> previous · <kbd>V</kbd> next light
        </p>
      </aside>
    </div>
  );
};

// --- Roguelike run ------------------------------------------------------------------

const RunScreen = ({ seed, settings, onSettings, onExit, onNewRun }: ScreenProps & { seed: number; onNewRun: () => void }) => {
  const [session] = useState(() => new RunSession(seed, settings));
  const ref = useMountedSession(session, settings);
  const { hud, stage, offers, next, arrived, summary, best, error } = useSyncExternalStore(session.store.subscribe, session.store.get);
  const run = hud?.run ?? null;

  useHotkeys({
    Enter: () => {
      if (stage === "intro") session.begin();
      else if (stage === "summary") session.again();
      else if (run?.phase === "finale") session.skip();
    },
    KeyN: () => stage === "summary" && onNewRun(),
    Backspace: () => stage === "summary" && onExit(),
  });

  // The title card shows for the run's "arrive" phase, its first seconds in a biome
  const showTitle = arrived && run?.phase === "arrive" && stage === "flying";

  return (
    <div className="game">
      <div ref={ref} className="game-view" />
      {/* Nothing but the wormhole while passing through a portal */}
      {hud && (hud.paused || (stage !== "pick" && stage !== "summary" && run?.phase !== "portal" && run?.phase !== "finale" && run?.phase !== "won")) && <Hud hud={hud} />}
      {run && stage !== "intro" && stage !== "summary" && stage !== "pick" && run.phase !== "finale" && run.phase !== "won" && <RunHud run={run} compassScale={RUN.compass} toasts={RUN.toasts} />}
      {run?.phase === "finale" && (
        <div className="finale-skip">
          <kbd>Enter</kbd> skip
        </div>
      )}
      {showTitle && arrived && <TitleCard level={arrived.level} length={run!.length} biome={arrived.biome} />}
      {stage !== "summary" && (
        <TopBar
          title={`Run #${seed}${run ? ` · level ${run.level}/${run.length} · ${run.biome} · ${run.mood}` : ""}`}
          onExit={onExit}
        />
      )}
      {error && <div className="banner">{error}</div>}

      {stage === "intro" && !error && (
        <aside className="panel glass">
          <h2>Run #{seed}</h2>
          <p>
            Fly through eight biomes, from Sky Isles to the Aurora Summit. Every level ends at a portal: fly into it
            and choose an upgrade. Gates score more in a chain, and skimming the land earns style.
          </p>
          <p className="hint">
            A crash puts you back at the last gate and breaks your gate chain. Hold <kbd>Shift</kbd> to boost or <kbd>Space</kbd> to brake.
            Adventure upgrades add <kbd>C</kbd> wingbeat and hold <kbd>F</kbd> hover. The arrow at the top points to the portal.
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

      {stage === "pick" && !hud?.paused && <UpgradePicker offers={offers} next={next} onPick={(id) => session.pick(id)} />}

      {stage === "summary" && summary && (
        <FinishScreen summary={summary} best={best} onAgain={() => session.again()} onNewRun={onNewRun} onMenu={onExit} />
      )}
    </div>
  );
};

// --- Item gallery ------------------------------------------------------------------

/** Every item model, and the pilot showing how they're taken out, worn and used */
const GalleryScreen = ({ onExit }: { onExit: () => void }) => {
  const ref = useRef<HTMLDivElement>(null);
  const gallery = useRef<ItemGallery | null>(null);
  const [demo, setDemo] = useState(true);
  useEffect(() => {
    let disposed = false;
    void import("../game/items/gallery").then(({ ItemGallery }) => {
      if (disposed || !ref.current) return;
      gallery.current = new ItemGallery(ref.current);
      if (import.meta.env.DEV) Object.assign(window, { __gallery: gallery.current });
    });
    return () => {
      disposed = true;
      gallery.current?.dispose();
      gallery.current = null;
    };
  }, []);
  const act = (f: (g: ItemGallery) => void) => {
    if (!gallery.current) return;
    f(gallery.current);
    setDemo(false);
  };
  return (
    <div className="game">
      <div ref={ref} className="game-view" />
      <TopBar title="Item gallery" onExit={onExit} />
      <aside className="panel glass gallery-panel">
        <header className="panel-head">
          <small>Models and animations{demo ? " · demo playing" : ""}</small>
          <h2>Items</h2>
        </header>
        <p className="hint">Put one on the pilot. What they do in a run comes later.</p>
        <div className="gallery-items">
          {ITEMS.map((item) => (
            <button key={item.id} onClick={() => act((g) => g.equip(item.id))}>
              {item.name}
              <small>{item.slot === "back" ? "on the back" : item.slot === "head" ? "on the head" : "in hand"}</small>
            </button>
          ))}
        </div>
        <div className="row">
          <button onClick={() => act((g) => g.use())}>Eat / use</button>
          <button onClick={() => act((g) => g.thrust(true))}>Firework on</button>
          <button onClick={() => act((g) => g.thrust(false))}>Off</button>
          <button onClick={() => act((g) => g.clear())}>Put away</button>
        </div>
      </aside>
    </div>
  );
};

/** Shown instead of the game when the browser can't create a WebGL context */
const NoWebGL = ({ onExit }: { onExit: () => void }) => (
  <div className="game">
    <TopBar title="Wingrace" onExit={onExit} />
    <aside className="panel glass no-webgl">
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
  if (screen.kind === "gallery") return <GalleryScreen onExit={props.onExit} />;
  return screen.kind === "solo" ? (
    <SoloScreen seed={screen.seed} {...props} />
  ) : (
    <RoomScreen code={screen.code} {...props} />
  );
};

export default GameScreen;
