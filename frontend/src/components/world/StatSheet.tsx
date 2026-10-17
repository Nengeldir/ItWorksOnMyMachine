import { STAT_INFO } from "../../catalog";
import type { StatGroup } from "../../catalog";
import type { Stats } from "../../game/stats";
import { formatNumber } from "./format";
import { STAT_ICON } from "./statIcons";
import "./StatSheet.css";

// A pilot's stats (plan F2), grouped, each with its icon, value and, given a base, what was gained
// over it. Used by the journal and tooltips once gear lands; it reads only what it's handed.

const GROUPS: readonly { id: StatGroup; name: string }[] = [
  { id: "combat", name: "Combat" },
  { id: "gathering", name: "Gathering" },
  { id: "general", name: "General" },
];

export function StatSheet({ stats, base, groups = GROUPS.map((group) => group.id) }: {
  stats: Stats;
  /** Shows each stat's gain over this */
  base?: Stats;
  groups?: readonly StatGroup[];
}) {
  return (
    <div className="stat-sheet">
      {GROUPS.filter((group) => groups.includes(group.id)).map((group) => (
        <section key={group.id} className="stat-group" aria-label={group.name}>
          <h4>{group.name}</h4>
          <dl>
            {STAT_INFO.filter((info) => info.group === group.id).map((info) => {
              const gain = base ? stats[info.id] - base[info.id] : 0;
              return (
                <div key={info.id} className="stat-row" title={info.description}>
                  <dt>
                    <span className="stat-icon" aria-hidden>{STAT_ICON[info.id]}</span>
                    {info.name}
                  </dt>
                  <dd>
                    {formatNumber(stats[info.id])}{info.unit}
                    {gain !== 0 && (
                      <small className={gain > 0 ? "stat-gain" : "stat-loss"}>
                        {gain > 0 ? "+" : "−"}{formatNumber(Math.abs(gain))}
                      </small>
                    )}
                  </dd>
                </div>
              );
            })}
          </dl>
        </section>
      ))}
    </div>
  );
}
