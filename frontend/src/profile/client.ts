import { ApiError, request } from "../api";
import { APPEARANCE_EVENT, DEFAULT_APPEARANCE, type Appearance } from "../game/cosmetics/storage";
import { Store } from "../session/store";
import { clientId, loadSettings } from "../storage";
import type { Adventure, ClaimResult, EquipSlot, Equipment, PilotPage, PilotSummary, Profile, Rarity, RunReport, RunReward, Shop, SpinResult } from "./types";

interface Pending { token: string; pickup: string }
interface ProfileState {
  profile: Profile | null;
  pending: number;
  loading: boolean;
  error: string | null;
  notice: { id: number; text: string; levelUp: boolean; expiresAt: number; rarity?: Rarity; duplicate?: boolean } | null;
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

  appearance(): Appearance {
    const equipped = this.store.get().profile?.equipped;
    if (!equipped) return { ...DEFAULT_APPEARANCE };
    const { cape, hat, shoes, wings, pet } = equipped;
    return { cape, hat, shoes, wings, pet };
  }
  /** The looks and the charm (the keepsake carried on adventures) */
  equipped(): Equipment { return { ...this.appearance(), charm: this.store.get().profile?.equipped.charm ?? "none" }; }
  /** The pilot's level (1 until the profile has loaded) */
  level(): number { return this.store.get().profile?.level ?? 1; }
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
      void this.flushReports();
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
          const one = result.accepted.length === 1 ? result.accepted[0] : null;
          // A duplicate says so plainly: you already have it, and here are its crystals instead
          const names = one ? (one.duplicate ? `Duplicate · ${one.name} (already in your collection)` : one.name) : `${result.accepted.length} discoveries`;
          const gains = `+${result.xp} XP${result.crystals ? ` · +${result.crystals} crystals` : ""}`;
          const rarity = result.accepted.map(a => a.rarity).filter((r): r is Rarity => !!r && r !== "common").at(-1) ?? one?.rarity;
          this.notify(result.levels ? `Level ${result.profile.level}! ${names} · ${gains}` : `${names} · ${gains}`, result.levels > 0, rarity, !!one?.duplicate);
        }
        if (!this.rejected.size) this.store.set({ error: null });
      }
    } catch {
      this.store.set({ error: "Rewards waiting to save. Reconnecting…" });
      this.timer = setTimeout(() => { this.timer = null; void this.flush(); }, 5000);
    } finally { this.saving = false; }
  }
  private notify(text: string, levelUp: boolean, rarity?: Rarity, duplicate = false) {
    this.store.set({ notice: { id: ++this.noticeId, text, levelUp, expiresAt: Date.now() + (duplicate ? 4200 : 3600), rarity, duplicate } });
  }

  async equip(slot: EquipSlot, asset: string) {
    const profile = await request<Profile>("/api/profile/equip", "POST", { ...identity(), slot, asset });
    this.publish(profile);
  }

  async namePet(pet: string, name: string) {
    this.publish(await request<Profile>("/api/profile/pets", "POST", { ...identity(), pet, name }));
  }

  async setStyle(style: 1 | 2) {
    if (this.store.get().profile?.style === style) return;
    this.publish(await request<Profile>("/api/profile/style", "POST", { ...identity(), style }));
  }

  // --- an adventure's result: gates become XP, the score crystals (sent until the server has it) ---

  private reportsKey() { return `windrider.profile.reports.v1:${encodeURIComponent(this.store.get().profile?.user_id ?? "")}`; }
  private pendingReports(): Record<string, RunReport> {
    try {
      const saved = JSON.parse(localStorage.getItem(this.reportsKey()) ?? "{}");
      return saved && typeof saved === "object" ? saved : {};
    } catch { return {}; }
  }
  private keepReports(reports: Record<string, RunReport>) {
    try {
      if (Object.keys(reports).length) localStorage.setItem(this.reportsKey(), JSON.stringify(reports));
      else localStorage.removeItem(this.reportsKey());
    } catch { /* Retried from memory this visit only. */ }
  }

  /** Reports an adventure (`token` from `start`). Resolves with what it earned, or null if it couldn't be saved yet */
  async reportRun(token: string, report: RunReport): Promise<RunReward | null> {
    const pending = { ...this.pendingReports(), [token]: report };
    this.keepReports(pending);
    try {
      const reward = await request<RunReward>("/api/profile/runs", "POST", { ...identity(), token, ...report });
      const left = this.pendingReports();
      delete left[token];
      this.keepReports(left);
      this.publish(reward.profile);
      if (!reward.repeated && (reward.xp || reward.crystals))
        this.notify(`${reward.levels ? `Level ${reward.profile.level}! ` : ""}Adventure rewards · +${reward.xp} XP · +${reward.crystals} crystals`, reward.levels > 0, "legendary");
      return reward;
    } catch (error) {
      if (error instanceof ApiError && error.status >= 400 && error.status < 500 && error.status !== 429) {
        const left = this.pendingReports();
        delete left[token];
        this.keepReports(left);
        this.store.set({ error: `Adventure rewards not saved: ${error.message}` });
      }
      return null;
    }
  }

  /** Reports that couldn't reach the server before (a closed tab, no connection) */
  private async flushReports() {
    for (const [token, report] of Object.entries(this.pendingReports())) await this.reportRun(token, report);
  }

  // --- the market, the wheel and the public pages ---------------------------------------------------

  async shop(): Promise<Shop> {
    const who = identity();
    const shop = await request<Shop>(`/api/shop?client_id=${encodeURIComponent(who.client_id)}&nickname=${encodeURIComponent(who.nickname)}`);
    this.publish(shop.profile);
    return shop;
  }

  async buy(key: string) {
    const result = await request<{ profile: Profile }>("/api/shop/buy", "POST", { ...identity(), key });
    this.publish(result.profile);
    return result;
  }

  async spin(): Promise<SpinResult> {
    const result = await request<SpinResult>("/api/shop/spin", "POST", { ...identity() });
    this.publish(result.profile);
    return result;
  }

  players(): Promise<PilotSummary[]> {
    return request<PilotSummary[]>("/api/players?limit=50");
  }

  player(publicId: string): Promise<PilotPage> {
    return request<PilotPage>(`/api/players/${encodeURIComponent(publicId)}`);
  }
}
export const profileClient = new ProfileClient();
