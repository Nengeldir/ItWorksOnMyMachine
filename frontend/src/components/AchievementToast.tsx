import { useEffect, useState, useSyncExternalStore } from "react";
import { IconAward } from "@tabler/icons-react";
import { achievements } from "../game/achievements";
import { profileClient } from "../profile/client";
import "./Achievements.css";

const SHOW_MS = 4200;

/**
 * A small banner when an achievement (or a tier of one) is reached, on every screen. It also keeps the
 * collection achievements in step with the profile (what's owned, the pets, the legendaries, the level)
 */
export default function AchievementToast() {
  useSyncExternalStore(achievements.subscribe, achievements.getVersion);
  const { profile } = useSyncExternalStore(profileClient.store.subscribe, profileClient.store.get);
  const news = achievements.news;
  const [hidden, setHidden] = useState(news?.id ?? 0);
  useEffect(() => {
    if (!news || news.id === hidden) return;
    const timer = setTimeout(() => setHidden(news.id), SHOW_MS);
    return () => clearTimeout(timer);
  }, [news, hidden]);
  useEffect(() => {
    if (!profile) return;
    const owned = profile.catalog.filter((entry) => profile.inventory[entry.key]);
    achievements.best("owned", owned.length);
    achievements.best("pets", owned.filter((entry) => entry.kind === "pet").length);
    achievements.best("legendaries", owned.filter((entry) => entry.rarity === "legendary").length);
    achievements.best("pilotLevel", profile.level);
  }, [profile]);
  if (!news || news.id === hidden) return null;
  return (
    <div className="achievement-toast glass" role="status" key={news.id}>
      <span className="achievement-toast-badge"><IconAward size={22} /></span>
      <span>
        <small>{news.tier ? `Achievement · tier ${news.tier}` : "Achievement unlocked"}</small>
        <b>{news.name}</b>
      </span>
      <em>+{news.points}</em>
    </div>
  );
}
