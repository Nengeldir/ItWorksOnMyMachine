import { useMemo, useState } from "react";
import { IconSearch } from "@tabler/icons-react";
import { ACTION_LABELS, bindingActions } from "../game/bindings";
import { RARITY_STYLE, rarityAt, type Rarity } from "../game/collection/rarity";
import { powerOf } from "../game/collection/abilities";
import { collectibleIcon } from "../game/collection/icons";
import { CAPES, HATS, SHOES, WINGS, type WingRig } from "../game/cosmetics/catalog";
import { PETS } from "../game/pets/catalog";
import { RUN_ITEMS, itemLevel } from "../game/run/items";
import { UPGRADES, upgradeLevel, upgradeRarity } from "../game/run/upgrades";
import type { Collectible } from "../profile/types";
import { boundKeys } from "./keys";
import { rarityStyle } from "./rarity";

// The journal's field guide: how each mode is played, the controls, and every
// ability, item, cosmetic, pet and keepsake with what it does. Built from the
// game's own data, so it never drifts from what's in the game.

const sections = ["How to play", "Controls", "Abilities", "Items", "Cosmetics", "Pets", "Keepsakes"] as const;
type Section = (typeof sections)[number];

const RIG: Record<WingRig, string> = {
  feather: "Feathered: beats like a bird's, the primaries spreading, twisting and folding",
  sail: "Membrane: one flexible sail that bends and ripples",
  jointed: "Mechanical: stiff plates on servo joints",
  rigid: "One piece: moves as a whole",
};

const key = (action: Parameters<typeof boundKeys>[0]) => boundKeys(action)[0]?.join(" ") ?? "–";

interface Entry {
  id: string;
  icon: string;
  name: string;
  rarity: Rarity;
  tags: string[];
  text: string;
  power?: { name: string; text: string };
}

/** One card in the guide: icon, name, rarity border, tags, what it is and what it does */
const Card = ({ entry }: { entry: Entry }) => (
  <article className={`guide-card rarity-${entry.rarity}`} style={rarityStyle(entry)}>
    <header>
      <span className="guide-icon" aria-hidden="true">{entry.icon}</span>
      <div>
        <b>{entry.name}</b>
        <small>{[RARITY_STYLE[entry.rarity].name, ...entry.tags].join(" · ")}</small>
      </div>
    </header>
    <p>{entry.text}</p>
    {entry.power && <p className="guide-power"><b>✦ {entry.power.name}</b> {entry.power.text}</p>}
  </article>
);

