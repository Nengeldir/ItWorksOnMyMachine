import { RUN_ITEMS } from "../run/items";

// A small symbol for each collectible, for the inventory's tiles, the market
// and the wheel's prizes (the 3D model shows when one is selected).

const KEEPSAKES: Record<string, string> = {
  firework: "🎆", candyWrapped: "🍬", lollipop: "🍭", starCandy: "⭐", goldenFeather: "🪶", aviatorCap: "🥽",
  wingedHelm: "⛑️", apple: "🍎", peach: "🍑", grapes: "🍇", cherries: "🍒", starfruit: "🌟",
};
const PETS: Record<string, string> = {
  swallow: "🐦", owl: "🦉", crane: "🦢", phoenix: "🔥", dragon: "🐉", kirin: "🦄", fox: "🦊", griffin: "🦅", manta: "🐋", rabbit: "🐇", jelly: "🏮", koi: "🐟",
};
const KINDS: Record<string, string> = { cape: "🧣", hat: "👒", shoes: "👢", wings: "🪽", jar: "🫙", crystal: "💎" };

export function collectibleIcon(kind: string, asset: string): string {
  if (kind === "item") return KEEPSAKES[asset] ?? RUN_ITEMS.find((item) => item.id === asset || item.model === asset)?.icon ?? "◇";
  if (kind === "pet") return PETS[asset] ?? "✦";
  return KINDS[kind] ?? "❧";
}
