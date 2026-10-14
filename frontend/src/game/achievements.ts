// Achievements: things to aim for across the three modes, worth points. They
// never change gameplay (CLAUDE.md rule 6): the game only reports what
// happened (`record`, `best`, `unlock`) and this keeps count, in this
// browser's storage. Test mode, the menu's backdrop and explore never report.
//
// Two kinds: `once` (done or not) and `progress` (tiers on a counter, each tier
// worth its own points). Some once-achievements are `hidden`: the journal shows
// "???" and a hint until they are found.

export type AchievementMode = "any" | "adventure" | "racing" | "zen" | "collection";

/** The counters progress achievements read (`record` adds, `best` keeps the highest) */
export type Counter =
  | "gates" | "dodges" | "crashes" | "distance" | "boostTime" | "skimTime"
  | "levels" | "runsCompleted" | "flawlessRuns" | "itemsUsed" | "abilities" | "portals" | "bestScore" | "bestChain"
  | "racesFinished" | "roomRaces" | "roomWins"
  | "zenDistance" | "zenTime" | "zenFlight"
  | "owned" | "pets" | "legendaries" | "pilotLevel";

interface Base {
  id: string;
  name: string;
  description: string;
  mode: AchievementMode;
}
export interface OnceAchievement extends Base {
  kind: "once";
  points: number;
  /** Shown as ??? with this hint until found */
  hidden?: string;
}
export interface ProgressAchievement extends Base {
  kind: "progress";
  counter: Counter;
  /** Each tier: how much of the counter, and what it's worth */
  tiers: readonly { at: number; points: number }[];
  /** How the counter reads (km for metres, minutes for seconds) */
  unit?: "km" | "min";
}
export type Achievement = OnceAchievement | ProgressAchievement;

const tiers = (ats: number[], points: number[]) => ats.map((at, i) => ({ at, points: points[i] }));

