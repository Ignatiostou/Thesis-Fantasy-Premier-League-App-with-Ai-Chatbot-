"use client";

import { useEffect, useRef, useState } from "react";
import { useTransfersState } from "@/lib/hooks/useTransfersState";

// ── Constants ──────────────────────────────────────────────────────────────
const ACCENT = "#00FF87";
const ACCENT2 = "#00d4ff";
const POS_COLOR: Record<number, string> = {
  1: "#fde047",
  2: "#7dd3fc",
  3: ACCENT,
  4: "#fb923c",
};
const POS_LABEL: Record<number, string> = {
  1: "GK",
  2: "DEF",
  3: "MID",
  4: "FWD",
};
const STATUS_COLOR: Record<string, string> = {
  a: ACCENT,
  d: "#facc15",
  i: "#ef4444",
  s: "#f97316",
  u: "#64748b",
};
const fmt = (c: number) => `£${(c / 10).toFixed(1)}m`;

function PosTag({ pos }: { pos: number }) {
  const c = POS_COLOR[pos];
  return (
    <span
      style={{
        fontSize: 9,
        fontWeight: 900,
        color: c,
        background: `${c}18`,
        border: `1px solid ${c}35`,
        borderRadius: 4,
        padding: "1px 5px",
        letterSpacing: "0.08em",
        fontFamily: "'Barlow Condensed', sans-serif",
      }}
    >
      {POS_LABEL[pos]}
    </span>
  );
}

function StatusDot({ status }: { status: string }) {
  if (status === "a") return null;
  const label: Record<string, string> = {
    d: "Doubtful",
    i: "Injured",
    s: "Suspended",
    u: "Unavailable",
  };
  return (
    <span
      title={label[status] ?? "Unknown"}
      style={{
        width: 6,
        height: 6,
        borderRadius: "50%",
        background: STATUS_COLOR[status] ?? STATUS_COLOR.u,
        display: "inline-block",
        flexShrink: 0,
      }}
    />
  );
}

type PickShape = {
  playerId: number;
  webName: string;
  position: number;
  nowCost: number;
  buyPrice: number;
  status: string;
  teamShortName: string;
  isCaptain: boolean;
  isViceCaptain: boolean;
  isOnBench: boolean;
};

function SquadSlot({
  pick,
  isSelected,
  isOut,
  onSelect,
}: {
  pick: PickShape;
  isSelected: boolean;
  isOut: boolean;
  onSelect: (id: number) => void;
}) {
  const c = POS_COLOR[pick.position];
  const sellP = Math.min(pick.buyPrice, pick.nowCost);

  return (
    <button
      onClick={() => onSelect(pick.playerId)}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 9,
        padding: "8px 11px",
        borderRadius: 10,
        width: "100%",
        textAlign: "left",
        cursor: "pointer",
        border: isSelected
          ? `1.5px solid ${ACCENT}`
          : isOut
            ? `1.5px solid #ef4444`
            : `1px solid rgba(255,255,255,.07)`,
        background: isSelected
          ? `${ACCENT}12`
          : isOut
            ? `rgba(239,68,68,.08)`
            : `rgba(255,255,255,.025)`,
        transition: "all .15s",
        position: "relative",
        fontFamily: "'Barlow Condensed', sans-serif",
      }}
    >
      <div
        style={{
          width: 36,
          height: 36,
          borderRadius: "50%",
          background: `linear-gradient(145deg,${c}30,${c}10)`,
          border: `1.5px solid ${c}50`,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontSize: 10,
          fontWeight: 900,
          color: c,
          flexShrink: 0,
        }}
      >
        {pick.webName.slice(0, 3).toUpperCase()}
      </div>

      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
          <span
            style={{
              color: "white",
              fontSize: 13,
              fontWeight: 800,
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
            }}
          >
            {pick.webName}
          </span>
          <StatusDot status={pick.status} />
          {pick.isCaptain && (
            <span
              style={{
                fontSize: 9,
                fontWeight: 900,
                color: "#f59e0b",
                background: "#f59e0b18",
                border: "1px solid #f59e0b35",
                borderRadius: 4,
                padding: "1px 4px",
              }}
            >
              C
            </span>
          )}
          {pick.isViceCaptain && (
            <span
              style={{
                fontSize: 9,
                fontWeight: 900,
                color: "#94a3b8",
                background: "#94a3b818",
                border: "1px solid #94a3b835",
                borderRadius: 4,
                padding: "1px 4px",
              }}
            >
              V
            </span>
          )}
        </div>

        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 6,
            marginTop: 2,
          }}
        >
          <PosTag pos={pick.position} />
          <span
            style={{
              color: "#aaddee",
              fontSize: 11,
              fontWeight: 600,
              fontFamily: "'Barlow', sans-serif",
            }}
          >
            {pick.teamShortName}
          </span>
          <span
            style={{
              color: "#9abacc",
              fontSize: 11,
              fontWeight: 600,
              fontFamily: "'Barlow', sans-serif",
            }}
          >
            Sell {fmt(sellP)}
          </span>
        </div>
      </div>

      <div
        style={{
          color: isSelected ? ACCENT : isOut ? "#ef4444" : "#3a5a6a",
          fontSize: 14,
          fontWeight: 900,
          transition: "all .15s",
        }}
      >
        {isOut ? "↔" : isSelected ? "✓" : "→"}
      </div>

      {pick.isOnBench && (
        <div
          style={{
            position: "absolute",
            top: -4,
            right: -4,
            fontSize: 8,
            fontWeight: 900,
            color: "#0a0e1a",
            background: "#9abacc",
            borderRadius: 3,
            padding: "1px 4px",
          }}
        >
          SUB
        </div>
      )}
    </button>
  );
}

type MarketShape = {
  id: number;
  webName: string;
  position: 1 | 2 | 3 | 4;
  nowCost: number;
  status: string;
  totalPoints: number | null;
  chanceOfPlayingNextRound: number | null;
  team: { id: number; name: string; shortName: string };
};

