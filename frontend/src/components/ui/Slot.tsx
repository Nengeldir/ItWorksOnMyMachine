import { IconLock } from "@tabler/icons-react";
import type { CSSProperties, HTMLAttributes, ReactNode, Ref } from "react";
import { RARITY_STYLE, type Rarity } from "../../game/collection/rarity";
import { formatNumber } from "../world/format";
import { STRINGS } from "./strings";
import "./ui.css";

/** What a slot shows. The icon is whatever the caller draws (F8's atlas cell, until then a sign) */
export interface SlotItem {
  id: string;
  name: string;
  count?: number;
  rarity?: Rarity;
  icon?: ReactNode;
  /** 0..1 of a cooldown still to run (a sweep darkens that much of the slot) */
  cooldown?: number;
  locked?: boolean;
}

interface SlotProps extends Omit<HTMLAttributes<HTMLDivElement>, "children"> {
  item: SlotItem | null;
  /** Lifted off (being dragged or held by the keyboard) */
  lifted?: boolean;
  /** The drop target under a dragged item */
  target?: boolean;
  selected?: boolean;
  ref?: Ref<HTMLDivElement>;
}

/**
 * One slot (plan F7): the item's icon in a soft glass square, its count bottom right, a frame in its
 * rarity's color (common carries none), a cooldown sweep. 44 px at least on touch (ui.css)
 */
export function Slot({ item, lifted, target, selected, className = "", style, ...rest }: SlotProps) {
  const rarity = item?.rarity ? RARITY_STYLE[item.rarity] : null;
  const vars = {
    ...style,
    ...(rarity?.tinted ? { "--slot-rarity": rarity.color, "--slot-rarity-deep": rarity.deep } : {}),
    ...(item?.cooldown ? { "--slot-cool": Math.max(0, Math.min(1, item.cooldown)) } : {}),
  } as CSSProperties;
  const label = item ? STRINGS.slotLabel(item.name, item.count ?? 1) : STRINGS.emptySlot;
  return (
    <div
      className={`ui-slot${item ? "" : " is-empty"}${rarity?.tinted ? " is-rare" : ""}${lifted ? " is-lifted" : ""}${target ? " is-target" : ""}${selected ? " is-selected" : ""} ${className}`}
      style={vars}
      aria-label={item?.cooldown ? `${label}, ${STRINGS.cooldown}` : label}
      {...rest}
    >
      {item && (
        <>
          <span className="ui-slot-icon" aria-hidden="true">{item.icon ?? item.name.slice(0, 1)}</span>
          {(item.count ?? 1) > 1 && <span className="ui-slot-count">{formatNumber(item.count!)}</span>}
          {!!item.cooldown && <span className="ui-slot-cool" aria-hidden="true" />}
          {item.locked && <span className="ui-slot-lock" aria-hidden="true"><IconLock size={14} /></span>}
        </>
      )}
    </div>
  );
}
