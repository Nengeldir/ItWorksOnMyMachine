import { useEffect, useState } from "react";
import { type User, getMe } from "./api";
import type { BiomeId } from "./game/world/biomes";
import { ExploreSession } from "./session/ExploreSession";
import GameScreen from "./components/GameScreen";
import { randomSeed } from "./game/rng";
import Menu from "./components/Menu";
import { type Settings, loadSettings, saveSettings } from "./storage";

export type Screen =
  | { kind: "menu"; joinCode?: string }
  | { kind: "solo"; seed: number }
  | { kind: "room"; code: string }
  | { kind: "explore"; biome: BiomeId; seed: number }
  | { kind: "test"; biome: BiomeId; seed: number }
  | { kind: "run"; seed: number }
  | { kind: "gallery" };

// Screens live in the URL, so a room link can be shared and reloads keep you in place
function screenFromUrl(): Screen {
  const params = new URLSearchParams(location.search);
  const room = params.get("room")?.toUpperCase();
  if (room && /^[A-Z0-9]{3,8}$/.test(room)) {
    // First visit through an invite link: pick a name before joining
    return loadSettings().nickname ? { kind: "room", code: room } : { kind: "menu", joinCode: room };
  }
  const seed = Number(params.get("seed"));
  const run = Number(params.get("run"));
  if (Number.isInteger(run) && run >= 1 && run < 2 ** 31) return { kind: "run", seed: run };
  // /?explore=ember, or just /?explore to start in the first world and switch from there
  if (params.has("gallery")) return { kind: "gallery" };
  const test = params.has("test");
  const explore = test ? params.get("test") : params.get("explore");
  if (explore !== null) {
    return { kind: test ? "test" : "explore", biome: ExploreSession.valid(explore) ? explore : "skyIsles", seed: Number.isInteger(seed) && seed >= 1 ? seed : 1 };
  }
  if (Number.isInteger(seed) && seed >= 1 && seed < 2 ** 31) return { kind: "solo", seed };
  return { kind: "menu" };
}

function urlFor(screen: Screen): string {
  if (screen.kind === "solo") return `/?seed=${screen.seed}`;
  if (screen.kind === "room") return `/?room=${screen.code}`;
  if (screen.kind === "explore" || screen.kind === "test") return `/?${screen.kind}=${screen.biome}&seed=${screen.seed}`;
  if (screen.kind === "run") return `/?run=${screen.seed}`;
  if (screen.kind === "gallery") return "/?gallery";
  return "/";
}

const App = () => {
  const [screen, setScreen] = useState<Screen>(screenFromUrl);
  const [settings, setSettings] = useState<Settings>(loadSettings);
  const [me, setMe] = useState<User | null>(null);

  useEffect(() => {
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
