import { useEffect, useState, useSyncExternalStore } from "react";
import { skill } from "../../catalog";
import { inventoryClient } from "../../game/inventory/outbox";
import { playChime } from "../../game/collection/sounds";
import { formatNumber } from "./format";
import { SkillEmblem } from "./SkillEmblem";
import "./Skills.css";

const SHOW_MS = 2600;

/**
 * The skill toast (plan F4), top left: the skill's emblem in a thin ring that fills to the level's
 * progress, and "+12 Farming". Gains of one skill in a row add up in one toast. Never takes the
 * pointer or the focus: flight goes on under it
 */
export default function SkillToast() {
  const client = inventoryClient();
  const { gains } = useSyncExternalStore(client.store.subscribe, client.store.get);
  const latest = gains.at(-1);
  // Gains up to this id have been shown. A gain still fresh shows even if it came before this mounted
  // (the overlays load lazily, after the first answer)
  const [hidden, setHidden] = useState(() => gains.filter((g) => Date.now() - g.at > SHOW_MS).at(-1)?.id ?? 0);
  const showing = !!latest && latest.id > hidden;
  useEffect(() => {
    if (!latest || latest.id <= hidden) return;
    playChime("skill");
    const timer = setTimeout(() => setHidden(latest.id), Math.max(0, SHOW_MS - (Date.now() - latest.at)));
    return () => clearTimeout(timer);
  }, [latest, hidden]);
  if (!showing) return null;
  const { gain } = latest;
  let total = 0;
  for (let i = gains.length - 1; i >= 0 && gains[i].id > hidden && gains[i].gain.skill === gain.skill; i--) total += gains[i].gain.gained;
  const progress = gain.next ? gain.into / gain.next : 1;
  return (
    <div className="skill-toast glass" role="status" key={gain.skill}>
      <SkillEmblem id={gain.skill} size={40} progress={progress} />
      <span>
        <b>+{formatNumber(total)} {skill(gain.skill).name}</b>
        <small>Level {gain.level}{gain.next ? ` · ${formatNumber(gain.into)} / ${formatNumber(gain.next)}` : " · max"}</small>
      </span>
    </div>
  );
}
