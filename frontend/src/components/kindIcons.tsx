import type { ReactNode } from "react";
import { IconDiamond, IconFeather, IconHanger, IconHelmet, IconPaw, IconShoe, IconSparkles } from "@tabler/icons-react";

/** Each kind of discovery's icon on its card in the journal (the UI's icons: the fonts lack ❧ ✦ ◇) */
export const KIND_ICON: Record<string, ReactNode> = {
  cape: <IconHanger size={20} />,
  hat: <IconHelmet size={20} />,
  shoes: <IconShoe size={20} />,
  wings: <IconFeather size={20} />,
  pet: <IconPaw size={20} />,
  item: <IconSparkles size={20} />,
  crystal: <IconDiamond size={20} />,
};
