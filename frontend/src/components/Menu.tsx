import { IconArrowLeft, IconBuildingStore, IconCompass, IconDiamond, IconDice5, IconFlag, IconLeaf, IconMap, IconSettings, IconTrophy, IconUser, IconUsers, IconWind } from "@tabler/icons-react";
import { type FormEvent, type ReactNode, useCallback, useEffect, useId, useMemo, useState, useSyncExternalStore } from "react";
import { type LeaderboardEntry, type User, getLeaderboard } from "../api";
import type { Screen } from "../App";
import { randomRoomCode, untilTomorrow } from "../format";
import { dailyRunSeed, dailySeed, randomSeed } from "../game/rng";
import { MAPS, seedLevel, zenSeed } from "../game/world/biomes";
import { Course } from "../game/world/course";
import { bestRun } from "../session/RunSession";
import { profileClient } from "../profile/client";
import { type Settings, clientId } from "../storage";
import { usePaletteTheme } from "../theme";
import SettingsPanel from "./SettingsPanel";
import MapSelect, { type MapSelectMode } from "./MapSelect";
import ProfilePanel from "./ProfilePanel";
import ShopPanel from "./ShopPanel";
import LeaderboardPanel from "./LeaderboardPanel";
import { HelpButton } from "./Help";
import MenuBackdrop from "./MenuBackdrop";
import MenuMotes from "./MenuMotes";
import TodaysBest from "./TodaysBest";
import "./Menu.css";

interface MenuProps {
  me: User | null;
  settings: Settings;
  onSettings: (settings: Settings) => void;
  joinCode?: string;
  go: (screen: Screen) => void;
}

/**
 * A mode on the landing page: an emblem of light (a diamond of fine gold lines, constellation nodes on its
 * points, a ring round the mode's sign) floating on the sky, its name under it. Motes gather into it
 * (`data-motes`, MenuMotes) and fly out of it while it's hovered
 */
const Emblem = ({ icon, name, line, onClick }: { icon: ReactNode; name: string; line: string; onClick: () => void }) => {
  const id = useId().replace(/:/g, "");
  return (
    <button className="menu-emblem" onClick={onClick}>
      <span className="emblem-art" data-motes aria-hidden="true">
        <span className="emblem-halo" />
        <svg className="emblem-frame" viewBox="-60 -60 120 120">
          <defs>
            <radialGradient id={`${id}-core`}>
              <stop offset="0" stopColor="var(--emblem-core)" stopOpacity="0.95" />
              <stop offset="0.65" stopColor="var(--emblem-core)" stopOpacity="0.35" />
              <stop offset="1" stopColor="var(--emblem-core)" stopOpacity="0" />
            </radialGradient>
            <linearGradient id={`${id}-line`} x1="0" y1="-1" x2="0" y2="1">
              <stop offset="0" stopColor="var(--emblem-line-hi)" />
              <stop offset="1" stopColor="var(--emblem-line)" />
            </linearGradient>
          </defs>
          <circle r="34" fill={`url(#${id}-core)`} />
          {/* The diamond and its stars turn a quarter when pointed at, and settle */}
          <g className="emblem-outer">
          <g stroke={`url(#${id}-line)`} fill="none">
            <path d="M0 -54 L54 0 L0 54 L-54 0 Z" strokeWidth="1.4" />
            <path d="M0 -46 L46 0 L0 46 L-46 0 Z" strokeWidth="0.7" opacity="0.65" />
            <path d="M0 -54 L0 -38 M54 0 L38 0 M0 54 L0 38 M-54 0 L-38 0" strokeWidth="0.9" />
            <path d="M-27 -27 L-21 -21 M27 -27 L21 -21 M27 27 L21 21 M-27 27 L-21 21" strokeWidth="0.8" opacity="0.7" />
          </g>
          <g className="emblem-ring" fill="none" stroke={`url(#${id}-line)`}>
            <circle r="31" strokeWidth="1.3" />
            <circle r="36" strokeWidth="0.6" strokeDasharray="1.5 4.2" opacity="0.8" />
          </g>
          <g className="emblem-nodes" fill="var(--emblem-node)">
            <circle cy="-54" r="2.8" /><circle cx="54" r="2.8" /><circle cy="54" r="2.8" /><circle cx="-54" r="2.8" />
            <circle cx="-24" cy="-24" r="1.5" /><circle cx="24" cy="-24" r="1.5" /><circle cx="24" cy="24" r="1.5" /><circle cx="-24" cy="24" r="1.5" />
          </g>
          </g>
        </svg>
        <span className="emblem-icon">{icon}</span>
      </span>
      <b>{name}</b>
      <small>{line}</small>
    </button>
  );
};

