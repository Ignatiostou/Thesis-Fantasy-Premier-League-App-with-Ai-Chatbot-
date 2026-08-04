"use client";
import { TeamPlayer,SlotProps } from "@/lib/types";
import { ACCENT, POS_COLOR, STATUS_COLOR, fmtShort } from "@/lib/constants";


export function canSwap(a: TeamPlayer, b: TeamPlayer): boolean {
  if (a.position === 1 || b.position === 1) return a.position === 1 && b.position === 1;
  return true;
}

export function legalFormation(picks: TeamPlayer[]): boolean {
  const starters = picks.filter((p) => !p.isOnBench);
  const m: Record<number, number> = {};
  starters.forEach((p) => { m[p.position] = (m[p.position] ?? 0) + 1; });
  return (m[1] ?? 0) === 1 && (m[2] ?? 0) >= 3 && (m[3] ?? 0) >= 2 && (m[4] ?? 0) >= 1;
}



export default function PlayerSlot({ 
  player, 
  subSrc, 
  subMode, 
  benchBoost, 
  onClick,
  onDragStart,
  onDragOver,
  onDragLeave,
  onDrop,
  onDragEnd,
  isDragging = false,
  isDragOver = false,
}: SlotProps) {
  const c       = POS_COLOR[player.position];
  const sc      = STATUS_COLOR[player.status] ?? STATUS_COLOR.u;
  const isSrc   = subSrc?.id === player.id;
  const isTarget = subMode && subSrc && subSrc.id !== player.id && canSwap(subSrc, player);
  const canDrop = isDragOver && !isDragging;
  const ep      = player.eventPoints;
  const displayPts = ep !== null ? (player.isCaptain && !benchBoost ? ep * 2 : ep) : null;

  return (
    <div
      className="pslot"
      draggable
      onDragStart={(e) => onDragStart?.(player, e)}
      onDragOver={(e) => onDragOver?.(player, e)}
      onDragLeave={(e) => onDragLeave?.(player, e)}
      onDrop={(e) => onDrop?.(player, e)}
      onDragEnd={onDragEnd}
      onClick={(e) => { e.stopPropagation(); onClick(player, e); }}
      style={{
        display: "flex", flexDirection: "column", alignItems: "center",
        gap: 4, width: 78, cursor: isDragging ? "grabbing" : "grab", position: "relative", userSelect: "none",
        opacity: isDragging ? 0.5 : 1,
        transform: isDragging ? "scale(0.95)" : "scale(1)",
        transition: "transform 0.15s, opacity 0.15s",
      }}
    >
      {(isTarget || canDrop) && (
        <div style={{
          position: "absolute", inset: -7, borderRadius: "50%",
          border: `2px solid ${c}`, boxShadow: `0 0 16px ${c}66`,
          animation: "halo 1.1s ease-in-out infinite", pointerEvents: "none", zIndex: 2,
        }} />
      )}
      {isSrc && (
        <div style={{
          position: "absolute", inset: -5, borderRadius: "50%",
          border: `2px solid ${ACCENT}`, boxShadow: `0 0 20px ${ACCENT}55`,
          animation: "halo .9s ease-in-out infinite", pointerEvents: "none", zIndex: 2,
        }} />
      )}

      <div style={{ position: "relative" }}>
        <div style={{
          position: "absolute", inset: -3, borderRadius: "50%",
          background: isSrc
            ? `conic-gradient(${ACCENT},#00d4ff,${ACCENT})`
            : (isTarget || canDrop) ? `conic-gradient(${c}88,transparent 55%,${c}88)`
            : `conic-gradient(${c}44,transparent 50%,${c}44)`,
          animation: "rot 6s linear infinite",
          opacity: isSrc ? 1 : (isTarget || canDrop) ? 0.9 : 0.65,
        }} />
        <div className="pslot-circle" style={{
          position: "relative", width: 54, height: 54, borderRadius: "50%",
          background: isSrc
            ? `linear-gradient(145deg,${ACCENT}55,${ACCENT}22)`
            : (isTarget || canDrop) ? `linear-gradient(145deg,${c}44,${c}18)`
            : `linear-gradient(145deg,${c}33,${c}11)`,
          border: `2px solid ${isSrc ? ACCENT : c}88`,
          display: "flex", alignItems: "center", justifyContent: "center",
          fontSize: 10, fontWeight: 900, color: "white",
          boxShadow: isSrc
            ? `0 0 24px ${ACCENT}55,inset 0 1px 0 rgba(255,255,255,.2)`
            : `0 0 12px ${c}22,inset 0 1px 0 rgba(255,255,255,.1)`,
          transition: "all .22s",
        }}>
          {player.webName.slice(0, 3).toUpperCase()}
        </div>

        {player.isCaptain && (
          <div style={{
            position: "absolute", top: -3, right: -3, width: 17, height: 17,
            borderRadius: "50%", background: "linear-gradient(135deg,#f59e0b,#fbbf24)",
            border: "2px solid #0a0e1a", display: "flex", alignItems: "center",
            justifyContent: "center", fontSize: 8, fontWeight: 900, color: "#0a0e1a",
            boxShadow: "0 0 8px #f59e0b88",
          }}>C</div>
        )}
        {player.isViceCaptain && (
          <div style={{
            position: "absolute", top: -3, right: -3, width: 17, height: 17,
            borderRadius: "50%", background: "linear-gradient(135deg,#94a3b8,#cbd5e1)",
            border: "2px solid #0a0e1a", display: "flex", alignItems: "center",
            justifyContent: "center", fontSize: 8, fontWeight: 900, color: "#0a0e1a",
          }}>V</div>
        )}
        {player.status !== "a" && (
          <div style={{
            position: "absolute", bottom: 0, left: 0, width: 10, height: 10,
            borderRadius: "50%", background: sc, border: "2px solid #0a0e1a",
          }} />
        )}
      </div>

      <div className="pslot-tag" style={{
        background: isSrc ? `linear-gradient(135deg,${ACCENT}28,${ACCENT}14)` : (isTarget || canDrop) ? `${c}18` : "rgba(0,0,0,.65)",
        backdropFilter: "blur(8px)", borderRadius: 7, padding: "3px 8px", maxWidth: 76,
        border: isSrc ? `1px solid ${ACCENT}44` : (isTarget || canDrop) ? `1px solid ${c}44` : "1px solid rgba(255,255,255,.07)",
        transition: "all .2s",
      }}>
        <div style={{
          fontSize: 10, fontWeight: 800,
          color: isSrc ? ACCENT : (isTarget || canDrop) ? c : "rgba(255,255,255,.95)",
          whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", textAlign: "center",
        }}>
          {player.webName}
        </div>
        <div style={{
          fontSize: 9, textAlign: "center", fontWeight: 700, lineHeight: 1.3,
          fontFamily: "'Barlow',sans-serif",
          color: displayPts !== null && displayPts > 0 ? ACCENT : "rgba(255,255,255,.55)",
        }}>
          {displayPts !== null ? `${displayPts} pts` : fmtShort(player.nowCost)}
        </div>
      </div>
    </div>
  );
}
