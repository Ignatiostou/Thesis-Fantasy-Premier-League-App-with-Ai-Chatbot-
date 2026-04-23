"use client";

import { ACCENT, GOLD, POS_COLOR, POS_LABEL } from "@/lib/constants";
import { TeamPlayer } from "@/lib/types";

export default function MiniPitch({ picks }: { picks: TeamPlayer[] }) {
  if (!picks?.length) {
    return (
      <div style={{ color: "rgba(255,255,255,.18)", fontSize: 12, fontFamily: "'DM Sans',sans-serif", textAlign: "center", padding: "20px 0" }}>
        No squad data yet
      </div>
    );
  }

  const starters = picks.filter((p) => !p.isOnBench);
  const byPos: Record<number, TeamPlayer[]> = { 1: [], 2: [], 3: [], 4: [] };
  starters.forEach((p) => { (byPos[p.position] = byPos[p.position] || []).push(p); });

  return (
    <div style={{ background: "linear-gradient(180deg, rgba(0,255,135,.03) 0%, transparent 100%)", borderRadius: 16, padding: "16px 10px", border: "1px solid rgba(0,255,135,.08)" }}>
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {[1, 2, 3, 4].map((pos) => {
          const row = byPos[pos] ?? [];
          if (!row.length) return null;
          const pc = POS_COLOR[pos];
          return (
            <div key={pos} style={{ display: "flex", justifyContent: "center", gap: 8, flexWrap: "wrap" }}>
              {row.map((p) => (
                <div key={p.id ?? p.playerId} style={{
                  position: "relative",
                  background: `linear-gradient(145deg, ${pc}12, ${pc}06)`,
                  border: `1px solid ${p.isCaptain ? GOLD + "55" : pc + "25"}`,
                  borderRadius: 10, padding: "7px 10px", textAlign: "center", minWidth: 54,
                }}>
                  {p.isCaptain && (
                    <div style={{
                      position: "absolute", top: -6, right: -6, width: 16, height: 16, borderRadius: "50%",
                      background: `linear-gradient(135deg, ${GOLD}, #fbbf24)`,
                      display: "flex", alignItems: "center", justifyContent: "center",
                      fontSize: 7, fontWeight: 900, color: "#0a0e1a", boxShadow: `0 0 8px ${GOLD}60`,
                    }}>C</div>
                  )}
                  {p.isViceCaptain && !p.isCaptain && (
                    <div style={{
                      position: "absolute", top: -6, right: -6, width: 16, height: 16, borderRadius: "50%",
                      background: "#475569", display: "flex", alignItems: "center", justifyContent: "center",
                      fontSize: 7, fontWeight: 900, color: "white",
                    }}>V</div>
                  )}
                  <div style={{ color: pc, fontSize: 7, fontWeight: 700, letterSpacing: ".15em", fontFamily: "'DM Sans',sans-serif", marginBottom: 3 }}>
                    {POS_LABEL[pos]}
                  </div>
                  <div style={{ color: "rgba(255,255,255,.85)", fontSize: 10, fontWeight: 700, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", maxWidth: 52, fontFamily: "'DM Sans',sans-serif" }}>
                    {p.webName}
                  </div>
                  {p.eventPoints != null && (
                    <div style={{ color: ACCENT, fontSize: 11, fontWeight: 800, marginTop: 2, fontFamily: "'Bebas Neue',sans-serif", letterSpacing: ".05em" }}>
                      {p.eventPoints}
                    </div>
                  )}
                </div>
              ))}
            </div>
          );
        })}
      </div>
    </div>
  );
}
