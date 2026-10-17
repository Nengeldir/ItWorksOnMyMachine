// The toast queue (plan F7): short notes that come and go on their own ("Bag full", "Saved"). At most
// `visible` at once, the rest wait; a toast pushed again with the same key while it shows is refreshed
// and counted ("×3") instead of stacking. Pure state plus a tiny store, so node tests can drive it with
// their own clock.

export type ToastTone = "info" | "good" | "warn";

export interface ToastInput {
  text: string;
  /** Same key while shown: refresh it and count up instead of a second toast */
  key?: string;
  tone?: ToastTone;
  /** ms on screen (default 2600) */
  duration?: number;
}

export interface Toast {
  id: number;
  key: string;
  text: string;
  tone: ToastTone;
  count: number;
  duration: number;
  /** When it went on screen (null: still waiting) */
  shownAt: number | null;
}

export class ToastQueue {
  readonly visible: number;
  private items: Toast[] = [];
  private nextId = 1;

  constructor(visible = 3) {
    this.visible = visible;
  }

  push(input: ToastInput, now: number): Toast {
    const key = input.key ?? input.text;
    const same = this.items.find((t) => t.key === key);
    if (same) {
      same.count++;
      same.text = input.text;
      if (same.shownAt !== null) same.shownAt = now;
      return same;
    }
    const toast: Toast = { id: this.nextId++, key, text: input.text, tone: input.tone ?? "info", count: 1, duration: input.duration ?? 2600, shownAt: null };
    this.items.push(toast);
    this.update(now);
    return toast;
  }

  dismiss(id: number, now: number) {
    this.items = this.items.filter((t) => t.id !== id);
    this.update(now);
  }

  /** Drops the expired ones and lets waiting ones in. Returns true when anything changed */
  update(now: number): boolean {
    const before = this.items.length;
    this.items = this.items.filter((t) => t.shownAt === null || now - t.shownAt < t.duration);
    let changed = this.items.length !== before;
    let shown = this.items.filter((t) => t.shownAt !== null).length;
    for (const t of this.items) {
      if (shown >= this.visible) break;
      if (t.shownAt === null) {
        t.shownAt = now;
        shown++;
        changed = true;
      }
    }
    return changed;
  }

  /** On screen now, oldest first */
  showing(): Toast[] {
    return this.items.filter((t) => t.shownAt !== null);
  }

  /** ms until the next one expires (Infinity: nothing on screen) */
  nextExpiry(now: number): number {
    let soonest = Infinity;
    for (const t of this.items) if (t.shownAt !== null) soonest = Math.min(soonest, t.shownAt + t.duration - now);
    return Math.max(0, soonest);
  }
}

// --- the page's one queue, for React (useSyncExternalStore) -------------------------------------

const queue = new ToastQueue();
let snapshot: readonly Toast[] = [];
let timer: ReturnType<typeof setTimeout> | null = null;
const listeners = new Set<() => void>();

function publish() {
  snapshot = queue.showing().map((t) => ({ ...t }));
  listeners.forEach((listener) => listener());
  if (timer) clearTimeout(timer);
  const wait = queue.nextExpiry(Date.now());
  timer = Number.isFinite(wait)
    ? setTimeout(() => {
        timer = null;
        queue.update(Date.now());
        publish();
      }, wait + 16)
    : null;
}

export const toasts = {
  push(input: ToastInput) {
    queue.push(input, Date.now());
    publish();
  },
  dismiss(id: number) {
    queue.dismiss(id, Date.now());
    publish();
  },
  subscribe(listener: () => void) {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },
  get: () => snapshot,
};
