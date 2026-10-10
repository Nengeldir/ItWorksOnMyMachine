import { type CSSProperties, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { IconBook2, IconDiamond, IconLock, IconRotate, IconSparkles, IconX } from "@tabler/icons-react";
import { profileClient } from "../profile/client";
import { RARITY_COLOR } from "../game/run/collection";
import CollectionPreview from "./CollectionPreview";
import { KIND_ICON } from "./kindIcons";
import "./ProfilePanel.css";

const tabs = ["All", "Cosmetics", "Pets", "Items"] as const;

/** The pilot the journal belongs to, from the landing page: their name, which a guest can change here */
export interface JournalPilot {
  name: string;
  verified: boolean;
  onName: (name: string) => void;
}

/**
 * The adventure journal: who you are (name, level, crystals, experience), then everything you can
 * collect, by kind, with a turning preview of the one picked. A sheet like the settings (index.css).
 */
export default function ProfilePanel({ onClose, pilot }: { onClose: () => void; pilot?: JournalPilot }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const { profile, error, pending, loading } = useSyncExternalStore(profileClient.store.subscribe, profileClient.store.get);
  const [tab, setTab] = useState<typeof tabs[number]>("All");
  const [ownedOnly, setOwnedOnly] = useState(false);
  const [selected, setSelected] = useState("cape:classic");
  const [message, setMessage] = useState("");
  const [saving, setSaving] = useState(false);
  const [rear, setRear] = useState(true);
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
    (tab === "All" || (tab === "Cosmetics" ? ["cape", "hat", "shoes", "wings"].includes(item.kind) : item.kind === (tab === "Pets" ? "pet" : "item"))) &&
    (!ownedOnly || profile.inventory[item.key])) ?? [];
  const item = profile?.catalog.find(e => e.key === selected);
  const count = item && profile ? profile.inventory[item.key] ?? 0 : 0;
  const equipped = item?.slot && profile?.equipped[item.slot] === item.asset;
  const equip = async () => {
    if (!item?.slot) return;
    setSaving(true); setMessage("");
    try { await profileClient.equip(item.slot, item.asset); setMessage(`${item.name} equipped.`); }
    catch (error) { setMessage((error as Error).message); }
    finally { setSaving(false); }
  };
  const title = pilot ? pilot.name || "Guest" : profile?.name ?? "Your journal";
  const xp = profile ? (profile.next_level_xp ? profile.level_xp / profile.next_level_xp : 1) : 0;
  const rarity = (r: keyof typeof RARITY_COLOR) => ({ "--rarity": RARITY_COLOR[r] }) as CSSProperties;
  return <dialog ref={dialog} className="profile-dialog sheet" aria-labelledby="profile-title" onCancel={e => { e.preventDefault(); onClose(); }}>
    <header className="sheet-head">
      <span className="overlay-badge"><IconBook2 size={22} /></span>
      <div><small>Adventure journal</small><h2 id="profile-title">{title}</h2></div>
      <button className="sheet-close" autoFocus onClick={onClose} aria-label="Close the journal"><IconX size={20} /></button>
    </header>
    <section className="journal-pilot sheet-panel">
      {pilot && !pilot.verified && <label className="journal-name"><span>Your name</span>
        <input value={pilot.name} maxLength={24} placeholder="Guest" onChange={e => pilot.onName(e.target.value)} /></label>}
      {profile ? <>
        <div className="journal-chips">
          <span className="chip"><IconSparkles size={15} /> Level {profile.level}</span>
          <span className="chip"><IconDiamond size={15} /> {profile.crystals.toLocaleString()} crystals</span>
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
        <label className="journal-filter"><input type="checkbox" checked={ownedOnly} onChange={e => setOwnedOnly(e.target.checked)} /> Collected only</label>
        {tab === "Pets" && <button className="journal-unequip" disabled={saving || profile.equipped.pet === "none"} onClick={() => {
          setSaving(true); void profileClient.equip("pet", "none").then(() => setMessage("Companion unequipped."))
            .catch(error => setMessage((error as Error).message)).finally(() => setSaving(false));
        }}>Unequip companion</button>}
      </div>
      <div className="journal-body">
        <div className="journal-grid" role="tabpanel" aria-label={`${tab} collection`}>
          {entries.map(entry => {
            const quantity = profile.inventory[entry.key] ?? 0;
            return <button key={entry.key} className={`journal-card ${quantity ? "owned" : "locked"}`} aria-pressed={entry.key === selected} style={rarity(entry.rarity)}
              onClick={() => { setSelected(entry.key); setRear(entry.kind === "cape" || entry.kind === "wings"); setMessage(""); }}>
              <span className="journal-icon" aria-hidden="true">{KIND_ICON[entry.kind]}</span>
              <b>{entry.name}</b>
              <small><i className="journal-rarity" /> {entry.kind} · {entry.rarity}</small>
              <span className="journal-state">{quantity ? entry.kind === "item" ? `×${quantity}` : entry.slot && profile.equipped[entry.slot] === entry.asset ? "Equipped" : "Collected" : <><IconLock size={12} /> Undiscovered</>}</span>
            </button>;
          })}
          {!entries.length && <p className="journal-empty">No discoveries here yet. Follow the crystals and look beside the hoops.</p>}
        </div>
        {item && <aside className="journal-detail sheet-panel">
          <div className="journal-preview"><CollectionPreview item={item} appearance={profile.equipped} rear={rear} />
            <button className="journal-turn" onClick={() => setRear(!rear)} aria-label={rear ? "View front" : "View back"} title={rear ? "View front" : "View back"}><IconRotate size={18} /></button></div>
          <h3>{item.name}</h3>
          <div className="journal-chips"><span className="chip" style={rarity(item.rarity)}><i className="journal-rarity" /> {item.rarity}</span><span className="chip">{item.kind}</span></div>
          <p>{count ? item.kind === "item" ? `${count} keepsakes collected` : "In your collection" : "Find this on an adventure"}</p>
          {item.slot && <button className="primary" disabled={!count || equipped || saving} onClick={() => void equip()}>{saving ? "Saving…" : equipped ? "Equipped" : count ? "Equip" : "Undiscovered"}</button>}
          <small>{item.kind === "item" ? "Kept in your journal. Adventure abilities are chosen at portals." : "A new look for your next flight."}</small>
        </aside>}
      </div>
      <footer className="journal-foot"><p>Crystals grant XP. Rarer discoveries sit farther from hoops. Duplicate cosmetics and pets become crystals.</p>
        <p role="status">{message || error || (loading ? "Refreshing…" : "")}</p>
        {error && <button onClick={() => void profileClient.refresh().catch(() => {})}>Retry saving / refresh</button>}</footer>
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
    {notice && notice.id !== dismissedNotice && <div key={notice.id} className={`collection-notice glass ${notice.levelUp ? "level-up" : ""}`} role="status">{notice.text}</div>}
    {open && <ProfilePanel onClose={() => setOpen(false)} />}
  </>;
}
