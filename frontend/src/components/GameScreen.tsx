import { IconArrowLeft, IconChevronDown, IconChevronUp, IconSettings } from "@tabler/icons-react";
import { type ReactNode, useEffect, useEffectEvent, useRef, useState, useSyncExternalStore } from "react";
import type { Screen } from "../App";
import { holdGame } from "../game/hold";
import { formatTime, ordinal, untilTomorrow } from "../format";
import { controlsBlocked } from "../game/input";
import { dailySeed } from "../game/rng";
import { keyboardBinding } from "../game/bindings";
import { webglAvailable } from "../game/webgl";
import { BIOMES, type BiomeId } from "../game/world/biomes";
import { RUN } from "../game/tuning";
import { ExploreSession } from "../session/ExploreSession";
import { RunSession } from "../session/RunSession";
import { ITEMS } from "../game/items/models";
import type { ItemGallery } from "../game/items/gallery";
import { FinishScreen, RunHud, TitleCard, UpgradePicker } from "./RunHud";
import { RoomSession } from "../session/RoomSession";
import { SoloSession } from "../session/SoloSession";
import { useMediaToggle } from "../media";
import { type Settings, clientId } from "../storage";
import { usePaletteTheme, useUiTheme } from "../theme";
import Coach from "./Coach";
import { HelpButton } from "./Help";
import SettingsPanel from "./SettingsPanel";
import Hud from "./Hud";
import Leaderboard from "./Leaderboard";
import MapSelect from "./MapSelect";
import "./GameScreen.css";
import "./Touch.css";

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
    if (event.defaultPrevented || controlsBlocked() || target?.isContentEditable || (target && ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName))) return;
    const action = keys[keyboardBinding(event)];
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
  /** The newcomer said yes to the tutorial: coach them through the controls before the first level */
  tutorial?: boolean;
  onTutorialEnd?: () => void;
}

interface TopBarControls {
  settings: Settings;
  onSettings: (settings: Settings) => void;
  /** The game's own mute (M), shown and changed in the settings */
  muted: boolean;
}

/** The gear: the settings, as on the landing page, over the game held paused */
const SettingsButton = ({ settings, onSettings, muted }: TopBarControls) => {
  const [open, setOpen] = useState(false);
  useEffect(() => (open ? holdGame() : undefined), [open]);
  return (
    <>
      <button className="help-button glass" aria-label="Settings" onClick={() => setOpen(true)}>
        <IconSettings size={20} />
      </button>
      {open && <SettingsPanel settings={{ ...settings, muted }} onSettings={onSettings} onClose={() => setOpen(false)} />}
    </>
  );
};

const TopBar = ({ title, onExit, controls, children }: { title: string; onExit: () => void; controls?: TopBarControls; children?: ReactNode }) => (
  <div className="topbar">
    <button className="glass" onClick={onExit}>
      <IconArrowLeft size={18} /> Menu
    </button>
    <span className="topbar-title glass">{title}</span>
    <div className="topbar-end">
      {children}
      <HelpButton />
      {controls && <SettingsButton {...controls} />}
    </div>
  </div>
);

const noop = () => {};

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

/** Before a race, where the race timer will be: just the button that starts it (`start-cta` draws the eye) */
const ReadyCard = ({ children }: { children: ReactNode }) => <div className="ready-card glass">{children}</div>;

// --- Time trial ------------------------------------------------------------------

