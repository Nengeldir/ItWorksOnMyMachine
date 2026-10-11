import { useEffect, useState } from "react";

/** A race-start acknowledgement, never a permanent obstacle over the course. */
export function GhostNotice({ names }: { names: string[] }) {
  const [visible, setVisible] = useState(true);
  useEffect(() => {
    const timer = window.setTimeout(() => setVisible(false), 5000);
    return () => window.clearTimeout(timer);
  }, []);
  return visible ? <div className="ghost-note glass" role="status">Ghosts: {names.join(", ")}</div> : null;
}
