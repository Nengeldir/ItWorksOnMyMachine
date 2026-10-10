export const DEFAULT_BINDINGS = {
  pitchDown: ["KeyW", "ArrowUp"], pitchUp: ["KeyS", "ArrowDown"],
  turnLeft: ["KeyA", "ArrowLeft"], turnRight: ["KeyD", "ArrowRight"],
  boost: ["ShiftLeft", "ShiftRight"], brake: ["Space"],
  barrelLeft: ["KeyQ"], barrelRight: ["KeyE"], flap: ["KeyC"], hover: ["KeyF"], plunge: ["KeyX"], burst: ["KeyZ"],
  respawn: ["KeyR"], pause: ["KeyP"], mute: ["KeyM"],
};
export type BindingAction = keyof typeof DEFAULT_BINDINGS;
export type Bindings = Record<BindingAction, string[]>;
export const ACTION_LABELS: Record<BindingAction, string> = {
  pitchDown: "Pitch down", pitchUp: "Pitch up", turnLeft: "Turn left", turnRight: "Turn right",
  boost: "Boost", brake: "Brake", barrelLeft: "Dodge left", barrelRight: "Dodge right",
  flap: "Wingbeat", hover: "Hover-Stall", plunge: "Plunging Attack", burst: "Gale Force", respawn: "Respawn", pause: "Pause / resume", mute: "Mute",
};
export const bindingActions = Object.keys(DEFAULT_BINDINGS) as BindingAction[];
export function defaultBindings(): Bindings {
  return Object.fromEntries(bindingActions.map(a => [a, [...DEFAULT_BINDINGS[a]]])) as Bindings;
}
export function keyLabel(code: string): string {
  const labels: Record<string,string> = { Space:"Space", ShiftLeft:"Left Shift", ShiftRight:"Right Shift", ControlLeft:"Left Ctrl", ControlRight:"Right Ctrl", AltLeft:"Left Alt", AltRight:"Right Alt", ArrowUp:"↑", ArrowDown:"↓", ArrowLeft:"←", ArrowRight:"→" };
  return labels[code] ?? code.replace(/^(Key|Digit)/, "");
}
export function bindingLabel(bindings: Bindings | undefined, action: BindingAction): string {
  return (bindings ?? DEFAULT_BINDINGS)[action].map(keyLabel).join(" / ");
}
// These keys remain available for browser navigation, menus, upgrade choices and debug mode.
export function bindable(code: string): boolean {
  return /^(Key[A-Z]|Digit[5-9]|Numpad[0-9]|Arrow(Up|Down|Left|Right)|Shift(Left|Right)|Control(Left|Right)|Alt(Left|Right)|Space|Comma|Period|Slash|Semicolon|Quote|BracketLeft|BracketRight|Backslash|Minus|Equal)$/.test(code)
    && !["KeyN", "KeyB", "KeyV"].includes(code);
}
