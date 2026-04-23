"use client";
// src/features/squad-builder/PitchSlot.tsx

import { POS_COLOR, POS_LABEL } from "@/lib/constants";

interface FplPlayer {
  id: number;
  webName: string;
  position: 1 | 2 | 3 | 4;
  nowCost: number;
  totalPoints: number | null;
  status: string;
  chanceOfPlayingNextRound: number | null;
  team: { id: number; name: string; shortName: string };
}

interface SquadPlayer extends FplPlayer {
  isCaptain: boolean;
  isViceCaptain: boolean;
}

interface Props {
  player: SquadPlayer | null;
  posId: number;
  isCaptain?: boolean;
  isViceCaptain?: boolean;
  onRemove: (id: number) => void;
  isEmpty: boolean;
}

export default function PitchSlot({ player, posId, isCaptain, isViceCaptain, onRemove, isEmpty }: Props) {
  const c = POS_COLOR[posId];

  if (isEmpty) {
    return (
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 4, width: 76 }}>
        <div style={{
          width: 58, height: 58, borderRadius: "50%",
          border: `2px dashed ${c}38`, background: `${c}07`,
          display: "flex", alignItems: "center", justifyContent: "center",
          fontSize: 20, color: `${c}38`,
        }}>+</div>
        <div style={{ fontSize: 9, color: `${c}48`, fontWeight: 800, letterSpacing: "0.1em" }}>
          {POS_LABEL[posId]}
        </div>
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 4, width: 76 }}>
      <div style={{ position: "relative" }}>
        {/* Spinning ring */}
        <div style={{
          position: "absolute", inset: -4, borderRadius: "50%",
          background: `conic-gradient(${c}58, transparent 55%, ${c}58)`,
          animation: "rot 7s linear infinite", opacity: 0.65,
        }} />
        {/* Avatar */}
        <div style={{
          position: "relative", width: 58, height: 58, borderRadius: "50%",
          background: `linear-gradient(145deg, ${c}44, ${c}18)`,
          border: `2px solid ${c}88`,
          display: "flex", alignItems: "center", justifyContent: "center",
          fontSize: 11, fontWeight: 900, color: "white",
          boxShadow: `0 0 18px ${c}44, inset 0 1px 0 rgba(255,255,255,.15)`,
        }}>
          {player!.webName.slice(0, 3).toUpperCase()}
        </div>

        {/* Captain badge */}
        {isCaptain && (
          <div style={{
            position: "absolute", top: -3, right: -3, width: 18, height: 18, borderRadius: "50%",
            background: "linear-gradient(135deg,#f59e0b,#fbbf24)", border: "2px solid #0a0e1a",
            display: "flex", alignItems: "center", justifyContent: "center",
            fontSize: 8, fontWeight: 900, color: "#0a0e1a", boxShadow: "0 0 8px #f59e0b88",
          }}>C</div>
        )}
        {isViceCaptain && (
          <div style={{
            position: "absolute", top: -3, right: -3, width: 18, height: 18, borderRadius: "50%",
            background: "linear-gradient(135deg,#94a3b8,#cbd5e1)", border: "2px solid #0a0e1a",
            display: "flex", alignItems: "center", justifyContent: "center",
            fontSize: 8, fontWeight: 900, color: "#0a0e1a",
          }}>V</div>
        )}

        {/* Remove button */}
        <button
          onClick={() => onRemove(player!.id)}
          style={{
            position: "absolute", top: -3, left: -3, width: 16, height: 16, borderRadius: "50%",
            background: "rgba(239,68,68,.85)", border: "1.5px solid #0a0e1a",
            display: "flex", alignItems: "center", justifyContent: "center",
            fontSize: 10, fontWeight: 900, color: "white", cursor: "pointer", lineHeight: 1,
          }}
        >×</button>
      </div>

      {/* Name tag */}
      <div style={{
        background: "rgba(0,0,0,.7)", backdropFilter: "blur(8px)",
        borderRadius: 7, padding: "3px 8px", maxWidth: 76,
        border: `1px solid ${c}33`,
      }}>
        <div style={{ fontSize: 10, fontWeight: 800, color: "rgba(255,255,255,.95)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", textAlign: "center" }}>
          {player!.webName}
        </div>
        <div style={{ fontSize: 9, textAlign: "center", fontWeight: 700, lineHeight: 1.3, fontFamily: "'Barlow',sans-serif", color: c }}>
          £{(player!.nowCost / 10).toFixed(1)}m
        </div>
      </div>
    </div>
  );
}
