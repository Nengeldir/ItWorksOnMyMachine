/** The URL opts in only on a development server; production builds always return false. */
export function debugModeRequested(search = location.search): boolean {
  return import.meta.env.DEV && new URLSearchParams(search).has("debug");
}

/** Per-game playtest settings. Add controls in tuning.ts and consume them only behind DEV. */
export interface DebugSettings {
  showFlight: boolean;
  portalAhead: number; // metres ahead of the pilot for the spawned portal
}
