import type { CSSProperties } from "react";
import { skill } from "../../catalog";
import type { SkillId } from "../../catalog";
import { EMBLEMS } from "./emblems";

/**
 * A skill's constellation emblem in its colour, optionally inside a ring that fills with the level's
 * progress; `draw` traces the lines in gold, one after another (the level-up card)
 */
export function SkillEmblem({ id, size = 56, progress, draw = false }: {
  id: SkillId;
  size?: number;
  /** 0..1: the ring around it */
  progress?: number;
  draw?: boolean;
}) {
  const { points, lines } = EMBLEMS[id];
  const color = skill(id).color;
  const ring = 2 * Math.PI * 47;
  return (
    <svg className={`skill-emblem ${draw ? "drawing" : ""}`} viewBox="-6 -6 112 112" width={size} height={size}
      style={{ "--skill": color } as CSSProperties} aria-hidden="true">
      <circle className="skill-emblem-halo" cx="50" cy="50" r="47" />
      {progress !== undefined && (
        <circle className="skill-emblem-ring" cx="50" cy="50" r="47" pathLength={ring}
          strokeDasharray={`${Math.max(0, Math.min(1, progress)) * ring} ${ring}`} transform="rotate(-90 50 50)" />
      )}
      <g transform="translate(15 15) scale(0.7)">
        {lines.map(([a, b], i) => (
          <line key={i} className="skill-emblem-line" x1={points[a][0]} y1={points[a][1]} x2={points[b][0]} y2={points[b][1]}
            pathLength={1} style={{ animationDelay: `${0.25 + i * 0.09}s` }} />
        ))}
        {points.map(([x, y], i) => (
          <circle key={i} className="skill-emblem-star" cx={x} cy={y} r={i === 0 ? 5.5 : 4.2} style={{ animationDelay: `${0.15 + i * 0.06}s` }} />
        ))}
      </g>
    </svg>
  );
}