/** Explore's sign: a leaf over a compass rose, drawn as a constellation (lines and star nodes) */
const ExploreSign = () => (
  <svg width="42" height="42" viewBox="-18 -18 36 36" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M0 -16 L0 -12 M16 0 L12 0 M0 16 L0 12 M-16 0 L-12 0" strokeWidth="1.5" />
    <path d="M-8 9 C-11 -2 -3 -10 9 -10 C10 2 2 10 -8 9 Z" strokeWidth="1.7" />
    <path d="M-8 9 L5 -5 M-3 4 L-3 -1 M1 0 L5 0" strokeWidth="1.2" opacity="0.85" />
    <g fill="currentColor" stroke="none">
      <circle cy="-16" r="1.7" /><circle cx="16" r="1.7" /><circle cy="16" r="1.7" /><circle cx="-16" r="1.7" />
      <circle cx="9" cy="-10" r="1.3" /><circle cx="-8" cy="9" r="1.3" />
    </g>
  </svg>
);

/** The Gathering's sign: a ring of five lanterns linked by a thread of light */
const GatheringSign = () => (
  <svg width="42" height="42" viewBox="-18 -18 36 36" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <circle r="11.5" strokeWidth="1.1" strokeDasharray="2 2.6" opacity="0.85" />
    {[0, 1, 2, 3, 4].map((i) => {
      const a = (i / 5) * Math.PI * 2;
      const x = Math.sin(a) * 11.5;
      const y = -Math.cos(a) * 11.5;
      return (
        <g key={i} transform={`translate(${x.toFixed(2)} ${y.toFixed(2)})`}>
          <path d="M-1.6 -4.2 L1.6 -4.2" strokeWidth="1.2" />
          <rect x="-2.8" y="-3.2" width="5.6" height="6.4" rx="2.2" strokeWidth="1.5" />
          <circle r="1.1" fill="currentColor" stroke="none" />
        </g>
      );
    })}
  </svg>
);

