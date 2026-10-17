import { IconHanger, IconRotate, IconX } from "@tabler/icons-react";
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { SANDBOX_COLLECTION } from "../game/cosmetics/sandbox";
import { profileClient } from "../profile/client";
import type { ItemId } from "../game/items/models";
import type { Appearance } from "../game/cosmetics/storage";
import { RUN_ITEMS, type RunItemId } from "../game/run/items";
import { UPGRADES, type UpgradeId, upgradeRarity } from "../game/run/upgrades";
import { rarityAt, type Rarity } from "../game/collection/rarity";
import CollectionPreview from "./CollectionPreview";
import { KIND_ICON } from "./kindIcons";
import { powerOf } from "../game/collection/abilities";
import { rarityStyle } from "./rarity";
import "./ProfilePanel.css";

/** What the fitting room needs from the test session (RunSession in test mode) */
export interface FittingRoom {
  previewLook: Appearance | null;
  previewAppearance(look: Appearance | null): void;
  previewItem(id: ItemId): void;
  previewCharm(id: string | null): void;
  previewUseItem(): void;
  previewThrust(on: boolean): void;
  clearPreviewItems(): void;
  giveItem(id: RunItemId): void;
  giveUpgrade(id: UpgradeId): void;
}

const kinds = [["wings", "Wings"], ["cape", "Capes"], ["hat", "Hats"], ["shoes", "Shoes"], ["pet", "Pets"], ["jar", "Jars"], ["item", "Keepsakes"], ["runItems", "Get items"], ["abilities", "Get abilities"]] as const;
type Kind = (typeof kinds)[number][0];

/**
 * A local fitting room in ?test, and the sandbox's shop: try every cosmetic, pet and keepsake, and hand
 * yourself any adventure item or ability. Every box carries its rarity's color as a border. No profile
 * API writes, even for locked discoveries
 */
