"use client";

import { TeamPlayer,Props } from "@/lib/types";
import { POS_COLOR, POS_LABEL } from "@/lib/constants";



export default function ContextMenu({ player, x, y, onAction }: Props) {
  const c     = POS_COLOR[player.position];
  const safeX = Math.min(x, (typeof window !== "undefined" ? window.innerWidth  : 900) - 215);
  const safeY = Math.min(y, (typeof window !== "undefined" ? window.innerHeight : 700) - 240);

  const btnStyle = (color: string): React.CSSProperties => ({
    display: "flex", alignItems: "center", gap: 10,
    width: "100%", padding: "9px 14px",
    background: "transparent", border: "none", cursor: "pointer",
    color, fontFamily: "'Barlow Condensed',sans-serif",
    fontWeight: 700, fontSize: 12, letterSpacing: "0.05em", textAlign: "left",
  });

  return (
    <div
      onClick={(e) => e.stopPropagation()}
      style={{
        position: "fixed", left: safeX, top: safeY, zIndex: 1000,
        background: "rgba(7,10,20,.97)", backdropFilter: "blur(24px)",
        border: `1px solid ${c}33`, borderRadius: 14,
        padding: "8px 0", minWidth: 204,
        boxShadow: `0 24px 64px rgba(0,0,0,.65),0 0 0 1px rgba(255,255,255,.04),0 0 40px ${c}14`,
        animation: "ctxIn .14s cubic-bezier(.16,1,.3,1) both",
      }}
    >
      {/* Header */}
      <div style={{ padding: "8px 14px 10px", borderBottom: "1px solid rgba(255,255,255,.07)", marginBottom: 4 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
          <div style={{
            width: 30, height: 30, borderRadius: "50%",
            background: `${c}22`, border: `1.5px solid ${c}55`,
            display: "flex", alignItems: "center", justifyContent: "center",
            fontSize: 10, fontWeight: 900, color: c,
          }}>
            {player.webName.slice(0, 2).toUpperCase()}
          </div>
          <div>
            <div style={{ color: "white", fontWeight: 900, fontSize: 13 }}>{player.webName}</div>
            <div style={{ color: c, fontSize: 9, fontWeight: 700, letterSpacing: "0.06em" }}>
              {player.team.shortName} · {POS_LABEL[player.position]}
              {player.eventPoints !== null && (
                <span style={{ color: "#475569", marginLeft: 6 }}>{player.eventPoints} pts</span>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Captain / VC — starters only */}
      {!player.isOnBench && (
        <>
          <button
            onClick={() => onAction("captain", player)}
            onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = "#f59e0b14"; }}
            onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = "transparent"; }}
            style={btnStyle("#f59e0b")}
          >
            <span style={{ width: 18, textAlign: "center", fontSize: 14 }}>🎖️</span>
            {player.isCaptain ? "Remove Captain" : "Make Captain"}
          </button>
          <button
            onClick={() => onAction("vice_captain", player)}
            onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = "#94a3b814"; }}
            onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = "transparent"; }}
            style={btnStyle("#94a3b8")}
          >
            <span style={{ width: 18, textAlign: "center", fontSize: 14 }}>🥈</span>
            {player.isViceCaptain ? "Remove Vice Captain" : "Make Vice Captain"}
          </button>
        </>
      )}

      {/* Sub */}
      <button
        onClick={() => onAction("sub", player)}
        onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = `${c}14`; }}
        onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = "transparent"; }}
        style={btnStyle(c)}
      >
        <span style={{ width: 18, textAlign: "center", fontSize: 14 }}>
          {player.isOnBench ? "⬆️" : "⬇️"}
        </span>
        {player.isOnBench ? "Bring on Field" : "Move to Bench"}
      </button>

      <div style={{ height: 1, background: "rgba(255,255,255,.07)", margin: "4px 0" }} />

      <button
        onClick={() => onAction("cancel", player)}
        onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.color = "white"; }}
        onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.color = "#475569"; }}
        style={{ ...btnStyle("#475569"), fontWeight: 600, fontSize: 11 }}
      >
        <span style={{ width: 18, textAlign: "center", fontSize: 12 }}>✕</span>
        Cancel
      </button>
    </div>
  );
}
