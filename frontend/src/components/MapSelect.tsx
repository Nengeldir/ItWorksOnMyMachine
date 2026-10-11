import { IconArrowLeft, IconChevronLeft, IconChevronRight, IconDice5 } from "@tabler/icons-react";
import { type FormEvent, useEffect, useMemo, useState } from "react";
import { type LeaderboardEntry, getLeaderboard } from "../api";
import { formatTime } from "../format";
import { randomSeed } from "../game/rng";
import { type BiomeId, MAPS, featuredSeed, seedLevel } from "../game/world/biomes";
import { keyboardBinding } from "../game/bindings";
import { Course } from "../game/world/course";
import { bestRun } from "../session/RunSession";
import { clientId } from "../storage";
import "./MapSelect.css";

const PREVIEW_DELAY_MS = 450; // the backdrop and the board follow once the cards stop moving (building a map is dear)
const MAX_SEED = 2 ** 31;

/**
 * What the map select is for. Every mode shows the same cards (today's, one per map, a random one) and
 * picking one plays exactly that map: a time trial on it, a run that starts on it, a room that races it,
 * endless free flight in it (Zen).
 */
export type MapSelectMode = "solo" | "run" | "room" | "zen";

const WORDS: Record<MapSelectMode, { title: string; today: string; card: string; random: string; roll: string }> = {
  solo: { title: "Choose a course", today: "Today's course", card: "Course", random: "Random course", roll: "Roll a course" },
  run: { title: "Choose a map", today: "Today's run", card: "Start the run here", random: "Random run", roll: "Roll a map" },
  room: { title: "Choose a map", today: "Today's course", card: "Race here", random: "Random map", roll: "Roll a map" },
  zen: { title: "Choose a map", today: "Today's Zen", card: "Wander here", random: "Random map", roll: "Roll a map" },
};

type Card = { kind: "daily"; seed: number } | { kind: "featured"; seed: number } | { kind: "random"; seed: number | null };

let featured: number[] | null = null;

/** One course for each map: the lowest seed that stands for it */
function featuredSeeds(): number[] {
  featured ??= MAPS.map(featuredSeed);
  return featured;
}

interface CourseInfo {
  biome: BiomeId;
  /** The map's name and the mood the seed gives it */
  map: string;
  mood: string;
  gates: number;
  /** The course's sky, top to bottom: art until a picture arrives */
  sky: string;
}

const infos = new Map<number, CourseInfo>();

function courseInfo(seed: number): CourseInfo {
  let info = infos.get(seed);
  if (!info) {
    const { biome, palette } = seedLevel(seed);
    info = {
      biome: biome.id,
      map: biome.name,
      mood: palette.name,
      gates: new Course(seed).rings.length,
      sky: `linear-gradient(180deg, ${palette.zenith}, ${palette.horizon})`,
    };
    infos.set(seed, info);
  }
  return info;
}

/**
 * A card's picture: drawn ahead of time for the featured courses (public/maps), else the one the backdrop
 * took, else its map's (the same map, maybe in another mood)
 */
function artFor(card: Card, taken: Record<number, string>): string | undefined {
  if (card.seed === null) return undefined;
  const map = `/maps/${courseInfo(card.seed).biome}.jpg`;
  return card.kind === "featured" ? map : (taken[card.seed] ?? map);
}


interface MapSelectProps {
  mode: MapSelectMode;
  /** Today's seed: the daily course, or (runs) the daily run */
  daily: number;
  /** Until today's changes */
  countdown: string;
  /** Pictures the backdrop took, by seed */
  art?: Record<number, string>;
  /** The course the backdrop should show */
  onPreview?: (seed: number) => void;
  /**
   * The course the live backdrop has all in. Until it shows the card in the middle, that card's picture
   * covers it, so its islands don't pop in one by one. Without it (no backdrop), nothing is covered.
   */
  live?: number | null;
  onPick: (seed: number) => void;
  /** The main button: "Fly", "Start the run"… */
  action: string;
  onBack: () => void;
}

