import { IconDiamond } from "@tabler/icons-react";
import { STAT_INFO, type Item } from "../../catalog";
import { RARITY_STYLE } from "../../game/collection/rarity";
import { rarityStyle } from "../rarity";
import { formatNumber } from "./format";
import { STAT_ICON } from "./statIcons";
import "./ItemCard.css";

const KIND_NAME: Record<Item["kind"], string> = {
  currency: "Currency", material: "Material", tool: "Tool", weapon: "Weapon", mantle: "Mantle", charm: "Charm", rune: "Rune",
  tea: "Tea", seed: "Seed", furniture: "Furniture", book: "Book", gem: "Gem", stone: "Tempering stone", essence: "Essence",
};

/**
 * An item's card (the tooltip's content, plan F7): its name in its rarity's color, kind and rarity, the
 * stats it gives, its lore in italics, and what an NPC pays for it
 */
export function ItemCard({ item, count }: { item: Item; count?: number }) {
  const stats = item.stats ? STAT_INFO.filter((info) => item.stats![info.id]) : [];
  return (
    <div className="item-card" style={rarityStyle(item)}>
      <b className="item-card-name">{item.name}</b>
      <small className="item-card-kind">
        {RARITY_STYLE[item.rarity].name} {KIND_NAME[item.kind].toLowerCase()}
        {count !== undefined && count > 1 && ` · ${formatNumber(count)}`}
      </small>
      {stats.length > 0 && (
        <ul className="item-card-stats">
          {stats.map((info) => (
            <li key={info.id}>
              <span aria-hidden>{STAT_ICON[info.id]}</span>
              {info.name} <b>+{formatNumber(item.stats![info.id]!)}{info.unit}</b>
            </li>
          ))}
        </ul>
      )}
      {item.fortune !== undefined && <small className="item-card-line">+{item.fortune}% yield</small>}
      <p className="item-card-lore">{item.lore}</p>
      {item.sell > 0 && (
        <small className="item-card-sell">
          Sells for <IconDiamond size={12} /> {formatNumber(item.sell)}
        </small>
      )}
    </div>
  );
}
