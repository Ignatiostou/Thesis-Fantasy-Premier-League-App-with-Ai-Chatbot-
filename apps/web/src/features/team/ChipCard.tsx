"use client";

import { ChipCardProps } from "@/lib/types";

export default function ChipCard({ id, name, desc, icon, active, used, onToggle }: ChipCardProps) {
  const col = id === "WILDCARD" ? "#a855f7" : id === "BENCH_BOOST" ? "#f97316" : id === "TRIPLE_CAPTAIN" ? "#f59e0b" : "#38bdf8";

  return (
    <div style={{
      background: active
        ? `linear-gradient(135deg,${col}1a,${col}0a)`
        : used ? "rgba(255,255,255,.02)" : "rgba(255,255,255,.04)",
      border: `1px solid ${active ? col + "55" : used ? "rgba(255,255,255,.04)" : "rgba(255,255,255,.1)"}`,
      borderRadius: 10, padding: "9px 11px",
      opacity: used && !active ? 0.4 : 1,
      transition: "all .25s", position: "relative", overflow: "hidden",
    }}>
      {active && (
        <div style={{
          position: "absolute", inset: 0,
          background: `radial-gradient(ellipse 80% 60% at 50% 0%, ${col}18 0%, transparent 70%)`,
          pointerEvents: "none",
        }} />
      )}
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 7 }}>
        <div style={{ flex: 1 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 7, marginBottom: 3, flexWrap: "wrap" }}>
            <span style={{ fontSize: 13 }}>{icon}</span>
            <span style={{ color: active ? col : "#ffffff", fontSize: 11.5, fontWeight: 900, letterSpacing: "0.07em", textTransform: "uppercase" }}>
              {name}
            </span>
            {active && (
              <span style={{
                background: `${col}22`, border: `1px solid ${col}55`, color: col,
                fontSize: 7, fontWeight: 800, padding: "1px 5px", borderRadius: 4, letterSpacing: "0.15em",
              }}>ACTIVE</span>
            )}
            {used && !active && (
              <span style={{
                background: "rgba(255,255,255,.06)", border: "1px solid rgba(255,255,255,.1)", color: "rgba(255,255,255,.5)",
                fontSize: 7, fontWeight: 800, padding: "1px 5px", borderRadius: 4, letterSpacing: "0.15em",
              }}>USED</span>
            )}
          </div>
          <p style={{ color: "rgba(255,255,255,.6)", fontSize: 10, fontFamily: "'Barlow',sans-serif", margin: 0, lineHeight: 1.45 }}>
            {desc}
          </p>
        </div>
        {!used && (
          <button
            onClick={onToggle}
            onMouseEnter={(e) => { const el = e.currentTarget as HTMLElement; el.style.background = `${col}28`; el.style.color = col; }}
            onMouseLeave={(e) => { const el = e.currentTarget as HTMLElement; el.style.background = active ? `${col}22` : "transparent"; el.style.color = active ? col : col + "88"; }}
            style={{
              padding: "5px 10px", borderRadius: 6,
              border: `1px solid ${active ? col + "55" : col + "33"}`,
              background: active ? `${col}22` : "transparent",
              color: active ? col : col + "cc",
              fontFamily: "'Barlow Condensed',sans-serif", fontWeight: 800,
              fontSize: 9.5, letterSpacing: "0.15em", textTransform: "uppercase",
              cursor: "pointer", transition: "all .18s", flexShrink: 0,
            }}
          >
            {active ? "Cancel" : "Play"}
          </button>
        )}
      </div>
    </div>
  );
}
