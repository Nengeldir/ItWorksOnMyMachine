// A tab left open across a redeploy still runs the previous build, whose lazy chunks (bloom,
// the tuning panel) and mesher worker no longer exist on the server. Loading one of them fails,
// so the page reloads once to pick up the current build instead of hanging without land.

const KEY = "wingrace:stale-reload";
const RETRY_MS = 30_000;

/** Reloads the page, unless it already did so in the last 30 s (then the file is really missing) */
export function reloadForNewBuild(reason: unknown) {
  if (import.meta.env.DEV) return;
  try {
    const last = Number(sessionStorage.getItem(KEY) ?? 0);
    if (Date.now() - last < RETRY_MS) return;
    sessionStorage.setItem(KEY, String(Date.now()));
  } catch {
    return; // without storage there is no guard against a reload loop
  }
  console.warn("Part of the game failed to load; reloading for the current build", reason);
  location.reload();
}

/** Vite fires this when a dynamic import's chunk can't be fetched */
export function watchForStaleBuild() {
  window.addEventListener("vite:preloadError", (event) => {
    event.preventDefault();
    reloadForNewBuild((event as Event & { payload?: unknown }).payload);
  });
}