const Menu = ({ me, settings, onSettings, joinCode, go }: MenuProps) => {
  const [daily, setDaily] = useState(() => dailySeed());
  // Today's run has a seed of its own, so it starts on another map than today's course
  const [dailyRun, setDailyRun] = useState(() => dailyRunSeed());
  // Today's course: whichever map the daily seed stands for
  const course = useMemo(() => {
    const { biome, palette } = seedLevel(daily);
    return { map: biome.name, mood: palette.name, gates: new Course(daily).rings.length };
  }, [daily]);
  // Today's run: it starts on the map its seed stands for
  const run = useMemo(() => {
    const { biome, palette } = seedLevel(dailyRun);
    return { map: biome.name, mood: palette.name };
  }, [dailyRun]);
  // Zen: today's course's map for ever (or the next seed's, if that's Sky Isles)
  const zenDaily = useMemo(() => zenSeed(daily), [daily]);
  const zen = useMemo(() => {
    const { biome, palette } = seedLevel(zenDaily);
    return { map: biome.name, mood: palette.name };
  }, [zenDaily]);
  // The landing page's pages: the four modes, then each mode's page (Racing's two ways and each way,
  // Explore's Reaches and Zen flight)
  const [view, setView] = useState<"home" | "adventure" | "racing" | "solo" | "friends" | "explore" | "zen" | "gathering">(joinCode ? "friends" : "home");
  const back = () => setView(view === "solo" || view === "friends" ? "racing" : view === "zen" ? "explore" : "home");
  const [code, setCode] = useState(joinCode ?? "");
  const [board, setBoard] = useState<LeaderboardEntry[]>([]);
  const best = useMemo(() => bestRun(dailyRun), [dailyRun]);
  // The journal is the pilot's own page (name, level, collection); an invite opens it to pick a name first
  const [panel, setPanel] = useState<"none" | "settings" | "journal" | "shop" | "hall">(joinCode && !settings.nickname ? "journal" : "none");
  const { profile } = useSyncExternalStore(profileClient.store.subscribe, profileClient.store.get);
  useEffect(() => void profileClient.initialize(), []);
  const [countdown, setCountdown] = useState(untilTomorrow);
  // The map select, for a time trial, a run or a new room: it shows its course behind the glass, and the UI
  // takes its colors
  const [picking, setPicking] = useState<MapSelectMode | null>(null);
  const [preview, setPreview] = useState<number | null>(null);
  const shown = picking && preview !== null ? preview : daily;
  const shownPalette = useMemo(() => seedLevel(shown).palette, [shown]);
  // Pictures of the courses the backdrop has shown, for the map select's cards
  const [art, setArt] = useState<Record<number, string>>({});
  const keepArt = useCallback((seed: number, url: string) => setArt((all) => ({ ...all, [seed]: url })), []);
  // The course the backdrop has all in: the map select covers the others with their picture meanwhile
  const [live, setLive] = useState<number | null>(null);
  usePaletteTheme(shownPalette);

  // The map select's pictures (public/maps, about 0.8 MB), fetched while the landing page is up
  useEffect(() => {
    const timer = setTimeout(() => MAPS.forEach((biome) => (new Image().src = `/maps/${biome}.jpg`)), 1500);
    return () => clearTimeout(timer);
  }, []);

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
      setDailyRun(dailyRunSeed());
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    // Enter starts what the page leads with (the home page opens Adventure), Escape goes back a page,
    // unless a field or button has the focus
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.target !== document.body || picking || panel !== "none") return;
      if (e.key === "Escape" && view !== "home") back();
      if (e.key !== "Enter") return;
      if (view === "home") setView("adventure");
      else if (view === "adventure") go({ kind: "run", seed: dailyRun });
      else if (view === "solo") go({ kind: "solo", seed: daily });
      else if (view === "explore") setView("zen");
      else if (view === "zen") go({ kind: "zen", seed: zenDaily });
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  });

  const joinRoom = (e: FormEvent) => {
    e.preventDefault();
    const room = code.trim().toUpperCase();
    if (/^[A-Z0-9]{3,8}$/.test(room)) go({ kind: "room", code: room });
  };

  const closePicker = () => {
    setPicking(null);
    setPreview(null);
  };

  const pilotName = me?.verified ? me.name : settings.nickname || "Guest";

  return (
    <main className="menu">
      {/* The Lantern Market and the Hall of Winds (the journal opens from the pilot pill): light on the
          sky, not panels over it */}
      <nav className="menu-nav" aria-label="Market and leaderboard">
        <button className="menu-ghost" onClick={() => setPanel("shop")} aria-label="Lantern Market"><span className="menu-ring"><IconBuildingStore size={19} /></span><span>Market</span></button>
        <button className="menu-ghost" onClick={() => setPanel("hall")} aria-label="Hall of Winds: the leaderboard"><span className="menu-ring"><IconTrophy size={19} /></span><span>Hall of Winds</span></button>
      </nav>
      {panel === "shop" && <ShopPanel onClose={() => setPanel("none")} />}
      {panel === "hall" && <LeaderboardPanel onClose={() => setPanel("none")} />}
      <MenuBackdrop seed={shown} mode="drift" onSnapshot={keepArt} onShown={setLive} settings={settings} />
      {/* Between the world and the UI: motes of light, gathering into the emblems; a soft shade top and
          bottom so the words there read without panels */}
      {!picking && <MenuMotes />}
      {!picking && <div className="menu-shade" aria-hidden="true" />}

      <HelpButton className="menu-help menu-ghost" />
      <button
        className="menu-icon menu-ghost settings-button"
        aria-label="Settings"
        onClick={() => setPanel(panel === "settings" ? "none" : "settings")}
      >
        <IconSettings size={22} />
      </button>
      {panel === "settings" && <SettingsPanel settings={settings} onSettings={onSettings} onClose={() => setPanel("none")} />}

      {picking ? (
        <MapSelect
          mode={picking}
          daily={picking === "run" ? dailyRun : daily}
          countdown={countdown}
          art={art}
          onPreview={setPreview}
          live={live}
          onPick={(seed) =>
            go(
              picking === "solo"
                ? { kind: "solo", seed }
                : picking === "run"
                  ? { kind: "run", seed }
                  : picking === "zen"
                    ? { kind: "zen", seed }
                    : { kind: "room", code: randomRoomCode(), seed },
            )
          }
          action={picking === "solo" ? "Fly" : picking === "run" ? "Start the run" : picking === "zen" ? "Start flying" : "Create the room"}
          onBack={closePicker}
        />
      ) : (
        <>
          <header className="menu-title">
            <h1 data-text="WindRider">WindRider</h1>
            <p>Fly through floating worlds</p>
          </header>

          {view === "home" && (
            <section className="menu-modes" aria-label="Game modes">
              <Emblem icon={<IconFlag size={30} />} name="Racing" line="Time trials and races with friends" onClick={() => setView("racing")} />
              <Emblem icon={<IconCompass size={34} />} name="Adventure" line="Eight worlds, one flight" onClick={() => setView("adventure")} />
              <Emblem icon={<ExploreSign />} name="Explore" line="Zen flight now, the Reaches soon" onClick={() => setView("explore")} />
              <Emblem icon={<GatheringSign />} name="Gathering" line="Lanternhaven together, soon" onClick={() => setView("gathering")} />
            </section>
          )}

          {view !== "home" && (
            <section className="menu-card glass">
              <header className="menu-card-head">
                <button className="menu-back" onClick={back} aria-label="Back">
                  <IconArrowLeft size={18} /> Back
                </button>
                <b>{{ adventure: "Adventure", racing: "Racing", solo: "Solo", friends: "With friends", explore: "Explore", zen: "Zen flight", gathering: "Gathering" }[view]}</b>
              </header>

              {view === "adventure" ? (
                <>
                  <p className="menu-lede">Eight worlds, one flight: portals, upgrades, items and treasure.</p>
                  <div className="menu-course">
                    <div>
                      <small>Today's run · #{dailyRun}</small>
                      <b>{run.map}</b>
                    </div>
                    <span>{run.mood}</span>
                    <span>8 maps</span>
                    {best !== null && <span>Best {best.toLocaleString()}</span>}
                    <span>New in {countdown}</span>
                  </div>
                  <button className="primary" onClick={() => go({ kind: "run", seed: dailyRun })}>
                    Start today's run <kbd>Enter</kbd>
                  </button>
                  <div className="menu-more">
                    <button className="menu-link" onClick={() => setPicking("run")}>
                      <IconMap size={18} /> Choose a map
                    </button>
                    <button className="menu-link" onClick={() => go({ kind: "run", seed: randomSeed() })}>
                      <IconDice5 size={18} /> New random run
                    </button>
                    {import.meta.env.DEV && (
                      <button className="menu-link" onClick={() => go({ kind: "explore", biome: "skyIsles", seed: 1 })}>
                        Debug: explore
                      </button>
                    )}
                  </div>
                </>
              ) : view === "racing" ? (
                <div className="menu-ways">
                  <button className="menu-way" onClick={() => setView("solo")}>
                    <IconFlag size={30} />
                    <b>Solo</b>
                    <small>Today's course against the clock and the best ghosts</small>
                  </button>
                  <button className="menu-way" onClick={() => setView("friends")}>
                    <IconUsers size={30} />
                    <b>With friends</b>
                    <small>A room: the same map, the same start, up to 12 pilots</small>
                  </button>
                </div>
              ) : view === "explore" ? (
                <>
                  <p className="menu-lede">Wander at your own pace: one endless map now, a whole world soon.</p>
                  <div className="menu-ways">
                    <button className="menu-way" onClick={() => setView("zen")}>
                      <IconWind size={30} />
                      <b>Zen flight</b>
                      <small>One endless map, no clock, nothing to chase</small>
                    </button>
                    <div className="menu-way is-soon" aria-label="The Reaches, coming soon">
                      <IconLeaf size={30} />
                      <b>The Reaches</b>
                      <small>A persistent world: gardens, canopies, crystal veins, a home isle</small>
                      <span className="menu-soon">Coming soon</span>
                    </div>
                  </div>
                </>
              ) : view === "gathering" ? (
                <>
                  <p className="menu-lede">Lanternhaven with everyone: wave, hold hands, trade and fly as a flock.</p>
                  <div className="menu-course menu-soon-card">
                    <div>
                      <small>The Gathering</small>
                      <b>Coming soon</b>
                    </div>
                    <span>Live town</span>
                    <span>Emotes</span>
                    <span>Holding hands</span>
                    <span>Trading</span>
                    <span>Flocks</span>
                  </div>
                  <div className="menu-more">
                    <button className="menu-link" onClick={() => setView("friends")}>
                      <IconUsers size={18} /> Race with friends meanwhile
                    </button>
                  </div>
                </>
              ) : view === "solo" ? (
                <>
                  <div className="menu-course">
                    <div>
                      <small>Today's course · #{daily}</small>
                      <b>{course.map}</b>
                    </div>
                    <span>{course.mood}</span>
                    <span>{course.gates} gates</span>
                    <span>New in {countdown}</span>
                  </div>
                  <button className="primary" onClick={() => go({ kind: "solo", seed: daily })}>
                    Fly today's course <kbd>Enter</kbd>
                  </button>
                  <div className="menu-more">
                    <button className="menu-link" onClick={() => setPicking("solo")}>
                      <IconMap size={18} /> Choose a course
                    </button>
                  </div>
                </>
              ) : view === "zen" ? (
                <>
                  <div className="menu-course">
                    <div>
                      <small>Today's Zen · #{zenDaily}</small>
                      <b>{zen.map}</b>
                    </div>
                    <span>{zen.mood}</span>
                    <span>Endless</span>
                    <span>No clock</span>
                  </div>
                  <button className="primary" onClick={() => go({ kind: "zen", seed: zenDaily })}>
                    Start flying <kbd>Enter</kbd>
                  </button>
                  <div className="menu-more">
                    <button className="menu-link" onClick={() => setPicking("zen")}>
                      <IconMap size={18} /> Choose a map
                    </button>
                    <button className="menu-link" onClick={() => go({ kind: "zen", seed: zenSeed(randomSeed()) })}>
                      <IconDice5 size={18} /> Random map
                    </button>
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
                  <button className="primary" onClick={() => setPicking("room")}>
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
          )}
        </>
      )}

      {!picking && <TodaysBest entries={board} />}

      {panel === "journal" && (
        <ProfilePanel
          onClose={() => setPanel("none")}
          pilot={{ name: me?.verified ? me.name : settings.nickname, verified: !!me?.verified, onName: (nickname) => onSettings({ ...settings, nickname }) }}
        />
      )}
      {/* You: your name, level and crystals; opens your journal */}
      <button className="menu-pilot menu-ghost" aria-label={`Journal of ${pilotName}`} onClick={() => setPanel("journal")}>
        <span className="menu-ring">
          <IconUser size={20} />
        </span>
        <span className="menu-pilot-text">
          {pilotName}
          {profile && (
            <small>
              Lv. {profile.level} · <IconDiamond size={12} /> {profile.crystals.toLocaleString()}
            </small>
          )}
        </span>
      </button>
    </main>
  );
};

export default Menu;
