import { useEffect, useEffectEvent, useRef } from "react";
import { loadSettings, type Settings } from "../storage";
import { type AttractMode, Game } from "../game/Game";

const ART_ASPECT = 2.2; // map-select card art, width / height (MapSelect.css draws it at about this shape)
const ART_WIDTH = 720;
const ART_SETTLE_MS = 1500; // after the nearby land, give the far islands a moment before the snapshot
const READY_POLL_MS = 400;

interface MenuBackdropProps {
  seed: number;
  mode: AttractMode;
  settings?: Settings;
  /** Gets a picture of each course once its land has loaded (map-select card art) */
  onSnapshot?: (seed: number, url: string) => void;
  /** Called once a course is all in (its far islands too), so the map select can stop covering it */
  onShown?: (seed: number) => void;
}

/** The live course behind the menu. Without WebGL the menu keeps its plain background. */
const MenuBackdrop = ({ seed, mode, onSnapshot, onShown, settings }: MenuBackdropProps) => {
  const container = useRef<HTMLDivElement>(null);
  const game = useRef<Game | null>(null);
  const shown = useRef(seed);
  const pictured = useRef(new Set<number>());
  const snapshotted = useEffectEvent((seed: number, url: string) => onSnapshot?.(seed, url));
  const arrived = useEffectEvent((seed: number) => onShown?.(seed));

  useEffect(() => {
    try {
      game.current = new Game(container.current!, {
        seed: shown.current,
        clock: () => performance.now(),
        controls: loadSettings(),
        color: "#ff5d73",
        events: { hud: () => {} },
        attract: mode,
      });
    } catch (e) {
      console.warn("No menu backdrop:", e);
    }
    return () => {
      game.current?.dispose();
      game.current = null;
    };
  }, [mode]);

  // Another course (the map select): the same game builds it (or takes it back from the ones it kept), so
  // the canvas never goes blank. Once its land is in, say so, and take a picture of it.
  useEffect(() => {
    shown.current = seed;
    game.current?.setSeed(seed);
    let timer = 0;
    let waited = false;
    const check = () => {
      if (!game.current) return;
      if (!game.current.landReady) {
        waited = true;
        timer = window.setTimeout(check, READY_POLL_MS);
        return;
      }
      // A course kept from before is in at once; a new one gets a moment for its far islands
      timer = window.setTimeout(() => {
        arrived(seed);
        if (pictured.current.has(seed)) return;
        const url = game.current?.snapshot(ART_WIDTH, ART_ASPECT);
        if (!url) return;
        pictured.current.add(seed);
        snapshotted(seed, url);
      }, waited ? ART_SETTLE_MS : 0);
    };
    check();
    return () => clearTimeout(timer);
  }, [seed]);

  useEffect(() => { if (settings) game.current?.setControls(settings); }, [settings]);

  return <div ref={container} className="menu-backdrop" aria-hidden="true" />;
};

export default MenuBackdrop;
