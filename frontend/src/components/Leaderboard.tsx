import type { LeaderboardEntry } from "../api";
import { formatTime } from "../format";

interface LeaderboardProps {
  entries: LeaderboardEntry[];
  empty: string;
}

const Leaderboard = ({ entries, empty }: LeaderboardProps) =>
  entries.length === 0 ? (
    <p className="hint">{empty}</p>
  ) : (
    <ol className="leaderboard">
      {entries.map((entry) => (
        <li key={entry.rank} className={entry.is_me ? "me" : undefined}>
          <span className="rank">{entry.rank}</span>
          <span className="name">{entry.name}</span>
          <span className="time">{formatTime(entry.time_ms)}</span>
        </li>
      ))}
    </ol>
  );

export default Leaderboard;
