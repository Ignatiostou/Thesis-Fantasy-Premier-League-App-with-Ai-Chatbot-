"use client";


import { POS_COLOR, POS_LABEL, STATUS_COLOR } from "@/lib/constants";

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

interface Props {
  player: FplPlayer;
  isSelected: boolean;
  canAdd: boolean;
  onToggle: (p: FplPlayer) => void;
}

export default function PlayerRow({ player, isSelected, canAdd, onToggle }: Props) {
  const c           = POS_COLOR[player.position];
  const statusColor = STATUS_COLOR[player.status] ?? STATUS_COLOR.u;
  const clickable   = canAdd || isSelected;

  return (
    <button
      onClick={() => clickable && onToggle(player)}
      disabled={!clickable}
      style={{
        display: "grid", gridTemplateColumns: "18px 1fr 38px 20px",
        alignItems: "center", gap: 6, padding: "7px 9px", borderRadius: 8,
        width: "100%", textAlign: "left",
        cursor: clickable ? "pointer" : "not-allowed",
        border: isSelected ? `1px solid ${c}55` : "1px solid rgba(255,255,255,.05)",
        background: isSelected ? `${c}0d` : "rgba(255,255,255,.018)",
        opacity: clickable ? 1 : 0.28,
        transition: "all .12s",
        fontFamily: "'Barlow Condensed',sans-serif",
      }}
    >
      {/* Position badge */}
      <div style={{
        width: 16, height: 16, borderRadius: 4,
        background: `${c}20`, border: `1px solid ${c}40`,
        display: "flex", alignItems: "center", justifyContent: "center",
        fontSize: 7, fontWeight: 900, color: c, flexShrink: 0,
      }}>
        {POS_LABEL[player.position]}
      </div>

      {/* Name + club */}
      <div style={{ minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
          <span style={{ color: "white", fontSize: 11, fontWeight: 700, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", lineHeight: 1.2 }}>
            {player.webName}
          </span>
          {player.status !== "a" && (
            <span style={{ width: 4, height: 4, borderRadius: "50%", background: statusColor, flexShrink: 0 }} />
          )}
        </div>
        <div style={{ color: "#374f62", fontSize: 9, fontFamily: "'Barlow',sans-serif", lineHeight: 1 }}>
          {player.team.shortName} · £{(player.nowCost / 10).toFixed(1)}m
        </div>
      </div>

      {/* Season points */}
      <div style={{ textAlign: "right", color: "#374f62", fontSize: 9, fontWeight: 700 }}>
        {player.totalPoints ?? 0}
      </div>

      {/* Add / remove toggle */}
      <div style={{
        width: 18, height: 18, borderRadius: "50%",
        background: isSelected ? "#ef444418" : `${c}18`,
        border: `1.5px solid ${isSelected ? "#ef4444" : c}`,
        display: "flex", alignItems: "center", justifyContent: "center",
        fontSize: 13, fontWeight: 900,
        color: isSelected ? "#ef4444" : c,
        flexShrink: 0, transition: "all .12s",
      }}>
        {isSelected ? "−" : "+"}
      </div>
    </button>
  );
}
