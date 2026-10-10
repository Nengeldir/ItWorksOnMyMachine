import { useEffect, useState } from "react";
import { type User, getMe } from "./api";
import GameScreen from "./components/GameScreen";
import { randomSeed } from "./game/rng";
import { FirstFlight, HowToFly } from "./components/Help";
import Menu from "./components/Menu";
import { type Screen, screenFromSearch, urlFor } from "./route";
import {
  type Settings,
  type TutorialState,
  clientId,
  loadSettings,
  saveSettings,
  saveTutorialState,
  tutorialState,
} from "./storage";

export type { Screen } from "./route";

const screenFromUrl = (): Screen => screenFromSearch(location.search, Boolean(loadSettings().nickname));

const App = () => {
  const [screen, setScreen] = useState<Screen>(screenFromUrl);
  const [settings, setSettings] = useState<Settings>(loadSettings);
  const [me, setMe] = useState<User | null>(null);
  // Newcomers are asked once whether they want the tutorial: no finished run on the server and nothing
  // started or skipped in this browser (/?tutorial asks anyway, for demos)
  const [asked, setAsked] = useState(false);
  const [tutorial, setTutorial] = useState(false);
  const [forceTutorial] = useState(() => new URLSearchParams(location.search).has("tutorial"));

  useEffect(() => {
    getMe(clientId())
      .then(setMe)
      .catch(() => setMe(null));
    const onPopState = () => setScreen(screenFromUrl());
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  const go = (next: Screen) => {
    history.pushState(null, "", urlFor(next));
    setScreen(next);
  };

  const updateSettings = (next: Settings) => {
    setSettings(next);
    saveSettings(next);
  };

  if (screen.kind === "menu") {
    return <Menu me={me} settings={settings} onSettings={updateSettings} joinCode={screen.joinCode} go={go} />;
  }
  const newcomer = forceTutorial || (me !== null && !me.has_played && tutorialState(me.id) === null);
  const playing = screen.kind === "solo" || screen.kind === "room" || screen.kind === "run";
  const answer = (how: TutorialState) => {
    if (me) saveTutorialState(me.id, how);
    setAsked(true);
    // The interactive tutorial comes next; until then it's the key guide
    if (how === "started") setTutorial(true);
  };

  return (
    <>
      <GameScreen
        key={urlFor(screen)}
        screen={screen}
        settings={settings}
        onSettings={updateSettings}
        onExit={() => go({ kind: "menu" })}
        onNewRun={() => go({ kind: "run", seed: randomSeed() })}
      />
      {playing && newcomer && !asked && <FirstFlight onStart={() => answer("started")} onSkip={() => answer("skipped")} />}
      {tutorial && <HowToFly onClose={() => setTutorial(false)} />}
    </>
  );
};

export default App;
