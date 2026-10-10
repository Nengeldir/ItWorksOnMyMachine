import { useEffect, useRef } from "react";
import { type AttractMode, Game } from "../game/Game";

interface MenuBackdropProps {
  seed: number;
  mode: AttractMode;
}

/** The live course behind the menu. Without WebGL the menu keeps its plain background. */
const MenuBackdrop = ({ seed, mode }: MenuBackdropProps) => {
  const container = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let game: Game | null = null;
    try {
      game = new Game(container.current!, {
        seed,
        clock: () => performance.now(),
        controls: { invertPitch: false, mouseSensitivity: 1 },
        color: "#ff5d73",
        events: { hud: () => {} },
        attract: mode,
      });
    } catch (e) {
      console.warn("No menu backdrop:", e);
    }
    return () => game?.dispose();
  }, [seed, mode]);

  return <div ref={container} className="menu-backdrop" aria-hidden="true" />;
};

export default MenuBackdrop;
