// Numbers in the open world's UI (plan §5: abbreviated, never cramped)

/** 1234 -> 1234, 12 345 -> 12.3k, 3 400 000 -> 3.4M; small numbers keep one decimal if they have one */
export function formatNumber(value: number): string {
  const size = Math.abs(value);
  if (size >= 1e6) return `${(value / 1e6).toFixed(1).replace(/\.0$/, "")}M`;
  if (size >= 1e4) return `${(value / 1e3).toFixed(1).replace(/\.0$/, "")}k`;
  return Number.isInteger(value) ? String(value) : value.toFixed(1).replace(/\.0$/, "");
}
