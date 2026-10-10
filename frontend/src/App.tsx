import { useEffect, useState } from "react";
import { type User, getMe } from "./api";
import GameScreen from "./components/GameScreen";
import { randomSeed } from "./game/rng";
import Menu from "./components/Menu";
import { type Screen, screenFromSearch, urlFor } from "./route";
import { type Settings, loadSettings, saveSettings } from "./storage";
import { profileClient } from "./profile/client";

export type { Screen } from "./route";

const screenFromUrl = (): Screen => screenFromSearch(location.search, Boolean(loadSettings().nickname));

const App = () => {
  const [screen, setScreen] = useState<Screen>(screenFromUrl);
  const [settings, setSettings] = useState<Settings>(loadSettings);
  const [me, setMe] = useState<User | null>(null);

  useEffect(() => {
    void profileClient.initialize();
    getMe()
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
  return (
    <GameScreen
      key={urlFor(screen)}
      screen={screen}
      settings={settings}
      onSettings={updateSettings}
      onExit={() => go({ kind: "menu" })}
      onNewRun={() => go({ kind: "run", seed: randomSeed() })}
    />
  );
};

export default App;
