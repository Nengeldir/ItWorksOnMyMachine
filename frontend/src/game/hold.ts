// Overlays over the game (the newcomer's key guide, the "?" pop-up) pause it while they're open.
// Games that aren't menu backdrops listen; any number of overlays can hold at once.

type Listener = (held: boolean) => void;

let holds = 0;
const listeners = new Set<Listener>();

/** Pauses the game until the returned function is called */
export function holdGame(): () => void {
  if (++holds === 1) listeners.forEach((listener) => listener(true));
  let released = false;
  return () => {
    if (released) return;
    released = true;
    if (--holds === 0) listeners.forEach((listener) => listener(false));
  };
}

/** Calls `listener` whenever the game becomes held or free, starting with now; returns the unsubscribe */
export function onHold(listener: Listener): () => void {
  listeners.add(listener);
  listener(holds > 0);
  return () => listeners.delete(listener);
}