export const ACHIEVEMENTS: readonly Achievement[] = [
  // --- everywhere ---------------------------------------------------------------------------------------
  { id: "firstWings", kind: "once", points: 5, mode: "any", name: "First wings", description: "Take off for the first time, in any mode." },
  { id: "gates", kind: "progress", counter: "gates", mode: "any", name: "Hoop hunter", description: "Fly through gates, in any mode.", tiers: tiers([25, 250, 1000, 5000], [5, 10, 25, 50]) },
  { id: "distance", kind: "progress", counter: "distance", unit: "km", mode: "any", name: "Long haul", description: "Fly a long way, all modes counted.", tiers: tiers([10_000, 100_000, 500_000, 2_000_000], [5, 10, 25, 50]) },
  { id: "dodges", kind: "progress", counter: "dodges", mode: "any", name: "Barrel roller", description: "Dodge sideways with a barrel roll.", tiers: tiers([20, 200, 1000], [5, 10, 25]) },
  { id: "skim", kind: "progress", counter: "skimTime", unit: "min", mode: "any", name: "Rock skimmer", description: "Spend time skimming close to the land.", tiers: tiers([60, 600, 3600], [5, 15, 30]) },
  { id: "boost", kind: "progress", counter: "boostTime", unit: "min", mode: "any", name: "Tailwind", description: "Spend time boosting.", tiers: tiers([60, 600, 3000], [5, 10, 20]) },
  { id: "crashes", kind: "progress", counter: "crashes", mode: "any", name: "Feathers everywhere", description: "Crash. It happens to every pilot.", tiers: tiers([10, 100, 500], [5, 10, 15]) },

  // --- adventure --------------------------------------------------------------------------------------
  { id: "firstPortal", kind: "once", points: 10, mode: "adventure", name: "Through the veil", description: "Fly through your first portal into the next world." },
  { id: "levels", kind: "progress", counter: "levels", mode: "adventure", name: "World walker", description: "Clear adventure levels.", tiers: tiers([5, 40, 200], [10, 20, 40]) },
  { id: "runs", kind: "progress", counter: "runsCompleted", mode: "adventure", name: "Journey's end", description: "Fly all eight worlds of an adventure to the end.", tiers: tiers([1, 5, 25], [25, 40, 75]) },
  { id: "flawless", kind: "once", points: 60, mode: "adventure", name: "Untouched", description: "Finish an adventure without a single crash." },
  { id: "score", kind: "progress", counter: "bestScore", mode: "adventure", name: "High flyer", description: "Score high in a single adventure.", tiers: tiers([10_000, 40_000, 100_000, 200_000], [10, 20, 40, 75]) },
  { id: "chain", kind: "progress", counter: "bestChain", mode: "adventure", name: "Chain of light", description: "String gates together without a crash in one level.", tiers: tiers([5, 10, 20], [10, 20, 40]) },
  { id: "items", kind: "progress", counter: "itemsUsed", mode: "adventure", name: "Treasure user", description: "Use items from your bag.", tiers: tiers([5, 50, 250], [5, 15, 30]) },
  { id: "abilities", kind: "progress", counter: "abilities", mode: "adventure", name: "Gifted", description: "Take upgrades and abilities at the portals.", tiers: tiers([5, 50, 200], [5, 15, 30]) },
  { id: "fullBag", kind: "once", points: 10, mode: "adventure", name: "Pack rat", description: "Carry three items at once." },

  // --- racing ----------------------------------------------------------------------------------------------
  { id: "firstRace", kind: "once", points: 10, mode: "racing", name: "Off the line", description: "Finish a time trial or a room race." },
  { id: "races", kind: "progress", counter: "racesFinished", mode: "racing", name: "Racer", description: "Finish time trials and room races.", tiers: tiers([5, 50, 200], [10, 20, 40]) },
  { id: "roomRaces", kind: "progress", counter: "roomRaces", mode: "racing", name: "In good company", description: "Finish races in rooms with friends.", tiers: tiers([1, 10, 50], [10, 20, 30]) },
  { id: "roomWins", kind: "progress", counter: "roomWins", mode: "racing", name: "First across the line", description: "Win room races.", tiers: tiers([1, 10, 50], [20, 30, 50]) },
  { id: "sub60", kind: "once", points: 40, mode: "racing", name: "Swift as wind", description: "Finish a time trial in under a minute." },
  { id: "personalBest", kind: "once", points: 15, mode: "racing", name: "Better than yesterday", description: "Beat your own best time on a course." },

  // --- zen --------------------------------------------------------------------------------------------------
  { id: "firstZen", kind: "once", points: 5, mode: "zen", name: "Breathe", description: "Take a Zen flight." },
  { id: "zenDistance", kind: "progress", counter: "zenDistance", unit: "km", mode: "zen", name: "Wanderer", description: "Explore the endless maps of Zen.", tiers: tiers([10_000, 100_000, 500_000], [10, 20, 40]) },
  { id: "zenTime", kind: "progress", counter: "zenTime", unit: "min", mode: "zen", name: "At peace", description: "Spend time flying in Zen.", tiers: tiers([600, 3600, 6 * 3600], [10, 20, 40]) },

  // --- the collection --------------------------------------------------------------------------------------
  { id: "owned", kind: "progress", counter: "owned", mode: "collection", name: "Collector", description: "Discover treasures: cosmetics, pets and keepsakes.", tiers: tiers([5, 20, 50, 90], [5, 15, 30, 60]) },
  { id: "pets", kind: "progress", counter: "pets", mode: "collection", name: "Menagerie", description: "Befriend companions.", tiers: tiers([1, 4, 8, 12], [5, 15, 30, 50]) },
  { id: "legendary", kind: "progress", counter: "legendaries", mode: "collection", name: "Legend in hand", description: "Own legendary treasures.", tiers: tiers([1, 3, 8], [20, 40, 75]) },
  { id: "pilotLevel", kind: "progress", counter: "pilotLevel", mode: "collection", name: "Seasoned pilot", description: "Raise your pilot level.", tiers: tiers([5, 10, 25], [10, 20, 50]) },

  // --- hidden ---------------------------------------------------------------------------------------------
  { id: "stargazer", kind: "once", points: 30, mode: "adventure", name: "Stargazer", description: "Watch the Milky Way at the end of an adventure all the way through, without skipping.", hidden: "Some endings are worth waiting for." },
  { id: "featherLight", kind: "once", points: 25, mode: "any", name: "Feather-light", description: "Skim the land for five seconds without letting go.", hidden: "Stay close. Closer. Don't let go." },
  { id: "dizzy", kind: "once", points: 20, mode: "any", name: "Dizzy", description: "Barrel roll ten times in ten seconds.", hidden: "Round and round you go." },
  { id: "upsideDown", kind: "once", points: 20, mode: "any", name: "Upside down", description: "Fly upside down for five seconds.", hidden: "See the world from the other side." },
  { id: "intoTheVoid", kind: "once", points: 10, mode: "any", name: "Into the void", description: "Fall off the world.", hidden: "There's always further down." },
  { id: "phoenixDown", kind: "once", points: 25, mode: "adventure", name: "From the ashes", description: "Be pulled back from a crash by a phoenix: feather, charm or companion.", hidden: "Not every fall is the end." },
  { id: "windFriend", kind: "once", points: 25, mode: "adventure", name: "The wind's friend", description: "Have a crash foreseen and be carried on the safe line.", hidden: "Someone is watching over you." },
  { id: "longWay", kind: "once", points: 40, mode: "zen", name: "The long way round", description: "Fly 20 km in a single Zen flight.", hidden: "Just keep going." },
];

const STORAGE_KEY = "windrider.achievements.v1";

interface Saved {
  counters: Partial<Record<Counter, number>>;
  /** Once-achievements found, and when (ms) */
  found: Record<string, number>;
  /** Progress tiers reached, per achievement: how many */
  reached: Record<string, number>;
}

export interface AchievementNews {
  id: number;
  name: string;
  points: number;
  /** The tier reached (progress achievements), 1-based */
  tier?: number;
}

