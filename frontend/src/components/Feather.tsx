import "./Feather.css";

/**
 * A golden feather in the pilot's style: a cream-to-gold vane, an ink outline,
 * a gold quill and a glint. The run's lives, and the Spare feather upgrade.
 * `spent`: only its ink outline, for a feather lost
 */
export const Feather = ({ spent = false }: { spent?: boolean }) => (
  <svg className={`feather${spent ? " spent" : ""}`} viewBox="0 0 24 32" aria-hidden="true">
    <defs>
      <linearGradient id="feather-vane" x1="0" y1="0" x2="0.35" y2="1">
        <stop offset="0" stopColor="#fffdf0" />
        <stop offset="0.45" stopColor="#ffe08a" />
        <stop offset="1" stopColor="#f3a544" />
      </linearGradient>
    </defs>
    <g transform="rotate(20 12 16)">
      {/* The vane, with two notches where the barbs part */}
      <path
        className="vane"
        d="M12 1.6 C16.6 4.6 19.2 9.4 18.9 14.2 L16.6 14.6 L18.3 17.4 C17.6 20.2 16.2 22.4 14.4 24.2 L12.5 26 L9.6 24.2 C7.8 22.4 6.4 20.2 5.7 17.6 L7.6 15.4 L5.1 14.2 C4.8 9.4 7.4 4.6 12 1.6 Z"
      />
      <path className="barbs" d="M12 10 L15.6 7.6 M12 14.5 L16.4 11.6 M12 19 L15.4 16.8 M12 10 L8.4 7.6 M12 14.5 L7.8 11.8 M12 19 L8.6 16.8" />
      <path className="quill" d="M12 5.2 L12 30.4" />
    </g>
    <path className="glint" d="M19 2.2 L19.8 4.8 L22.4 5.6 L19.8 6.4 L19 9 L18.2 6.4 L15.6 5.6 L18.2 4.8 Z" />
  </svg>
);
