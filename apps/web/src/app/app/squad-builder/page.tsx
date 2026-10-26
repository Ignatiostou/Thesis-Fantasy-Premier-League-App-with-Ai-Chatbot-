"use client";
// src/app/app/squad-builder/page.tsx

import { useEffect, useState, useCallback, useRef } from "react";
import { useRouter } from "next/navigation";
import { apiFetch } from "@/lib/api";
import { ACCENT, POS_COLOR, POS_LABEL } from "@/lib/constants";

import Spinner from "@/components/ui/Spinner";
import PitchSvg from "@/components/ui/PitchSvg";
import PitchSlot from "@/features/squad-builder/PitchSlot";
import PlayerRow from "@/features/squad-builder/PlayerRow";

// ── Types ─────────────────────────────────────────────────────────────────────

interface FplTeam {
  id: number;
  name: string;
  shortName: string;
}
interface FplPlayer {
  id: number;
  webName: string;
  position: 1 | 2 | 3 | 4;
  nowCost: number;
  status: string;
  totalPoints: number | null;
  chanceOfPlayingNextRound: number | null;
  team: FplTeam;
}
interface SquadPlayer extends FplPlayer {
  isCaptain: boolean;
  isViceCaptain: boolean;
}
interface PaginatedPlayers {
  items: FplPlayer[];
  total: number;
  page: number;
  limit: number;
  hasMore: boolean;
}

// ── Constants ─────────────────────────────────────────────────────────────────

const BUDGET = 1000;
const LIMITS: Record<number, number> = { 1: 2, 2: 5, 3: 5, 4: 3 };
const PAGE_LIMIT = 20;

// ── Helpers ───────────────────────────────────────────────────────────────────

function reAssignCaptain(squad: SquadPlayer[]): SquadPlayer[] {
  const sorted = [...squad].sort(
    (a, b) => (b.totalPoints ?? 0) - (a.totalPoints ?? 0),
  );
  return squad.map((p) => ({
    ...p,
    isCaptain: p.id === sorted[0]?.id,
    isViceCaptain: p.id === sorted[1]?.id,
  }));
}

// ── Pitch component ───────────────────────────────────────────────────────────