/** How far along an achievement is, for the journal */
export interface AchievementState {
  achievement: Achievement;
  done: boolean;
  /** Tiers reached (progress) */
  tier: number;
  /** The counter, and the next tier's target (progress) */
  value: number;
  next: number | null;
  /** Points earned from it so far */
  points: number;
  /** Hidden and not found: shown as ??? */
  secret: boolean;
}

const total = (a: Achievement) => (a.kind === "once" ? a.points : a.tiers.reduce((sum, t) => sum + t.points, 0));

class Tracker {
  private saved: Saved = { counters: {}, found: {}, reached: {} };
  private loaded = false;
  private listeners = new Set<() => void>();
  private version = 0;
  private dirty = false;
  private saveTimer = 0;
  /** The latest unlock, for the toast */
  news: AchievementNews | null = null;

  private load() {
    if (this.loaded) return;
    this.loaded = true;
    try {
      const data = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "null") as Partial<Saved> | null;
      if (data && typeof data === "object") {
        this.saved = { counters: { ...(data.counters ?? {}) }, found: { ...(data.found ?? {}) }, reached: { ...(data.reached ?? {}) } };
      }
    } catch {
      // Storage may be unavailable: count for this visit only
    }
  }

  private persist() {
    this.dirty = true;
    if (this.saveTimer) return;
    // Counters tick every physics step: write at most once a second
    this.saveTimer = globalThis.setTimeout(() => {
      this.saveTimer = 0;
      if (!this.dirty) return;
      this.dirty = false;
      try { localStorage.setItem(STORAGE_KEY, JSON.stringify(this.saved)); } catch { /* still counts for this visit */ }
    }, 1000) as unknown as number;
  }

  private changed() {
    this.version++;
    this.listeners.forEach((listener) => listener());
  }

  readonly subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  readonly getVersion = () => this.version;

  /** Adds to a counter */
  record(counter: Counter, amount = 1) {
    if (amount <= 0) return;
    this.load();
    this.saved.counters[counter] = (this.saved.counters[counter] ?? 0) + amount;
    this.persist();
    this.check(counter);
  }

  /** Keeps a counter at its highest (best score, best chain, the collection's sizes) */
  best(counter: Counter, value: number) {
    this.load();
    if (value <= (this.saved.counters[counter] ?? 0)) return;
    this.saved.counters[counter] = value;
    this.persist();
    this.check(counter);
  }

  /** A once-achievement happened */
  unlock(id: string) {
    this.load();
    if (this.saved.found[id]) return;
    const achievement = ACHIEVEMENTS.find((a) => a.id === id);
    if (!achievement || achievement.kind !== "once") return;
    this.saved.found[id] = Date.now();
    this.persist();
    this.news = { id: (this.news?.id ?? 0) + 1, name: achievement.name, points: achievement.points };
    this.changed();
  }

  /** Progress achievements on this counter: any new tier reached? */
  private check(counter: Counter) {
    const value = this.saved.counters[counter] ?? 0;
    let news = false;
    for (const achievement of ACHIEVEMENTS) {
      if (achievement.kind !== "progress" || achievement.counter !== counter) continue;
      const reached = achievement.tiers.filter((t) => value >= t.at).length;
      if (reached > (this.saved.reached[achievement.id] ?? 0)) {
        const tier = achievement.tiers[reached - 1];
        this.saved.reached[achievement.id] = reached;
        this.news = { id: (this.news?.id ?? 0) + 1, name: achievement.name, points: tier.points, tier: reached };
        news = true;
      }
    }
    if (news) this.changed();
  }

  /** Every achievement and how far along it is */
  states(): AchievementState[] {
    this.load();
    return ACHIEVEMENTS.map((achievement) => {
      if (achievement.kind === "once") {
        const done = !!this.saved.found[achievement.id];
        return { achievement, done, tier: done ? 1 : 0, value: done ? 1 : 0, next: null, points: done ? achievement.points : 0, secret: !!achievement.hidden && !done };
      }
      const value = this.saved.counters[achievement.counter] ?? 0;
      const tier = Math.max(this.saved.reached[achievement.id] ?? 0, achievement.tiers.filter((t) => value >= t.at).length);
      const next = achievement.tiers[tier]?.at ?? null;
      const points = achievement.tiers.slice(0, tier).reduce((sum, t) => sum + t.points, 0);
      return { achievement, done: tier >= achievement.tiers.length, tier, value, next, points, secret: false };
    });
  }

  /** Points earned and the most there are */
  score(): { points: number; max: number } {
    const states = this.states();
    return { points: states.reduce((sum, s) => sum + s.points, 0), max: ACHIEVEMENTS.reduce((sum, a) => sum + total(a), 0) };
  }
}

/** The one tracker for the page */
export const achievements = new Tracker();

/** A counter as the journal shows it: km for metres, minutes for seconds */
export function formatCounter(value: number, unit?: "km" | "min"): string {
  if (unit === "km") return `${(value / 1000).toLocaleString(undefined, { maximumFractionDigits: value < 10_000 ? 1 : 0 })} km`;
  if (unit === "min") return `${Math.floor(value / 60).toLocaleString()} min`;
  return Math.floor(value).toLocaleString();
}
