import { ApiError, request } from "../../api";
import { Store } from "../../session/store";
import { clientId, loadSettings } from "../../storage";
import { worldUi } from "../../worldUi";
import {
  actionId, EMPTY_INVENTORY, predict, project, type BatchAnswer, type InventoryAction, type InventoryState, type SkillGain,
} from "./model";

// The inventory's outbox (plan F3): an action is predicted at once, kept in
// localStorage until the server has answered it, and sent in batches every
// FLUSH_MS (or when a sheet closes). The server's answer replaces the
// confirmed state; actions still waiting are predicted again on top, so the
// view converges on the truth. Sending an action twice is harmless: the
// server answers an action_id once and repeats that answer.

export const FLUSH_MS = 2000;
const RETRY_MS = 5000;
const BATCH = 50;

/** How the client talks to the server (replaced in tests) */
export interface InventoryTransport {
  load(): Promise<InventoryState>;
  send(actions: readonly InventoryAction[]): Promise<BatchAnswer>;
}

/** The part of localStorage the outbox uses */
export type KeyValue = Pick<Storage, "getItem" | "setItem" | "removeItem">;

export interface InventoryView {
  /** What the player sees: the server's last word plus every pending action */
  inventory: InventoryState;
  pending: number;
  /** The last action the server refused, and why */
  refused: { action_id: string; error: string } | null;
  error: string | null;
  /** Skill XP earned, newest last (the skill toast and the level-up card show them) */
  gains: readonly { id: number; at: number; gain: SkillGain }[];
}

/** An action without its id: the outbox gives it one */
export type NewAction = InventoryAction extends infer A ? (A extends InventoryAction ? Omit<A, "action_id"> : never) : never;

const identity = () => ({ client_id: clientId(), nickname: loadSettings().nickname });

export function httpTransport(): InventoryTransport {
  return {
    load: () => {
      const who = identity();
      return request<InventoryState>(`/api/inv?client_id=${encodeURIComponent(who.client_id)}&nickname=${encodeURIComponent(who.nickname)}`);
    },
    send: (actions) => request<BatchAnswer>("/api/inv/actions", "POST", { ...identity(), actions }),
  };
}

export class InventoryClient {
  readonly store = new Store<InventoryView>({ inventory: EMPTY_INVENTORY, pending: 0, refused: null, error: null, gains: [] });
  private gainId = 0;
  private confirmed: InventoryState = EMPTY_INVENTORY;
  private pending: InventoryAction[] = [];
  private sending = false;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private readonly transport: InventoryTransport;
  private readonly storage: KeyValue | null;
  private readonly key: string;

  constructor(transport: InventoryTransport, storage: KeyValue | null, key = `windrider.inventory.outbox.v1:${clientId()}`) {
    this.transport = transport;
    this.storage = storage;
    this.key = key;
    this.pending = this.restore();
    this.publish();
  }

  /** Loads the server's inventory and sends whatever a previous visit left waiting */
  async start(): Promise<void> {
    try {
      this.accept(await this.transport.load());
      this.store.set({ error: null });
    } catch (error) {
      this.store.set({ error: `Inventory unavailable: ${(error as Error).message}` });
    }
    await this.flush();
  }

  /** Predicts an action, queues it and returns its id; or returns the reason it can't happen */
  act(action: NewAction): { id: string } | { error: string } {
    const full = { ...action, action_id: actionId() } as InventoryAction;
    const { error } = predict(this.store.get().inventory, full);
    if (error) return { error };
    this.pending.push(full);
    this.save();
    this.publish();
    this.schedule(FLUSH_MS);
    return { id: full.action_id };
  }

  /** Sends everything waiting now (a sheet closing, the page hiding) */
  async flush(): Promise<void> {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    if (this.sending) return;
    this.sending = true;
    try {
      while (this.pending.length) {
        const batch = this.pending.slice(0, BATCH);
        let answer: BatchAnswer;
        try {
          answer = await this.transport.send(batch);
        } catch (error) {
          if (error instanceof ApiError && error.status >= 400 && error.status < 500 && error.status !== 429) {
            // The batch itself is malformed: it will never go through, so let it go
            this.pending = this.pending.filter((action) => !batch.includes(action));
            this.save();
            this.store.set({ error: `Some changes could not be saved: ${error.message}` });
            this.publish();
            continue;
          }
          this.store.set({ error: "Changes waiting to save. Reconnecting…" });
          this.schedule(RETRY_MS);
          return;
        }
        if (!this.reconcile(answer)) {
          // Only rate-limited actions came back: try again later
          this.schedule(RETRY_MS);
          return;
        }
      }
      this.store.set({ error: null });
    } finally {
      this.sending = false;
    }
  }

  /** The server's answer: the truth, plus whatever is still waiting. False if nothing was settled */
  reconcile(answer: BatchAnswer): boolean {
    const settled = new Set(answer.results.filter((result) => !result.retry).map((result) => result.action_id));
    const refused = answer.results.filter((result) => !result.ok && !result.retry).at(-1);
    this.pending = this.pending.filter((action) => !settled.has(action.action_id));
    this.accept(answer.inventory);
    this.save();
    if (refused) this.store.set({ refused: { action_id: refused.action_id, error: refused.error ?? "Refused" } });
    const gains = answer.results.flatMap((result) => (result.ok && result.xp ? [{ id: ++this.gainId, at: Date.now(), gain: result.xp }] : []));
    if (gains.length) this.store.set({ gains: [...this.store.get().gains, ...gains].slice(-8) });
    return settled.size > 0;
  }

  private accept(state: InventoryState) {
    // An older answer (overtaken by a newer one) never rolls the view back
    if (state.rev >= this.confirmed.rev) this.confirmed = state;
    this.publish();
  }

  private publish() {
    this.store.set({ inventory: project(this.confirmed, this.pending), pending: this.pending.length });
  }

  private schedule(ms: number) {
    if (this.timer) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.flush();
    }, ms);
  }

  private restore(): InventoryAction[] {
    try {
      const saved = JSON.parse(this.storage?.getItem(this.key) ?? "[]");
      return Array.isArray(saved)
        ? saved.filter((action) => action && typeof action.action_id === "string" && typeof action.kind === "string")
        : [];
    } catch {
      return [];
    }
  }

  private save() {
    try {
      if (this.pending.length) this.storage?.setItem(this.key, JSON.stringify(this.pending));
      else this.storage?.removeItem(this.key);
    } catch {
      // Kept in memory for this visit; the server's idempotency makes a later resend harmless
    }
  }
}

let shared: InventoryClient | null = null;

/** The page's inventory client (created on first use: races never make one) */
export function inventoryClient(): InventoryClient {
  if (!shared) {
    let storage: KeyValue | null = null;
    try {
      storage = localStorage;
    } catch {
      // Private mode without storage: the outbox lives in memory
    }
    shared = new InventoryClient(httpTransport(), storage);
    worldUi.want();
  }
  return shared;
}
