import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { IconDiamond, IconLock, IconSparkles, IconX } from "@tabler/icons-react";
import { profileClient } from "../profile/client";
import { RARITY_COLOR } from "../game/run/collection";
import CollectionPreview from "./CollectionPreview";
import "./ProfilePanel.css";

const tabs = ["All", "Cosmetics", "Pets", "Items"] as const;
export default function ProfilePanel({ onClose }: { onClose: () => void }) {
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
  return <dialog ref={dialog} className="profile-dialog glass" aria-labelledby="profile-title" onCancel={e => { e.preventDefault(); onClose(); }}>
    <header className="profile-header"><div><small>Adventure journal</small><h2 id="profile-title">{profile?.name ?? "Your profile"}</h2></div>
      <button autoFocus onClick={onClose} aria-label="Close inventory"><IconX size={20} /></button></header>
    {profile && <>
      <div className="profile-stats"><strong><IconSparkles size={22} /> Level {profile.level}</strong>
        <strong><IconDiamond size={22} /> {profile.crystals.toLocaleString()} crystals</strong></div>
      <div className="profile-xp"><label htmlFor="profile-xp">{profile.next_level_xp ? `${profile.level_xp} / ${profile.next_level_xp} XP to level ${profile.level + 1}` : "Maximum level reached"}</label>
        <progress id="profile-xp" value={profile.next_level_xp ? profile.level_xp : 1} max={profile.next_level_xp || 1} />
        <small>{profile.xp.toLocaleString()} lifetime XP · {pending ? `${pending} rewards waiting to save` : "Saved to your profile"}</small></div>
      <div className="profile-toolbar"><div role="tablist" aria-label="Inventory categories">{tabs.map(t => <button key={t} role="tab" aria-selected={t === tab} onClick={() => setTab(t)}>{t}</button>)}</div>
        <label><input type="checkbox" checked={ownedOnly} onChange={e => setOwnedOnly(e.target.checked)} /> Collected only</label></div>
      {tab === "Pets" && <button disabled={saving || profile.equipped.pet === "none"} onClick={() => {
        setSaving(true); void profileClient.equip("pet", "none").then(() => setMessage("Companion unequipped."))
          .catch(error => setMessage((error as Error).message)).finally(() => setSaving(false));
      }}>Unequip companion</button>}
      <div className="profile-body"><div className="inventory-grid" role="tabpanel" aria-label={`${tab} collection`}>
        {entries.map(entry => {
          const quantity = profile.inventory[entry.key] ?? 0;
          return <button key={entry.key} className={`inventory-entry ${quantity ? "owned" : "locked"}`} aria-pressed={entry.key === selected}
            onClick={() => { setSelected(entry.key); setRear(entry.kind === "cape" || entry.kind === "wings"); setMessage(""); }} style={{ borderColor: RARITY_COLOR[entry.rarity] }}>
            <span className="inventory-symbol" aria-hidden="true">{entry.kind === "pet" ? "✦" : entry.kind === "item" ? "◇" : "❧"}</span>
            <b>{entry.name}</b><small>{entry.kind} · {entry.rarity}</small>
            <span>{quantity ? entry.kind === "item" ? `×${quantity}` : entry.slot && profile.equipped[entry.slot] === entry.asset ? "Equipped" : "Collected" : <><IconLock size={12} /> Undiscovered</>}</span>
          </button>;
        })}
        {!entries.length && <p className="inventory-empty">No discoveries here yet. Follow the crystals and look beside the hoops.</p>}
      </div>
      {item && <aside className="inventory-detail"><CollectionPreview item={item} appearance={profile.equipped} rear={rear} />
        <button onClick={() => setRear(!rear)}>{rear ? "View front" : "View back"}</button>
        <h3>{item.name}</h3><p>{item.rarity} · {item.kind}</p>
        <p>{count ? item.kind === "item" ? `${count} keepsakes collected` : "In your collection" : "Find this on an adventure"}</p>
        {item.slot && <button className="primary" disabled={!count || equipped || saving} onClick={() => void equip()}>{saving ? "Saving…" : equipped ? "Equipped" : count ? "Equip" : "Undiscovered"}</button>}
        <small>{item.kind === "item" ? "Kept in your journal. Adventure abilities are chosen at portals." : "A new look for your next flight."}</small>
      </aside>}
      </div>
      <footer><p>Crystals grant XP. Rarer discoveries sit farther from hoops. Duplicate cosmetics and pets become crystals.</p>
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
    {notice && notice.id !== dismissedNotice && <div key={notice.id} className={`collection-notice glass ${notice.levelUp ? "level-up" : ""}`} role="status">{notice.text}</div>}
    {open && <ProfilePanel onClose={() => setOpen(false)} />}
  </>;
}