function MarketRow({
  player,
  onSelect,
}: {
  player: MarketShape;
  onSelect: (id: number) => void;
}) {
  const c = POS_COLOR[player.position];
  const [hov, setHov] = useState(false);

  return (
    <button
      onClick={() => onSelect(player.id)}
      onMouseEnter={() => setHov(true)}
      onMouseLeave={() => setHov(false)}
      style={{
        display: "grid",
        gridTemplateColumns: "28px 1fr 42px 28px",
        alignItems: "center",
        gap: 8,
        padding: "8px 10px",
        borderRadius: 8,
        border: hov ? `1px solid ${c}40` : `1px solid rgba(255,255,255,.05)`,
        background: hov ? `${c}08` : `rgba(255,255,255,.02)`,
        cursor: "pointer",
        width: "100%",
        transition: "all .12s",
        fontFamily: "'Barlow Condensed', sans-serif",
      }}
    >
      <div
        style={{
          width: 26,
          height: 26,
          borderRadius: 6,
          background: `${c}18`,
          border: `1px solid ${c}35`,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontSize: 8,
          fontWeight: 900,
          color: c,
        }}
      >
        {POS_LABEL[player.position]}
      </div>

      <div style={{ minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
          <span
            style={{
              color: "white",
              fontSize: 13,
              fontWeight: 800,
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
            }}
          >
            {player.webName}
          </span>
          <StatusDot status={player.status} />
        </div>
        <div
          style={{
            color: "#aaddee",
            fontSize: 11,
            fontWeight: 600,
            fontFamily: "'Barlow', sans-serif",
          }}
        >
          {player.team.shortName} · {fmt(player.nowCost)}
        </div>
      </div>

      <div
        style={{
          textAlign: "right",
          color: "#aaddee",
          fontSize: 13,
          fontWeight: 800,
        }}
      >
        {player.totalPoints ?? 0}
        <div
          style={{
            color: "#5a7a8a",
            fontSize: 8,
            fontFamily: "'Barlow', sans-serif",
          }}
        >
          pts
        </div>
      </div>

      <div
        style={{
          width: 24,
          height: 24,
          borderRadius: "50%",
          background: hov ? `${c}30` : `${c}18`,
          border: `1.5px solid ${c}50`,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontSize: 14,
          fontWeight: 900,
          color: c,
          transition: "all .12s",
        }}
      >
        +
      </div>
    </button>
  );
}

type CartItemShape = {
  outPlayerId: number;
  outWebName: string;
  outSellPrice: number;
  inPlayerId: number;
  inWebName: string;
  inBuyPrice: number;
  isHit: boolean;
};

function CartItem({
  item,
  onRemove,
}: {
  item: CartItemShape;
  onRemove: (id: number) => void;
}) {
  const diff = item.inBuyPrice - item.outSellPrice;

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 6,
        padding: "9px 10px",
        borderRadius: 9,
        background: item.isHit ? "rgba(239,68,68,.06)" : `${ACCENT}08`,
        border: `1px solid ${item.isHit ? "rgba(239,68,68,.2)" : `${ACCENT}20`}`,
        fontFamily: "'Barlow Condensed', sans-serif",
      }}
    >
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
          <span
            style={{
              color: "#ef4444",
              fontSize: 12,
              fontWeight: 800,
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
            }}
          >
            {item.outWebName}
          </span>
          <span style={{ color: "#5a7a8a", fontSize: 10 }}>
            {fmt(item.outSellPrice)}
          </span>
        </div>

        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 4,
            marginTop: 2,
          }}
        >
          <span style={{ color: "#3a5a6a", fontSize: 10 }}>→</span>
          <span
            style={{
              color: ACCENT,
              fontSize: 12,
              fontWeight: 800,
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
            }}
          >
            {item.inWebName}
          </span>
          <span style={{ color: "#5a7a8a", fontSize: 10 }}>
            {fmt(item.inBuyPrice)}
          </span>
          {item.isHit && (
            <span
              style={{
                fontSize: 8,
                fontWeight: 900,
                color: "#ef4444",
                background: "rgba(239,68,68,.15)",
                border: "1px solid rgba(239,68,68,.3)",
                borderRadius: 3,
                padding: "1px 4px",
              }}
            >
              -4pts
            </span>
          )}
        </div>

        {item.outSellPrice > 0 && (
          <div
            style={{
              fontSize: 9,
              color: diff > 0 ? "#ef4444" : diff < 0 ? ACCENT : "#5a7a8a",
              fontFamily: "'Barlow', sans-serif",
              marginTop: 2,
            }}
          >
            {diff > 0
              ? `↑ costs ${fmt(diff)} more`
              : diff < 0
                ? `↓ saves ${fmt(-diff)}`
                : "same price"}
          </div>
        )}
      </div>

      <button
        onClick={() => onRemove(item.outPlayerId)}
        style={{
          width: 22,
          height: 22,
          borderRadius: "50%",
          background: "rgba(239,68,68,.12)",
          border: "1px solid rgba(239,68,68,.25)",
          color: "#ef4444",
          fontSize: 13,
          fontWeight: 900,
          cursor: "pointer",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          flexShrink: 0,
        }}
      >
        ×
      </button>
    </div>
  );
}

