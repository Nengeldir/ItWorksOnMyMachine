import { useSyncExternalStore } from "react";
import { loadSettings } from "../../storage";
import { type Breakpoint, breakpoint } from "./nav";

// Small hooks the primitives share: the layout breakpoint (plan §5), touch mode and reduced motion.

let size = "";
function viewportKey() {
  return breakpoint(window.innerWidth, window.innerHeight);
}

const onResize = (listener: () => void) => {
  const handler = () => {
    const next = viewportKey();
    if (next !== size) {
      size = next;
      listener();
    }
  };
  window.addEventListener("resize", handler);
  return () => window.removeEventListener("resize", handler);
};

/**
 * The breakpoint of the game container. The game fills the window, and sheets sit in the top layer
 * (relative to the window anyway), so the window's size is the container's
 */
export function useBreakpoint(): Breakpoint {
  return useSyncExternalStore(onResize, viewportKey, () => "wide");
}

const onTouchChange = (listener: () => void) => {
  const observer = new MutationObserver(listener);
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
  return () => observer.disconnect();
};

/** `html.touch` (touch.ts keeps it in step with the last press) */
export function useTouchMode(): boolean {
  return useSyncExternalStore(onTouchChange, () => document.documentElement.classList.contains("touch"), () => false);
}

/** The system's reduced motion or the game's own setting: sheets fade instead of sliding, counters jump */
export function reducedMotion(): boolean {
  return (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false) || loadSettings().reducedMotion === true;
}
