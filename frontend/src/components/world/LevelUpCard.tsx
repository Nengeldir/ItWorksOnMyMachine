import { useEffect, useState, useSyncExternalStore } from "react";
import { skill } from "../../catalog";
import { inventoryClient } from "../../game/inventory/outbox";
import { playChime } from "../../game/collection/sounds";
import { SkillEmblem } from "./SkillEmblem";
import { unlockLabel } from "./unlocks";
import "./Skills.css";

const SHOW_MS = 3000;

/**
 * A skill's level-up (plan F4): a ring of light opens, the skill's emblem draws itself in gold, a harp
 * arpeggio, and what the level unlocks. Gone after 3 s or a tap; never modal, never takes the focus
 */
export default function LevelUpCard() {
  const client = inventoryClient();
  const { gains } = useSyncExternalStore(client.store.subscribe, client.store.get);
  const latest = [...gains].reverse().find((g) => g.gain.levels > 0);
  // Up to this id shown; a level-up still fresh shows even if it came before this mounted
  const [hidden, setHidden] = useState(() => gains.filter((g) => Date.now() - g.at > SHOW_MS).at(-1)?.id ?? 0);
  useEffect(() => {
    if (!latest || latest.id <= hidden) return;
    playChime("levelUp");
    const timer = setTimeout(() => setHidden(latest.id), Math.max(0, SHOW_MS - (Date.now() - latest.at)));
    return () => clearTimeout(timer);
  }, [latest, hidden]);
  if (!latest || latest.id <= hidden) return null;
  const { gain } = latest;
  // Every unlock passed since the card last showed, if several level-ups came at once
  const unlocks = gains.filter((g) => g.id > hidden && g.gain.skill === gain.skill).flatMap((g) => g.gain.unlocks);
  return (
    <div className="level-up" role="status" key={latest.id}>
      <span className="level-up-ring" aria-hidden="true" />
      <button className="level-up-card glass" onClick={() => setHidden(latest.id)} aria-label="Dismiss">
        <SkillEmblem id={gain.skill} size={84} draw />
        <small>Level up</small>
        <b>{skill(gain.skill).name} {gain.level}</b>
        {unlocks.length > 0 && (
          <ul>
            {unlocks.map((unlock) => {
              const { kind, name } = unlockLabel(unlock);
              return <li key={`${unlock.kind}:${unlock.id}`}><em>{kind}</em> {name}</li>;
            })}
          </ul>
        )}
      </button>
    </div>
  );
}
