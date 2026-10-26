"use client";
// src/app/app/leagues/page.tsx

import { useEffect, useState, useCallback } from "react";
import { apiFetch } from "@/lib/api";
import { useTeamGuard } from "@/lib/hooks/useTeamGuard";
import { ACCENT } from "@/lib/constants";
import { League, LeagueDetail, StandingRow } from "@/lib/types";

import Spinner from "@/components/ui/Spinner";
import LeagueCard from "@/features/leagues/LeagueCard";
import StandingsTable from "@/features/leagues/StandingsTable";
import {
  Modal,
  CreateLeagueModal,
  JoinLeagueModal,
} from "@/features/leagues/Modals";

const typeColor = (type: string) =>
  type === "HEAD_TO_HEAD" ? "#f59e0b" : "#38bdf8";
const typeLabel = (type: string) =>
  type === "HEAD_TO_HEAD" ? "H2H" : "Classic";

const primaryBtn: React.CSSProperties = {
  padding: "10px 20px",
  borderRadius: 9,
  border: `1px solid ${ACCENT}44`,
  background: `${ACCENT}18`,
  color: ACCENT,
  fontFamily: "'Barlow Condensed',sans-serif",
  fontWeight: 800,
  fontSize: 12,
  letterSpacing: ".12em",
  textTransform: "uppercase",
  cursor: "pointer",
};
const secondaryBtn: React.CSSProperties = {
  padding: "10px 16px",
  borderRadius: 9,
  border: "1px solid rgba(255,255,255,.1)",
  background: "rgba(255,255,255,.04)",
  color: "rgba(255,255,255,.78)",
  fontFamily: "'Barlow Condensed',sans-serif",
  fontWeight: 700,
  fontSize: 12,
  letterSpacing: ".1em",
  textTransform: "uppercase",
  cursor: "pointer",
};

