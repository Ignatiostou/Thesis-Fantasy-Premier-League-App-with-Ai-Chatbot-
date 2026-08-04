"use client";
// src/features/leagues/StandingsTable.tsx

import { ACCENT } from "@/lib/constants";
import { StandingRow } from "@/lib/types";

interface Props {
  standings: StandingRow[];
  myUserId: string;
}

export default function StandingsTable({ standings, myUserId }: Props) {
  return (
    <div style={{ background: "rgba(255,255,255,.03)", border: "1px solid rgba(255,255,255,.07)", borderRadius: 14, overflow: "hidden" }}>
      {/* Header */}
      <div className="st-grid" style={{ display: "grid", gridTemplateColumns: "36px 1fr 1fr 70px 70px", gap: 8, padding: "10px 16px", background: "rgba(255,255,255,.025)", borderBottom: "1px solid rgba(255,255,255,.06)" }}>
        {["#", "Manager", "Team", "GW", "Total"].map((h, i) => (
          <div key={h} style={{ color: "rgba(255,255,255,.28)", fontSize: 8, fontWeight: 700, letterSpacing: ".15em", textTransform: "uppercase", fontFamily: "'Barlow',sans-serif", textAlign: i > 1 ? "right" : "left" }}>
            {h}
          </div>
        ))}
      </div>

      {/* Rows */}
      {standings.map((row) => {
        const isMe = row.userId === myUserId;
        return (
          <div key={row.userId} className="st-grid" style={{
            display: "grid", gridTemplateColumns: "36px 1fr 1fr 70px 70px",
            gap: 8, padding: "10px 16px", borderBottom: "1px solid rgba(255,255,255,.04)",
            background: isMe ? `${ACCENT}07` : "transparent", alignItems: "center",
          }}>
            <div style={{
              color: row.rank <= 3 ? ["#f59e0b", "#94a3b8", "#b45309"][row.rank - 1] : "rgba(255,255,255,.35)",
              fontSize: row.rank <= 3 ? 13 : 11, fontWeight: 900,
            }}>
              {row.rank <= 3 ? ["🥇", "🥈", "🥉"][row.rank - 1] : row.rank}
            </div>

            <div style={{ display: "flex", alignItems: "center", gap: 5, minWidth: 0 }}>
              {isMe && <div style={{ width: 5, height: 5, borderRadius: "50%", background: ACCENT, flexShrink: 0 }} />}
              <span style={{ color: isMe ? ACCENT : "rgba(255,255,255,.8)", fontSize: 12, fontWeight: isMe ? 800 : 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                {row.username}
              </span>
            </div>

            <div style={{ color: "rgba(255,255,255,.4)", fontSize: 10, fontFamily: "'Barlow',sans-serif", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", textAlign: "right" }}>
              {row.teamName}
            </div>
            <div style={{ color: "rgba(255,255,255,.5)", fontSize: 12, fontWeight: 700, textAlign: "right", fontFamily: "'Barlow',sans-serif" }}>
              {row.latestGwPoints}
            </div>
            <div style={{ color: isMe ? ACCENT : "rgba(255,255,255,.88)", fontSize: 14, fontWeight: 900, textAlign: "right" }}>
              {row.totalPoints}
            </div>
          </div>
        );
      })}
    </div>
  );
}
