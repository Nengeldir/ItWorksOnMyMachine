import { IconFeather, IconMouse, IconQuestionMark } from "@tabler/icons-react";
import { type ReactNode, useEffect, useEffectEvent, useState } from "react";
import { createPortal } from "react-dom";
import { holdGame } from "../game/hold";
import { loadSettings } from "../storage";
import { boundKeys } from "./keys";
import "./Help.css";

/** A row of the guide: its keys in groups (alternatives, e.g. W or ↑) and what they do */
type Row = [groups: ReactNode[][], action: string];

function rows(): [Row[], Row[]] {
  // "Invert pitch" in the settings swaps what the pitch keys do
  const invert = loadSettings().invertPitch;
  return [
    [
      [boundKeys(invert ? "pitchUp" : "pitchDown"), "Dive"],
      [boundKeys(invert ? "pitchDown" : "pitchUp"), "Climb"],
      [boundKeys("turnLeft"), "Turn left"],
      [boundKeys("turnRight"), "Turn right"],
      [boundKeys("boost"), "Boost"],
      [boundKeys("brake"), "Brake"],
      [boundKeys("barrelLeft", "barrelRight"), "Dodge"],
    ],
    [
      [boundKeys("respawn"), "Respawn"],
      [boundKeys("pause"), "Pause"],
      [boundKeys("mute"), "Mute"],
      [[[<IconMouse key="mouse" size={15} />], ["Esc"]], "Mouse control"],
    ],
  ];
}

const Keys = ({ rows }: { rows: Row[] }) => (
  <dl>
    {rows.map(([groups, action]) => (
      <div key={action}>
        <dt>
          {groups.map((group, i) => (
            <span key={i} className="key-group">
              {group.map((key, j) => (
                <kbd key={j}>{key}</kbd>
              ))}
            </span>
          ))}
        </dt>
        <dd>{action}</dd>
      </div>
    ))}
  </dl>
);

/** Every key and what it does, nothing else; read when shown, so rebound keys show up */
const KeyGuide = () => {
  const [fly, more] = rows();
  return (
    <div className="key-guide no-touch">
      <Keys rows={fly} />
      <Keys rows={more} />
    </div>
  );
};

interface OverlayProps {
  label: string;
  /** Enter, the main button */
  onConfirm: () => void;
  /** Esc, or a click beside the card */
  onDismiss: () => void;
  children: ReactNode;
}

/** A card's title under a small feather badge */
const Title = ({ children }: { children: ReactNode }) => (
  <header className="overlay-title">
    <span className="overlay-badge">
      <IconFeather size={22} />
    </span>
    <h2>{children}</h2>
  </header>
);

/**
 * A card in the middle of a dimmed screen, the game paused behind it. Takes Enter and Esc before the game
 * and the screens do (Enter would start the run behind the card).
 */
const Overlay = ({ label, onConfirm, onDismiss, children }: OverlayProps) => {
  const onKey = useEffectEvent((e: KeyboardEvent) => {
    if (e.key === "Enter") onConfirm();
    else if (e.key === "Escape") onDismiss();
    else return;
    e.preventDefault();
    e.stopImmediatePropagation();
  });
  useEffect(() => holdGame(), []);
  useEffect(() => {
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, []);

  return createPortal(
    <div className="overlay" onClick={(e) => e.target === e.currentTarget && onDismiss()}>
      <section className="overlay-card glass" role="dialog" aria-modal="true" aria-label={label}>
        {children}
      </section>
    </div>,
    document.body,
  );
};

/** The key guide on a card */
export const HowToFly = ({ onClose }: { onClose: () => void }) => (
  <Overlay label="How to fly" onConfirm={onClose} onDismiss={onClose}>
    <Title>How to fly</Title>
    <KeyGuide />
    <div className="touch-guide touch-only">
      <p>Drag anywhere on the view to steer. Drag up to dive and down to climb; Settings can invert this.</p>
      <p>Turn on Tilt to steer like a wheel. Lean the top away to dive, or towards you to climb.</p>
      <p>Hold Boost or Brake. Tap ‹ or › to dodge, Respawn to restart at your last gate, and Pause to rest.</p>
      <p>Adventure upgrades add Flap, Hover, Plunge and Gale buttons.</p>
    </div>
    <div className="overlay-actions">
      <button className="primary" onClick={onClose}>
        Got it <kbd>Enter</kbd>
      </button>
    </div>
  </Overlay>
);

/** A round "?" that opens How to fly */
export const HelpButton = ({ className = "" }: { className?: string }) => {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button className={`help-button glass ${className}`} aria-label="How to fly" onClick={() => setOpen(true)}>
        <IconQuestionMark size={20} />
      </button>
      {open && <HowToFly onClose={() => setOpen(false)} />}
    </>
  );
};

/** A newcomer's first time in the game: take the tutorial, or skip it for good */
export const FirstFlight = ({ onStart, onSkip }: { onStart: () => void; onSkip: () => void }) => (
  <Overlay label="First flight" onConfirm={onStart} onDismiss={onSkip}>
    <Title>First flight?</Title>
    <div className="overlay-actions">
      <button className="primary" onClick={onStart}>
        Start with a tutorial <kbd>Enter</kbd>
      </button>
      <button onClick={onSkip}>
        Skip tutorial <kbd>Esc</kbd>
      </button>
    </div>
  </Overlay>
);
