import { type BindingAction, defaultBindings, keyLabel } from "../game/bindings";
import { loadSettings } from "../storage";

/** A key as players know it: "Shift" for either Shift, "↑" for the arrow */
export const shortKey = (code: string) => keyLabel(code).replace(/^(Left|Right) /, "");

/**
 * The keys bound right now (players rebind them in the settings), one group per binding slot, without
 * repeats: boundKeys("turnLeft", "turnRight") gives [["A", "D"], ["←", "→"]], boundKeys("boost") [["Shift"]].
 */
export function boundKeys(...actions: BindingAction[]): string[][] {
  const bindings = loadSettings().bindings ?? defaultBindings();
  const slots = Math.max(...actions.map((action) => bindings[action].length));
  const groups: string[][] = [];
  for (let i = 0; i < slots; i++) {
    const codes = actions.map((action) => bindings[action][i]);
    if (codes.some((code) => !code)) continue;
    const group = codes.map(shortKey);
    if (!groups.some((other) => other.join() === group.join())) groups.push(group);
  }
  return groups;
}