/** The map select: a carousel of courses (over the live backdrop on the landing page, which shows the middle one) */
const MapSelect = ({ mode, daily, countdown, art = {}, onPreview, live, onPick, action, onBack }: MapSelectProps) => {
  const words = WORDS[mode];
  const zen = mode === "zen";
  const [rolled, setRolled] = useState<number | null>(null);
  const [seedText, setSeedText] = useState("");
  const cards = useMemo<Card[]>(
    () => [
      { kind: "daily", seed: daily },
      ...featuredSeeds().map((seed): Card => ({ kind: "featured", seed })),
      { kind: "random", seed: rolled },
    ],
    [daily, rolled],
  );
  const [index, setIndex] = useState(0);
  const [boards, setBoards] = useState<Record<number, LeaderboardEntry[]>>({});
  const card = cards[index];
  const step = (by: number) => setIndex((i) => (i + by + cards.length) % cards.length);
  const pick = () => onPick(card.seed ?? randomSeed());

  useEffect(() => {
    const seed = card.seed;
    if (seed === null) return;
    const timer = setTimeout(() => {
      onPreview?.(seed);
      // Runs score in this browser only and Zen not at all; races and rooms have a board per seed
      if (mode === "run" || mode === "zen") return;
      getLeaderboard(seed, clientId())
        .then((entries) => setBoards((all) => ({ ...all, [seed]: entries })))
        .catch(() => {});
    }, PREVIEW_DELAY_MS);
    return () => clearTimeout(timer);
  }, [card.seed, onPreview, mode]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onBack();
      // Typing a seed: the keys are letters and digits (Enter submits the seed)
      else if (e.target instanceof HTMLInputElement) return;
      else if (e.key === "ArrowLeft" || keyboardBinding(e) === "KeyA") step(-1);
      else if (e.key === "ArrowRight" || keyboardBinding(e) === "KeyD") step(1);
      // A focused button takes Enter itself
      else if (e.key === "Enter" && !(e.target instanceof HTMLButtonElement)) pick();
      else return;
      e.preventDefault();
      // Over a game (a room's lobby), the keys are for this, not for flying or the lobby's own keys
      e.stopImmediatePropagation();
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  });

  const roll = () => {
    const seed = randomSeed();
    setRolled(seed);
    setSeedText(String(seed));
  };

  const typeSeed = (text: string) => {
    const digits = text.replace(/\D/g, "");
    setSeedText(digits);
    const seed = Number(digits);
    if (digits && seed >= 1 && seed < MAX_SEED) setRolled(seed);
  };

  const pickTyped = (e: FormEvent) => {
    e.preventDefault();
    if (rolled !== null) onPick(rolled);
  };

  const side = (by: number) => {
    const at = (index + by + cards.length) % cards.length;
    return (
      <article className="course-card side glass" onClick={() => step(by)} aria-hidden="true">
        <CardArt card={cards[at]} art={art} countdown={countdown} today={words.today} />
        <div className="course-body">
          <CardHead card={cards[at]} words={words} zen={zen} />
        </div>
      </article>
    );
  };

  const veiled = live !== undefined && card.seed !== null && card.seed !== live;
  const veil = artFor(card, art);

  return (
    <section className="course-select">
      {live !== undefined && (
        <div
          className={`map-veil${veiled ? " on" : ""}`}
          style={veil ? { backgroundImage: `url("${veil}")` } : undefined}
          aria-hidden="true"
        />
      )}
      <button className="course-back glass" onClick={onBack}>
        <IconArrowLeft size={18} /> Back
      </button>
      <header className="menu-title course-title">
        <h1>{words.title}</h1>
      </header>

      <div className="course-row">
        <button className="course-arrow glass" aria-label="Previous" onClick={() => step(-1)}>
          <IconChevronLeft size={24} />
        </button>
        {side(-1)}
        <article className="course-card main glass" aria-live="polite">
          <CardArt card={card} art={art} countdown={countdown} today={words.today} main />
          <div className="course-body">
            <CardHead card={card} words={words} zen={zen} />
            {card.kind === "random" && (
              <form className="course-random" onSubmit={pickTyped}>
                <button type="button" onClick={roll}>
                  <IconDice5 size={18} /> {words.roll}
                </button>
                <input
                  value={seedText}
                  onChange={(e) => typeSeed(e.target.value)}
                  placeholder="Or a seed"
                  inputMode="numeric"
                  aria-label="Seed"
                />
              </form>
            )}
            {card.seed !== null &&
              (mode === "run" ? <RunBest seed={card.seed} /> : zen ? <p className="course-empty">No clock, no score: the land goes on every way.</p> : <Board entries={boards[card.seed]} />)}
          </div>
        </article>
        {side(1)}
        <button className="course-arrow glass" aria-label="Next" onClick={() => step(1)}>
          <IconChevronRight size={24} />
        </button>
      </div>

      <div className="course-dots" aria-hidden="true">
        {cards.map((_, i) => (
          <i key={i} className={i === index ? "on" : undefined} />
        ))}
      </div>
      <button className="primary course-fly" onClick={pick}>
        {action} <kbd>Enter</kbd>
      </button>
    </section>
  );
};