function HistoryRow({
  item,
}: {
  item: {
    id: string;
    gameweek: number;
    playerOutWebName: string;
    playerOutCost: number;
    playerInWebName: string;
    playerInCost: number;
    isHit: boolean;
    createdAt: string;
  };
}) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 8,
        padding: "8px 12px",
        borderRadius: 8,
        background: "rgba(255,255,255,.02)",
        border: "1px solid rgba(255,255,255,.05)",
        fontFamily: "'Barlow Condensed', sans-serif",
      }}
    >
      <div
        style={{
          width: 30,
          height: 30,
          borderRadius: 7,
          background: "rgba(255,255,255,.04)",
          border: "1px solid rgba(255,255,255,.08)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontSize: 8,
          fontWeight: 900,
          color: "#7a9aaa",
          flexShrink: 0,
        }}
      >
        GW{item.gameweek}
      </div>

      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
          <span style={{ color: "#ef4444", fontSize: 12, fontWeight: 700 }}>
            {item.playerOutWebName}
          </span>
          <span style={{ color: "#3a5a6a", fontSize: 10 }}>→</span>
          <span style={{ color: ACCENT, fontSize: 12, fontWeight: 700 }}>
            {item.playerInWebName}
          </span>
        </div>
        <div
          style={{
            color: "#5a7a8a",
            fontSize: 10,
            fontFamily: "'Barlow', sans-serif",
          }}
        >
          {fmt(item.playerOutCost)} → {fmt(item.playerInCost)} ·{" "}
          {new Date(item.createdAt).toLocaleDateString()}
        </div>
      </div>

      {item.isHit && (
        <span
          style={{
            fontSize: 9,
            fontWeight: 900,
            color: "#ef4444",
            background: "rgba(239,68,68,.12)",
            border: "1px solid rgba(239,68,68,.25)",
            borderRadius: 4,
            padding: "2px 6px",
          }}
        >
          HIT
        </span>
      )}
    </div>
  );
}

