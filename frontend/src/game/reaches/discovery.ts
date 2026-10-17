import type { PlaceId } from "../../catalog";
import { EDGE, regionWeights } from "./regions";

// Which places of the Reaches the pilot has found (plan R1): a place counts as found once you fly where it
// owns most of the land (`FOUND_SHARE`), never in a border's blend. Kept in this browser for now; the
// Reaches' save (R20) moves it to the profile. It is no value (nothing to trade), so the server needn't
// check it (ground rule 3).

export const DISCOVERY_KEY = "windrider.reaches.discovered.v1";
/** How much of the land under you a place must own for you to have found it */
export const FOUND_SHARE = 0.7;

export class Discovery {
  private readonly found = new Set<PlaceId>();
  private readonly key: string | null;
  private readonly listeners = new Set<() => void>();

  /** `key`: where it is kept (null: nowhere, for tests and previews); `start`: found already */
  constructor(key: string | null = DISCOVERY_KEY, start: Iterable<PlaceId> = []) {
    this.key = key;
    for (const place of start) this.found.add(place);
    if (key) {
      try {
        const saved = JSON.parse(localStorage.getItem(key) ?? "[]");
        if (Array.isArray(saved)) for (const place of saved) if (typeof place === "string") this.found.add(place as PlaceId);
      } catch { /* Storage may be unavailable: start afresh for this visit */ }
    }
  }

  has(place: PlaceId): boolean {
    return this.found.has(place);
  }

  get places(): PlaceId[] {
    return [...this.found];
  }

  /** Call as the pilot flies: the place found just now, if any (for its title card) */
  visit(x: number, z: number): PlaceId | null {
    const { a, wa } = regionWeights(x, z);
    if (a === EDGE || wa < FOUND_SHARE || this.found.has(a)) return null;
    this.found.add(a);
    this.save();
    return a;
  }

  /** Called on every change */
  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private save() {
    if (this.key) {
      try { localStorage.setItem(this.key, JSON.stringify([...this.found])); } catch { /* Kept for this visit */ }
    }
    this.listeners.forEach((listener) => listener());
  }
}