export default function FieldGuide({ catalog }: { catalog: readonly Collectible[] }) {
  const [section, setSection] = useState<Section>("How to play");
  const [query, setQuery] = useState("");
  const rarityOf = useMemo(() => new Map(catalog.map((entry) => [entry.key, entry.rarity])), [catalog]);
  const levelOf = useMemo(() => new Map(catalog.map((entry) => [entry.key, entry.min_level ?? 1])), [catalog]);
  const withPower = (key: string) => {
    const power = powerOf(key);
    return power ? { name: power.name, text: power.description } : undefined;
  };

  const entries = useMemo((): Entry[] => {
    if (section === "Abilities") {
      return UPGRADES.map((u) => ({
        id: u.id, icon: u.icon, name: u.name, rarity: rarityAt(upgradeRarity(u)),
        tags: [u.kind === "ability" ? `ability · ${u.key}` : "passive", `up to ${u.max}×`, `from level ${upgradeLevel(u)}`], text: u.description,
      }));
    }
    if (section === "Items") {
      return RUN_ITEMS.map((item) => ({
        id: item.id, icon: item.icon, name: item.name, rarity: rarityAt(item.rarity),
        tags: [item.auto ? "works by itself" : item.charges > 1 ? `${item.charges} uses` : "one use", `from level ${itemLevel(item)}`], text: item.description,
      }));
    }
    if (section === "Cosmetics") {
      const kinds = [["wings", WINGS], ["cape", CAPES], ["hat", HATS], ["shoes", SHOES]] as const;
      return kinds.flatMap(([kind, list]) => (list as readonly { id: string; name: string; description: string }[])
        .filter((entry) => entry.id !== "none")
        .map((entry) => {
          const catalogKey = `${kind}:${entry.id}`;
          const rig = kind === "wings" ? RIG[WINGS.find((w) => w.id === entry.id)!.rig] : null;
          return {
            id: catalogKey, icon: collectibleIcon(kind, entry.id), name: entry.name, rarity: rarityOf.get(catalogKey) ?? "common",
            tags: [kind === "cape" ? "cape" : kind, `from level ${levelOf.get(catalogKey) ?? 1}`],
            text: rig ? `${entry.description} ${rig}.` : entry.description, power: withPower(catalogKey),
          };
        }));
    }
    if (section === "Pets") {
      return PETS.map((pet) => ({
        id: pet.id, icon: collectibleIcon("pet", pet.id), name: pet.name, rarity: rarityOf.get(`pet:${pet.id}`) ?? "uncommon",
        tags: ["companion", `from level ${levelOf.get(`pet:${pet.id}`) ?? 1}`], text: pet.description, power: withPower(`pet:${pet.id}`),
      }));
    }
    if (section === "Keepsakes") {
      return catalog.filter((entry) => entry.kind === "item").map((entry) => ({
        id: entry.key, icon: collectibleIcon("item", entry.asset), name: entry.name, rarity: entry.rarity,
        tags: ["keepsake", `from level ${entry.min_level ?? 1}`],
        text: RUN_ITEMS.find((run) => run.id === entry.asset || run.model === entry.asset)?.description ?? "A treasure from the islands.",
        power: withPower(entry.key),
      }));
    }
    return [];
  }, [section, catalog, rarityOf, levelOf]);
  const needle = query.trim().toLowerCase();
  const shown = needle ? entries.filter((e) => `${e.name} ${e.text} ${e.tags.join(" ")} ${e.power?.name ?? ""} ${e.power?.text ?? ""}`.toLowerCase().includes(needle)) : entries;

  return (
    <div className="guide">
      <div className="guide-toolbar">
        <div className="segmented guide-sections" role="tablist" aria-label="Field guide">
          {sections.map((s) => <button key={s} role="tab" aria-selected={s === section} onClick={() => setSection(s)}>{s}</button>)}
        </div>
        {entries.length > 0 && (
          <label className="guide-search">
            <IconSearch size={16} />
            <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder={`Search ${section.toLowerCase()}`} aria-label={`Search ${section}`} />
          </label>
        )}
      </div>

      {section === "How to play" && (
        <div className="guide-prose sheet-panel">
          <h3>Wind Rider</h3>
          <p>You are a little pilot on glider wings. The nose points where you go: dive to gain speed, climb to spend it, bank to turn. Skim close to the land for style and a push of speed, and fly through the crystal gates. Hit rock and you crash; you come back at the last gate you passed.</p>

          <h3>Adventure: how to play it</h3>
          <p><b>Eight worlds, one flight.</b> An adventure starts on the map you pick (today's run, one you choose, or a random one) and flies seven more biomes after it, each harder than the last. Your aim is to reach the end with the best score.</p>
          <ol>
            <li><b>Take off.</b> The first level opens with your pilot gliding on its own: steer, boost or press Take off to take the wings.</li>
            <li><b>Chain the gates.</b> Every gate scores, and gates flown in a row without a crash build a chain that multiplies them. Skimming the land adds style points on top.</li>
            <li><b>Watch your boost.</b> In an adventure the boost does not refill by itself: fly through the glowing stamina orbs, and use items and abilities that restore it.</li>
            <li><b>Find the portal.</b> The compass points to it, at the last gate. Fly through and you're carried to the next world.</li>
            <li><b>Pick an upgrade.</b> At every portal choose one of three: stronger boost, wingbeats, and abilities like Hover-Stall, Plunging Attack or Guardian Gale. The strongest wait for higher pilot levels.</li>
            <li><b>Carry items.</b> Items lie on the islands, in beams of their rarity's color. Your bag holds three: use the lit one with {key("useItem")}, switch with {key("nextItem")}.</li>
            <li><b>Mind your golden feathers.</b> Each crash costs a feather (a life). Lose the last and the run ends. Some pets, cosmetics and upgrades give more, or save you from a crash.</li>
            <li><b>Collect treasure.</b> Crystals and treasures float off to the side of the line: cosmetics, pets and keepsakes go to your journal, and crystals buy things at the Lantern Market.</li>
            <li><b>Your charm.</b> One keepsake from your journal rides along as your charm: press {key("charm")} to use its power once per level (some work by themselves).</li>
            <li><b>The end.</b> Through the eighth portal waits the Milky Way. Your score, gates and level count towards your pilot level, which unlocks rarer finds.</li>
          </ol>
          <p className="guide-tip">Tip: equipped pets and rare cosmetics have powers in adventures. They never touch races, so leaderboards stay fair.</p>

          <h3>Racing</h3>
          <p><b>Solo:</b> today's course, or any course you choose, against the clock. A countdown, then every gate in order to the finish; your best time goes on the course's leaderboard, and the fastest pilots' ghosts fly with you. <b>With friends:</b> create a room and share its code, or join one. Everyone flies the same map from the same start; the host can restart, and the race is called a minute after the first finish. Races always fly the plain flight model: no items, abilities or powers.</p>

          <h3>Zen</h3>
          <p>One map that never ends, every way: valleys, rivers, mountains and islands made around you as you fly. No gates, no clock, no score, nothing to lose. A crash puts you back in the air close to where you tumbled.</p>

          <h3>Your journal</h3>
          <p>Everything you can collect, by kind, with a turning preview. Equip cosmetics and a companion, name your pets, carry a keepsake as your charm. Each rarity is three times rarer than the last: common, uncommon, rare, legendary. Duplicates become crystals.</p>
        </div>
      )}

      {section === "Controls" && (
        <div className="guide-prose sheet-panel">
          <table className="guide-keys">
            <tbody>
              {bindingActions.filter((action) => action !== "lesson").map((action) => (
                <tr key={action}><th>{ACTION_LABELS[action]}</th><td>{boundKeys(action).map((g) => <kbd key={g.join()}>{g.join(" ")}</kbd>)}</td></tr>
              ))}
            </tbody>
          </table>
          <p className="guide-tip">Change any key in Settings. Gamepads and touch screens work too: see "How to fly" (the ? button).</p>
        </div>
      )}

      {entries.length > 0 && (
        <div className="guide-grid">
          {shown.map((entry) => <Card key={entry.id} entry={entry} />)}
          {!shown.length && <p className="journal-empty">Nothing matches "{query}".</p>}
        </div>
      )}
    </div>
  );
}