const SoloScreen = ({ seed, settings, onSettings, onExit, tutorial, onTutorialEnd = noop }: ScreenProps & { seed: number }) => {
  const [session] = useState(() => new SoloSession(seed, clientId(), settings));
  const ref = useMountedSession(session, settings);
  const { hud, stage, result, leaderboard, ghosts, error } = useSyncExternalStore(
    session.store.subscribe,
    session.store.get,
  );
  useUiTheme(seed);
  // The tutorial runs in the warm-up, before the clock: the start button waits for it
  const coaching = !!tutorial && stage === "ready" && !error;
  // So does the land: some maps take a few seconds to build, and the clock shouldn't start before them
  const building = stage === "ready" && !!hud?.loading;

  useHotkeys({
    Enter: () => stage !== "racing" && !coaching && !building && session.start(),
    Backspace: () => stage === "racing" && session.abort(),
  });

  return (
    <div className="game">
      <div ref={ref} className="game-view" />
      {hud && <Hud hud={hud} settings={settings} />}
      <TopBar title={`Time trial · #${seed}${hud ? ` · ${hud.biomeName} · ${hud.paletteName}` : ""}`} onExit={onExit} controls={{ settings, onSettings, muted: !!hud?.muted }} />
      {error && <div className="banner glass">{error}</div>}

      {coaching && <Coach onEnd={onTutorialEnd} observeInput={session.observeInput} />}
      {stage === "ready" && !error && !coaching && (
        <ReadyCard>
          <button className="primary start-cta" disabled={building} onClick={() => session.start()}>
            {building ? "Loading the map…" : <>Start the run <kbd>Enter</kbd></>}
          </button>
        </ReadyCard>
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

/** The landing page's map select over the room's game (held paused): the room flies the map picked next */
const RoomMapSelect = ({ onPick, onBack }: { onPick: (seed: number) => void; onBack: () => void }) => {
  const [countdown, setCountdown] = useState(untilTomorrow);
  useEffect(() => holdGame(), []);
  useEffect(() => {
    const timer = setInterval(() => setCountdown(untilTomorrow()), 1000);
    return () => clearInterval(timer);
  }, []);
  return (
    <div className="map-overlay">
      <MapSelect mode="room" daily={dailySeed()} countdown={countdown} onPick={onPick} action="Race this map" onBack={onBack} />
    </div>
  );
};

const RoomScreen = ({ code, seed, settings, onSettings, onExit, tutorial, onTutorialEnd = noop }: ScreenProps & { code: string; seed?: number }) => {
  const [session] = useState(
    () => new RoomSession(code, { clientId: clientId(), nickname: settings.nickname, seed }, settings),
  );
  const ref = useMountedSession(session, settings);
  const { hud, connection, message, room, selfId, lastPlace } = useSyncExternalStore(
    session.store.subscribe,
    session.store.get,
  );
  useUiTheme(hud?.seed);
  const me = room?.players.find((p) => p.id === selfId);
  const lobby = room?.phase === "lobby";
  // The tutorial runs in the lobby; if someone starts the race first, it's over
  const coaching = !!tutorial && !!room && lobby;
  // Your own land first (others can still start: the countdown gives it a few more seconds)
  const building = lobby && !!hud?.loading;
  useEffect(() => {
    if (tutorial && room && !lobby) onTutorialEnd();
  }, [tutorial, room, lobby, onTutorialEnd]);
  // The map select, for the next race; it closes if someone starts this one meanwhile
  const [choosing, setChoosing] = useState(false);
  const [wasLobby, setWasLobby] = useState(lobby);
  if (lobby !== wasLobby) {
    setWasLobby(lobby);
    if (!lobby) setChoosing(false);
  }

  useHotkeys({
    Enter: () => lobby && !coaching && !building && !choosing && session.start(),
    KeyN: () => lobby && !coaching && setChoosing(true),
  });

  return (
    <div className="game">
      <div ref={ref} className="game-view" />
      {hud && <Hud hud={hud} settings={settings} />}
      <TopBar title={`Room ${code}${hud ? ` · course #${hud.seed} · ${hud.biomeName} · ${hud.paletteName}` : ""}`} onExit={onExit} controls={{ settings, onSettings, muted: !!hud?.muted }}>
        <span className={`connection glass ${connection}`}>
          <span className="dot" />
          {connection === "connected" ? "online" : connection}
        </span>
      </TopBar>

      {(connection !== "connected" || message) && (
        <div className="banner glass">{message ?? "Connecting to the room…"}</div>
      )}

      {coaching && <Coach onEnd={onTutorialEnd} observeInput={session.observeInput} />}
      {room && lobby && !coaching && (
        <ReadyCard>
          <div className="row">
            <button className="primary start-cta" disabled={building} onClick={() => session.start()}>
              {building ? "Loading the map…" : <>Start race <kbd>Enter</kbd></>}
            </button>
            <button onClick={() => setChoosing(true)}>
              Change map <kbd>N</kbd>
            </button>
          </div>
        </ReadyCard>
      )}
      {choosing && lobby && (
        <RoomMapSelect
          onPick={(seed) => {
            session.newMap(seed);
            setChoosing(false);
          }}
          onBack={() => setChoosing(false)}
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

// --- Explore ---------------------------------------------------------------------

const ExploreScreen = ({ biome, seed, settings, onSettings, onExit, testMode = false }: ScreenProps & { biome: BiomeId; seed: number; testMode?: boolean }) => {
  const [session] = useState(() => new ExploreSession(biome, seed, settings, testMode));
  const ref = useMountedSession(session, settings);
  const { hud, error, biome: current, mood, track, playing, speed, offers, next, summary } = useSyncExternalStore(session.store.subscribe, session.store.get);
  usePaletteTheme(hud?.palette);

  // The mouse is often locked to the game, so everything has a key
  useHotkeys({
    ...(!testMode ? {
      KeyN: () => session.step(1),
      KeyB: () => session.step(-1),
      KeyV: () => session.stepMood(1),
    } : {}),
    Enter: () => { if (summary) session.again(); else session.skip(); },
    Backspace: () => { if (summary) onExit(); },
  });

  const moods = BIOMES[current].moods;
  const run = hud?.run ?? null;
  const phase = run?.phase;
  const transitioning = phase === "portal" || phase === "pick" || phase === "finale" || phase === "won";
  return (
    <div className="game">
      <div ref={ref} className="game-view" />
      {hud && !summary && (!transitioning || hud.paused) && <Hud hud={hud} settings={settings} showStyle={testMode} />}
      {/* Test mode flies a real run: its score, chain and compass to the portal */}
      {testMode && run && !summary && !transitioning && <RunHud run={run} compassScale={RUN.compass} toasts={RUN.toasts} />}
      {!summary && <TopBar title={testMode
        ? `Test · #${seed}${run ? ` · Level ${run.level}/${run.length} · ${run.biome} · ${run.mood}` : ""} · ${speed}× speed`
        : `Explore · ${hud ? `${hud.biomeName} · ${hud.paletteName}` : ""} · #${seed}`} onExit={onExit} controls={{ settings, onSettings, muted: !!hud?.muted }} />}
      {error && <div className="banner">{error}</div>}
      {!summary && !transitioning && <aside className={`debug-panel glass${testMode ? " test" : ""}`}>
        {!testMode && <>
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
        </>}
        {testMode && <>
          <h3>Test mode · nothing saved</h3>
          <div className="debug-row touch-only">
            <button onClick={() => session.testAction("portal")}>Portal</button>
            <button onClick={() => session.testAction("win")}>Victory</button>
            <button onClick={() => session.testAction("speed")}>{speed === 1 ? "Half speed" : "Normal speed"}</button>
          </div>
          <ul className="debug-keys no-touch">
            <li><kbd>Shift+P</kbd> portal ahead</li>
            <li><kbd>Shift+O</kbd> victory</li>
            <li><kbd>Shift+S</kbd> {speed === 1 ? "half speed" : "normal speed"}</li>
            <li><kbd>Shift+I</kbd> next item</li>
          </ul>
        </>}
      </aside>}
      {testMode && phase === "finale" && <div className="finale-skip" onClick={() => session.skip()}>
        <kbd>Enter</kbd> <span className="no-touch">skip</span><span className="touch-only">Skip</span>
      </div>}
      {testMode && offers.length > 0 && !hud?.paused && <UpgradePicker offers={offers} next={next} onPick={(id) => session.pick(id)} />}
      {testMode && summary && <FinishScreen testMode summary={summary} best={null} onAgain={() => session.again()} onMenu={onExit} />}
    </div>
  );
};

// --- Roguelike run ------------------------------------------------------------------

const RunScreen = ({ seed, settings, onSettings, onExit, onNewRun, tutorial, onTutorialEnd = noop }: ScreenProps & { seed: number; onNewRun: () => void }) => {
  const [session] = useState(() => new RunSession(seed, settings));
  const ref = useMountedSession(session, settings);
  const { hud, stage, offers, next, arrived, summary, best, error } = useSyncExternalStore(session.store.subscribe, session.store.get);
  const run = hud?.run ?? null;
  usePaletteTheme(hud?.palette);

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
  // A run has no warm-up: the tutorial runs in the first level's opening seconds, and ends with it
  const coaching = !!tutorial && stage === "flying";
  useEffect(() => {
    if (tutorial && stage !== "intro" && stage !== "flying") onTutorialEnd();
  }, [tutorial, stage, onTutorialEnd]);

  return (
    <div className="game">
      <div ref={ref} className="game-view" />
      {/* Nothing but the wormhole while passing through a portal */}
      {hud && (hud.paused || (stage !== "intro" && stage !== "pick" && stage !== "summary" && run?.phase !== "portal" && run?.phase !== "finale" && run?.phase !== "won")) && <Hud hud={hud} settings={settings} showStyle />}
      {run && stage !== "intro" && stage !== "summary" && stage !== "pick" && run.phase !== "finale" && run.phase !== "won" && <RunHud run={run} compassScale={RUN.compass} toasts={RUN.toasts} />}
      {run?.phase === "finale" && (
        <div className="finale-skip" onClick={() => session.skip()}>
          <kbd>Enter</kbd> <span className="no-touch">skip</span>
          <span className="touch-only">Skip</span>
        </div>
      )}
      {coaching && <Coach onEnd={onTutorialEnd} observeInput={session.observeInput} />}
      {showTitle && arrived && <TitleCard level={arrived.level} length={run!.length} biome={arrived.biome} />}
      {stage !== "summary" && (
        <TopBar
          title={run ? `Level ${run.level}/${run.length} · ${run.biome} · ${run.mood}` : "Adventure"}
          onExit={onExit}
          controls={{ settings, onSettings, muted: !!hud?.muted }}
        />
      )}
      {error && <div className="banner">{error}</div>}

      {stage === "intro" && !error && (
        <ReadyCard>
          <button className="primary start-cta" onClick={() => session.begin()}>
            Take off <kbd>Enter</kbd>
          </button>
        </ReadyCard>
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
      <Panel className="gallery-panel" head={<><small>Models and animations{demo ? " · demo playing" : ""}</small><h2>Items</h2></>}>

        <p className="hint">Preview the models here. Adventure items have their own effects in a run.</p>
        <div className="gallery-items">
          {ITEMS.map((item) => (
            <button key={item.id} onClick={() => act((g) => g.equip(item.id))}>
              {item.name}
              <small>{item.slot === "back" ? "on the back" : item.slot === "head" ? "on the head" : item.slot === "feet" ? "on the feet" : "in hand"}</small>
            </button>
          ))}
        </div>
        <div className="row">
          <button onClick={() => act((g) => g.use())}>Eat / use</button>
          <button onClick={() => act((g) => g.thrust(true))}>Firework on</button>
          <button onClick={() => act((g) => g.thrust(false))}>Off</button>
          <button onClick={() => act((g) => g.clear())}>Put away</button>
        </div>
      </Panel>
    </div>
  );
};

/** Shown instead of the game when the browser can't create a WebGL context */
const NoWebGL = ({ onExit }: { onExit: () => void }) => (
  <div className="game">
    <TopBar title="Wind Rider" onExit={onExit} />
    <aside className="panel glass no-webgl">
      <h2>Your browser has 3D graphics turned off</h2>
      <p>
        Wind Rider needs WebGL 2, and this browser won't create a WebGL context. That's a browser setting, not a
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
  if (screen.kind === "explore" || screen.kind === "test") return <ExploreScreen biome={screen.biome} seed={screen.seed} testMode={screen.kind === "test"} {...props} />;
  if (screen.kind === "run") return <RunScreen seed={screen.seed} onNewRun={onNewRun} {...props} />;
  if (screen.kind === "gallery") return <GalleryScreen onExit={props.onExit} />;
  return screen.kind === "solo" ? (
    <SoloScreen seed={screen.seed} {...props} />
  ) : (
    <RoomScreen code={screen.code} seed={screen.seed} {...props} />
  );
};

export default GameScreen;
