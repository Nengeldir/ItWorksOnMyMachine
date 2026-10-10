import { useEffect, useEffectEvent, useRef } from "react";
import { type AttractMode, Game } from "../game/Game";

const ART_ASPECT = 2.2; // map-select card art, width / height (CourseSelect.css draws it at about this shape)
const ART_WIDTH = 720;
const ART_SETTLE_MS = 1500; // after the nearby land, give the far islands a moment before the snapshot
const READY_POLL_MS = 400;

interface MenuBackdropProps {
  seed: number;
  mode: AttractMode;
  /** Gets a picture of each course once its land has loaded (map-select card art) */
  onSnapshot?: (seed: number, url: string) => void;
}

/** The live course behind the menu. Without WebGL the menu keeps its plain background. */
const MenuBackdrop = ({ seed, mode, onSnapshot }: MenuBackdropProps) => {
  const container = useRef<HTMLDivElement>(null);
  const game = useRef<Game | null>(null);
  const shown = useRef(seed);
  const snapshotted = useEffectEvent((seed: number, url: string) => onSnapshot?.(seed, url));

  useEffect(() => {
    try {
      game.current = new Game(container.current!, {
        seed: shown.current,
        clock: () => performance.now(),
        controls: { invertPitch: false, mouseSensitivity: 1 },
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

  // Another course (the map select): the same game builds it, so the canvas never goes blank.
  // Once its land is in, take a picture of it.
  useEffect(() => {
    shown.current = seed;
    game.current?.setSeed(seed);
    let timer = 0;
    const check = () => {
      if (!game.current?.landReady) {
        timer = window.setTimeout(check, READY_POLL_MS);
        return;
      }
      timer = window.setTimeout(() => {
        const url = game.current?.snapshot(ART_WIDTH, ART_ASPECT);
        if (url) snapshotted(seed, url);
      }, ART_SETTLE_MS);
    };
    timer = window.setTimeout(check, READY_POLL_MS);
    return () => clearTimeout(timer);
  }, [seed]);

  return <div ref={container} className="menu-backdrop" aria-hidden="true" />;
};

export default MenuBackdrop;
