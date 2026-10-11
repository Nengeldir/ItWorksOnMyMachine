import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { IconArrowLeft, IconCrown, IconRosetteDiscountCheck, IconX } from "@tabler/icons-react";
import { profileClient } from "../profile/client";
import type { PilotPage, PilotSummary } from "../profile/types";
import { formatTime } from "../format";
import { BIOMES, MAPS, seedMap, type BiomeId } from "../game/world/biomes";
import { collectibleIcon } from "../game/collection/icons";
import { powerOf } from "../game/collection/abilities";
import Minifigure from "./Minifigure";
import { portrait } from "./portrait";
import { rarityStyle } from "./rarity";
import "./LeaderboardPanel.css";

// The Hall of Winds: every pilot with a profile, ranked by experience, each
// with a little portrait in their outfit. A pilot's page shows them as a
// figurine, their level and stats, achievements, best adventure, fastest race
// on each map and their named companions. Public: anyone can look.

const hours = (ms: number) => {
  const minutes = Math.round(ms / 60_000);
  return minutes < 60 ? `${minutes} min` : `${Math.floor(minutes / 60)} h ${minutes % 60} min`;
};

/** A pilot's portrait, drawn when it's ready (initials until then, or without WebGL) */
function Portrait({ pilot }: { pilot: Pick<PilotSummary, "equipped" | "style" | "name"> }) {
  const [url, setUrl] = useState("");
  useEffect(() => {
    let live = true;
    void portrait(pilot.equipped, pilot.style).then((image) => { if (live) setUrl(image); });
    return () => { live = false; };
  }, [pilot.equipped, pilot.style]);
  return url ? <img className="portrait" src={url} alt="" /> : <span className="portrait initials" aria-hidden="true">{pilot.name.slice(0, 1).toUpperCase()}</span>;
}

export default function LeaderboardPanel({ onClose, open: initial = null }: { onClose: () => void; open?: string | null }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const { profile } = useSyncExternalStore(profileClient.store.subscribe, profileClient.store.get);
  const [board, setBoard] = useState<PilotSummary[] | null>(null);
  const [error, setError] = useState("");
  const [open, setOpen] = useState<string | null>(initial);

  useEffect(() => {
    const el = dialog.current!;
    el.showModal();
    const stop = (e: KeyboardEvent) => e.stopPropagation();
    window.addEventListener("keydown", stop, true);
    window.addEventListener("keyup", stop, true);
    profileClient.players().then(setBoard).catch((e: Error) => setError(e.message));
    return () => { window.removeEventListener("keydown", stop, true); window.removeEventListener("keyup", stop, true); el.close(); };
  }, []);

  return (
    <dialog ref={dialog} className="hall-dialog glass" aria-labelledby="hall-title" onCancel={(e) => { e.preventDefault(); if (open) setOpen(null); else onClose(); }}>
      <header className="hall-header">
        {open ? <button onClick={() => setOpen(null)} aria-label="Back to the Hall of Winds"><IconArrowLeft size={20} /></button> : <IconCrown size={28} className="hall-crown" />}
        <div><small>Pilots of every sky</small><h2 id="hall-title">Hall of Winds</h2></div>
        <button autoFocus onClick={onClose} aria-label="Close the Hall of Winds"><IconX size={20} /></button>
      </header>
      {open ? <PilotView id={open} me={profile?.public_id ?? null} /> : (
        <>
          {!board && <p className="hall-status" role="status">{error || "Gathering the pilots…"}</p>}
          {board && !board.length && <p className="hall-status">No pilots yet. Fly an adventure to be the first in the hall!</p>}
          {board && board.length > 0 && <ol className="hall-board">
            {board.map((pilot) => (
              <li key={pilot.public_id} className={`${pilot.public_id === profile?.public_id ? "me" : ""} rank-${pilot.rank}`}>
                <button onClick={() => setOpen(pilot.public_id)}>
                  <span className="rank">{pilot.rank <= 3 ? ["🥇", "🥈", "🥉"][pilot.rank - 1] : pilot.rank}</span>
                  <Portrait pilot={pilot} />
                  <span className="who"><b>{pilot.name}{pilot.verified && <IconRosetteDiscountCheck size={15} className="verified" aria-label="Signed in" />}</b>
                    <small>{pilot.xp.toLocaleString()} XP · best adventure {pilot.best_score.toLocaleString()}</small></span>
                  <span className="level"><small>Level</small><b>{pilot.level}</b></span>
                  <progress max={pilot.next_level_xp || 1} value={pilot.next_level_xp ? pilot.level_xp : 1} aria-label="Progress to the next level" />
                </button>
              </li>
            ))}
          </ol>}
        </>
      )}
    </dialog>
  );
}

