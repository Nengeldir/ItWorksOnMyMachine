import { ApiError, request } from "../api";
import { APPEARANCE_EVENT, DEFAULT_APPEARANCE, type Appearance } from "../game/cosmetics/storage";
import { Store } from "../session/store";
import { clientId, loadSettings } from "../storage";
import type { Adventure, ClaimResult, Profile } from "./types";

interface Pending { token: string; pickup: string }
interface ProfileState {
  profile: Profile | null;
  pending: number;
  loading: boolean;
  error: string | null;
  notice: { id: number; text: string; levelUp: boolean; expiresAt: number } | null;
}
const identity = () => ({ client_id: clientId(), nickname: loadSettings().nickname });

/** The server owns balances. The outbox only stores issued pickup ids for safe retries. */
export class ProfileClient {
  readonly store = new Store<ProfileState>({ profile: null, pending: 0, loading: false, error: null, notice: null });
  private ready: Promise<void> | null = null;
  private queue: Pending[] = [];
  private saving = false;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private noticeId = 0;
  private outboxKey = "";
  private readonly rejected = new Set<string>();

  appearance(): Appearance { return this.store.get().profile?.equipped ?? { ...DEFAULT_APPEARANCE }; }
  private publish(profile: Profile) {
    const previous = this.store.get().profile;
    if (previous?.user_id === profile.user_id && previous.revision > profile.revision) return;
    this.store.set({ profile });
    if (!previous || Object.keys(profile.equipped).some(slot => previous.equipped[slot as keyof Appearance] !== profile.equipped[slot as keyof Appearance]))
      window.dispatchEvent(new Event(APPEARANCE_EVENT));
  }
  initialize(): Promise<void> {
    if (this.ready) return this.ready;
    this.ready = this.refresh().catch(() => {}).finally(() => { this.ready = null; });
    return this.ready;
  }
  async refresh() {
    this.store.set({ loading: true });
    try {
      const who = identity();
      const profile = await request<Profile>(`/api/profile?client_id=${encodeURIComponent(who.client_id)}&nickname=${encodeURIComponent(who.nickname)}`);
      const key = `windrider.profile.outbox.v1:${encodeURIComponent(profile.user_id)}:`;
      if (key !== this.outboxKey) {
        this.outboxKey = key;
        try {
          this.queue = [];
          for (let i = 0; i < localStorage.length; i++) {
            const entryKey = localStorage.key(i);
            if (!entryKey?.startsWith(key)) continue;
            try {
              const p = JSON.parse(localStorage.getItem(entryKey) ?? "null");
              if (p && typeof p.token === "string" && p.token.length > 0 && p.token.length <= 128 && typeof p.pickup === "string" && /^[1-8]:[ct]\d{1,2}$/.test(p.pickup)) this.queue.push(p);
            } catch { /* A damaged record must not discard other rewards. */ }
          }
        } catch { this.queue = []; }
      }
      this.publish(profile);
      this.rejected.clear();
      this.store.set({ error: null, pending: this.queue.length });
      void this.flush();
    } catch (error) {
      this.store.set({ error: `Profile unavailable: ${(error as Error).message}` });
      throw error;
    } finally { this.store.set({ loading: false }); }
  }
  async start(seed: number): Promise<Adventure> {
    await this.initialize();
    if (!this.store.get().profile) throw new Error("Connect to the server to start collecting adventure rewards.");
    return request("/api/profile/adventures", "POST", { ...identity(), seed });
  }
  collect(token: string, pickup: string) {
    if (this.queue.some(p => p.token === token && p.pickup === pickup)) return;
    this.queue.push({ token, pickup });
    try { localStorage.setItem(this.recordKey({ token, pickup }), JSON.stringify({ token, pickup })); } catch { /* Retry from memory this visit. */ }
    this.persist();
    void this.flush();
  }
  private persist() {
    this.store.set({ pending: this.queue.length });
  }
  private recordKey(p: Pending) { return `${this.outboxKey}${p.token}:${p.pickup}`; }
  async flush() {
    if (this.saving || !this.queue.length) return;
    if (this.timer) { clearTimeout(this.timer); this.timer = null; }
    this.saving = true;
    try {
      while (this.queue.length) {
        const token = this.queue.find(p => !this.rejected.has(p.token))?.token;
        if (!token) break;
        const batch = this.queue.filter(p => p.token === token).slice(0, 24);
        let result: ClaimResult;
        try {
          result = await request<ClaimResult>("/api/profile/claim", "POST", { ...identity(), token, pickups: batch.map(p => p.pickup) });
        } catch (error) {
          if (error instanceof ApiError && error.status >= 400 && error.status < 500 && error.status !== 429) {
            this.rejected.add(token);
            this.store.set({ error: `Some rewards could not save: ${error.message}. Retry from your inventory.` });
            continue;
          }
          throw error;
        }
        this.publish(result.profile);
        for (const p of batch) {
          try { localStorage.removeItem(this.recordKey(p)); } catch { /* An idempotent retry is harmless. */ }
        }
        this.queue = this.queue.filter(p => !batch.some(b => p.token === b.token && p.pickup === b.pickup));
        this.persist();
        if (result.accepted.length) {
          const names = result.accepted.length === 1 ? result.accepted[0].name + (result.accepted[0].duplicate ? " · duplicate" : "") : `${result.accepted.length} discoveries`;
          const gains = `+${result.xp} XP${result.crystals ? ` · +${result.crystals} crystals` : ""}`;
          this.store.set({ notice: { id: ++this.noticeId, text: result.levels ? `Level ${result.profile.level}! ${names} · ${gains}` : `${names} · ${gains}`, levelUp: result.levels > 0, expiresAt: Date.now() + 3600 } });
        }
        if (!this.rejected.size) this.store.set({ error: null });
      }
    } catch {
      this.store.set({ error: "Rewards waiting to save. Reconnecting…" });
      this.timer = setTimeout(() => { this.timer = null; void this.flush(); }, 5000);
    } finally { this.saving = false; }
  }
  async equip(slot: keyof Appearance, asset: string) {
    const profile = await request<Profile>("/api/profile/equip", "POST", { ...identity(), slot, asset });
    this.publish(profile);
  }
}
export const profileClient = new ProfileClient();
