import { IconHanger, IconRotate, IconX } from "@tabler/icons-react";
import { useEffect, useRef, useState } from "react";
import { SANDBOX_COLLECTION } from "../game/cosmetics/sandbox";
import { profileClient } from "../profile/client";
import type { ItemId } from "../game/items/models";
import type { ExploreSession } from "../session/ExploreSession";
import CollectionPreview from "./CollectionPreview";
import { KIND_ICON } from "./kindIcons";
import { powerOf } from "../game/collection/abilities";
import "./ProfilePanel.css";

/** A local fitting room in ?test. No profile API writes, even for locked discoveries. */
export default function TestCollectionPanel({ session, onClose }: { session: ExploreSession; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [kind, setKind] = useState("wings");
  const [selected, setSelected] = useState("wings:astral");
  const [look, setLook] = useState(() => session.previewLook ?? profileClient.appearance());
  const [rear, setRear] = useState(true);
  const [flame, setFlame] = useState(false);
  const item = SANDBOX_COLLECTION.find(entry => entry.key === selected)!;
  useEffect(() => {
    const el = dialog.current!; el.showModal();
    const stop = (event: KeyboardEvent) => event.stopPropagation();
    window.addEventListener("keydown", stop, true); window.addEventListener("keyup", stop, true);
    return () => { window.removeEventListener("keydown", stop, true); window.removeEventListener("keyup", stop, true); el.close(); };
  }, []);
  const trySelected = () => {
    if (item.slot) { const next = { ...look, [item.slot]: item.asset }; setLook(next); session.previewAppearance(next); }
    else session.previewItem(item.asset as ItemId);
  };
  return <dialog ref={dialog} className="profile-dialog sheet" aria-labelledby="test-collection-title" onCancel={event => { event.preventDefault(); onClose(); }}>
    <header className="sheet-head">
      <span className="overlay-badge"><IconHanger size={22} /></span>
      <div><small>Test mode · nothing saved</small><h2 id="test-collection-title">Fitting room</h2></div>
      <button className="sheet-close" autoFocus onClick={onClose} aria-label="Back to flight"><IconX size={20} /></button>
    </header>
    <p className="journal-intro">Try every item, pet and cosmetic. Your profile and earned collection stay as they are. Pets lead along the hoop route once you resume.</p>
    <div className="journal-toolbar"><div className="segmented" role="tablist" aria-label="Kind">{["wings", "cape", "hat", "shoes", "pet", "item"].map(category => <button key={category} role="tab" aria-selected={kind === category} onClick={() => {
      setKind(category); setSelected(SANDBOX_COLLECTION.find(entry => entry.kind === category)!.key);
    }}>{category === "pet" ? "Pets" : category === "item" ? "Items" : category[0].toUpperCase() + category.slice(1)}</button>)}</div></div>
    <div className="journal-body"><div className="journal-grid" aria-label="All test models">{SANDBOX_COLLECTION.filter(entry => entry.kind === kind).map(entry =>
      <button className="journal-card owned" key={entry.key} aria-pressed={selected === entry.key} onClick={() => setSelected(entry.key)}>
        <span className="journal-icon" aria-hidden="true">{KIND_ICON[entry.kind]}</span><b>{entry.name}</b><small>Available in test mode</small></button>
    )}</div><aside className="journal-detail sheet-panel">
      <div className="journal-preview"><CollectionPreview item={item} appearance={look} rear={rear} />
        <button className="journal-turn" onClick={() => setRear(!rear)} aria-label={rear ? "View front" : "View back"} title={rear ? "View front" : "View back"}><IconRotate size={18} /></button></div>
      <h3>{item.name}</h3>
      <button className="primary" onClick={trySelected}>{item.kind === "item" ? "Carry item" : "Try in flight"}</button>
      {item.kind === "item" && powerOf(item.key)?.charm && <button onClick={() => session.previewCharm(item.asset)}>Carry as charm ({powerOf(item.key)!.name})</button>}
      {item.kind === "item" && <><button onClick={() => session.previewUseItem()}>Use held item</button>
        {item.asset === "firework" && <button onClick={() => { session.previewThrust(!flame); setFlame(!flame); }}>{flame ? "Extinguish" : "Light firework"}</button>}</>}
      <small>Resume to watch the equipped model animate.</small></aside></div>
    <footer className="journal-toolbar"><button onClick={() => { const next = { ...look, pet: "none" as const }; setLook(next); session.previewAppearance(next); }}>Unequip pet</button>
      <button onClick={() => { session.clearPreviewItems(); setFlame(false); }}>Put items away</button>
      <button onClick={() => { session.previewAppearance(null); session.previewCharm(null); setLook(profileClient.appearance()); session.clearPreviewItems(); setFlame(false); }}>Restore profile look</button></footer>
  </dialog>;
}
