import { type FormEvent, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { IconDiamond, IconLock, IconSparkles, IconX } from "@tabler/icons-react";
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
import Minifigure from "./Minifigure";
import { rarityStyle } from "./rarity";
import "./ProfilePanel.css";

const tabs = ["All", "Cosmetics", "Pets", "Keepsakes"] as const;

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

export default function ProfilePanel({ onClose }: { onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const { profile, error, pending, loading } = useSyncExternalStore(profileClient.store.subscribe, profileClient.store.get);
  const [tab, setTab] = useState<typeof tabs[number]>("All");
  const [ownedOnly, setOwnedOnly] = useState(false);
  const [selected, setSelected] = useState("cape:classic");
  const [message, setMessage] = useState("");
  const [saving, setSaving] = useState(false);
  const [rear, setRear] = useState(true);
  const [petName, setPetName] = useState("");
  useEffect(() => {
    const el = dialog.current!; el.showModal();
    const stop = (e: KeyboardEvent) => { e.stopPropagation(); };
    window.addEventListener("keydown", stop, true); window.addEventListener("keyup", stop, true);
    void profileClient.initialize();
    return () => { window.removeEventListener("keydown", stop, true); window.removeEventListener("keyup", stop, true); el.close(); };
  }, []);
  const entries = profile?.catalog.filter(item =>
    (tab === "All" || (tab === "Cosmetics" ? ["cape", "hat", "shoes", "wings"].includes(item.kind) : item.kind === (tab === "Pets" ? "pet" : "item"))) &&
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

  return <dialog ref={dialog} className="profile-dialog glass" aria-labelledby="profile-title" onCancel={e => { e.preventDefault(); onClose(); }}>
    <header className="profile-header"><div><small>Adventure journal</small><h2 id="profile-title">{profile?.name ?? "Your profile"}</h2></div>
      <button autoFocus onClick={onClose} aria-label="Close inventory"><IconX size={20} /></button></header>
    {profile && <>
      <div className="profile-stats"><strong><IconSparkles size={22} /> Level {profile.level}</strong>
        <strong><IconDiamond size={22} /> {profile.crystals.toLocaleString()} crystals</strong>
        <span>{discovered} / {profile.catalog.length} discovered</span></div>
      <div className="profile-xp"><label htmlFor="profile-xp">{profile.next_level_xp ? `${profile.level_xp} / ${profile.next_level_xp} XP to level ${profile.level + 1}` : "Maximum level reached"}</label>
        <progress id="profile-xp" value={profile.next_level_xp ? profile.level_xp : 1} max={profile.next_level_xp || 1} />
        <small>{profile.xp.toLocaleString()} lifetime XP · {pending ? `${pending} rewards waiting to save` : "Saved to your profile"}</small></div>
      <div className="profile-body">
        {/* The pilot as they fly now: everything equipped, the companion at their shoulder */}
        <aside className="profile-figure">
          <Minifigure appearance={profile.equipped} style={loadSettings().pilotStyle ?? 1} label={`${profile.name} in their equipped outfit`} />
          <p className="figure-caption">{profile.equipped.pet !== "none" && profile.pet_names[profile.equipped.pet] ? `with ${profile.pet_names[profile.equipped.pet]}` : "Your pilot"}</p>
          {profile.equipped.charm !== "none" && <p className="figure-charm" style={rarityStyle(profile.catalog.find(e => e.key === `item:${profile.equipped.charm}`) ?? { rarity: "common" })}>
            {collectibleIcon("item", profile.equipped.charm)} Charm: {profile.catalog.find(e => e.key === `item:${profile.equipped.charm}`)?.name}
          </p>}
        </aside>
        <div className="profile-collection">
          <div className="profile-toolbar"><div role="tablist" aria-label="Inventory categories">{tabs.map(t => <button key={t} role="tab" aria-selected={t === tab} onClick={() => setTab(t)}>{t}</button>)}</div>
            <label><input type="checkbox" checked={ownedOnly} onChange={e => setOwnedOnly(e.target.checked)} /> Collected only</label></div>
          <div className="inventory-grid" role="tabpanel" aria-label={`${tab} collection`}>
            {entries.map(entry => {
              const s = status(entry, profile);
              return <button key={entry.key} className={`inventory-entry rarity-${entry.rarity} ${s.owned ? "owned" : "locked"}`} aria-pressed={entry.key === selected}
                onClick={() => pick(entry)} style={rarityStyle(entry)}>
                <span className="inventory-symbol" aria-hidden="true">{collectibleIcon(entry.kind, entry.asset)}</span>
                {powerOf(entry.key) && <span className="inventory-power" title="Has a power">✦</span>}
                <b>{entry.kind === "pet" && profile.pet_names[entry.asset] ? profile.pet_names[entry.asset] : entry.name}</b>
                <small>{entry.kind === "item" ? "keepsake" : entry.kind} · <span className="rarity-name">{entry.rarity}</span></small>
                <span className="inventory-state">{s.owned ? s.text : <><IconLock size={12} /> {s.text}</>}</span>
              </button>;
            })}
            {!entries.length && <p className="inventory-empty">No discoveries here yet. Follow the crystals and look beside the hoops.</p>}
          </div>
        </div>
        {item && state && <aside className={`inventory-detail rarity-${item.rarity}`} style={rarityStyle(item)}>
          <CollectionPreview item={item} appearance={profile.equipped} rear={rear} />
          {item.kind !== "item" && item.kind !== "pet" && <button className="small" onClick={() => setRear(!rear)}>{rear ? "View front" : "View back"}</button>}
          <h3>{item.name}</h3>
          <p className="rarity-badge">{RARITY_STYLE[item.rarity].name} {item.kind === "item" ? "keepsake" : item.kind}</p>
          {lore(item) && <p className="lore">{lore(item)}</p>}
          {power && <div className="power">
            <b>✦ {power.name}</b>
            <p>{power.description}</p>
            <small>{item.kind === "item"
              ? power.charm?.kind === "passive" ? "Works all adventure while carried as your charm." : `Carry it as your charm and press ${charmKey} on an adventure.`
              : "Works on adventures while equipped."}</small>
          </div>}
          <p className="detail-state">{state.locked ? <><IconLock size={13} /> {state.text}: it won't turn up before then.</> : state.owned ? state.text : "Find it on an adventure, at the market or on the wheel."}</p>
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
      <footer><p>Crystals and gates grant XP. Each rarity is three times rarer than the last, and sits farther from the hoops. Duplicates become crystals.</p>
        <p role="status">{message || error || (loading ? "Refreshing…" : "")}</p>
        {error && <button onClick={() => void profileClient.refresh().catch(() => {})}>Retry saving / refresh</button>}</footer>
    </>}
    {!profile && <div className="profile-empty"><p role="status">{error ?? "Opening your journal…"}</p><button onClick={() => void profileClient.refresh().catch(() => {})} disabled={loading}>Try again</button></div>}
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
