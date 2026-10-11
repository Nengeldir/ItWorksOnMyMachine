import type { ControlSettings } from "./game/input";
import { defaultBindings, bindingActions, bindable, type Bindings } from "./game/bindings";

// Per-browser conveniences. Storage can be unavailable (private windows), so
// every access is wrapped and falls back to defaults.

export interface Settings extends ControlSettings {
  nickname: string;
}

const SETTINGS_KEY = "windrider.settings";
const CLIENT_KEY = "windrider.client";
const TUTORIAL_KEY = "windrider.tutorial";

export function defaultSettings(): Settings {
  return { nickname: "", invertPitch: false, invertMouse: false, invertGamepad: false, invertTouch: false,
    mouseSensitivity: 2, bindings: defaultBindings(), deadZone: 0.12,
    reducedMotion: false, quality: "auto", musicVolume: 1, effectsVolume: 1, muted: false,
    pilotStyle: 1, crystalsOnly: false };
}

/** Keys handed to new actions whose default keys a player has already bound to something else */
const SPARE_KEYS = ["KeyY", "KeyU", "KeyI", "KeyJ", "KeyK", "KeyL", "KeyO", "Digit5", "Digit6", "Digit7", "Digit8", "Digit9"];

export function normalizeSettings(value: unknown): Settings {
  const defaults = defaultSettings();
  if (!value || typeof value !== "object" || Array.isArray(value)) return defaults;
  const saved = value as Record<string, unknown>;
  const number = (key: string, min: number, max: number, fallback: number) =>
    typeof saved[key] === "number" && Number.isFinite(saved[key]) ? Math.max(min, Math.min(max, saved[key])) : fallback;
  const flag = (key: string, fallback = false) => typeof saved[key] === "boolean" ? saved[key] : fallback;
  const bindings = defaultBindings();
  if (saved.bindings && typeof saved.bindings === "object") {
    const candidate = saved.bindings as Bindings;
    const used = new Set<string>();
    let valid = true;
    // The saved actions first
    const savedActions = bindingActions.filter((action) => candidate[action] !== undefined);
    for (const action of savedActions) {
      const codes = candidate[action];
      if (!Array.isArray(codes) || codes.length < 1 || codes.length > 2) { valid = false; break; }
      for (const code of codes) {
        if (typeof code !== "string" || !bindable(code) || used.has(code)) valid = false;
        used.add(code);
      }
    }
    if (valid) {
      for (const action of savedActions) bindings[action] = [...candidate[action]];
      // Actions added since these were saved keep their default keys, or a spare one where those are taken
      for (const action of bindingActions) {
        if (candidate[action] !== undefined) continue;
        let codes = bindings[action].filter((code) => !used.has(code));
        if (!codes.length) codes = SPARE_KEYS.filter((code) => !used.has(code)).slice(0, 1);
        bindings[action] = codes;
        codes.forEach((code) => used.add(code));
      }
    }
  }
  return { ...defaults, bindings,
    nickname: typeof saved.nickname === "string" ? saved.nickname.slice(0,24) : "",
    invertPitch: flag("invertPitch"), invertMouse: flag("invertMouse", flag("invertPitch")),
    invertGamepad: flag("invertGamepad", flag("invertPitch")),
    mouseSensitivity: number("mouseSensitivity", 0.3, 6, 2),
    invertTouch: flag("invertTouch"),
    deadZone: number("deadZone", 0, 0.4, 0.12), reducedMotion: flag("reducedMotion"), muted: flag("muted"),
    musicVolume: number("musicVolume", 0, 1, 1), effectsVolume: number("effectsVolume", 0, 1, 1),
    pilotStyle: saved.pilotStyle === 2 ? 2 : 1, crystalsOnly: flag("crystalsOnly"),
    quality: ["auto","high","medium","low"].includes(String(saved.quality)) ? saved.quality as Settings["quality"] : "auto",
  };
}

export function loadSettings(): Settings {
  try { return normalizeSettings(JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? "{}")); }
  catch { return defaultSettings(); }
}

export function saveSettings(settings: Settings) {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  } catch {
    // Not persisted, still works for this visit
  }
}

let fallbackClientId = "";

// crypto.randomUUID only exists on HTTPS pages; getRandomValues works everywhere
function randomId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(12));
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

/** A random id for this browser, so guests keep their leaderboard entries */
export function clientId(): string {
  try {
    let id = localStorage.getItem(CLIENT_KEY);
    if (!id) {
      id = randomId();
      localStorage.setItem(CLIENT_KEY, id);
    }
    return id;
  } catch {
    fallbackClientId ||= randomId();
    return fallbackClientId;
  }
}

export type TutorialState = "started" | "skipped";

function loadTutorials(): Record<string, TutorialState> {
  try {
    return JSON.parse(localStorage.getItem(TUTORIAL_KEY) ?? "{}");
  } catch {
    return {};
  }
}

/** Whether this player (a user id: a login, or a guest's browser) has started or skipped the tutorial here */
export function tutorialState(userId: string): TutorialState | null {
  return loadTutorials()[userId] ?? null;
}

export function saveTutorialState(userId: string, state: TutorialState) {
  try {
    localStorage.setItem(TUTORIAL_KEY, JSON.stringify({ ...loadTutorials(), [userId]: state }));
  } catch {
    // Not persisted: the tutorial shows again next visit
  }
}
