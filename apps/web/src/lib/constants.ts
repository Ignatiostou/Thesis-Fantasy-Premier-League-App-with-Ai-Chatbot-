export const ACCENT  = "#00FF87";
export const ACCENT2 = "#00d4ff";
export const GOLD    = "#f5c842";
export const BG      = "#060b14";
export const BG_ALT  = "#0a0e1a";
export const SURFACE = "rgba(255,255,255,.04)";
export const BORDER  = "rgba(255,255,255,.07)";

export const POS_COLOR: Record<number, string> = {
  1: "#facc15",
  2: "#38bdf8",
  3: ACCENT,
  4: "#f97316",
};

export const POS_LABEL: Record<number, string> = {
  1: "GK",
  2: "DEF",
  3: "MID",
  4: "FWD",
};

export const STATUS_COLOR: Record<string, string> = {
  a: ACCENT,
  d: "#facc15",
  i: "#ef4444",
  s: "#f97316",
  u: "#64748b",
};

export const CHIP_DISPLAY: Record<string, { label: string; color: string }> = {
  WILDCARD:       { label: "Wildcard",       color: "#a855f7" },
  BENCH_BOOST:    { label: "Bench Boost",    color: "#f97316" },
  TRIPLE_CAPTAIN: { label: "Triple Captain", color: "#f59e0b" },
  FREE_HIT:       { label: "Free Hit",       color: "#38bdf8" },
};

export const fmt      = (cost: number) => `£${(cost / 10).toFixed(1)}m`;
export const fmtShort = (cost: number) => `${(cost / 10).toFixed(1)}m`;