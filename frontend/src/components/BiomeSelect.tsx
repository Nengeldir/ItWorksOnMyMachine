import { IconArrowLeft, IconChevronLeft, IconChevronRight } from "@tabler/icons-react";
import { useEffect, useState } from "react";
import { BIOMES, type BiomeId, runLevel } from "../game/world/biomes";
import type { Level } from "../game/world/biomes/types";
import "./CourseSelect.css";

const PREVIEW_DELAY_MS = 300; // the backdrop follows once the cards stop moving
const SHOWCASE_SEED = 2; // the level each card shows: the same one `/?explore=<biome>&seed=2` flies

// In the order a run meets them: Sky Isles, Verdant, the middle five and the reef shuffled, the summit last
const ORDER: BiomeId[] = ["skyIsles", "verdant", "glacier", "archipelago", "lagoon", "twilight", "ember", "reef", "aurora"];

/** Where in a run the biome comes */
function place(id: BiomeId): string {
  if (id === "skyIsles") return "Level 1";
  if (id === "verdant") return "Level 2";
  if (id === "aurora") return "Level 8 · the summit";
  return "Levels 3 to 7";
}

const levels = new Map<BiomeId, Level>();

/** The level a biome's card shows behind the glass, built once */
function showcase(id: BiomeId): Level {
  let level = levels.get(id);
  if (!level) {
    level = runLevel(SHOWCASE_SEED, 1, id);
    levels.set(id, level);
  }
  return level;
}

interface BiomeSelectProps {
  /** The level the backdrop should show */
  onPreview: (level: Level) => void;
  onStart: () => void;
  onBack: () => void;
}

/** The adventure's map select: every biome on a card, the one in the middle flown behind the glass */
const BiomeSelect = ({ onPreview, onStart, onBack }: BiomeSelectProps) => {
  const [index, setIndex] = useState(0);
  const id = ORDER[index];
  const step = (by: number) => setIndex((i) => (i + by + ORDER.length) % ORDER.length);

  useEffect(() => {
    const timer = setTimeout(() => onPreview(showcase(id)), PREVIEW_DELAY_MS);
    return () => clearTimeout(timer);
  }, [id, onPreview]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") return onBack();
      if (e.target instanceof HTMLInputElement) return;
      if (e.key === "ArrowLeft" || e.code === "KeyA") step(-1);
      else if (e.key === "ArrowRight" || e.code === "KeyD") step(1);
      // A focused button takes Enter itself
      else if (e.key === "Enter" && !(e.target instanceof HTMLButtonElement)) onStart();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  });

  const side = (by: number) => {
    const at = ORDER[(index + by + ORDER.length) % ORDER.length];
    return (
      <article className="course-card side glass" onClick={() => step(by)} aria-hidden="true">
        <BiomeArt id={at} />
        <div className="course-body">
          <BiomeHead id={at} />
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
        <h1>Choose a map</h1>
      </header>

      <div className="course-row">
        <button className="course-arrow glass" aria-label="Previous map" onClick={() => step(-1)}>
          <IconChevronLeft size={24} />
        </button>
        {side(-1)}
        <article className="course-card main glass" aria-live="polite">
          <BiomeArt id={id} />
          <div className="course-body">
            <BiomeHead id={id} />
            <p className="course-tagline">{BIOMES[id].tagline}</p>
            <div className="course-chips">
              {BIOMES[id].moods.map((mood) => (
                <span key={mood.name}>{mood.name}</span>
              ))}
            </div>
          </div>
        </article>
        {side(1)}
        <button className="course-arrow glass" aria-label="Next map" onClick={() => step(1)}>
          <IconChevronRight size={24} />
        </button>
      </div>

      <div className="course-dots" aria-hidden="true">
        {ORDER.map((biome, i) => (
          <i key={biome} className={i === index ? "on" : undefined} />
        ))}
      </div>
      <button className="primary course-fly" onClick={onStart}>
        Start today's run <kbd>Enter</kbd>
      </button>
    </section>
  );
};

/** A biome's picture (public/biomes), on its showcase level's sky until it has loaded */
const BiomeArt = ({ id }: { id: BiomeId }) => {
  const { palette } = showcase(id);
  const sky = `linear-gradient(180deg, ${palette.zenith}, ${palette.horizon})`;
  return <div className="course-art" style={{ backgroundImage: `url("/biomes/${id}.jpg"), ${sky}` }} />;
};

const BiomeHead = ({ id }: { id: BiomeId }) => (
  <div className="course-head">
    <small>{place(id)}</small>
    <h2>{BIOMES[id].name}</h2>
  </div>
);

export default BiomeSelect;
