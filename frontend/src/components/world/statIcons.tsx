import type { ReactNode } from "react";
import {
  IconBolt, IconBook, IconClover, IconDiamond, IconEye, IconFish, IconHourglass, IconShield, IconSun, IconSword,
  IconTarget, IconTree, IconWheat, IconWind,
} from "@tabler/icons-react";
import type { StatId } from "../../catalog";

/** Each stat's icon (as kindIcons.tsx for discoveries) */
export const STAT_ICON: Record<StatId, ReactNode> = {
  light: <IconSun size={18} />,
  ward: <IconShield size={18} />,
  might: <IconSword size={18} />,
  crit: <IconTarget size={18} />,
  critPower: <IconBolt size={18} />,
  haste: <IconHourglass size={18} />,
  focus: <IconEye size={18} />,
  swiftness: <IconWind size={18} />,
  harvestFortune: <IconWheat size={18} />,
  timberFortune: <IconTree size={18} />,
  oreFortune: <IconDiamond size={18} />,
  angling: <IconFish size={18} />,
  luck: <IconClover size={18} />,
  wisdom: <IconBook size={18} />,
};
