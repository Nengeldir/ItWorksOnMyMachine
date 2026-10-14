import { useCallback, useEffect, useState } from "react";
import { defaultBindings, keyboardBinding } from "./game/bindings";
import LessonCover from "./components/LessonCover";
import { type User, getMe } from "./api";
import GameScreen from "./components/GameScreen";
import { randomSeed } from "./game/rng";
import { FirstFlight } from "./components/Help";
import Menu from "./components/Menu";
import AchievementToast from "./components/AchievementToast";
import { profileClient } from "./profile/client";
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
  useEffect(() => { void profileClient.initialize(); }, []);
  const [screen, setScreen] = useState<Screen>(screenFromUrl);
  const [settings, setSettings] = useState<Settings>(loadSettings);
  const [me, setMe] = useState<User | null>(null);
  // Newcomers are asked once whether they want the tutorial: no finished run on the server and nothing
  // started or skipped in this browser (/?tutorial asks anyway, for demos)
  const [asked, setAsked] = useState(false);
  const [tutorial, setTutorial] = useState(false);
  const [forceTutorial] = useState(() => new URLSearchParams(location.search).has("tutorial"));
  const endTutorial = useCallback(() => setTutorial(false), []);

  useEffect(() => {
    getMe(clientId())
      .then(setMe)
      .catch(() => setMe(null));
    const onPopState = () => setScreen(screenFromUrl());
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  const go = (next: Screen) => {
    // Leaving the game leaves the tutorial too
    setTutorial(false);
    history.pushState(null, "", urlFor(next));
    setScreen(next);
  };

  const updateSettings = (next: Settings) => {
    setSettings(next);
    saveSettings(next);
    // The public pilot page shows the character style chosen here
    if (next.pilotStyle !== settings.pilotStyle) void profileClient.setStyle(next.pilotStyle ?? 1).catch(() => {});
  };

  // Lesson mode: its key (when turned on in the settings) covers everything with a blank document
  const [lesson, setLesson] = useState(false);
  const endLesson = useCallback(() => setLesson(false), []);
  useEffect(() => {
    if (!settings.lessonMode) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.repeat || event.ctrlKey || event.metaKey || event.altKey) return;
      const target = event.target as HTMLElement | null;
      // Typing (in the document itself too) types; a dialog waiting for a key to rebind keeps it
      if (target?.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target?.tagName ?? "")) return;
      if (!lesson && document.querySelector("dialog[open]")) return;
      if (!(settings.bindings ?? defaultBindings()).lesson.includes(keyboardBinding(event))) return;
      event.preventDefault();
      event.stopPropagation();
      setLesson((on) => !on);
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [settings, lesson]);
  const cover = lesson && <LessonCover onBack={endLesson} />;

  if (screen.kind === "menu") {
    return <>
      <Menu me={me} settings={settings} onSettings={updateSettings} joinCode={screen.joinCode} go={go} />
      <AchievementToast />
      {cover}
    </>;
  }
  const newcomer = forceTutorial || (me !== null && !me.has_played && tutorialState(me.id) === null);
  const playing = screen.kind === "solo" || screen.kind === "room" || screen.kind === "run";
  const answer = (how: TutorialState) => {
    if (me) saveTutorialState(me.id, how);
    setAsked(true);
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
        tutorial={tutorial}
        onTutorialEnd={endTutorial}
      />
      {playing && newcomer && !asked && <FirstFlight onStart={() => answer("started")} onSkip={() => answer("skipped")} />}
      {screen.kind !== "test" && screen.kind !== "explore" && <AchievementToast />}
      {cover}
    </>
  );
};

export default App;
