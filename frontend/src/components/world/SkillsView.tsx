import { useEffect, useState, useSyncExternalStore } from "react";
import { IconArrowLeft, IconLock } from "@tabler/icons-react";
import { skill, STAT_INFO } from "../../catalog";
import type { SkillId, StatId } from "../../catalog";
import { inventoryClient } from "../../game/inventory/outbox";
import { rewardsLadder, SKILL_IDS, skillProgress } from "../../game/skills";
import { formatNumber } from "./format";
import { SkillEmblem } from "./SkillEmblem";
import { SKY_LINKS, SKY_MAP } from "./emblems";
import { unlockLabel } from "./unlocks";
import "./Skills.css";

const statName = (id: string) => STAT_INFO.find((info) => info.id === id);

/**
 * The journal's Skills page (plan F4): every skill's emblem on one constellation, each in a ring of its
 * level's progress. Tapping one opens its rewards ladder: what every level gives and unlocks
 */
export default function SkillsView() {
  const client = inventoryClient();
  const { inventory, error } = useSyncExternalStore(client.store.subscribe, client.store.get);
  const [open, setOpen] = useState<SkillId | null>(null);
  useEffect(() => {
    void client.start();
  }, [client]);
  if (open) return <Ladder id={open} xp={inventory.skills[open] ?? 0} onBack={() => setOpen(null)} />;
  return (
    <div className="skills">
      {error && <p className="skills-note">{error}</p>}
      <div className="skills-sky">
        <svg className="skills-links" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
          {SKY_LINKS.map(([a, b]) => (
            <line key={`${a}-${b}`} x1={SKY_MAP[a][0]} y1={SKY_MAP[a][1]} x2={SKY_MAP[b][0]} y2={SKY_MAP[b][1]} />
          ))}
        </svg>
        {SKILL_IDS.map((id) => {
          const progress = skillProgress(id, inventory.skills[id] ?? 0);
          const [x, y] = SKY_MAP[id];
          return (
            <button key={id} className="skills-star" style={{ left: `${x}%`, top: `${y}%` }} onClick={() => setOpen(id)}
              aria-label={`${skill(id).name}, level ${progress.level}`}>
              <SkillEmblem id={id} size={64} progress={progress.next ? progress.into / progress.next : 1} />
              <b>{skill(id).name}</b>
              <small>Level {progress.level}</small>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function Ladder({ id, xp, onBack }: { id: SkillId; xp: number; onBack: () => void }) {
  const entry = skill(id);
  const progress = skillProgress(id, xp);
  return (
    <div className="skills skills-ladder">
      <header className="skills-ladder-head sheet-panel">
        <button className="journal-back" onClick={onBack} aria-label="Back to every skill"><IconArrowLeft size={18} /> Skills</button>
        <SkillEmblem id={id} size={72} progress={progress.next ? progress.into / progress.next : 1} />
        <div>
          <b>{entry.name} · level {progress.level}{progress.level === entry.maxLevel ? " (max)" : ""}</b>
          <small>{progress.next ? `${formatNumber(progress.into)} / ${formatNumber(progress.next)} XP to level ${progress.level + 1}` : `${formatNumber(xp)} XP`}</small>
          <div className="meter" role="progressbar" aria-label={`${entry.name} progress`} aria-valuemin={0} aria-valuemax={progress.next || 1} aria-valuenow={progress.next ? progress.into : 1}>
            <span style={{ width: `${Math.round((progress.next ? progress.into / progress.next : 1) * 100)}%` }} />
          </div>
        </div>
      </header>
      <ol className="skills-steps">
        {rewardsLadder(id).map((step) => {
          const reached = step.level <= progress.level;
          const stats = Object.entries(step.stats) as [StatId, number][];
          return (
            <li key={step.level} className={`${reached ? "reached" : ""} ${step.unlocks.length ? "has-unlock" : ""}`}>
              <span className="skills-step-level">{reached ? step.level : <><IconLock size={12} />{step.level}</>}</span>
              <span className="skills-step-rewards">
                {stats.map(([stat, amount]) => {
                  const info = statName(stat);
                  return <span key={stat}>{formatNumber(amount)}{info?.unit} {info?.name}</span>;
                })}
                {step.unlocks.map((unlock) => {
                  const { kind, name } = unlockLabel(unlock);
                  return <em key={unlock.id}>{kind} · {name}</em>;
                })}
                {!stats.length && !step.unlocks.length && <span className="skills-step-none">A step closer</span>}
              </span>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
