"use client";
// src/features/points/BreakdownRow.tsx

import { ACCENT, POS_COLOR } from "@/lib/constants";
import { PickBreakdown } from "@/lib/types";

export default function BreakdownRow({ pick }: { pick: PickBreakdown }) {
  const posColor = POS_COLOR[pick.position] ?? "white";
  const hasMul   = pick.multiplier > 1;

  return (
    <div style={{
      display: "grid", gridTemplateColumns: "12px 1fr 44px 36px 50px",
      alignItems: "center", gap: 8, padding: "8px 14px", borderRadius: 8,
      background: pick.isCaptain ? "rgba(245,158,11,.07)" : pick.isOnBench ? "rgba(255,255,255,.02)" : "rgba(255,255,255,.04)",
      border: `1px solid ${pick.isCaptain ? "rgba(245,158,11,.2)" : "rgba(255,255,255,.06)"}`,
      opacity: !pick.counted ? 0.45 : 1,
    }}>
      <div style={{ width: 7, height: 7, borderRadius: "50%", background: posColor, margin: "0 auto" }} />

      <div style={{ display: "flex", alignItems: "center", gap: 5, minWidth: 0 }}>
        {pick.isCaptain && (
          <div style={{ width: 16, height: 16, borderRadius: "50%", background: "linear-gradient(135deg,#f59e0b,#fbbf24)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 8, fontWeight: 900, color: "#0a0e1a", flexShrink: 0 }}>C</div>
        )}
        {pick.isViceCaptain && (
          <div style={{ width: 16, height: 16, borderRadius: "50%", background: "#64748b", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 8, fontWeight: 900, color: "white", flexShrink: 0 }}>V</div>
        )}
        {pick.isOnBench && (
          <div style={{ fontSize: 7, color: "rgba(255,255,255,.28)", background: "rgba(255,255,255,.06)", borderRadius: 4, padding: "1px 4px", fontFamily: "'Barlow',sans-serif", flexShrink: 0 }}>BENCH</div>
        )}
        {pick.wasAutoSubbedIn && (
          <div style={{ fontSize: 7, color: ACCENT, background: `${ACCENT}18`, borderRadius: 4, padding: "1px 4px", fontFamily: "'Barlow',sans-serif", flexShrink: 0 }}>IN↑</div>
        )}
        {pick.wasAutoSubbedOut && (
          <div style={{ fontSize: 7, color: "#f87171", background: "rgba(248,113,113,.12)", borderRadius: 4, padding: "1px 4px", fontFamily: "'Barlow',sans-serif", flexShrink: 0 }}>OUT↓</div>
        )}
        <span style={{ color: "rgba(255,255,255,.88)", fontSize: 12, fontWeight: 700, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
          {pick.webName}
        </span>
        <span style={{ color: "rgba(255,255,255,.22)", fontSize: 9, fontFamily: "'Barlow',sans-serif", flexShrink: 0 }}>{pick.teamShortName}</span>
      </div>

      <div style={{ textAlign: "center", color: "rgba(255,255,255,.4)", fontSize: 12, fontFamily: "'Barlow',sans-serif" }}>
        {pick.basePoints}
      </div>
      <div style={{ textAlign: "center", color: hasMul ? "#f59e0b" : "rgba(255,255,255,.15)", fontSize: 12, fontWeight: hasMul ? 900 : 400 }}>
        ×{pick.multiplier}
      </div>
      <div style={{ textAlign: "right", color: pick.counted && pick.finalPoints > 0 ? ACCENT : "rgba(255,255,255,.25)", fontSize: 14, fontWeight: 900 }}>
        {pick.counted ? pick.finalPoints : "—"}
      </div>
    </div>
  );
}
