"use client";
// src/features/leagues/LeagueCard.tsx

import { ACCENT } from "@/lib/constants";
import { League } from "@/lib/types";

const typeColor = (type: string) => type === "HEAD_TO_HEAD" ? "#f59e0b" : "#38bdf8";
const typeLabel = (type: string) => type === "HEAD_TO_HEAD" ? "H2H" : "Classic";

interface Props {
  league: League;
  selected: boolean;
  onClick: () => void;
}

export default function LeagueCard({ league, selected, onClick }: Props) {
  const tc = typeColor(league.type);
  return (
    <div onClick={onClick} style={{
      padding: "14px 16px", borderRadius: 12, cursor: "pointer", transition: "all .18s",
      border: `1px solid ${selected ? ACCENT + "44" : "rgba(255,255,255,.08)"}`,
      background: selected ? `${ACCENT}0e` : "rgba(255,255,255,.03)",
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 5 }}>
        <span style={{ background: tc + "22", border: `1px solid ${tc}44`, borderRadius: 5, padding: "2px 7px", color: tc, fontSize: 9, fontWeight: 800, letterSpacing: ".12em" }}>
          {typeLabel(league.type)}
        </span>
      </div>
      <div style={{ color: selected ? ACCENT : "rgba(255,255,255,.88)", fontSize: 14, fontWeight: 900, letterSpacing: ".03em", marginBottom: 3 }}>
        {league.name}
      </div>
      <div style={{ color: "rgba(255,255,255,.6)", fontSize: 11, fontFamily: "'Barlow',sans-serif" }}>
        Code: <span style={{ color: "rgba(255,255,255,.85)", fontWeight: 600 }}>{league.code}</span>
      </div>
    </div>
  );
}