export default function LeaguesPage() {
  const { checking } = useTeamGuard("mustHaveTeam");

  const [leagues, setLeagues] = useState<League[]>([]);
  const [selected, setSelected] = useState<League | null>(null);
  const [detail, setDetail] = useState<LeagueDetail | null>(null);
  const [standings, setStandings] = useState<StandingRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingSub, setLoadingSub] = useState(false);
  const [tab, setTab] = useState<"standings" | "info">("standings");
  const [modal, setModal] = useState<"create" | "join" | null>(null);
  const [myUserId, setMyUserId] = useState("");
  const [feedback, setFeedback] = useState<{
    type: "ok" | "err";
    msg: string;
  } | null>(null);

  const showFeedback = (type: "ok" | "err", msg: string) => {
    setFeedback({ type, msg });
    setTimeout(() => setFeedback(null), 3500);
  };

  const loadLeagues = useCallback(async () => {
    if (checking) return;
    setLoading(true);
    try {
      const [leaguesRes, meRes] = await Promise.all([
        apiFetch<{ items: League[] }>("/leagues/mine"),
        apiFetch<{ id: string }>("/auth/me").catch(() => null),
      ]);
      setLeagues(leaguesRes.items ?? []);
      if (meRes?.id) setMyUserId(meRes.id);
    } finally {
      setLoading(false);
    }
  }, [checking]);

  useEffect(() => {
    loadLeagues();
  }, [loadLeagues]);

  const selectLeague = async (league: League) => {
    setSelected(league);
    setTab("standings");
    setLoadingSub(true);
    setDetail(null);
    setStandings([]);
    try {
      const [detailRes, standRes] = await Promise.all([
        apiFetch<LeagueDetail>(`/leagues/${league.id}`),
        apiFetch<{ items: StandingRow[] }>(`/leagues/${league.id}/standings`),
      ]);
      setDetail(detailRes);
      setStandings(standRes.items ?? []);
    } catch (e: any) {
      showFeedback("err", e?.message ?? "Failed to load league");
    } finally {
      setLoadingSub(false);
    }
  };

  const handleLeave = async () => {
    if (!selected) return;
    try {
      await apiFetch(`/leagues/${selected.id}/leave`, { method: "POST" });
      showFeedback("ok", `Left ${selected.name}`);
      setSelected(null);
      setLeagues((prev) => prev.filter((l) => l.id !== selected.id));
    } catch (e: any) {
      showFeedback("err", e?.message ?? "Failed to leave");
    }
  };

  if (checking) return null;

  const isAdmin = detail?.adminUserId === myUserId;

  return (
    <div
      style={{
        fontFamily: "'Barlow Condensed','Impact',sans-serif",
        minHeight: "100vh",
        background: "#0a0e1a",
        padding: "clamp(14px, 3vw, 22px) clamp(14px, 3.5vw, 26px) 48px",
      }}
    >
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Barlow+Condensed:wght@400;600;700;800;900&family=Barlow:wght@400;500;600&display=swap');
        @keyframes fadeUp  { from { opacity:0;transform:translateY(10px); } to { opacity:1;transform:translateY(0); } }
        @keyframes slideIn { from { opacity:0;transform:translateY(-8px); } to { opacity:1;transform:translateY(0); } }
        .la  { animation: fadeUp .4s both; }
        .la2 { animation: fadeUp .4s .06s both; }

        .la2 {
          display: grid;
          grid-template-columns: 280px 1fr;
          gap: 18px;
          align-items: start;
        }

        @media (max-width: 760px) {
          .la2 { grid-template-columns: 1fr; }
        }

        @media (max-width: 640px) {
          .st-grid {
            grid-template-columns: 28px 1fr 1fr 40px 52px !important;
            gap: 5px !important;
            padding-left: 10px !important;
            padding-right: 10px !important;
          }
        }
        input::placeholder { color: rgba(255,255,255,.5); }
        input:focus { border-color: ${ACCENT}44 !important; outline: none; }
      `}</style>

      <div
        style={{
          position: "fixed",
          inset: 0,
          pointerEvents: "none",
          zIndex: 0,
          background:
            "radial-gradient(ellipse 50% 40% at 80% 20%, #38bdf808 0%, transparent 60%)",
        }}
      />
      <div
        style={{
          position: "relative",
          zIndex: 1,
          maxWidth: 1100,
          margin: "0 auto",
        }}
      >
        {/* Header */}
        <div
          className="la"
          style={{
            display: "flex",
            alignItems: "flex-end",
            justifyContent: "space-between",
            marginBottom: 22,
            flexWrap: "wrap",
            gap: 12,
          }}
        >
          <div>
            <div
              style={{
                color: ACCENT,
                fontSize: 9,
                fontWeight: 700,
                letterSpacing: ".38em",
                textTransform: "uppercase",
                fontFamily: "'Barlow',sans-serif",
                marginBottom: 3,
              }}
            >
              Competition
            </div>
            <h1
              style={{
                color: "white",
                fontSize: 34,
                fontWeight: 900,
                textTransform: "uppercase",
                margin: 0,
                lineHeight: 0.95,
              }}
            >
              Leagues
            </h1>
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <button onClick={() => setModal("join")} style={secondaryBtn}>
              + Join
            </button>
            <button onClick={() => setModal("create")} style={primaryBtn}>
              + Create
            </button>
          </div>
        </div>

        {/* Feedback toast */}
        {feedback && (
          <div
            style={{
              animation: "slideIn .25s both",
              padding: "10px 16px",
              borderRadius: 10,
              marginBottom: 16,
              background:
                feedback.type === "ok" ? `${ACCENT}14` : "rgba(239,68,68,.12)",
              border: `1px solid ${feedback.type === "ok" ? ACCENT + "44" : "rgba(239,68,68,.35)"}`,
              color: feedback.type === "ok" ? ACCENT : "#f87171",
              fontSize: 12,
              fontFamily: "'Barlow',sans-serif",
            }}
          >
            {feedback.type === "ok" ? "✓" : "⚠️"} {feedback.msg}
          </div>
        )}

        {loading ? (
          <Spinner label="Loading…" />
        ) : (
          <div className="la2">
            {/* Left: league list */}
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {leagues.length === 0 ? (
                <div
                  style={{
                    padding: "32px 20px",
                    textAlign: "center",
                    background: "rgba(255,255,255,.025)",
                    border: "1px solid rgba(255,255,255,.07)",
                    borderRadius: 14,
                  }}
                >
                  <div style={{ fontSize: 32, marginBottom: 10 }}>🏆</div>
                  <div
                    style={{
                      color: "rgba(255,255,255,.7)",
                      fontSize: 13,
                      fontFamily: "'Barlow',sans-serif",
                      lineHeight: 1.5,
                    }}
                  >
                    You're not in any leagues yet.
                    <br />
                    Create one or join with an invite code.
                  </div>
                </div>
              ) : (
                leagues.map((l) => (
                  <LeagueCard
                    key={l.id}
                    league={l}
                    selected={selected?.id === l.id}
                    onClick={() => selectLeague(l)}
                  />
                ))
              )}
            </div>

            {/* Right: detail */}
            <div>
              {!selected ? (
                <div
                  style={{
                    padding: "48px 20px",
                    textAlign: "center",
                    background: "rgba(255,255,255,.02)",
                    border: "1px solid rgba(255,255,255,.06)",
                    borderRadius: 14,
                    color: "rgba(255,255,255,.5)",
                    fontFamily: "'Barlow',sans-serif",
                    fontSize: 13,
                  }}
                >
                  ← Select a league to see standings
                </div>
              ) : (
                <div
                  style={{ display: "flex", flexDirection: "column", gap: 14 }}
                >
                  {/* League header */}
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 12,
                      flexWrap: "wrap",
                    }}
                  >
                    <div style={{ flex: 1 }}>
                      <div
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: 8,
                          marginBottom: 2,
                        }}
                      >
                        <h2
                          style={{
                            color: "white",
                            fontSize: 22,
                            fontWeight: 900,
                            margin: 0,
                            textTransform: "uppercase",
                          }}
                        >
                          {selected.name}
                        </h2>
                        <span
                          style={{
                            background: typeColor(selected.type) + "22",
                            border: `1px solid ${typeColor(selected.type)}44`,
                            borderRadius: 5,
                            padding: "2px 8px",
                            color: typeColor(selected.type),
                            fontSize: 9,
                            fontWeight: 800,
                            letterSpacing: ".12em",
                          }}
                        >
                          {typeLabel(selected.type)}
                        </span>
                        {isAdmin && (
                          <span
                            style={{
                              background: `${ACCENT}18`,
                              border: `1px solid ${ACCENT}33`,
                              borderRadius: 5,
                              padding: "2px 8px",
                              color: ACCENT,
                              fontSize: 9,
                              fontWeight: 700,
                            }}
                          >
                            ADMIN
                          </span>
                        )}
                      </div>
                      <div
                        style={{
                          color: "rgba(255,255,255,.6)",
                          fontSize: 11,
                          fontFamily: "'Barlow',sans-serif",
                        }}
                      >
                        Code:{" "}
                        <span
                          style={{
                            color: ACCENT,
                            fontWeight: 700,
                            letterSpacing: ".1em",
                          }}
                        >
                          {selected.code}
                        </span>
                        {detail && (
                          <>
                            <span style={{ margin: "0 8px", opacity: 0.3 }}>
                              ·
                            </span>
                            {detail.membersCount} members
                          </>
                        )}
                      </div>
                    </div>
                    <button
                      onClick={handleLeave}
                      style={{
                        ...secondaryBtn,
                        color: "#f87171",
                        borderColor: "rgba(239,68,68,.25)",
                      }}
                    >
                      Leave
                    </button>
                  </div>

                  {/* Tabs */}
                  <div style={{ display: "flex", gap: 4 }}>
                    {(["standings", "info"] as const).map((t) => {
                      const on = tab === t;
                      return (
                        <button
                          key={t}
                          onClick={() => setTab(t)}
                          style={{
                            padding: "7px 16px",
                            borderRadius: 8,
                            border: `1px solid ${on ? ACCENT + "44" : "rgba(255,255,255,.08)"}`,
                            background: on
                              ? `${ACCENT}12`
                              : "rgba(255,255,255,.03)",
                            color: on ? ACCENT : "rgba(255,255,255,.72)",
                            fontFamily: "'Barlow Condensed',sans-serif",
                            fontWeight: 700,
                            fontSize: 11,
                            letterSpacing: ".1em",
                            textTransform: "uppercase",
                            cursor: "pointer",
                            transition: "all .18s",
                          }}
                        >
                          {t === "standings" ? "Standings" : "Info"}
                        </button>
                      );
                    })}
                  </div>

                  {loadingSub && <Spinner label="Loading…" />}

                  {!loadingSub &&
                    tab === "standings" &&
                    (standings.length > 0 ? (
                      <StandingsTable
                        standings={standings}
                        myUserId={myUserId}
                      />
                    ) : (
                      <div
                        style={{
                          padding: "32px 0",
                          textAlign: "center",
                          color: "rgba(255,255,255,.5)",
                          fontFamily: "'Barlow',sans-serif",
                          fontSize: 13,
                        }}
                      >
                        No standings yet.
                      </div>
                    ))}

                  {!loadingSub && tab === "info" && detail && (
                    <div
                      style={{
                        background: "rgba(255,255,255,.03)",
                        border: "1px solid rgba(255,255,255,.07)",
                        borderRadius: 14,
                        padding: "18px 20px",
                        display: "flex",
                        flexDirection: "column",
                        gap: 12,
                      }}
                    >
                      {[
                        ["League Name", detail.name],
                        ["Type", typeLabel(detail.type)],
                        ["Invite Code", detail.code],
                        ["Members", String(detail.membersCount)],
                        [
                          "Created",
                          new Date(detail.createdAt).toLocaleDateString(
                            "en-GB",
                            { day: "numeric", month: "long", year: "numeric" },
                          ),
                        ],
                      ].map(([k, v]) => (
                        <div
                          key={k}
                          style={{
                            display: "flex",
                            justifyContent: "space-between",
                            alignItems: "center",
                            paddingBottom: 10,
                            borderBottom: "1px solid rgba(255,255,255,.05)",
                          }}
                        >
                          <span
                            style={{
                              color: "rgba(255,255,255,.65)",
                              fontSize: 11,
                              fontFamily: "'Barlow',sans-serif",
                            }}
                          >
                            {k}
                          </span>
                          <span
                            style={{
                              color:
                                k === "Invite Code"
                                  ? ACCENT
                                  : "rgba(255,255,255,.8)",
                              fontSize: 12,
                              fontWeight: 700,
                              letterSpacing: k === "Invite Code" ? ".12em" : 0,
                            }}
                          >
                            {v}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {modal === "create" && (
        <Modal onClose={() => setModal(null)}>
          <CreateLeagueModal
            onClose={() => setModal(null)}
            onCreate={(l) => {
              setLeagues((prev) => [l, ...prev]);
              showFeedback("ok", `${l.name} created! Code: ${l.code}`);
            }}
          />
        </Modal>
      )}
      {modal === "join" && (
        <Modal onClose={() => setModal(null)}>
          <JoinLeagueModal
            onClose={() => setModal(null)}
            onJoin={() => {
              loadLeagues();
              showFeedback("ok", "Joined league!");
            }}
          />
        </Modal>
      )}
    </div>
  );
}
