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
        display: "grid", gridTemplateColumns: "19px 1fr 42px 21px",
        alignItems: "center", gap: 8, padding: "8px 10px", borderRadius: 8,
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
        width: 18, height: 18, borderRadius: 4,
        background: `${c}20`, border: `1px solid ${c}40`,
        display: "flex", alignItems: "center", justifyContent: "center",
        fontSize: 8, fontWeight: 900, color: c, flexShrink: 0,
      }}>
        {POS_LABEL[player.position]}
      </div>

      {/* Name + club + price */}
      <div style={{ minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
          <span style={{ color: "#ffffff", fontSize: 13.5, fontWeight: 700, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", lineHeight: 1.25, letterSpacing: ".01em" }}>
            {player.webName}
          </span>
          {player.status !== "a" && (
            <span style={{ width: 4.5, height: 4.5, borderRadius: "50%", background: statusColor, flexShrink: 0 }} />
          )}
        </div>
        <div style={{ display: "flex", alignItems: "baseline", gap: 5, marginTop: 2, fontFamily: "'Barlow',sans-serif", lineHeight: 1 }}>
          <span style={{ color: "#8ea9bd", fontSize: 10.5, fontWeight: 500 }}>
            {player.team.shortName}
          </span>
          <span style={{ color: "#3d5568", fontSize: 10 }}>·</span>
          {/* Price gets its own weight/colour — it is a primary decision input,
              not secondary metadata like the club abbreviation. */}
          <span style={{ color: "#e8f1f7", fontSize: 11.5, fontWeight: 700 }}>
            £{(player.nowCost / 10).toFixed(1)}m
          </span>
        </div>
      </div>

      {/* Last season's points — the total FPL carries over, so it reads 0 for
          everyone until the first gameweek is scored, then climbs weekly. */}
      <div style={{ textAlign: "right", lineHeight: 1 }}>
        <div style={{ color: "#e8f1f7", fontSize: 13.5, fontWeight: 800 }}>
          {player.totalPoints ?? 0}
        </div>
        <div style={{ color: "#5b7386", fontSize: 7.5, fontWeight: 700, letterSpacing: ".14em", marginTop: 2 }}>
          PTS
        </div>
      </div>

      {/* Add / remove toggle */}
      <div style={{
        width: 20, height: 20, borderRadius: "50%",
        background: isSelected ? "#ef444418" : `${c}18`,
        border: `1.5px solid ${isSelected ? "#ef4444" : c}`,
        display: "flex", alignItems: "center", justifyContent: "center",
        fontSize: 14, fontWeight: 900,
        color: isSelected ? "#ef4444" : c,
        flexShrink: 0, transition: "all .12s",
      }}>
        {isSelected ? "−" : "+"}
      </div>
    </button>
  );
}
