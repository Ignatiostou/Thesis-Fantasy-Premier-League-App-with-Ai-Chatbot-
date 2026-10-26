"use client";
// src/features/points/HistoryBar.tsx

import { ACCENT, CHIP_DISPLAY } from "@/lib/constants";
import { HistoryScore } from "@/lib/types";

export default function HistoryBar({ scores }: { scores: HistoryScore[] }) {
  if (!scores.length) return null;
  const max = Math.max(...scores.map((s) => s.finalPoints), 1);

  return (
    <div style={{ display: "flex", alignItems: "flex-end", gap: 3, height: 80 }}>
      {scores.map((s) => {
        const h   = Math.max(5, (s.finalPoints / max) * 76);
        const cd  = s.chipPlayed ? CHIP_DISPLAY[s.chipPlayed] : null;
        const col = cd ? cd.color : ACCENT;
        return (
          <div key={s.gameweek} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 2, minWidth: 0 }}>
            <div style={{ fontSize: 9, color: "rgba(255,255,255,.7)", fontFamily: "'Barlow',sans-serif" }}>{s.finalPoints}</div>
            <div
              title={`GW${s.gameweek}: ${s.finalPoints} pts${cd ? ` · ${cd.label}` : ""}`}
              style={{ width: "100%", height: h, borderRadius: "3px 3px 0 0", background: col + "44", border: `1px solid ${col}77` }}
            />
            <div style={{ fontSize: 9, color: "rgba(255,255,255,.5)", fontFamily: "'Barlow',sans-serif" }}>{s.gameweek}</div>
          </div>
        );
      })}
    </div>
  );
}
