import { type FormEvent, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { IconArrowLeft, IconAward, IconBook, IconBook2, IconDiamond, IconLock, IconRotate, IconSparkles, IconX } from "@tabler/icons-react";
import { profileClient } from "../profile/client";
import type { Collectible, Profile } from "../profile/types";
import { RARITY_STYLE } from "../game/collection/rarity";
import { powerOf } from "../game/collection/abilities";
import { collectibleIcon } from "../game/collection/icons";
import { playVoice } from "../game/collection/sounds";
import { CAPES, HATS, SHOES, WINGS } from "../game/cosmetics/catalog";
import { PETS } from "../game/pets/catalog";
import { RUN_ITEMS } from "../game/run/items";
import { loadSettings } from "../storage";
import { boundKeys } from "./keys";
import CollectionPreview from "./CollectionPreview";
import FieldGuide from "./FieldGuide";
import AchievementsView from "./AchievementsView";
import Minifigure from "./Minifigure";
import { rarityStyle } from "./rarity";
import "./ProfilePanel.css";

const tabs = ["All", "Cosmetics", "Pets", "Keepsakes"] as const;
/** The cosmetics, by kind */
const cosmeticKinds = [["all", "All"], ["wings", "Wings"], ["cape", "Capes"], ["hat", "Hats"], ["shoes", "Shoes"]] as const;
type CosmeticKind = (typeof cosmeticKinds)[number][0];

/** A collectible's own description (its look or its adventure item's effect) */
function lore(item: Collectible): string | undefined {
  const lists: Record<string, readonly { id: string; description: string }[]> = { cape: CAPES, hat: HATS, shoes: SHOES, wings: WINGS, pet: PETS };
  if (item.kind === "item") return RUN_ITEMS.find((run) => run.model === item.asset || run.id === item.asset)?.description;
  return lists[item.kind]?.find((entry) => entry.id === item.asset)?.description;
}

/** Where an entry stands for this pilot */
function status(item: Collectible, profile: Profile): { owned: boolean; text: string; locked: boolean } {
  const owned = !!profile.inventory[item.key];
  const slot = item.slot;
  if (owned) {
    if (slot === "charm" && profile.equipped.charm === item.asset) return { owned, text: "Carried as charm", locked: false };
    if (slot && slot !== "charm" && profile.equipped[slot] === item.asset) return { owned, text: "Equipped", locked: false };
    return { owned, text: "Collected", locked: false };
  }
  const level = item.min_level ?? 1;
  return level > profile.level ? { owned, text: `Unlocks at level ${level}`, locked: true } : { owned, text: "Undiscovered", locked: false };
}

/** The pilot the journal belongs to, from the landing page: their name, which a guest can change here */
export interface JournalPilot {
  name: string;
  verified: boolean;
  onName: (name: string) => void;
}

/**
 * The adventure journal: who you are (name, level, crystals, experience, the figurine in everything
 * equipped), then everything you can collect, by kind, with a turning preview, its lore and power.
 * A sheet like the settings (index.css).
 */
export default function ProfilePanel({ onClose, pilot }: { onClose: () => void; pilot?: JournalPilot }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const { profile, error, pending, loading } = useSyncExternalStore(profileClient.store.subscribe, profileClient.store.get);
  const [tab, setTab] = useState<typeof tabs[number]>("All");
  const [cosmetic, setCosmetic] = useState<CosmeticKind>("all");
  /** The collection, or one of the pages above it: the field guide and the achievements */
  const [view, setView] = useState<"collection" | "guide" | "achievements">("collection");
  const [ownedOnly, setOwnedOnly] = useState(false);
  const [selected, setSelected] = useState("cape:classic");
  const [message, setMessage] = useState("");
  const [saving, setSaving] = useState(false);
  const [rear, setRear] = useState(true);
  const [petName, setPetName] = useState("");
  useEffect(() => {
    const el = dialog.current!; el.showModal();
    // A guest without a name (an invite opens the journal for it) starts typing it straight away
    el.querySelector<HTMLInputElement>(".journal-name input:placeholder-shown")?.focus();
    const stop = (e: KeyboardEvent) => { e.stopPropagation(); };
    window.addEventListener("keydown", stop, true); window.addEventListener("keyup", stop, true);
    void profileClient.initialize();
    return () => { window.removeEventListener("keydown", stop, true); window.removeEventListener("keyup", stop, true); el.close(); };
  }, []);
  const entries = profile?.catalog.filter(item =>
    (tab === "All" || (tab === "Cosmetics" ? (cosmetic === "all" ? ["cape", "hat", "shoes", "wings"].includes(item.kind) : item.kind === cosmetic) : item.kind === (tab === "Pets" ? "pet" : "item"))) &&
    (!ownedOnly || profile.inventory[item.key])) ?? [];
  const item = profile?.catalog.find(e => e.key === selected);
  const state = item && profile ? status(item, profile) : null;
  const power = item ? powerOf(item.key) : null;
  const discovered = profile ? profile.catalog.filter(e => profile.inventory[e.key]).length : 0;
  const charmKey = boundKeys("charm")[0]?.[0] ?? "K";

  const pick = (entry: Collectible) => {
    setSelected(entry.key);
    setRear(entry.kind === "cape" || entry.kind === "wings");
    setMessage("");
    setPetName(entry.kind === "pet" ? profile?.pet_names[entry.asset] ?? "" : "");
    // Things with a power have a voice of their own
    const voice = powerOf(entry.key)?.voice;
    if (voice) playVoice(voice, 0.7);
  };
  const act = async (work: () => Promise<unknown>, done: string) => {
    setSaving(true); setMessage("");
    try { await work(); setMessage(done); }
    catch (error) { setMessage((error as Error).message); }
    finally { setSaving(false); }
  };
  const equip = () => item?.slot && act(() => profileClient.equip(item.slot!, item.asset), item.slot === "charm" ? `${item.name} is your charm now.` : `${item.name} equipped.`);
  const rename = (event: FormEvent) => {
    event.preventDefault();
    if (item?.kind === "pet") void act(() => profileClient.namePet(item.asset, petName.trim()), petName.trim() ? `Your ${item.name} is called ${petName.trim()} now.` : "Name cleared.");
  };
  const equipped = !!state && (state.text === "Equipped" || state.text === "Carried as charm");
  const title = pilot ? pilot.name || "Guest" : profile?.name ?? "Your journal";
  const xp = profile ? (profile.next_level_xp ? profile.level_xp / profile.next_level_xp : 1) : 0;
  const charm = profile && profile.equipped.charm !== "none" ? profile.catalog.find(e => e.key === `item:${profile.equipped.charm}`) : undefined;
  // Esc goes back a page first, then closes
  const dismiss = () => (view === "collection" ? onClose() : setView("collection"));
  return <dialog ref={dialog} className={`profile-dialog sheet view-${view}`} aria-labelledby="profile-title" onCancel={e => { e.preventDefault(); dismiss(); }}>
    <header className="sheet-head">
      {view === "collection"
        ? <span className="overlay-badge"><IconBook2 size={22} /></span>
        : <button className="journal-back" onClick={() => setView("collection")} aria-label="Back to the journal"><IconArrowLeft size={18} /> Back</button>}
      <div><small>{view === "collection" ? "Adventure journal" : view === "guide" ? "Field guide" : "Achievements"}</small>
        <h2 id="profile-title">{view === "collection" ? title : view === "guide" ? "How everything works" : "Feats of the wind"}</h2></div>
      {view === "collection" && <nav className="journal-pages" aria-label="Journal pages">
        <button onClick={() => setView("guide")}><IconBook size={18} /><span>Guide</span></button>
        <button onClick={() => setView("achievements")}><IconAward size={18} /><span>Achievements</span></button>
      </nav>}
      <button className="sheet-close" autoFocus onClick={onClose} aria-label="Close the journal"><IconX size={20} /></button>
    </header>
    {view === "guide" && <FieldGuide catalog={profile?.catalog ?? []} />}
    {view === "achievements" && <AchievementsView />}
    {view === "collection" && <>
    <section className="journal-pilot sheet-panel">
      {pilot && !pilot.verified && <label className="journal-name"><span>Your name</span>
        <input value={pilot.name} maxLength={24} placeholder="Guest" onChange={e => pilot.onName(e.target.value)} /></label>}
      {profile ? <>
        <div className="journal-chips">
          <span className="chip"><IconSparkles size={15} /> Level {profile.level}</span>
          <span className="chip"><IconDiamond size={15} /> {profile.crystals.toLocaleString()} crystals</span>
          <span className="chip">{discovered} / {profile.catalog.length} discovered</span>
          <span className="journal-xp">{profile.next_level_xp ? `${profile.level_xp} / ${profile.next_level_xp} XP to level ${profile.level + 1}` : "Maximum level reached"}</span>
        </div>
        <div className="meter" role="progressbar" aria-label="Experience" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(xp * 100)}><span style={{ width: `${Math.round(xp * 100)}%` }} /></div>
        <small className="journal-saved">{profile.xp.toLocaleString()} lifetime XP · {pending ? `${pending} rewards waiting to save` : "Saved to your profile"}</small>
      </> : <div className="journal-loading"><p role="status">{error ?? "Opening your journal…"}</p>
        <button onClick={() => void profileClient.refresh().catch(() => {})} disabled={loading}>Try again</button></div>}
    </section>
    {profile && <>
      <div className="journal-toolbar">
        <div className="segmented" role="tablist" aria-label="Collection">{tabs.map(t => <button key={t} role="tab" aria-selected={t === tab} onClick={() => setTab(t)}>{t}</button>)}</div>
        {tab === "Cosmetics" && <div className="segmented journal-subtabs" role="tablist" aria-label="Cosmetics by kind">
          {cosmeticKinds.map(([id, label]) => <button key={id} role="tab" aria-selected={id === cosmetic} onClick={() => setCosmetic(id)}>{label}</button>)}</div>}
        <label className="journal-filter"><input type="checkbox" checked={ownedOnly} onChange={e => setOwnedOnly(e.target.checked)} /> Collected only</label>
      </div>
      <div className="journal-body">
        {/* The pilot as they fly now: everything equipped, the companion at their shoulder */}
        <aside className="journal-figure sheet-panel">
          <Minifigure appearance={profile.equipped} style={loadSettings().pilotStyle ?? 1} label={`${profile.name} in their equipped outfit`} />
          <p className="figure-caption">{profile.equipped.pet !== "none" && profile.pet_names[profile.equipped.pet] ? `with ${profile.pet_names[profile.equipped.pet]}` : "Your pilot"}</p>
          {charm && <p className="figure-charm" style={rarityStyle(charm)}>{collectibleIcon("item", profile.equipped.charm)} Charm: {charm.name}</p>}
        </aside>
        <div className="journal-grid" role="tabpanel" aria-label={`${tab} collection`}>
          {entries.map(entry => {
            const s = status(entry, profile);
            return <button key={entry.key} className={`journal-card rarity-${entry.rarity} ${s.owned ? "owned" : "locked"}`} aria-pressed={entry.key === selected} style={rarityStyle(entry)}
              onClick={() => pick(entry)}>
              <span className="journal-icon" aria-hidden="true">{collectibleIcon(entry.kind, entry.asset)}</span>
              {powerOf(entry.key) && <span className="journal-power" title="Has a power">✦</span>}
              <b>{entry.kind === "pet" && profile.pet_names[entry.asset] ? profile.pet_names[entry.asset] : entry.name}</b>
              <small><i className="journal-rarity" /> {entry.kind === "item" ? "keepsake" : entry.kind} · {entry.rarity}</small>
              <span className="journal-state">{s.owned ? s.text : <><IconLock size={12} /> {s.text}</>}</span>
              {!s.owned && <IconLock className="journal-lock" size={54} stroke={1.6} aria-hidden="true" />}
            </button>;
          })}
          {!entries.length && <p className="journal-empty">No discoveries here yet. Follow the crystals and look beside the hoops.</p>}
        </div>
        {item && state && <aside className={`journal-detail sheet-panel rarity-${item.rarity}`} style={rarityStyle(item)}>
          <div className="journal-preview"><CollectionPreview item={item} appearance={profile.equipped} rear={rear} />
            {item.kind !== "item" && item.kind !== "pet" && <button className="journal-turn" onClick={() => setRear(!rear)} aria-label={rear ? "View front" : "View back"} title={rear ? "View front" : "View back"}><IconRotate size={18} /></button>}</div>
          <h3>{item.name}</h3>
          <div className="journal-chips"><span className="chip"><i className="journal-rarity" /> {RARITY_STYLE[item.rarity].name}</span><span className="chip">{item.kind === "item" ? "keepsake" : item.kind}</span></div>
          {lore(item) && <p className="journal-lore">{lore(item)}</p>}
          {power && <div className="journal-power-card">
            <b>✦ {power.name}</b>
            <p>{power.description}</p>
            <small>{item.kind === "item"
              ? power.charm?.kind === "passive" ? "Works all adventure while carried as your charm." : `Carry it as your charm and press ${charmKey} on an adventure.`
              : "Works on adventures while equipped."}</small>
          </div>}
          <p className="journal-detail-state">{state.locked ? <><IconLock size={13} /> {state.text}: it won't turn up before then.</> : state.owned ? state.text : "Find it on an adventure, at the market or on the wheel."}</p>
          {item.slot && <button className="primary" disabled={!state.owned || equipped || saving} onClick={() => void equip()}>
            {saving ? "Saving…" : equipped ? state.text : !state.owned ? "Not yet yours" : item.slot === "charm" ? "Carry as charm" : "Equip"}</button>}
          {equipped && (item.slot === "pet" || item.slot === "charm") && <button disabled={saving} onClick={() => void act(() => profileClient.equip(item.slot!, "none"), item.slot === "pet" ? "Companion resting at home." : "Charm put away.")}>
            {item.slot === "pet" ? "Leave at home" : "Put the charm away"}</button>}
          {item.kind === "pet" && state.owned && <form className="pet-name" onSubmit={rename}>
            <label htmlFor="pet-name">Name your companion</label>
            <div><input id="pet-name" value={petName} maxLength={20} placeholder={item.name} onChange={e => setPetName(e.target.value)} />
              <button type="submit" disabled={saving}>Save</button></div>
          </form>}
        </aside>}
      </div>
      <footer className="journal-foot"><p>Crystals and gates grant XP. Each rarity is three times rarer than the last, and sits farther from the hoops. Duplicates become crystals.</p>
        <p role="status">{message || error || (loading ? "Refreshing…" : "")}</p>
        {error && <button onClick={() => void profileClient.refresh().catch(() => {})}>Retry saving / refresh</button>}</footer>
    </>}
    </>}
  </dialog>;
}

/** Read-only while flying; opening the inventory is reserved for the menu or pause. */
export function ProfileStatus({ paused = false }: { paused?: boolean }) {
  const { profile, notice, pending, error } = useSyncExternalStore(profileClient.store.subscribe, profileClient.store.get);
  const [open, setOpen] = useState(false);
  const [dismissedNotice, setDismissedNotice] = useState(() => notice && notice.expiresAt <= Date.now() ? notice.id : 0);
  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setDismissedNotice(notice.id), Math.max(0, notice.expiresAt - Date.now()));
    return () => clearTimeout(timer);
  }, [notice]);
  return <>
    <div className={`profile-flight glass ${paused ? "paused" : ""}`}>
      {profile ? <><b>Lv. {profile.level}</b><span><IconDiamond size={15} /> {profile.crystals.toLocaleString()}</span><progress aria-label="Level experience" max={profile.next_level_xp || 1} value={profile.next_level_xp ? profile.level_xp : 1} /></> : <span>Loading profile…</span>}
      {pending > 0 && <small>{pending} saving…</small>}
      {error && <small role="status">{error}</small>}
      {paused && <button onClick={() => setOpen(true)}>Inventory</button>}
    </div>
    {notice && notice.id !== dismissedNotice && <div key={notice.id}
      className={`collection-notice glass ${notice.levelUp ? "level-up" : ""} ${notice.duplicate ? "duplicate" : ""} ${notice.rarity ? `rarity-${notice.rarity}` : ""}`}
      style={notice.rarity ? rarityStyle({ rarity: notice.rarity }) : undefined} role="status">{notice.text}</div>}
    {open && <ProfilePanel onClose={() => setOpen(false)} />}
  </>;
}