/** One pilot's page */
function PilotView({ id, me }: { id: string; me: string | null }) {
  const [page, setPage] = useState<PilotPage | null>(null);
  const [error, setError] = useState("");
  useEffect(() => { profileClient.player(id).then(setPage).catch((e: Error) => setError(e.message)); }, [id]);
  if (!page) return <p className="hall-status" role="status">{error || "Opening their page…"}</p>;
  const s = page.stats;
  // Fastest race on each map: their seeds grouped by the map each one stands for
  const fastest = new Map<BiomeId, { ms: number; seed: number }>();
  for (const race of page.races) {
    const biome = seedMap(race.seed).biome;
    const best = fastest.get(biome);
    if (!best || race.best_ms < best.ms) fastest.set(biome, { ms: race.best_ms, seed: race.seed });
  }
  const done = page.achievements.filter((a) => a.done).length;
  return (
    <div className="pilot-page">
      <aside className="pilot-hero">
        <Minifigure appearance={page.equipped} style={page.style} label={`${page.name}'s pilot`} />
        <h3>{page.name}{page.verified && <IconRosetteDiscountCheck size={18} className="verified" aria-label="Signed in" />}{page.public_id === me && <small className="you">you</small>}</h3>
        <p className="pilot-rank">#{page.rank} in the hall · Level {page.level}</p>
        <progress max={page.next_level_xp || 1} value={page.next_level_xp ? page.level_xp : 1} aria-label="Progress to the next level" />
        <small>{page.xp.toLocaleString()} XP · {page.next_level_xp ? `${page.next_level_xp - page.level_xp} to level ${page.level + 1}` : "maximum level"}</small>
      </aside>
      <div className="pilot-details">
        <section>
          <h4>Flight log</h4>
          <dl className="pilot-stats">
            <div><dt>Playtime</dt><dd>{hours(s.playtime_ms)}</dd></div>
            <div><dt>Best adventure</dt><dd>{s.best_score.toLocaleString()} pts</dd></div>
            <div><dt>Fastest full adventure</dt><dd>{s.best_adventure_ms ? formatTime(s.best_adventure_ms) : "—"}</dd></div>
            <div><dt>Adventures</dt><dd>{s.completed} of {s.adventures} finished</dd></div>
            <div><dt>Gates flown</dt><dd>{s.gates.toLocaleString()}</dd></div>
            <div><dt>Races</dt><dd>{s.races.toLocaleString()}</dd></div>
            <div><dt>Discoveries</dt><dd>{page.discoveries} / {page.catalog_size}</dd></div>
            <div><dt>Crystals earned</dt><dd>{s.crystals_earned.toLocaleString()}</dd></div>
          </dl>
        </section>
        <section>
          <h4>Fastest race on each map</h4>
          <ul className="pilot-races">
            {MAPS.map((biome) => {
              const best = fastest.get(biome);
              return <li key={biome} className={best ? "" : "none"}><span>{BIOMES[biome].name}</span><b>{best ? formatTime(best.ms) : "—"}</b>{best && <small>#{best.seed}</small>}</li>;
            })}
          </ul>
        </section>
        <section>
          <h4>Companions</h4>
          {page.pets.length ? <ul className="pilot-pets">
            {page.pets.map((pet) => (
              <li key={pet.asset} style={rarityStyle(pet)} className={`rarity-${pet.rarity}`} title={powerOf(`pet:${pet.asset}`)?.description}>
                <span aria-hidden="true">{collectibleIcon("pet", pet.asset)}</span>
                <b>{pet.nickname || pet.name}</b>{pet.nickname && <small>{pet.name}</small>}
              </li>
            ))}
          </ul> : <p className="hall-status">No companions yet.</p>}
        </section>
        <section>
          <h4>Achievements <small>{done} / {page.achievements.length}</small></h4>
          <ul className="pilot-achievements">
            {page.achievements.map((a) => (
              <li key={a.id} className={a.done ? "done" : ""} title={a.description}>
                <span aria-hidden="true">{a.done ? "🏅" : "🔒"}</span><b>{a.name}</b><small>{a.description}</small>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </div>
  );
}
