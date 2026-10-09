import type { ControlSettings } from "./game/input";

// Per-browser conveniences. Storage can be unavailable (private windows), so
// every access is wrapped and falls back to defaults.

export interface Settings extends ControlSettings {
  nickname: string;
}

const SETTINGS_KEY = "wingrace.settings";
const CLIENT_KEY = "wingrace.client";

const DEFAULTS: Settings = { nickname: "", invertPitch: false, mouseSensitivity: 1 };

export function loadSettings(): Settings {
  try {
    const saved = JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? "{}");
    return { ...DEFAULTS, ...saved };
  } catch {
    return { ...DEFAULTS };
  }
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
