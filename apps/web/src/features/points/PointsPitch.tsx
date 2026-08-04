"use client";
// src/features/points/PointsPitch.tsx

import { PickBreakdown } from "@/lib/types";
import PointsPitchSlot from "./PointsPitchSlot";
import { POS_COLOR } from "@/lib/constants";

interface Props {
  breakdown: PickBreakdown[];
}

function BenchPlayer({ pick }: { pick: PickBreakdown }) {
  const posColor = POS_COLOR[pick.position] ?? "white";
  
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 10,
        padding: "12px 16px",
        background: "rgba(255,255,255,.04)",
        border: "1.5px solid rgba(255,255,255,.1)",
        borderRadius: 10,
        opacity: 0.85,
      }}
    >
      <div
        style={{
          width: 10,
          height: 10,
          borderRadius: "50%",
          background: posColor,
          boxShadow: `0 0 8px ${posColor}66`,
          flexShrink: 0,
        }}
      />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div
          style={{
            fontSize: 13,
            fontWeight: 800,
            color: "rgba(255,255,255,.85)",
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
          }}
        >
          {pick.webName}
        </div>
        <div
          style={{
            fontSize: 10,
            color: "rgba(255,255,255,.5)",
            fontFamily: "'Barlow',sans-serif",
            fontWeight: 600,
          }}
        >
          {pick.teamShortName}
        </div>
      </div>
      <div
        style={{
          fontSize: 16,
          fontWeight: 900,
          color: "rgba(255,255,255,.5)",
        }}
      >
        {pick.basePoints}
      </div>
    </div>
  );
}

export default function PointsPitch({ breakdown }: Props) {
  const starters = breakdown.filter((p) => !p.isOnBench);
  const bench = breakdown.filter((p) => p.isOnBench);

  const gk = starters.filter((p) => p.position === 1);
  const def = starters.filter((p) => p.position === 2);
  const mid = starters.filter((p) => p.position === 3);
  const fwd = starters.filter((p) => p.position === 4);

  return (
    <>
      <div
        className="pp-pitch"
        style={{
          background: "linear-gradient(180deg, rgba(34,197,94,.15) 0%, rgba(16,185,129,.08) 50%, rgba(34,197,94,.15) 100%)",
          border: "2px solid rgba(16,185,129,.25)",
          borderRadius: 20,
          padding: "42px 28px",
          position: "relative",
          overflow: "hidden",
          boxShadow: "0 8px 32px rgba(16,185,129,.15), inset 0 1px 0 rgba(255,255,255,.1)",
        }}
      >
        {/* Pitch lines */}
        <div
          style={{
            position: "absolute",
            inset: 0,
            opacity: 0.2,
            pointerEvents: "none",
          }}
        >
          <div
            style={{
              position: "absolute",
              top: "50%",
              left: 0,
              right: 0,
              height: 2,
              background: "rgba(255,255,255,.6)",
              boxShadow: "0 0 10px rgba(255,255,255,.3)",
            }}
          />
          <div
            style={{
              position: "absolute",
              top: "50%",
              left: "50%",
              transform: "translate(-50%, -50%)",
              width: 100,
              height: 100,
              border: "2px solid rgba(255,255,255,.6)",
              borderRadius: "50%",
              boxShadow: "0 0 10px rgba(255,255,255,.3)",
            }}
          />
        </div>

        <div className="pp-rows" style={{ position: "relative", display: "flex", flexDirection: "column", gap: 32 }}>
          {/* GK */}
          {gk.length > 0 && (
            <div className="pp-row" style={{ display: "flex", justifyContent: "center", gap: 24 }}>
              {gk.map((p) => (
                <PointsPitchSlot key={p.playerId} pick={p} />
              ))}
            </div>
          )}

          {/* DEF */}
          {def.length > 0 && (
            <div className="pp-row" style={{ display: "flex", justifyContent: "center", gap: 24, flexWrap: "wrap" }}>
              {def.map((p) => (
                <PointsPitchSlot key={p.playerId} pick={p} />
              ))}
            </div>
          )}

          {/* MID */}
          {mid.length > 0 && (
            <div className="pp-row" style={{ display: "flex", justifyContent: "center", gap: 24, flexWrap: "wrap" }}>
              {mid.map((p) => (
                <PointsPitchSlot key={p.playerId} pick={p} />
              ))}
            </div>
          )}

          {/* FWD */}
          {fwd.length > 0 && (
            <div className="pp-row" style={{ display: "flex", justifyContent: "center", gap: 24, flexWrap: "wrap" }}>
              {fwd.map((p) => (
                <PointsPitchSlot key={p.playerId} pick={p} />
              ))}
            </div>
          )}
        </div>
      </div>

      <div
        style={{
          color: "rgba(255,255,255,.45)",
          fontSize: 10,
          fontWeight: 800,
          letterSpacing: ".25em",
          padding: "0 6px",
          fontFamily: "'Barlow',sans-serif",
          textTransform: "uppercase",
        }}
      >
        BENCH
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 10 }}>
        {bench.map((p) => (
          <BenchPlayer key={p.playerId} pick={p} />
        ))}
      </div>
    </>
  );
}
