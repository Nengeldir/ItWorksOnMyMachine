import { IconFlag } from "@tabler/icons-react";
import type { LeaderboardEntry } from "../api";
import { formatTime } from "../format";
import { useMediaToggle } from "../media";

// Wide screens show the board open; narrow ones only the flag until it's tapped
const WIDE = "(min-width: 900px)";

interface TodaysBestProps {
  entries: LeaderboardEntry[];
}

/** The top three on today's course, folded into a flag in the corner */
const TodaysBest = ({ entries }: TodaysBestProps) => {
  const [open, setOpen] = useMediaToggle(WIDE);

  return (
    <aside className={`menu-best menu-ghost ${open ? "open" : ""}`}>
      <button className="menu-best-flag" aria-label="Today's best" aria-expanded={open} onClick={() => setOpen(!open)}>
        <span className="menu-ring">
          <IconFlag size={19} />
        </span>
      </button>
      {open && (
        <div className="menu-best-list">
          <b>Today's best</b>
          {entries.length === 0 ? (
            <span className="menu-hint">No times yet. Be the first!</span>
          ) : (
            entries.slice(0, 3).map((entry) => (
              <span key={entry.rank} className={`menu-best-entry ${entry.is_me ? "me" : ""}`}>
                <i>{entry.rank}</i>
                {entry.name} <em>{formatTime(entry.time_ms)}</em>
              </span>
            ))
          )}
        </div>
      )}
    </aside>
  );
};

export default TodaysBest;
