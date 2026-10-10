import { IconArrowLeft, IconChevronLeft, IconChevronRight, IconDice5 } from "@tabler/icons-react";
import { type FormEvent, useEffect, useMemo, useState } from "react";
import { type LeaderboardEntry, getLeaderboard } from "../api";
import { formatTime } from "../format";
import { randomSeed } from "../game/rng";
import { BIOMES, raceLevel } from "../game/world/biomes";
import { Course } from "../game/world/course";
import { clientId } from "../storage";
import "./CourseSelect.css";

const PREVIEW_DELAY_MS = 300; // the backdrop and the board follow once the cards stop moving
const MAX_SEED = 2 ** 31;

type Card = { kind: "daily"; seed: number } | { kind: "featured"; seed: number } | { kind: "random"; seed: number | null };

let featured: number[] | null = null;

/** One course for each of Sky Isles' moods: the lowest seed that has it */
function featuredSeeds(): number[] {
  if (featured) return featured;
  const names = BIOMES.skyIsles.moods.map((mood) => mood.name);
  const found = new Map<string, number>();
  for (let seed = 1; seed < 500 && found.size < names.length; seed++) {
    const name = raceLevel(seed).palette.name;
    if (!found.has(name)) found.set(name, seed);
  }
  featured = names.flatMap((name) => (found.has(name) ? [found.get(name)!] : []));
  return featured;
}

interface CourseInfo {
  palette: string;
  gates: number;
  /** The course's sky, top to bottom: art until a picture arrives */
  sky: string;
}

const infos = new Map<number, CourseInfo>();

function courseInfo(seed: number): CourseInfo {
  let info = infos.get(seed);
  if (!info) {
    const { palette } = raceLevel(seed);
    info = {
      palette: palette.name,
      gates: new Course(seed).rings.length,
      sky: `linear-gradient(180deg, ${palette.zenith}, ${palette.horizon})`,
    };
    infos.set(seed, info);
  }
  return info;
}

/** A card's picture: drawn ahead of time for the featured courses (public/courses), else taken by the backdrop */
function artFor(card: Card, taken: Record<number, string>): string | undefined {
  if (card.seed === null) return undefined;
  return card.kind === "featured" ? `/courses/${card.seed}.jpg` : taken[card.seed];
}

interface CourseSelectProps {
  daily: number;
  /** Until today's course changes */
  countdown: string;
  /** Pictures the backdrop took, by seed */
  art: Record<number, string>;
  /** The course the backdrop should show */
  onPreview: (seed: number) => void;
  onFly: (seed: number) => void;
  onBack: () => void;
}

/** Map select: a carousel of courses over the live backdrop, which shows the one in the middle */
const CourseSelect = ({ daily, countdown, art, onPreview, onFly, onBack }: CourseSelectProps) => {
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
  const fly = () => onFly(card.seed ?? randomSeed());

  useEffect(() => {
    const seed = card.seed;
    if (seed === null) return;
    const timer = setTimeout(() => {
      onPreview(seed);
      getLeaderboard(seed, clientId())
        .then((entries) => setBoards((all) => ({ ...all, [seed]: entries })))
        .catch(() => {});
    }, PREVIEW_DELAY_MS);
    return () => clearTimeout(timer);
  }, [card.seed, onPreview]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") return onBack();
      // Typing a seed: the keys are letters and digits (Enter submits the seed)
      if (e.target instanceof HTMLInputElement) return;
      if (e.key === "ArrowLeft" || e.code === "KeyA") step(-1);
      else if (e.key === "ArrowRight" || e.code === "KeyD") step(1);
      // A focused button takes Enter itself
      else if (e.key === "Enter" && !(e.target instanceof HTMLButtonElement)) fly();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
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

  const flySeed = (e: FormEvent) => {
    e.preventDefault();
    if (rolled !== null) onFly(rolled);
  };

  const side = (by: number) => {
    const at = (index + by + cards.length) % cards.length;
    return (
      <article className="course-card side glass" onClick={() => step(by)} aria-hidden="true">
        <CardArt card={cards[at]} art={art} countdown={countdown} />
        <div className="course-body">
          <CardHead card={cards[at]} />
        </div>
      </article>
    );
  };

  return (
    <section className="course-select">
      <button className="course-back glass" onClick={onBack}>
        <IconArrowLeft size={18} /> Back
      </button>
      <header className="menu-title course-title">
        <h1>Choose a course</h1>
      </header>

      <div className="course-row">
        <button className="course-arrow glass" aria-label="Previous course" onClick={() => step(-1)}>
          <IconChevronLeft size={24} />
        </button>
        {side(-1)}
        <article className="course-card main glass" aria-live="polite">
          <CardArt card={card} art={art} countdown={countdown} main />
          <div className="course-body">
            <CardHead card={card} />
            {card.kind === "random" && (
              <form className="course-random" onSubmit={flySeed}>
                <button type="button" onClick={roll}>
                  <IconDice5 size={18} /> Roll a course
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
            {card.seed !== null && <Board entries={boards[card.seed]} />}
          </div>
        </article>
        {side(1)}
        <button className="course-arrow glass" aria-label="Next course" onClick={() => step(1)}>
          <IconChevronRight size={24} />
        </button>
      </div>

      <div className="course-dots" aria-hidden="true">
        {cards.map((_, i) => (
          <i key={i} className={i === index ? "on" : undefined} />
        ))}
      </div>
      <button className="primary course-fly" onClick={fly}>
        {card.seed === null ? "Fly a random course" : "Fly"} <kbd>Enter</kbd>
      </button>
    </section>
  );
};

interface CardArtProps {
  card: Card;
  art: Record<number, string>;
  countdown: string;
  /** The card in the middle: today's course gets its ribbon */
  main?: boolean;
}

/** The picture at the top of a card, on the course's own sky until the picture has loaded */
const CardArt = ({ card, art, countdown, main = false }: CardArtProps) => {
  const url = artFor(card, art);
  const sky = card.seed === null ? "linear-gradient(180deg, var(--ink-45), var(--tint))" : courseInfo(card.seed).sky;
  return (
    <div className="course-art" style={{ backgroundImage: url ? `url("${url}"), ${sky}` : sky }}>
      {main && card.kind === "daily" && (
        <div className="course-ribbon">
          <span>Today's course</span>
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
const CardHead = ({ card }: { card: Card }) => {
  const info = card.seed === null ? null : courseInfo(card.seed);
  const label = card.kind === "daily" ? "Today's course" : card.kind === "random" ? "Random course" : "Course";
  return (
    <>
      <div className="course-head">
        <small>{label}</small>
        <h2>{info ? `${info.palette} isles` : "Any course"}</h2>
      </div>
      {info && card.seed !== null && (
        <div className="course-chips">
          <span>#{card.seed}</span>
          <span>{info.gates} gates</span>
        </div>
      )}
    </>
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

export default CourseSelect;
