"use client";
// src/features/points/PointsPitchSlot.tsx

import { ACCENT, POS_COLOR } from "@/lib/constants";
import { PickBreakdown } from "@/lib/types";

interface Props {
  pick: PickBreakdown;
}

export default function PointsPitchSlot({ pick }: Props) {
  const posColor = POS_COLOR[pick.position] ?? "white";

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: 6,
        position: "relative",
      }}
    >
      {pick.isCaptain && (
        <div
          style={{
            position: "absolute",
            top: -12,
            left: "50%",
            transform: "translateX(-50%)",
            width: 28,
            height: 28,
            borderRadius: "50%",
            background: "linear-gradient(135deg,#f59e0b,#fbbf24)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: 14,
            fontWeight: 900,
            color: "#0a0e1a",
            border: "3px solid #0a0e1a",
            zIndex: 2,
            boxShadow: "0 4px 16px rgba(245,158,11,.5)",
          }}
        >
          C
        </div>
      )}
      {pick.isViceCaptain && (
        <div
          style={{
            position: "absolute",
            top: -12,
            left: "50%",
            transform: "translateX(-50%)",
            width: 28,
            height: 28,
            borderRadius: "50%",
            background: "linear-gradient(135deg,#64748b,#94a3b8)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: 14,
            fontWeight: 900,
            color: "white",
            border: "3px solid #0a0e1a",
            zIndex: 2,
            boxShadow: "0 4px 16px rgba(100,116,139,.5)",
          }}
        >
          V
        </div>
      )}
      
      <div
        className="pp-circle"
        style={{
          width: 90,
          height: 90,
          borderRadius: "50%",
          background: `linear-gradient(135deg, ${posColor}33, ${posColor}66)`,
          border: `4px solid ${posColor}`,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          position: "relative",
          boxShadow: `0 8px 24px ${posColor}55, 0 0 48px ${posColor}22`,
          transition: "transform .2s ease",
        }}
      >
        <div
          className="pp-pts"
          style={{
            position: "absolute",
            top: -4,
            right: -4,
            minWidth: 32,
            height: 32,
            borderRadius: "50%",
            background: pick.counted && pick.finalPoints > 0 ? `linear-gradient(135deg, ${ACCENT}, #10b981)` : "rgba(255,255,255,.2)",
            border: "3px solid #0a0e1a",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: 15,
            fontWeight: 900,
            color: pick.counted && pick.finalPoints > 0 ? "#0a0e1a" : "rgba(255,255,255,.6)",
            padding: "0 6px",
            boxShadow: pick.counted && pick.finalPoints > 0 ? `0 4px 16px ${ACCENT}88` : "none",
          }}
        >
          {pick.counted ? pick.finalPoints : "—"}
        </div>
        
        <div style={{ textAlign: "center", padding: "0 8px" }}>
          <div
            className="pp-name"
            style={{
              fontSize: 13,
              fontWeight: 900,
              color: "white",
              textTransform: "uppercase",
              lineHeight: 1.1,
              marginBottom: 3,
              textShadow: "0 2px 8px rgba(0,0,0,.7)",
            }}
          >
            {pick.webName}
          </div>
          <div
            style={{
              fontSize: 10,
              color: "rgba(255,255,255,.85)",
              fontFamily: "'Barlow',sans-serif",
              fontWeight: 600,
              textShadow: "0 1px 4px rgba(0,0,0,.6)",
            }}
          >
            {pick.teamShortName}
          </div>
        </div>
      </div>
      
      <div style={{ display: "flex", gap: 4, flexWrap: "wrap", justifyContent: "center" }}>
        {pick.wasAutoSubbedIn && (
          <div
            style={{
              fontSize: 8,
              color: ACCENT,
              background: `${ACCENT}28`,
              borderRadius: 5,
              padding: "2px 6px",
              fontFamily: "'Barlow',sans-serif",
              fontWeight: 700,
              border: `1px solid ${ACCENT}`,
            }}
          >
            IN↑
          </div>
        )}
        {pick.wasAutoSubbedOut && (
          <div
            style={{
              fontSize: 8,
              color: "#ff6b6b",
              background: "rgba(255,107,107,.15)",
              borderRadius: 5,
              padding: "2px 6px",
              fontFamily: "'Barlow',sans-serif",
              fontWeight: 700,
              border: "1px solid #ff6b6b",
            }}
          >
            OUT↓
          </div>
        )}
      </div>
    </div>
  );
}