export default function TestCollectionPanel({ session, onClose, start = "wings" }: { session: FittingRoom; onClose: () => void; start?: Kind }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [kind, setKind] = useState<Kind>(start);
  const [selected, setSelected] = useState(() => SANDBOX_COLLECTION.find((entry) => entry.kind === (start === "runItems" || start === "abilities" ? "wings" : start))!.key);
  const [look, setLook] = useState(() => session.previewLook ?? profileClient.appearance());
  const [rear, setRear] = useState(true);
  const [flame, setFlame] = useState(false);
  const [given, setGiven] = useState("");
  const { profile } = useSyncExternalStore(profileClient.store.subscribe, profileClient.store.get);
  // The sandbox lists everything as common: the real rarities come from the profile's catalog when it's there
  const rarityOf = useMemo(() => new Map(profile?.catalog.map((entry) => [entry.key, entry.rarity]) ?? []), [profile]);
  const item = SANDBOX_COLLECTION.find(entry => entry.key === selected)!;
  const itemRarity = (key: string): Rarity => rarityOf.get(key) ?? "common";
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
  const shop = kind === "runItems" || kind === "abilities";
  return <dialog ref={dialog} className="profile-dialog sheet test-collection" aria-labelledby="test-collection-title" onCancel={event => { event.preventDefault(); onClose(); }}>
    <header className="sheet-head">
      <span className="overlay-badge"><IconHanger size={22} /></span>
      <div><small>Test mode · nothing saved</small><h2 id="test-collection-title">{shop ? "Items & abilities" : "Fitting room"}</h2></div>
      <button className="sheet-close" autoFocus onClick={onClose} aria-label="Back to flight"><IconX size={20} /></button>
    </header>
    <p className="journal-intro">{shop
      ? "Hand yourself any adventure item (it goes in the bag; the oldest leaves a full one) or any ability, right now."
      : "Try every item, pet and cosmetic. Your profile and earned collection stay as they are. Pets lead along the hoop route once you resume."}</p>
    <div className="journal-toolbar"><div className="segmented test-kinds" role="tablist" aria-label="Kind">{kinds.map(([id, label]) => <button key={id} role="tab" aria-selected={kind === id} onClick={() => {
      setKind(id); setGiven("");
      if (id !== "runItems" && id !== "abilities") setSelected(SANDBOX_COLLECTION.find(entry => entry.kind === id)!.key);
    }}>{label}</button>)}</div></div>

    {shop ? <div className="journal-grid test-shop" aria-label={kind === "runItems" ? "Adventure items" : "Abilities"}>
      {kind === "runItems" && RUN_ITEMS.map(run => {
        const rarity = rarityAt(run.rarity);
        return <button key={run.id} className={`journal-card owned rarity-${rarity}`} style={rarityStyle({ rarity })} onClick={() => { session.giveItem(run.id); setGiven(`${run.name} is in your bag.`); }}>
          <span className="journal-icon" aria-hidden="true">{run.icon}</span><b>{run.name}</b>
          <small><i className="journal-rarity" /> {rarity}{run.auto ? " · works by itself" : ""}</small>
          <span className="test-shop-text">{run.description}</span>
        </button>;
      })}
      {kind === "abilities" && UPGRADES.map(upgrade => {
        const rarity = rarityAt(upgradeRarity(upgrade));
        return <button key={upgrade.id} className={`journal-card owned rarity-${rarity}`} style={rarityStyle({ rarity })} onClick={() => { session.giveUpgrade(upgrade.id); setGiven(`${upgrade.name} is yours.`); }}>
          <span className="journal-icon" aria-hidden="true">{upgrade.icon}</span><b>{upgrade.name}</b>
          <small><i className="journal-rarity" /> {upgrade.kind === "ability" ? `ability · ${upgrade.key}` : "passive"}</small>
          <span className="test-shop-text">{upgrade.description}</span>
        </button>;
      })}
    </div> : <div className="journal-body"><div className="journal-grid" aria-label="All test models">{SANDBOX_COLLECTION.filter(entry => entry.kind === kind).map(entry => {
      const rarity = itemRarity(entry.key);
      return <button className={`journal-card owned rarity-${rarity}`} style={rarityStyle({ rarity })} key={entry.key} aria-pressed={selected === entry.key} onClick={() => setSelected(entry.key)}>
        <span className="journal-icon" aria-hidden="true">{KIND_ICON[entry.kind]}</span><b>{entry.name}</b>
        <small><i className="journal-rarity" /> {rarity}</small>
        {powerOf(entry.key) && <span className="journal-power" title="Has a power">✦</span>}</button>;
    })}</div><aside className={`journal-detail sheet-panel rarity-${itemRarity(item.key)}`} style={rarityStyle({ rarity: itemRarity(item.key) })}>
      <div className="journal-preview"><CollectionPreview item={item} appearance={look} rear={rear} />
        <button className="journal-turn" onClick={() => setRear(!rear)} aria-label={rear ? "View front" : "View back"} title={rear ? "View front" : "View back"}><IconRotate size={18} /></button></div>
      <h3>{item.name}</h3>
      <button className="primary" onClick={trySelected}>{item.kind === "item" ? "Carry item" : "Try in flight"}</button>
      {item.kind === "item" && powerOf(item.key)?.charm && <button onClick={() => session.previewCharm(item.asset)}>Carry as charm ({powerOf(item.key)!.name})</button>}
      {item.kind === "item" && <><button onClick={() => session.previewUseItem()}>Use held item</button>
        {item.asset === "firework" && <button onClick={() => { session.previewThrust(!flame); setFlame(!flame); }}>{flame ? "Extinguish" : "Light firework"}</button>}</>}
      <small>Resume to watch the equipped model animate.</small></aside></div>}

    <footer className="journal-toolbar">
      {shop ? <p className="journal-saved" role="status">{given || "Tap a box to take it."}</p> : <>
        <button onClick={() => { const next = { ...look, pet: "none" as const }; setLook(next); session.previewAppearance(next); }}>Unequip pet</button>
        <button onClick={() => { const next = { ...look, jar: "none" as const }; setLook(next); session.previewAppearance(next); }}>Put the jar away</button>
        <button onClick={() => { session.clearPreviewItems(); setFlame(false); }}>Put items away</button>
        <button onClick={() => { session.previewAppearance(null); session.previewCharm(null); setLook(profileClient.appearance()); session.clearPreviewItems(); setFlame(false); }}>Restore profile look</button>
      </>}
    </footer>
  </dialog>;
}