export default function TransfersPage() {
  const {
    loading,
    state,
    history,
    teams,
    selectedOutId,
    selectedOutPick,
    selectOut,
    cart,
    addTransfer,
    removeTransfer,
    clearCart,
    activeChip,
    toggleWildcard,
    preview,
    previewing,
    committing,
    commit,
    marketItems,
    marketLoading,
    search,
    setSearch,
    teamFilter,
    setTeamFilter,
    page,
    setPage,
    market,
  } = useTransfersState();

  const [tab, setTab] = useState<"squad" | "history">("squad");
  const [showConfirm, setShowConfirm] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (selectedOutId) searchRef.current?.focus();
  }, [selectedOutId]);

  const picks = state?.team?.picks ?? [];
  const gwState = state?.gwState;
  const isWildcard = activeChip === "wildcard";
  const cartOutIds = new Set(cart.map((t) => t.outPlayerId));

  const freeRemaining = gwState
    ? Math.max(0, gwState.freeTransfers - gwState.transfersMade)
    : 0;

  const freeAfterCart = isWildcard
    ? Infinity
    : Math.max(0, freeRemaining - cart.length);

  const starters = picks.filter((p) => !p.isOnBench);
  const bench = picks
    .filter((p) => p.isOnBench)
    .sort((a, b) => (a.benchOrder ?? 99) - (b.benchOrder ?? 99));

  const byPos: Record<number, typeof picks> = { 1: [], 2: [], 3: [], 4: [] };
  starters.forEach((p) => {
    byPos[p.position] = [...(byPos[p.position] ?? []), p];
  });

  const totalPages = market ? Math.ceil(market.total / 20) : 1;
  const canCommit =
    !!preview?.ok && cart.length > 0 && !committing && !previewing;

  const budgetDisplay =
    preview?.summary?.budgetLeftAfter ?? state?.team?.budgetLeft ?? 0;
  const hitDisplay =
    preview?.summary?.hitCostTotalAfter ?? gwState?.pointsHit ?? 0;

  const pageButtons = () => {
    if (totalPages <= 7)
      return Array.from({ length: totalPages }, (_, i) => i + 1);

    const btns: (number | "…")[] = [1];
    if (page > 3) btns.push("…");
    for (
      let i = Math.max(2, page - 1);
      i <= Math.min(totalPages - 1, page + 1);
      i++
    ) {
      btns.push(i);
    }
    if (page < totalPages - 2) btns.push("…");
    btns.push(totalPages);
    return btns;
  };

  if (loading) {
    return (
      <div
        style={{
          height: "100vh",
          background: "#0a0e1a",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <div
          style={{
            textAlign: "center",
            fontFamily: "'Barlow Condensed', sans-serif",
            color: ACCENT,
            letterSpacing: "0.3em",
            fontSize: 12,
            textTransform: "uppercase",
          }}
        >
          <div
            style={{
              width: 36,
              height: 36,
              border: `3px solid ${ACCENT}25`,
              borderTopColor: ACCENT,
              borderRadius: "50%",
              animation: "spin .8s linear infinite",
              margin: "0 auto 12px",
            }}
          />
          Loading transfers…
        </div>
        <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
      </div>
    );
  }

  if (!state?.team) {
    return (
      <div
        style={{
          height: "100vh",
          background: "#0a0e1a",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          color: "#7a9aaa",
          fontFamily: "'Barlow Condensed', sans-serif",
          fontSize: 16,
          letterSpacing: "0.15em",
        }}
      >
        No team found. Build your squad first.
      </div>
    );
  }

  return (
    <div
      className="tr-root"
      style={{
        fontFamily: "'Barlow Condensed','Impact',sans-serif",
        height: "100vh",
        background: "#0a0e1a",
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
        position: "relative",
      }}
    >
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Barlow+Condensed:wght@300;400;600;700;800;900&family=Barlow:wght@300;400;500;600&display=swap');

        @keyframes spin    { to { transform: rotate(360deg); } }
        @keyframes fadeUp  { from { opacity:0; transform:translateY(8px); } to { opacity:1; transform:translateY(0); } }
        @keyframes fadeIn  { from { opacity:0; } to { opacity:1; } }
        @keyframes pulse   { 0%,100%{opacity:1} 50%{opacity:.45} }
        @keyframes shimmer { 0%{background-position:200% 0} 100%{background-position:-200% 0} }
        @keyframes borderPulse { 0%,100%{border-color:${ACCENT}35} 50%{border-color:${ACCENT}80} }

        .fade-a { animation: fadeUp .4s both; }
        .fade-b { animation: fadeUp .4s .07s both; }

        .sk { background:linear-gradient(90deg,rgba(255,255,255,.03) 25%,rgba(255,255,255,.06) 50%,rgba(255,255,255,.03) 75%); background-size:200% 100%; animation:shimmer 1.4s infinite; border-radius:8px; }

        ::-webkit-scrollbar { width:3px; }
        ::-webkit-scrollbar-track { background:transparent; }
        ::-webkit-scrollbar-thumb { background:rgba(255,255,255,.08); border-radius:2px; }

        .s-inp { width:100%; background:rgba(255,255,255,.04); border:1px solid rgba(255,255,255,.08); border-radius:8px; padding:7px 10px 7px 30px; color:white; font-size:13px; font-weight:500; font-family:'Barlow',sans-serif; outline:none; box-sizing:border-box; transition:border-color .2s; }
        .s-inp:focus { border-color:${ACCENT}44; background:rgba(0,255,135,.02); }
        .s-inp::placeholder { color:rgba(255,255,255,.5); font-weight:500; }
        .s-inp:disabled { opacity:.35; cursor:not-allowed; }

        .c-sel { background:rgba(255,255,255,.04); border:1px solid rgba(255,255,255,.08); border-radius:7px; color:rgba(255,255,255,.8); padding:6px 8px; font-family:'Barlow',sans-serif; font-size:11px; outline:none; cursor:pointer; transition:border-color .2s; }
        .c-sel:focus { border-color:${ACCENT}44; }
        .c-sel option { background:#0f1724; }
        .c-sel:disabled { opacity:.35; cursor:not-allowed; }

        .pg-b { min-width:26px; height:26px; border-radius:6px; padding:0 5px; border:1px solid rgba(255,255,255,.12); background:transparent; color:#9abacc; font-family:'Barlow Condensed',sans-serif; font-weight:800; font-size:11px; cursor:pointer; transition:all .15s; }
        .pg-b:hover:not(:disabled) { border-color:${ACCENT}55; color:${ACCENT}; }
        .pg-b.on { background:${ACCENT}20; border-color:${ACCENT}60; color:${ACCENT}; }
        .pg-b:disabled { opacity:.25; cursor:not-allowed; }

        .tab-btn { flex:1; padding:10px 0; border:none; background:transparent; font-family:'Barlow Condensed',sans-serif; font-weight:800; font-size:11px; letter-spacing:.2em; text-transform:uppercase; cursor:pointer; transition:all .2s; }

        /* ── Responsive: stack the three panels below 980px ── */
        @media (max-width: 980px) {
          .tr-root {
            height: auto !important;
            min-height: 100dvh;
            overflow: visible !important;
          }
          .tr-body {
            flex-direction: column !important;
          }
          .tr-squadcol {
            width: 100% !important;
            border-right: none !important;
            border-bottom: 1px solid rgba(255,255,255,.06);
          }
          .tr-side-scroll {
            max-height: 44vh;
          }
          .tr-marketcol {
            border-right: none !important;
            border-bottom: 1px solid rgba(255,255,255,.06);
          }
          .tr-market-scroll {
            max-height: 48vh;
            min-height: 160px;
          }
          .tr-cartcol {
            width: 100% !important;
          }
          .tr-cart-scroll {
            max-height: 44vh;
          }
        }

        @media (max-width: 640px) {
          .tr-topbar {
            flex-wrap: wrap;
            padding: 10px 14px !important;
            gap: 10px;
          }
          .tr-stats {
            flex-wrap: wrap;
            gap: 12px !important;
            width: 100%;
            justify-content: space-between;
          }
          .pg-b { min-width: 34px; height: 34px; }
          .tab-btn { padding: 13px 0; }
        }
      `}</style>

      <div
        style={{
          position: "absolute",
          inset: 0,
          pointerEvents: "none",
          zIndex: 0,
        }}
      >
        <div
          style={{
            position: "absolute",
            inset: 0,
            background: `radial-gradient(ellipse 55% 60% at 28% 50%, ${ACCENT}04 0%, transparent 65%)`,
          }}
        />
        <div
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            right: 0,
            height: 2,
            background: `linear-gradient(90deg, transparent 0%, ${ACCENT} 40%, ${ACCENT2} 60%, transparent 100%)`,
          }}
        />
      </div>

      <div
        className="fade-a tr-topbar"
        style={{
          position: "relative",
          zIndex: 10,
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "10px 20px",
          borderBottom: "1px solid rgba(255,255,255,.06)",
          flexShrink: 0,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div
            style={{
              width: 32,
              height: 32,
              borderRadius: 8,
              background: `linear-gradient(135deg,${ACCENT}25,${ACCENT2}15)`,
              border: `1px solid ${ACCENT}35`,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: 16,
            }}
          >
            ↔
          </div>
          <div>
            <div
              style={{
                color: ACCENT,
                fontSize: 8,
                fontWeight: 600,
                letterSpacing: "0.35em",
                textTransform: "uppercase",
                fontFamily: "'Barlow',sans-serif",
              }}
            >
              {state.team.name}
            </div>
            <div
              style={{
                color: "white",
                fontSize: 20,
                fontWeight: 900,
                textTransform: "uppercase",
                lineHeight: 1,
              }}
            >
              Transfers
            </div>
          </div>
        </div>

        <div className="tr-stats" style={{ display: "flex", alignItems: "center", gap: 16 }}>
          {[
            {
              label: "Gameweek",
              value: String(state.gameweek),
              color: "white",
            },
            null,
            {
              label: "Free TF",
              value: isWildcard
                ? "∞"
                : String(freeAfterCart === Infinity ? "∞" : freeAfterCart),
              color: isWildcard
                ? "#f59e0b"
                : freeAfterCart > 0
                  ? ACCENT
                  : "#ef4444",
            },
            null,
            {
              label: "Hit pts",
              value: `-${hitDisplay}`,
              color: hitDisplay > 0 ? "#ef4444" : "#5a7a8a",
            },
            null,
            {
              label: "Bank",
              value: fmt(budgetDisplay),
              color: budgetDisplay < 0 ? "#ef4444" : ACCENT,
            },
          ].map((item, i) =>
            item === null ? (
              <div
                key={i}
                style={{
                  width: 1,
                  height: 28,
                  background: "rgba(255,255,255,.07)",
                }}
              />
            ) : (
              <div key={i} style={{ textAlign: "center" }}>
                <div
                  style={{
                    color: "#5a7a8a",
                    fontSize: 8,
                    letterSpacing: "0.15em",
                    textTransform: "uppercase",
                    fontFamily: "'Barlow',sans-serif",
                  }}
                >
                  {item.label}
                </div>
                <div
                  style={{
                    color: item.color,
                    fontSize: 20,
                    fontWeight: 900,
                    lineHeight: 1,
                  }}
                >
                  {item.value}
                </div>
              </div>
            ),
          )}

          {gwState?.wildcardAvailable && (
            <>
              <div
                style={{
                  width: 1,
                  height: 28,
                  background: "rgba(255,255,255,.07)",
                }}
              />
              <button
                onClick={toggleWildcard}
                style={{
                  padding: "6px 13px",
                  borderRadius: 8,
                  cursor: "pointer",
                  transition: "all .2s",
                  border: `1px solid ${isWildcard ? "#f59e0b" : "rgba(255,255,255,.1)"}`,
                  background: isWildcard
                    ? "rgba(245,158,11,.15)"
                    : "rgba(255,255,255,.03)",
                  color: isWildcard ? "#f59e0b" : "#9abacc",
                  fontFamily: "'Barlow Condensed',sans-serif",
                  fontWeight: 800,
                  fontSize: 11,
                  letterSpacing: "0.1em",
                  animation: isWildcard
                    ? "borderPulse 2s ease-in-out infinite"
                    : "none",
                }}
              >
                🃏 WILDCARD {isWildcard ? "ON" : ""}
              </button>
            </>
          )}
        </div>
      </div>

      <div
        className="fade-b tr-body"
        style={{
          flex: 1,
          display: "flex",
          minHeight: 0,
          position: "relative",
          zIndex: 1,
        }}
      >
        <div
          className="tr-squadcol"
          style={{
            width: 295,
            flexShrink: 0,
            borderRight: "1px solid rgba(255,255,255,.06)",
            display: "flex",
            flexDirection: "column",
            overflow: "hidden",
          }}
        >
          <div
            style={{
              display: "flex",
              borderBottom: "1px solid rgba(255,255,255,.06)",
              flexShrink: 0,
            }}
          >
            {(["squad", "history"] as const).map((t) => (
              <button
                key={t}
                className="tab-btn"
                onClick={() => setTab(t)}
                style={{
                  color: tab === t ? "white" : "#5a7a8a",
                  borderBottom:
                    tab === t ? `2px solid ${ACCENT}` : "2px solid transparent",
                }}
              >
                {t === "squad" ? "My Squad" : `History (${history.length})`}
              </button>
            ))}
          </div>

          {tab === "squad" ? (
            <div
              className="tr-side-scroll"
              style={{ flex: 1, overflowY: "auto", padding: "10px 10px 14px" }}
            >
              {!selectedOutId && cart.length === 0 && (
                <div
                  style={{
                    padding: "9px 12px",
                    borderRadius: 8,
                    background: `${ACCENT}08`,
                    border: `1px solid ${ACCENT}18`,
                    color: "#9abacc",
                    fontSize: 11,
                    fontFamily: "'Barlow',sans-serif",
                    lineHeight: 1.5,
                    marginBottom: 10,
                  }}
                >
                  👆 <strong style={{ color: ACCENT }}>Click a player</strong>{" "}
                  to start a transfer, then pick a replacement from the market.
                </div>
              )}

              {selectedOutId && (
                <div
                  style={{
                    padding: "8px 12px",
                    borderRadius: 8,
                    background: "rgba(239,68,68,.07)",
                    border: "1px solid rgba(239,68,68,.18)",
                    color: "#fca5a5",
                    fontSize: 11,
                    fontFamily: "'Barlow',sans-serif",
                    marginBottom: 10,
                    display: "flex",
                    alignItems: "center",
                    gap: 6,
                    animation: "fadeIn .25s both",
                  }}
                >
                  <span
                    style={{ animation: "pulse 1.5s infinite", fontSize: 8 }}
                  >
                    ●
                  </span>
                  Replacing{" "}
                  <strong style={{ color: "white" }}>
                    {picks.find((p) => p.playerId === selectedOutId)?.webName}
                  </strong>{" "}
                  — choose from market →
                </div>
              )}

              {([4, 3, 2, 1] as const).map((pos) => {
                const group = byPos[pos] ?? [];
                if (!group.length) return null;

                return (
                  <div key={pos} style={{ marginBottom: 10 }}>
                    <div
                      style={{
                        fontSize: 9,
                        fontWeight: 800,
                        color: POS_COLOR[pos],
                        letterSpacing: "0.2em",
                        textTransform: "uppercase",
                        fontFamily: "'Barlow',sans-serif",
                        marginBottom: 4,
                        paddingLeft: 2,
                      }}
                    >
                      {POS_LABEL[pos]}
                    </div>
                    <div
                      style={{
                        display: "flex",
                        flexDirection: "column",
                        gap: 3,
                      }}
                    >
                      {group.map((pick) => (
                        <SquadSlot
                          key={pick.playerId}
                          pick={pick}
                          isSelected={selectedOutId === pick.playerId}
                          isOut={cartOutIds.has(pick.playerId)}
                          onSelect={selectOut}
                        />
                      ))}
                    </div>
                  </div>
                );
              })}

              {bench.length > 0 && (
                <div style={{ marginBottom: 10 }}>
                  <div
                    style={{
                      fontSize: 9,
                      fontWeight: 800,
                      color: "#7a9aaa",
                      letterSpacing: "0.2em",
                      textTransform: "uppercase",
                      fontFamily: "'Barlow',sans-serif",
                      marginBottom: 4,
                      paddingLeft: 2,
                    }}
                  >
                    Bench
                  </div>
                  <div
                    style={{ display: "flex", flexDirection: "column", gap: 3 }}
                  >
                    {bench.map((pick) => (
                      <SquadSlot
                        key={pick.playerId}
                        pick={pick}
                        isSelected={selectedOutId === pick.playerId}
                        isOut={cartOutIds.has(pick.playerId)}
                        onSelect={selectOut}
                      />
                    ))}
                  </div>
                </div>
              )}
            </div>
          ) : (
            <div className="tr-side-scroll" style={{ flex: 1, overflowY: "auto", padding: "10px" }}>
              {history.length === 0 ? (
                <div
                  style={{
                    textAlign: "center",
                    padding: "32px 0",
                    color: "#3a5a6a",
                    fontFamily: "'Barlow',sans-serif",
                    fontSize: 12,
                  }}
                >
                  No transfers made yet.
                </div>
              ) : (
                <div
                  style={{ display: "flex", flexDirection: "column", gap: 4 }}
                >
                  {history.map((item) => (
                    <HistoryRow key={item.id} item={item} />
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        <div
          className="tr-marketcol"
          style={{
            flex: 1,
            display: "flex",
            flexDirection: "column",
            overflow: "hidden",
            borderRight: "1px solid rgba(255,255,255,.06)",
          }}
        >
          <div
            style={{
              padding: "12px 14px 10px",
              borderBottom: "1px solid rgba(255,255,255,.06)",
              flexShrink: 0,
            }}
          >
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                marginBottom: 8,
              }}
            >
              <span
                style={{
                  color: "white",
                  fontSize: 17,
                  fontWeight: 900,
                  textTransform: "uppercase",
                }}
              >
                Player Market
              </span>

              {selectedOutPick && (
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 5,
                    padding: "3px 9px",
                    borderRadius: 6,
                    background: `${POS_COLOR[selectedOutPick.position]}12`,
                    border: `1px solid ${POS_COLOR[selectedOutPick.position]}30`,
                  }}
                >
                  <PosTag pos={selectedOutPick.position} />
                  <span
                    style={{
                      color: "#7a9aaa",
                      fontSize: 10,
                      fontFamily: "'Barlow',sans-serif",
                    }}
                  >
                    only
                  </span>
                </div>
              )}

              {!selectedOutPick && (
                <span
                  style={{
                    color: "#9abacc",
                    fontSize: 11,
                    fontWeight: 600,
                    fontFamily: "'Barlow',sans-serif",
                  }}
                >
                  ← select a player first
                </span>
              )}
            </div>

            <div style={{ display: "flex", gap: 6 }}>
              <div style={{ position: "relative", flex: 1 }}>
                <span
                  style={{
                    position: "absolute",
                    left: 8,
                    top: "50%",
                    transform: "translateY(-50%)",
                    color: "rgba(255,255,255,.18)",
                    fontSize: 11,
                    pointerEvents: "none",
                  }}
                >
                  🔍
                </span>
                <input
                  ref={searchRef}
                  className="s-inp"
                  placeholder="Search players…"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  disabled={!selectedOutPick}
                  style={{ color: "white", fontWeight: 500 }}
                />
              </div>

              <select
                className="c-sel"
                value={teamFilter}
                onChange={(e) => setTeamFilter(Number(e.target.value))}
                disabled={!selectedOutPick}
                style={{
                  width: 140,
                  color: "rgba(255,255,255,.9)",
                  fontWeight: 600,
                }}
              >
                <option value={0}>All clubs</option>
                {teams.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div
            className="tr-market-scroll"
            style={{
              flex: 1,
              overflowY: "auto",
              padding: "8px 10px",
              display: "flex",
              flexDirection: "column",
              gap: 3,
            }}
          >
            {!selectedOutPick ? (
              <div
                style={{
                  flex: 1,
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: 10,
                  color: "#8aaacc",
                  fontFamily: "'Barlow',sans-serif",
                  fontSize: 13,
                  fontWeight: 600,
                  textAlign: "center",
                  padding: "50px 20px",
                }}
              >
                <div style={{ fontSize: 48, opacity: 0.3, color: ACCENT }}>
                  ↔
                </div>
                <div style={{ lineHeight: 1.6 }}>
                  Select a player from
                  <br />
                  your squad to browse
                  <br />
                  replacements
                </div>
              </div>
            ) : marketLoading ? (
              [...Array(10)].map((_, i) => (
                <div key={i} className="sk" style={{ height: 48 }} />
              ))
            ) : marketItems.length === 0 ? (
              <div
                style={{
                  textAlign: "center",
                  padding: "28px 0",
                  color: "#5a7a8a",
                  fontFamily: "'Barlow',sans-serif",
                  fontSize: 12,
                }}
              >
                No players found matching your filters.
              </div>
            ) : (
              marketItems.map((p) => (
                <MarketRow key={p.id} player={p} onSelect={addTransfer} />
              ))
            )}
          </div>

          {selectedOutPick && totalPages > 1 && (
            <div
              style={{
                padding: "8px 12px",
                borderTop: "1px solid rgba(255,255,255,.06)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                gap: 3,
                flexShrink: 0,
                flexWrap: "wrap",
              }}
            >
              <button
                className="pg-b"
                disabled={page === 1}
                onClick={() => setPage(page - 1)}
              >
                ‹
              </button>

              {pageButtons().map((b, i) =>
                b === "…" ? (
                  <span
                    key={`e${i}`}
                    style={{ color: "#9abacc", fontSize: 11, padding: "0 2px" }}
                  >
                    …
                  </span>
                ) : (
                  <button
                    key={b}
                    className={`pg-b${page === b ? " on" : ""}`}
                    onClick={() => setPage(b as number)}
                  >
                    {b}
                  </button>
                ),
              )}

              <button
                className="pg-b"
                disabled={page === totalPages}
                onClick={() => setPage(page + 1)}
              >
                ›
              </button>
            </div>
          )}
        </div>

        <div
          className="tr-cartcol"
          style={{
            width: 275,
            flexShrink: 0,
            display: "flex",
            flexDirection: "column",
            overflow: "hidden",
          }}
        >
          <div
            style={{
              padding: "12px 14px 10px",
              borderBottom: "1px solid rgba(255,255,255,.06)",
              flexShrink: 0,
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
            }}
          >
            <div
              style={{
                color: "white",
                fontSize: 17,
                fontWeight: 900,
                textTransform: "uppercase",
                display: "flex",
                alignItems: "center",
                gap: 7,
              }}
            >
              Cart
              {cart.length > 0 && (
                <span
                  style={{
                    fontSize: 10,
                    fontWeight: 900,
                    color: "#0a0e1a",
                    background: ACCENT,
                    borderRadius: 10,
                    padding: "1px 6px",
                  }}
                >
                  {cart.length}
                </span>
              )}
            </div>

            {cart.length > 0 && (
              <button
                onClick={clearCart}
                style={{
                  padding: "3px 8px",
                  borderRadius: 5,
                  border: "1px solid rgba(239,68,68,.2)",
                  background: "rgba(239,68,68,.06)",
                  color: "#ef4444",
                  fontFamily: "'Barlow Condensed',sans-serif",
                  fontWeight: 700,
                  fontSize: 10,
                  letterSpacing: "0.1em",
                  cursor: "pointer",
                }}
              >
                CLEAR ALL
              </button>
            )}
          </div>

          <div className="tr-cart-scroll" style={{ flex: 1, overflowY: "auto", padding: "10px" }}>
            {cart.length === 0 ? (
              <div
                style={{
                  textAlign: "center",
                  padding: "32px 0",
                  color: "#8aaacc",
                  fontFamily: "'Barlow',sans-serif",
                  fontSize: 12,
                  fontWeight: 600,
                  lineHeight: 1.6,
                }}
              >
                <div style={{ fontSize: 32, opacity: 0.4, marginBottom: 8 }}>
                  🛒
                </div>
                Your cart is empty.
                <br />
                Add a transfer to get started.
              </div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
                {(
                  preview?.cart ??
                  cart.map((t) => ({
                    outPlayerId: t.outPlayerId,
                    outWebName:
                      picks.find((p) => p.playerId === t.outPlayerId)
                        ?.webName ?? "…",
                    outSellPrice: 0,
                    inPlayerId: t.inPlayerId,
                    inWebName: "…",
                    inBuyPrice: 0,
                    isHit: false,
                  }))
                ).map((item) => (
                  <CartItem
                    key={item.outPlayerId}
                    item={item}
                    onRemove={removeTransfer}
                  />
                ))}
              </div>
            )}

            {previewing && (
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 7,
                  padding: "8px 10px",
                  marginTop: 8,
                  borderRadius: 8,
                  background: "rgba(255,255,255,.03)",
                  color: "#7a9aaa",
                  fontFamily: "'Barlow',sans-serif",
                  fontSize: 11,
                }}
              >
                <div
                  style={{
                    width: 12,
                    height: 12,
                    border: "2px solid #7a9aaa33",
                    borderTopColor: "#7a9aaa",
                    borderRadius: "50%",
                    animation: "spin .7s linear infinite",
                    flexShrink: 0,
                  }}
                />
                Validating transfer…
              </div>
            )}

            {preview &&
              !preview.ok &&
              preview.errors &&
              preview.errors.length > 0 && (
                <div
                  style={{
                    marginTop: 8,
                    padding: "14px 14px",
                    borderRadius: 12,
                    background:
                      "linear-gradient(135deg, rgba(239,68,68,.12), rgba(220,38,38,.08))",
                    border: "1.5px solid rgba(239,68,68,.35)",
                    animation: "fadeIn .25s both",
                    boxShadow: "0 4px 12px rgba(239,68,68,.15)",
                  }}
                >
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 6,
                      color: "#ff6b6b",
                      fontSize: 10,
                      fontWeight: 900,
                      letterSpacing: "0.2em",
                      textTransform: "uppercase",
                      fontFamily: "'Barlow Condensed',sans-serif",
                      marginBottom: 8,
                    }}
                  >
                    <span style={{ fontSize: 14 }}>⚠️</span>
                    Transfer Error
                  </div>

                  {preview.errors.map((err, i) => (
                    <div
                      key={i}
                      style={{
                        color: "#fecaca",
                        fontSize: 12,
                        fontWeight: 600,
                        fontFamily: "'Barlow',sans-serif",
                        lineHeight: 1.6,
                        padding: "6px 10px",
                        background: "rgba(0,0,0,.2)",
                        borderRadius: 6,
                        marginTop: i > 0 ? 4 : 0,
                      }}
                    >
                      {err
                        .replace(/_/g, " ")
                        .toLowerCase()
                        .replace(/^./, (c) => c.toUpperCase())}
                    </div>
                  ))}
                </div>
              )}

            {preview?.ok && preview.summary && (
              <div
                style={{
                  marginTop: 10,
                  padding: "12px",
                  borderRadius: 10,
                  background: `${ACCENT}07`,
                  border: `1px solid ${ACCENT}18`,
                  animation: "fadeIn .3s both",
                }}
              >
                <div
                  style={{
                    color: ACCENT,
                    fontSize: 9,
                    fontWeight: 800,
                    letterSpacing: "0.22em",
                    textTransform: "uppercase",
                    fontFamily: "'Barlow',sans-serif",
                    marginBottom: 8,
                  }}
                >
                  Transfer Summary
                </div>

                {(
                  [
                    [
                      "Bank before",
                      fmt(preview.summary.budgetLeftBefore),
                      "white",
                    ],
                    [
                      "Bank after",
                      fmt(preview.summary.budgetLeftAfter),
                      preview.summary.budgetLeftAfter < 0 ? "#ef4444" : ACCENT,
                    ],
                    [
                      "Free TF left",
                      String(preview.summary.freeTransfersRemainingAfter),
                      preview.summary.freeTransfersRemainingAfter > 0
                        ? ACCENT
                        : "#ef4444",
                    ],
                    [
                      "Transfers made",
                      `${preview.summary.transfersMadeBefore} → ${preview.summary.transfersMadeAfter}`,
                      "white",
                    ],
                    ...(preview.summary.hitCostAdded > 0
                      ? [
                          [
                            "Point hit",
                            `-${preview.summary.hitCostAdded}pts`,
                            "#ef4444",
                          ],
                        ]
                      : []),
                  ] as [string, string, string][]
                ).map(([label, value, color]) => (
                  <div
                    key={label}
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "center",
                      marginBottom: 5,
                    }}
                  >
                    <span
                      style={{
                        color: "#7a9aaa",
                        fontSize: 11,
                        fontFamily: "'Barlow',sans-serif",
                      }}
                    >
                      {label}
                    </span>
                    <span style={{ color, fontSize: 12, fontWeight: 800 }}>
                      {value}
                    </span>
                  </div>
                ))}

                {isWildcard && (
                  <div
                    style={{
                      marginTop: 6,
                      padding: "5px 8px",
                      borderRadius: 6,
                      background: "rgba(245,158,11,.1)",
                      border: "1px solid rgba(245,158,11,.2)",
                      color: "#fcd34d",
                      fontSize: 10,
                      fontFamily: "'Barlow',sans-serif",
                      textAlign: "center",
                    }}
                  >
                    🃏 Wildcard active — no point hits
                  </div>
                )}
              </div>
            )}
          </div>

          <div
            style={{
              padding: "10px",
              borderTop: "1px solid rgba(255,255,255,.06)",
              flexShrink: 0,
            }}
          >
            {!showConfirm ? (
              <button
                disabled={!canCommit}
                onClick={() => setShowConfirm(true)}
                style={{
                  width: "100%",
                  padding: "13px",
                  borderRadius: 11,
                  border: "none",
                  cursor: canCommit ? "pointer" : "not-allowed",
                  transition: "all .25s",
                  background: canCommit
                    ? `linear-gradient(135deg,${ACCENT},${ACCENT2})`
                    : "rgba(255,255,255,.04)",
                  color: canCommit ? "#0a0e1a" : "#7a9aaa",
                  fontFamily: "'Barlow Condensed',sans-serif",
                  fontWeight: 900,
                  fontSize: 13,
                  letterSpacing: "0.2em",
                  textTransform: "uppercase",
                  boxShadow: canCommit ? `0 0 22px ${ACCENT}30` : "none",
                }}
              >
                {cart.length === 0
                  ? "No transfers in cart"
                  : previewing
                    ? "Checking…"
                    : !preview
                      ? "Add transfers above"
                      : !preview.ok
                        ? "Fix errors above"
                        : `Confirm ${cart.length} transfer${cart.length > 1 ? "s" : ""} →`}
              </button>
            ) : (
              <div
                style={{
                  display: "flex",
                  flexDirection: "column",
                  gap: 7,
                  animation: "fadeIn .2s both",
                }}
              >
                <div
                  style={{
                    padding: "9px 12px",
                    borderRadius: 8,
                    background: preview?.summary?.hitCostAdded
                      ? "rgba(239,68,68,.08)"
                      : "rgba(245,158,11,.08)",
                    border: `1px solid ${
                      preview?.summary?.hitCostAdded
                        ? "rgba(239,68,68,.2)"
                        : "rgba(245,158,11,.2)"
                    }`,
                    color: preview?.summary?.hitCostAdded
                      ? "#fca5a5"
                      : "#fcd34d",
                    fontSize: 11,
                    fontFamily: "'Barlow',sans-serif",
                    textAlign: "center",
                    lineHeight: 1.5,
                  }}
                >
                  {preview?.summary?.hitCostAdded
                    ? `⚠️ This costs -${preview.summary.hitCostAdded} points. Sure?`
                    : "Confirm transfers? This cannot be undone."}
                </div>

                <div style={{ display: "flex", gap: 5 }}>
                  <button
                    onClick={() => setShowConfirm(false)}
                    style={{
                      flex: 1,
                      padding: "10px",
                      borderRadius: 8,
                      border: "1px solid rgba(255,255,255,.1)",
                      background: "transparent",
                      color: "#9abacc",
                      fontFamily: "'Barlow Condensed',sans-serif",
                      fontWeight: 800,
                      fontSize: 11,
                      letterSpacing: "0.15em",
                      cursor: "pointer",
                    }}
                  >
                    CANCEL
                  </button>

                  <button
                    onClick={async () => {
                      setShowConfirm(false);
                      await commit();
                    }}
                    disabled={committing}
                    style={{
                      flex: 2,
                      padding: "10px",
                      borderRadius: 8,
                      border: "none",
                      background: `linear-gradient(135deg,${ACCENT},${ACCENT2})`,
                      color: "#0a0e1a",
                      fontFamily: "'Barlow Condensed',sans-serif",
                      fontWeight: 900,
                      fontSize: 11,
                      letterSpacing: "0.15em",
                      cursor: committing ? "not-allowed" : "pointer",
                      opacity: committing ? 0.6 : 1,
                    }}
                  >
                    {committing ? (
                      <span
                        style={{
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                          gap: 5,
                        }}
                      >
                        <span
                          style={{
                            width: 10,
                            height: 10,
                            border: "2px solid #0a0e1a44",
                            borderTopColor: "#0a0e1a",
                            borderRadius: "50%",
                            animation: "spin .7s linear infinite",
                            display: "inline-block",
                          }}
                        />
                        SAVING…
                      </span>
                    ) : (
                      "CONFIRM ✓"
                    )}
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