interface CardArtProps {
  card: Card;
  art: Record<number, string>;
  countdown: string;
  today: string;
  /** The card in the middle: today's gets its ribbon */
  main?: boolean;
}

/** The picture at the top of a card, on the course's own sky until the picture has loaded */
const CardArt = ({ card, art, countdown, today, main = false }: CardArtProps) => {
  const url = artFor(card, art);
  const sky = card.seed === null ? "linear-gradient(180deg, var(--ink-45), var(--tint))" : courseInfo(card.seed).sky;
  return (
    <div className="course-art" style={{ backgroundImage: url ? `url("${url}"), ${sky}` : sky }}>
      {main && card.kind === "daily" && (
        <div className="course-ribbon">
          <span>{today}</span>
          <span>New in {countdown}</span>
        </div>
      )}
      {card.kind === "random" && (
        <span className="course-dice">
          <IconDice5 size={main ? 34 : 26} />
        </span>
      )}
    </div>
  );
};

/** What a card is: its label, name and chips */
const CardHead = ({ card, words, zen = false }: { card: Card; words: (typeof WORDS)[MapSelectMode]; zen?: boolean }) => {
  const info = card.seed === null ? null : courseInfo(card.seed);
  const label = card.kind === "daily" ? words.today : card.kind === "random" ? words.random : words.card;
  return (
    <>
      <div className="course-head">
        <small>{label}</small>
        <h2>{info ? info.map : "Any map"}</h2>
      </div>
      {info && card.seed !== null && (
        <div className="course-chips">
          <span>{info.mood}</span>
          <span>#{card.seed}</span>
          <span>{zen ? "Endless" : `${info.gates} gates`}</span>
        </div>
      )}
    </>
  );
};

/** Your best on a run (the maps after the first stay a surprise) */
const RunBest = ({ seed }: { seed: number }) => {
  const best = bestRun(seed);
  return best === null ? null : (
    <div className="course-best">
      <span>Your best on this run</span>
      <span>{best.toLocaleString()}</span>
    </div>
  );
};

/** The top three on a course, and your best if you're not among them */
const Board = ({ entries }: { entries: LeaderboardEntry[] | undefined }) => {
  if (!entries) return <p className="course-empty">Loading best times…</p>;
  if (entries.length === 0) return <p className="course-empty">No times yet. Be the first!</p>;
  const me = entries.find((entry) => entry.is_me);
  return (
    <>
      <ol className="course-podium">
        {entries.slice(0, 3).map((entry) => (
          <li key={entry.rank} className={entry.is_me ? "me" : undefined}>
            <span>
              <i>{entry.rank}</i>
              {entry.name}
            </span>
            <em>{formatTime(entry.time_ms)}</em>
          </li>
        ))}
      </ol>
      {me && me.rank > 3 && (
        <div className="course-best">
          <span>Your best · #{me.rank}</span>
          <span>{formatTime(me.time_ms)}</span>
        </div>
      )}
    </>
  );
};

export default MapSelect;
