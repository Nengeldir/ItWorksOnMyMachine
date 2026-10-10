/** Shared by the panel buttons and keyboard shortcuts. This module is loaded only with ?debug. */
export const DEBUG_ACTIONS = [
  { id: "spawnPortal", code: "KeyP", label: "Spawn portal (Shift+P)" },
  { id: "win", code: "KeyO", label: "Win adventure (Shift+O)" },
] as const;

export type DebugAction = typeof DEBUG_ACTIONS[number]["id"];

export function debugActionFor(event: Pick<KeyboardEvent, "code" | "shiftKey" | "ctrlKey" | "altKey" | "metaKey">): DebugAction | null {
  if (!event.shiftKey || event.ctrlKey || event.altKey || event.metaKey) return null;
  return DEBUG_ACTIONS.find((action) => action.code === event.code)?.id ?? null;
}
