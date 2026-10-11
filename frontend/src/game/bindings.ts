export const DEFAULT_BINDINGS = {
  pitchDown: ["KeyW", "ArrowUp"], pitchUp: ["KeyS", "ArrowDown"],
  turnLeft: ["KeyA", "ArrowLeft"], turnRight: ["KeyD", "ArrowRight"],
  boost: ["ShiftLeft", "ShiftRight"], brake: ["Space"],
  barrelLeft: ["KeyQ"], barrelRight: ["KeyE"], flap: ["KeyC"], hover: ["KeyF"], plunge: ["KeyX"], burst: ["KeyZ"],
  resonance: ["KeyT"], ascend: ["KeyG"], stance: ["KeyH"], useItem: ["KeyY"], nextItem: ["KeyU"], charm: ["KeyK"],
  respawn: ["KeyR"], pause: ["KeyP"], mute: ["KeyM"], lesson: ["KeyL"],
};
export type BindingAction = keyof typeof DEFAULT_BINDINGS;
export type Bindings = Record<BindingAction, string[]>;
export const ACTION_LABELS: Record<BindingAction, string> = {
  pitchDown: "Pitch down", pitchUp: "Pitch up", turnLeft: "Turn left", turnRight: "Turn right",
  boost: "Boost", brake: "Brake", barrelLeft: "Dodge left", barrelRight: "Dodge right",
  flap: "Wingbeat", hover: "Hover-Stall", plunge: "Plunging Attack", burst: "Gale Force", resonance: "Resonance", ascend: "Ascension", stance: "Gliding stance", useItem: "Use item", nextItem: "Next item", charm: "Use charm", respawn: "Respawn", pause: "Pause / resume", mute: "Mute", lesson: "Lesson mode (when on)",
};
export const bindingActions = Object.keys(DEFAULT_BINDINGS) as BindingAction[];
export function defaultBindings(): Bindings {
  return Object.fromEntries(bindingActions.map(a => [a, [...DEFAULT_BINDINGS[a]]])) as Bindings;
}
const CHARACTER_CODES: Record<string, string> = {
  ",": "Comma", ".": "Period", "/": "Slash", ";": "Semicolon", "'": "Quote",
  "[": "BracketLeft", "]": "BracketRight", "\\": "Backslash", "-": "Minus", "=": "Equal",
};

function characterBinding(key: string): string {
  if (/^[a-z]$/i.test(key)) return `Key${key.toUpperCase()}`;
  if (/^[0-9]$/.test(key)) return `Digit${key}`;
  return CHARACTER_CODES[key] ?? `Char:${key.toLowerCase()}`;
}

/** Bind characters from the player's layout; only modifiers and the numeric keypad use positions.
 * Keep the existing Key/ Digit identifiers so saved bindings still mean their displayed characters.
 */
export function keyboardBinding(event: Pick<KeyboardEvent, "key" | "code" | "isComposing">): string {
  if (event.isComposing || event.key === "Dead" || event.key === "Unidentified") return "";
  if (/^(Shift|Control|Alt)(Left|Right)$/.test(event.code) || /^Numpad[0-9]$/.test(event.code)) return event.code;
  if (event.key === " ") return "Space";
  if (/^[\p{L}\p{N}\p{P}\p{S}]$/u.test(event.key)) return characterBinding(event.key);
  return event.key;
}

export function keyLabel(code: string): string {
  const labels: Record<string,string> = { Space:"Space", ShiftLeft:"Left Shift", ShiftRight:"Right Shift", ControlLeft:"Left Ctrl", ControlRight:"Right Ctrl", AltLeft:"Left Alt", AltRight:"Right Alt", ArrowUp:"↑", ArrowDown:"↓", ArrowLeft:"←", ArrowRight:"→" };
  if (code.startsWith("Char:")) {
    const character = code.slice(5), upper = character.toUpperCase();
    return [...upper].length === 1 ? upper : character;
  }
  const character = Object.keys(CHARACTER_CODES).find(key => CHARACTER_CODES[key] === code);
  if (character) return character;
  return labels[code] ?? code.replace(/^(Key|Digit)/, "");
}
export function bindingLabel(bindings: Bindings | undefined, action: BindingAction): string {
  return (bindings ?? DEFAULT_BINDINGS)[action].map(keyLabel).join(" / ");
}
// These keys remain available for browser navigation, menus, upgrade choices and debug mode.
export function bindable(code: string): boolean {
  if (code.startsWith("Char:")) {
    const character = code.slice(5);
    return /^[\p{L}\p{N}\p{P}\p{S}]$/u.test(character) && characterBinding(character) === code;
  }
  return /^(Key[A-Z]|Digit[5-9]|Numpad[0-9]|Arrow(Up|Down|Left|Right)|Shift(Left|Right)|Control(Left|Right)|Alt(Left|Right)|Space|Comma|Period|Slash|Semicolon|Quote|BracketLeft|BracketRight|Backslash|Minus|Equal)$/.test(code)
    && !["KeyN", "KeyB", "KeyV"].includes(code);
}