function Pitch({
  squad,
  onRemove,
}: {
  squad: SquadPlayer[];
  onRemove: (id: number) => void;
}) {
  const byPos: Record<number, SquadPlayer[]> = { 1: [], 2: [], 3: [], 4: [] };
  squad.forEach((p) => byPos[p.position]?.push(p));

  const slotProps = (p: SquadPlayer | null, posId: number, idx: number) => ({
    player: p,
    posId,
    isCaptain: p?.isCaptain,
    isViceCaptain: p?.isViceCaptain,
    onRemove,
    isEmpty: !p,
  });

  return (
    <div
      style={{
        flex: 1,
        display: "flex",
        flexDirection: "column",
        minHeight: 0,
      }}
    >
      <div
        style={{
          flex: 1,
          position: "relative",
          background:
            "linear-gradient(180deg,#195830 0%,#1d6636 14.28%,#195830 28.57%,#1d6636 42.85%,#195830 57.14%,#1d6636 71.42%,#195830 85.71%,#1d6636 100%)",
          borderRadius: "16px",
          border: "2px solid rgba(255,255,255,.14)",
          overflow: "hidden",
          padding: "12px 8px",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-around",
        }}
      >
        <PitchSvg />
        {([4, 3, 2, 1] as const).map((posId) => {
          const row = byPos[posId] ?? [];
          const needed = LIMITS[posId] ?? 0;
          const slots = Array.from(
            { length: needed },
            (_, i) => row[i] ?? null,
          );
          return (
            <div
              key={posId}
              style={{
                display: "flex",
                justifyContent: "center",
                gap: 8,
                position: "relative",
                zIndex: 1,
              }}
            >
              {slots.map((p, i) => (
                <PitchSlot
                  key={p?.id ?? `empty-${posId}-${i}`}
                  {...slotProps(p, posId, i)}
                />
              ))}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function SquadBuilderPage() {
  const router = useRouter();

  const [squad, setSquad] = useState<SquadPlayer[]>([]);
  const [teamName, setTeamName] = useState("My Team");
  const [fplTeams, setFplTeams] = useState<FplTeam[]>([]);
  const [market, setMarket] = useState<FplPlayer[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [posFilter, setPosFilter] = useState(0);
  const [teamFilter, setTeamFilter] = useState(0);
  const [search, setSearch] = useState("");
  // Typed value drives the input; the settled value drives the request, so a
  // fast typist fires one query instead of one per keystroke.
  const [querySearch, setQuerySearch] = useState("");
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitErr, setSubmitErr] = useState<string | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  // ── Load teams for filter ─────────────────────────────────────────────────
  useEffect(() => {
    apiFetch<FplTeam[]>("/fpl/teams")
      .then(setFplTeams)
      .catch(() => {});
  }, []);

  // ── Load market ───────────────────────────────────────────────────────────
  const loadMarket = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({
        page: String(page),
        limit: String(PAGE_LIMIT),
        sortBy: "points",
      });
      if (posFilter) params.set("position", String(posFilter));
      if (teamFilter) params.set("teamId", String(teamFilter));
      if (querySearch.trim()) params.set("q", querySearch.trim());
      const res = await apiFetch<PaginatedPlayers>(`/fpl/players?${params}`);
      setMarket(res.items);
      setTotal(res.total);
    } finally {
      setLoading(false);
    }
  }, [page, posFilter, teamFilter, querySearch]);

  // Settle the typed term, and reset to page 1 in the same step. Resetting in a
  // separate effect fired a request for the OLD page first, which briefly showed
  // an empty list whenever a narrower search had fewer pages than the current one.
  useEffect(() => {
    const t = setTimeout(() => {
      setQuerySearch(search);
      setPage(1);
    }, 180);
    return () => clearTimeout(t);
  }, [search]);

  useEffect(() => {
    loadMarket();
  }, [loadMarket]);

  useEffect(() => {
    setPage(1);
  }, [posFilter, teamFilter]);

  // ── Squad logic ───────────────────────────────────────────────────────────
  const togglePlayer = (player: FplPlayer) => {
    const already = squad.find((p) => p.id === player.id);
    if (already) {
      setSquad(reAssignCaptain(squad.filter((p) => p.id !== player.id)));
      return;
    }
    if (squad.length >= 15) return;
    const posCount = squad.filter((p) => p.position === player.position).length;
    if (posCount >= LIMITS[player.position]) return;
    const clubCount = squad.filter((p) => p.team.id === player.team.id).length;
    if (clubCount >= 3) return;
    const newSquad = [
      ...squad,
      { ...player, isCaptain: false, isViceCaptain: false },
    ];
    setSquad(reAssignCaptain(newSquad));
  };

  const removePlayer = (id: number) =>
    setSquad(reAssignCaptain(squad.filter((p) => p.id !== id)));

  // ── Submit ────────────────────────────────────────────────────────────────
  const submit = async () => {
    if (squad.length !== 15) return setSubmitErr("You need exactly 15 players");
    const budgetUsed = squad.reduce((s, p) => s + p.nowCost, 0);
    if (budgetUsed > BUDGET)
      return setSubmitErr(
        `Over budget by £${((budgetUsed - BUDGET) / 10).toFixed(1)}m`,
      );
    setSubmitting(true);
    setSubmitErr(null);
    try {
      await apiFetch("/team/initialize", {
        method: "POST",
        body: JSON.stringify({
          playerIds: squad.map((p) => p.id),
          name: teamName.trim() || "My Team",
        }),
      });
      router.push("/app");
    } catch (e: any) {
      setSubmitErr(e.message ?? "Failed to create team");
    } finally {
      setSubmitting(false);
    }
  };

  // ── Derived ───────────────────────────────────────────────────────────────
  const budgetUsed = squad.reduce((s, p) => s + p.nowCost, 0);
  const budgetLeft = BUDGET - budgetUsed;
  const totalPages = Math.ceil(total / PAGE_LIMIT);
  const counts = {
    1: 0,
    2: 0,
    3: 0,
    4: 0,
    ...Object.fromEntries(
      [1, 2, 3, 4].map((pos) => [
        pos,
        squad.filter((p) => p.position === pos).length,
      ]),
    ),
  };

  return (
    <div
      className="sb-root"
      style={{
        fontFamily: "'Barlow Condensed','Impact',sans-serif",
        height: "100vh",
        background: "#0a0e1a",
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
      }}
    >
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Barlow+Condensed:wght@300;400;600;700;800;900&family=Barlow:wght@300;400;500;600&display=swap');
        @keyframes rot   { to { transform:rotate(360deg); } }
        @keyframes spin  { to { transform:rotate(360deg); } }
        @keyframes fadeUp{ from { opacity:0;transform:translateY(8px); } to { opacity:1;transform:translateY(0); } }
        @keyframes shimmer{ 0%{background-position:200% 0} 100%{background-position:-200% 0} }
        .sk { background:linear-gradient(90deg,rgba(255,255,255,.03) 25%,rgba(255,255,255,.06) 50%,rgba(255,255,255,.03) 75%); background-size:200% 100%; animation:shimmer 1.4s infinite; border-radius:8px; }
        ::-webkit-scrollbar { width:3px } ::-webkit-scrollbar-thumb { background:rgba(255,255,255,.08);border-radius:2px }

        /* The global scrollbar above is a 3px, 8%-opacity sliver — invisible on
           this panel, so a list of 500+ players looked like it simply ended.
           The player list gets a track and thumb you can actually see and grab. */
        .sb-list { scrollbar-width: thin; scrollbar-color: rgba(255,255,255,.28) rgba(255,255,255,.05); scrollbar-gutter: stable; }
        .sb-list::-webkit-scrollbar { width: 9px }
        .sb-list::-webkit-scrollbar-track { background: rgba(255,255,255,.05); border-radius: 5px }
        .sb-list::-webkit-scrollbar-thumb { background: rgba(255,255,255,.26); border-radius: 5px; border: 2px solid transparent; background-clip: content-box }
        .sb-list::-webkit-scrollbar-thumb:hover { background: rgba(255,255,255,.45); background-clip: content-box }

        /* Second cue: the last row fades out at the bottom edge. Sticky with a
           matching negative margin, so it hovers without taking up height. */
        .sb-list-fade { position: sticky; bottom: 0; height: 26px; margin-top: -26px; pointer-events: none;
          background: linear-gradient(180deg, rgba(10,14,26,0) 0%, rgba(10,14,26,.94) 85%); }

        /* ── Responsive: stack pitch above player list below 900px ── */
        @media (max-width: 900px) {
          .sb-root {
            height: auto !important;
            min-height: 100dvh;
            overflow: visible !important;
          }
          .sb-body {
            flex-direction: column !important;
          }
          .sb-pitchcol {
            padding: 10px !important;
          }
          .sb-pitchcol > div > div {
            min-height: clamp(400px, 55vh, 540px);
          }
          .sb-side {
            width: 100% !important;
            border-left: none !important;
            border-top: 1px solid rgba(255,255,255,.07);
          }
          .sb-list {
            max-height: 52vh;
          }
        }

        @media (max-width: 640px) {
          .sb-topbar {
            flex-wrap: wrap;
            padding: 10px 12px !important;
            gap: 10px !important;
          }
          .sb-stats {
            width: 100%;
            justify-content: space-between;
            gap: 8px !important;
          }
          .sb-actions {
            width: 100%;
            flex-wrap: wrap;
          }
          .sb-actions input {
            flex: 1;
            min-width: 140px;
          }
          .sb-actions button {
            flex: 1;
            min-height: 44px;
          }
          .sbslot { width: 60px !important; }
          .sbslot-circle {
            width: 46px !important;
            height: 46px !important;
            font-size: 9px !important;
          }
          .sbslot-tag { max-width: 60px !important; padding: 2px 5px !important; }
        }
      `}</style>

      {/* Top bar */}
      <div
        className="sb-topbar"
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "10px 20px",
          borderBottom: "1px solid rgba(255,255,255,.06)",
          flexShrink: 0,
          gap: 16,
          position: "relative",
          zIndex: 10,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div
            style={{
              width: 32,
              height: 32,
              borderRadius: 8,
              background: `linear-gradient(135deg,${ACCENT}25,#00d4ff15)`,
              border: `1px solid ${ACCENT}35`,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: 16,
            }}
          >
            ⚽
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
              FPL Manager
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
              Build Your Squad
            </div>
          </div>
        </div>

        {/* Budget + position counts */}
        <div className="sb-stats" style={{ display: "flex", alignItems: "center", gap: 14 }}>
          {([1, 2, 3, 4] as const).map((pos) => (
            <div key={pos} style={{ textAlign: "center" }}>
              <div
                style={{
                  color: "rgba(255,255,255,.35)",
                  fontSize: 7,
                  letterSpacing: ".2em",
                  textTransform: "uppercase",
                  fontFamily: "'Barlow',sans-serif",
                }}
              >
                {POS_LABEL[pos]}
              </div>
              <div
                style={{
                  color:
                    counts[pos] >= LIMITS[pos]
                      ? ACCENT
                      : "rgba(255,255,255,.6)",
                  fontSize: 18,
                  fontWeight: 900,
                  lineHeight: 1,
                }}
              >
                {counts[pos]}/{LIMITS[pos]}
              </div>
            </div>
          ))}
          <div
            style={{
              width: 1,
              height: 28,
              background: "rgba(255,255,255,.07)",
            }}
          />
          <div style={{ textAlign: "center" }}>
            <div
              style={{
                color: "rgba(255,255,255,.35)",
                fontSize: 7,
                letterSpacing: ".2em",
                textTransform: "uppercase",
                fontFamily: "'Barlow',sans-serif",
              }}
            >
              Players
            </div>
            <div
              style={{
                color: squad.length === 15 ? ACCENT : "rgba(255,255,255,.6)",
                fontSize: 18,
                fontWeight: 900,
                lineHeight: 1,
              }}
            >
              {squad.length}/15
            </div>
          </div>
          <div
            style={{
              width: 1,
              height: 28,
              background: "rgba(255,255,255,.07)",
            }}
          />
          <div style={{ textAlign: "center" }}>
            <div
              style={{
                color: "rgba(255,255,255,.35)",
                fontSize: 7,
                letterSpacing: ".2em",
                textTransform: "uppercase",
                fontFamily: "'Barlow',sans-serif",
              }}
            >
              Bank
            </div>
            <div
              style={{
                color: budgetLeft < 0 ? "#ef4444" : ACCENT,
                fontSize: 18,
                fontWeight: 900,
                lineHeight: 1,
              }}
            >
              £{(budgetLeft / 10).toFixed(1)}m
            </div>
          </div>
        </div>

        {/* Team name + submit */}
        <div className="sb-actions" style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <input
            value={teamName}
            onChange={(e) => setTeamName(e.target.value)}
            maxLength={30}
            placeholder="Team name…"
            style={{
              background: "rgba(255,255,255,.05)",
              border: "1px solid rgba(255,255,255,.1)",
              borderRadius: 8,
              padding: "8px 12px",
              color: "white",
              fontSize: 13,
              fontFamily: "'Barlow',sans-serif",
              outline: "none",
              width: 160,
            }}
          />
          {submitErr && (
            <span
              style={{
                color: "#f87171",
                fontSize: 10,
                fontFamily: "'Barlow',sans-serif",
                maxWidth: 180,
              }}
            >
              {submitErr}
            </span>
          )}
          <button
            disabled={squad.length !== 15 || submitting}
            onClick={submit}
            style={{
              padding: "10px 20px",
              borderRadius: 10,
              border: "none",
              fontFamily: "'Barlow Condensed',sans-serif",
              fontWeight: 800,
              fontSize: 12,
              letterSpacing: ".2em",
              textTransform: "uppercase",
              cursor: squad.length === 15 ? "pointer" : "not-allowed",
              background:
                squad.length === 15
                  ? `linear-gradient(135deg,${ACCENT},#00d4ff)`
                  : "rgba(255,255,255,.05)",
              color: squad.length === 15 ? "#0a0e1a" : "rgba(255,255,255,.3)",
              transition: "all .25s",
            }}
          >
            {submitting ? "Saving…" : "Confirm Squad →"}
          </button>
        </div>
      </div>

      {/* Main body */}
      <div className="sb-body" style={{ flex: 1, display: "flex", minHeight: 0 }}>
        {/* Pitch */}
        <div
          className="sb-pitchcol"
          style={{
            flex: 1,
            padding: "10px 10px 10px 16px",
            display: "flex",
            flexDirection: "column",
            minWidth: 0,
          }}
        >
          <Pitch squad={squad} onRemove={removePlayer} />
        </div>

        {/* Sidebar */}
        <div
          className="sb-side"
          style={{
            width: 300,
            flexShrink: 0,
            borderLeft: "1px solid rgba(255,255,255,.06)",
            display: "flex",
            flexDirection: "column",
            overflow: "hidden",
          }}
        >
          {/* Filters */}
          <div
            style={{
              padding: "10px 10px 8px",
              borderBottom: "1px solid rgba(255,255,255,.06)",
              flexShrink: 0,
              display: "flex",
              flexDirection: "column",
              gap: 6,
            }}
          >
            <div style={{ position: "relative" }}>
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
                placeholder="Search players…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                style={{
                  width: "100%",
                  background: "rgba(255,255,255,.04)",
                  border: "1px solid rgba(255,255,255,.08)",
                  borderRadius: 8,
                  padding: "7px 10px 7px 30px",
                  color: "white",
                  fontSize: 12,
                  fontFamily: "'Barlow',sans-serif",
                  outline: "none",
                  boxSizing: "border-box",
                }}
              />
            </div>
            <div style={{ display: "flex", gap: 4 }}>
              {[0, 1, 2, 3, 4].map((pos) => (
                <button
                  key={pos}
                  onClick={() => setPosFilter(pos)}
                  style={{
                    flex: 1,
                    padding: "5px 0",
                    borderRadius: 6,
                    border: `1px solid ${posFilter === pos ? (POS_COLOR[pos] ?? ACCENT) + "55" : "rgba(255,255,255,.08)"}`,
                    background:
                      posFilter === pos
                        ? `${POS_COLOR[pos] ?? ACCENT}14`
                        : "transparent",
                    color:
                      posFilter === pos
                        ? (POS_COLOR[pos] ?? ACCENT)
                        : "rgba(255,255,255,.4)",
                    fontFamily: "'Barlow Condensed',sans-serif",
                    fontWeight: 700,
                    fontSize: 10,
                    cursor: "pointer",
                    transition: "all .15s",
                  }}
                >
                  {pos === 0 ? "All" : POS_LABEL[pos]}
                </button>
              ))}
            </div>
            {/* The club filter is a native <select>: the closed control can be
                styled, but the popup list is drawn by the OS and ignored the
                dark theme, rendering as a white sheet with a blue highlight.
                Colouring the <option>s directly is what browsers actually
                honour, so the open list matches the rest of the panel. */}
            <select
              value={teamFilter}
              onChange={(e) => setTeamFilter(Number(e.target.value))}
              style={{
                background: "rgba(255,255,255,.05)",
                border: "1px solid rgba(255,255,255,.12)",
                borderRadius: 7,
                color: "#e8f1f7",
                padding: "9px 30px 9px 11px",
                fontFamily: "'Barlow',sans-serif",
                fontSize: 12.5,
                fontWeight: 500,
                outline: "none",
                cursor: "pointer",
                width: "100%",
                appearance: "none",
                WebkitAppearance: "none",
                MozAppearance: "none",
                colorScheme: "dark",
                backgroundImage:
                  "url(\"data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 12 12'><path d='M2 4.5L6 8.5L10 4.5' stroke='%238ea9bd' stroke-width='1.6' fill='none' stroke-linecap='round' stroke-linejoin='round'/></svg>\")",
                backgroundRepeat: "no-repeat",
                backgroundPosition: "right 10px center",
              }}
            >
              <option value={0} style={{ background: "#0f1724", color: "#e8f1f7" }}>
                All clubs
              </option>
              {fplTeams.map((t) => (
                <option
                  key={t.id}
                  value={t.id}
                  style={{ background: "#0f1724", color: "#e8f1f7" }}
                >
                  {t.name}
                </option>
              ))}
            </select>
          </div>

          {/* Player list */}
          <div className="sb-list" style={{ flex: 1, overflowY: "auto", padding: "6px 8px" }}>
            {loading
              ? [...Array(10)].map((_, i) => (
                  <div
                    key={i}
                    className="sk"
                    style={{ height: 40, marginBottom: 3 }}
                  />
                ))
              : market.map((player) => {
                  const inSquad = squad.some((p) => p.id === player.id);
                  const posOk =
                    squad.filter((p) => p.position === player.position).length <
                    LIMITS[player.position];
                  const clubOk =
                    squad.filter((p) => p.team.id === player.team.id).length <
                    3;
                  const budgetOk = budgetLeft >= player.nowCost || inSquad;
                  const canAdd =
                    squad.length < 15 && posOk && clubOk && budgetOk;
                  return (
                    <div key={player.id} style={{ marginBottom: 3 }}>
                      <PlayerRow
                        player={player}
                        isSelected={inSquad}
                        canAdd={canAdd}
                        onToggle={togglePlayer}
                      />
                    </div>
                  );
                })}
            <div className="sb-list-fade" aria-hidden />
          </div>

          {/* Pagination */}
          {totalPages > 1 && (
            <div
              style={{
                padding: "12px 8px 12px 14px",
                borderTop: "1px solid rgba(255,255,255,.06)",
                display: "flex",
                alignItems: "center",
                justifyContent: "flex-start",
                gap: 12,
                flexShrink: 0,
              }}
            >
              <button
                onClick={() => setPage(Math.max(1, page - 1))}
                disabled={page === 1}
                aria-label="Previous page"
                style={{
                  width: 38,
                  height: 38,
                  borderRadius: 9,
                  border: `1px solid ${page > 1 ? "rgba(255,255,255,.22)" : "rgba(255,255,255,.08)"}`,
                  background: page > 1 ? "rgba(255,255,255,.06)" : "transparent",
                  color: page > 1 ? "#e8f1f7" : "rgba(255,255,255,.22)",
                  cursor: page > 1 ? "pointer" : "not-allowed",
                  fontFamily: "'Barlow Condensed',sans-serif",
                  fontSize: 22,
                  fontWeight: 700,
                  lineHeight: 1,
                  transition: "all .12s",
                }}
              >
                ‹
              </button>
              <span
                style={{
                  color: "#e8f1f7",
                  fontSize: 15,
                  fontWeight: 700,
                  fontFamily: "'Barlow Condensed',sans-serif",
                  letterSpacing: ".06em",
                  minWidth: 62,
                  textAlign: "center",
                }}
              >
                {page} / {totalPages}
              </span>
              <button
                onClick={() => setPage(Math.min(totalPages, page + 1))}
                disabled={page === totalPages}
                aria-label="Next page"
                style={{
                  width: 38,
                  height: 38,
                  borderRadius: 9,
                  border: `1px solid ${page < totalPages ? "rgba(255,255,255,.22)" : "rgba(255,255,255,.08)"}`,
                  background: page < totalPages ? "rgba(255,255,255,.06)" : "transparent",
                  color: page < totalPages ? "#e8f1f7" : "rgba(255,255,255,.22)",
                  cursor: page < totalPages ? "pointer" : "not-allowed",
                  fontFamily: "'Barlow Condensed',sans-serif",
                  fontSize: 22,
                  fontWeight: 700,
                  lineHeight: 1,
                  transition: "all .12s",
                }}
              >
                ›
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
